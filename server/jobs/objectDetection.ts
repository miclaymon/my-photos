/**
 * Object Detection Job — COCO-SSD via TensorFlow.js
 *
 * Detects objects in images and stores results in `media_objects`.
 * Animal classes (cat, dog, bird, etc.) also upsert a corresponding
 * `subjects` row (type='pet') for the library.
 *
 * Model weights (~25 MB) are downloaded from tf-hub on first run and cached.
 *
 * Quality thresholds:
 *   MIN_CONFIDENCE  0.35 — minimum score to persist any detection
 *   PET_THRESHOLD   0.65 — minimum score to create/associate a pet subject
 *   NMS_IOU         0.45 — IoU overlap above which weaker same-class boxes are suppressed
 *
 * Non-Maximum Suppression (NMS) is applied per class to eliminate duplicate
 * overlapping boxes for the same object (common with COCO-SSD mobilenet_v2).
 */
import { eq, isNull, and, type SQL } from 'drizzle-orm'
import { db } from '~/server/db'
import { media, libraryMedia, mediaObjects, subjects } from '~/server/db/schema'
import { loadImageBuffer } from './lib/imageLoader'
import { extractVideoFrames } from './lib/videoFrameExtractor'
import type { JobOptions, StatusUpdater } from './types'

const PET_CLASSES = new Set(['cat', 'dog', 'bird', 'horse', 'sheep', 'cow', 'bear'])

// Quality thresholds
const MIN_CONFIDENCE = 0.35  // minimum score to save any detection
const PET_THRESHOLD  = 0.65  // minimum score to create / associate a pet subject
const NMS_IOU        = 0.45  // IoU threshold for non-maximum suppression

// ── Non-Maximum Suppression ───────────────────────────────────────────────────

type BBox = [number, number, number, number]  // [x, y, w, h] pixel coords

function iou(a: BBox, b: BBox): number {
  const ax2 = a[0] + a[2], ay2 = a[1] + a[3]
  const bx2 = b[0] + b[2], by2 = b[1] + b[3]
  const ix1 = Math.max(a[0], b[0]), iy1 = Math.max(a[1], b[1])
  const ix2 = Math.min(ax2, bx2),   iy2 = Math.min(ay2, by2)
  const interArea = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1)
  if (interArea === 0) return 0
  const unionArea = a[2] * a[3] + b[2] * b[3] - interArea
  return interArea / unionArea
}

interface Prediction { class: string; score: number; bbox: BBox }

/**
 * Applies per-class NMS: for each class, sort by score descending and
 * suppress any box whose IoU with a higher-scoring box exceeds NMS_IOU.
 */
function applyNMS(predictions: Prediction[]): Prediction[] {
  const byClass = new Map<string, Prediction[]>()
  for (const p of predictions) {
    const arr = byClass.get(p.class) ?? []
    arr.push(p)
    byClass.set(p.class, arr)
  }

  const kept: Prediction[] = []
  for (const preds of byClass.values()) {
    const sorted     = [...preds].sort((a, b) => b.score - a.score)
    const suppressed = new Set<number>()
    for (let i = 0; i < sorted.length; i++) {
      if (suppressed.has(i)) continue
      kept.push(sorted[i]!)
      for (let j = i + 1; j < sorted.length; j++) {
        if (!suppressed.has(j) && iou(sorted[i]!.bbox, sorted[j]!.bbox) > NMS_IOU) {
          suppressed.add(j)
        }
      }
    }
  }
  return kept
}

let _model: import('@tensorflow-models/coco-ssd').ObjectDetection | null = null

async function getModel() {
  if (_model) return _model
  await import('@tensorflow/tfjs-node')
  const cocoSsd = await import('@tensorflow-models/coco-ssd')
  _model = await cocoSsd.load({ base: 'mobilenet_v2' })
  return _model
}

export async function runObjectDetectionJob(opts: JobOptions, update: StatusUpdater) {
  let processed = 0
  let errors    = 0

  update({ currentItem: 'Loading COCO-SSD model…' })
  const model = await getModel()
  const tf    = (await import('@tensorflow/tfjs-node')).default ?? await import('@tensorflow/tfjs-node')

  // ── Fetch unprocessed media ─────────────────────────────────────────────────
  const whereClause: SQL | undefined = (() => {
    const hasLib = !!opts.libraryId
    if (!opts.reprocess && hasLib)  return and(isNull(media.objectsProcessedAt), eq(libraryMedia.libraryId, opts.libraryId!))
    if (!opts.reprocess && !hasLib) return isNull(media.objectsProcessedAt)
    if (opts.reprocess  && hasLib)  return eq(libraryMedia.libraryId, opts.libraryId!)
    return undefined
  })()

  const rows = await db
    .select({
      id:               media.id,
      objectKey:        media.objectKey,
      originalFilename: media.originalFilename,
      contentType:      media.contentType,
      libraryId:        libraryMedia.libraryId,
      durationSeconds:  media.durationSeconds,
    })
    .from(media)
    .innerJoin(libraryMedia, eq(media.id, libraryMedia.mediaId))
    .where(whereClause)

  // Deduplicate: a media item may appear in multiple libraries
  const seen = new Set<string>()
  const rows2 = rows.filter(r => seen.has(r.id) ? false : (seen.add(r.id), true))

  update({ total: rows2.length })

  for (const item of rows2) {
    update({ currentItem: item.originalFilename })

    const isVideo = item.contentType.startsWith('video/')

    // Skip non-image, non-video files (e.g. raw formats not yet supported)
    if (!item.contentType.startsWith('image/') && !isVideo) {
      processed++
      update({ processed })
      await markProcessed(item.id)
      continue
    }

    try {
      const buffer = await loadImageBuffer(item.objectKey)

      // For videos: extract frames and aggregate best detection per class.
      // For images: treat as a single-element frame list.
      let frameBuffers: Buffer[]
      if (isVideo) {
        const frames = await extractVideoFrames(buffer, item.durationSeconds ?? null)
        if (frames.length === 0) {
          // ffmpeg failed — mark processed so we don't retry forever
          await markProcessed(item.id)
          processed++
          update({ processed })
          continue
        }
        frameBuffers = frames.map(f => f.buffer)
      } else {
        frameBuffers = [buffer]
      }

      // Aggregate best-per-class across all frames, then apply NMS.
      const bestPerClass = new Map<string, Prediction>()

      for (const fb of frameBuffers) {
        const imageTensor = tf.node.decodeImage(new Uint8Array(fb), 3) as Parameters<typeof model.detect>[0]
        const predictions = await model.detect(imageTensor)
        // @ts-ignore
        imageTensor.dispose?.()

        for (const p of predictions as Prediction[]) {
          if (p.score < MIN_CONFIDENCE) continue
          const existing = bestPerClass.get(p.class)
          if (!existing || p.score > existing.score) bestPerClass.set(p.class, p)
        }
      }

      const qualifiedPredictions = applyNMS(Array.from(bestPerClass.values()))

      if (qualifiedPredictions.length > 0) {
        const now = new Date()

        // Wipe previous detections for this item (idempotent re-run)
        await db.delete(mediaObjects).where(eq(mediaObjects.mediaId, item.id))

        await db.insert(mediaObjects).values(
          qualifiedPredictions.map(p => ({
            mediaId:     item.id,
            class:       p.class,
            confidence:  p.score,
            boundingBox: JSON.stringify({
              x: Math.round(p.bbox[0]),
              y: Math.round(p.bbox[1]),
              w: Math.round(p.bbox[2]),
              h: Math.round(p.bbox[3]),
            }),
            detectedAt: now,
          })),
        )

        // Create pet subjects for high-confidence animal detections
        const pets = qualifiedPredictions.filter(p => PET_CLASSES.has(p.class) && p.score >= PET_THRESHOLD)
        const seenClasses = new Set<string>()
        for (const pred of pets) {
          if (seenClasses.has(pred.class)) continue
          seenClasses.add(pred.class)

          const libraryId   = item.libraryId
          const classLower  = pred.class.toLowerCase()
          const allPets = await db
            .select({ id: subjects.id, petClass: subjects.petClass })
            .from(subjects)
            .where(and(
              eq(subjects.libraryId, libraryId),
              eq(subjects.type, 'pet'),
            ))

          const alreadyExists = allPets.some(s => {
            try {
              const classes = JSON.parse(s.petClass ?? '[]') as string[]
              return classes.includes(classLower)
            } catch { return false }
          })

          if (!alreadyExists) {
            await db.insert(subjects).values({
              id:        crypto.randomUUID(),
              libraryId,
              type:      'pet',
              name:      capitalise(pred.class),
              petClass:  JSON.stringify([classLower]),
              createdAt: now,
              updatedAt: now,
            })
          }
        }
      }

      await markProcessed(item.id)
      processed++
      update({ processed })
    } catch (err) {
      console.error(`[object-detection] ${item.originalFilename}:`, err)
      errors++
      processed++
      update({ processed, errors, lastError: `${item.originalFilename}: ${String(err)}` })
    }
  }
}

async function markProcessed(mediaId: string) {
  await db
    .update(media)
    .set({ objectsProcessedAt: new Date() })
    .where(eq(media.id, mediaId))
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
