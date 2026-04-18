/**
 * Face Grouping Job — face-api.js via TensorFlow.js
 *
 * For each unprocessed image:
 *   1. Run face detection to get bounding boxes + 128-d face descriptors
 *   2. Compare each face against ALL stored descriptors for every known subject
 *      (not just the representative centroid) — uses minimum distance across
 *      all known faces for that subject, which is more robust.
 *   3. If best match < CLUSTER_THRESHOLD AND gap to second-best is meaningful:
 *      assign to existing subject and store matchDistance.
 *      If match distance > REVIEW_THRESHOLD: flag reviewNeeded = 1.
 *   4. Otherwise create a new unnamed subject.
 *   5. Persist to subject_detections; set representativeDetectionId if first.
 *
 * CLUSTER_THRESHOLD  0.50 — must be below this to count as a match
 * REVIEW_THRESHOLD   0.38 — above this (but below cluster) → flag for review
 * MIN_GAP            0.05 — best match must be at least this much closer than
 *                           the second-best; if not, the match is ambiguous and
 *                           reviewNeeded is set regardless of REVIEW_THRESHOLD
 *
 * After merge operations the in-memory descriptor pool is rebuilt on the next
 * job run, so merged subjects naturally absorb new similar faces.
 */
import { eq, isNull, and, type SQL } from 'drizzle-orm'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { db } from '~/server/db'
import { media, libraryMedia, subjects, subjectDetections } from '~/server/db/schema'
import { loadImageBuffer } from './lib/imageLoader'
import { extractVideoFrames } from './lib/videoFrameExtractor'
import type { JobOptions, StatusUpdater } from './types'

const CLUSTER_THRESHOLD = 0.50  // Euclidean; below this → same subject
const REVIEW_THRESHOLD  = 0.38  // above this (but below cluster) → needs review
const MIN_GAP           = 0.05  // best must beat second-best by at least this to be unambiguous

// ── Model singleton ───────────────────────────────────────────────────────────

let _faceapiLoaded = false

async function loadModels() {
  if (_faceapiLoaded) return
  await import('@tensorflow/tfjs-node')

  const faceapi = await import('@vladmandic/face-api')

  const require   = createRequire(import.meta.url)
  const pkgJson   = require.resolve('@vladmandic/face-api/package.json')
  const modelPath = join(dirname(pkgJson), 'model')

  await Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromDisk(modelPath),
    faceapi.nets.faceLandmark68Net.loadFromDisk(modelPath),
    faceapi.nets.faceRecognitionNet.loadFromDisk(modelPath),
  ])
  _faceapiLoaded = true
}

// ── Clustering helpers ────────────────────────────────────────────────────────

function euclidean(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i]
    sum += d * d
  }
  return Math.sqrt(sum)
}

/** All stored descriptors for a subject, used for nearest-neighbour matching. */
interface SubjectPool {
  subjectId:   string
  libraryId:   string
  descriptors: number[][]  // all known face descriptors for this subject
}

// ── Job ───────────────────────────────────────────────────────────────────────

export async function runFaceGroupingJob(opts: JobOptions, update: StatusUpdater) {
  let processed = 0
  let errors    = 0

  update({ currentItem: 'Loading face-api models…' })
  await loadModels()

  const faceapi = await import('@vladmandic/face-api')
  const tf      = (await import('@tensorflow/tfjs-node')).default ?? await import('@tensorflow/tfjs-node')

  // ── Load ALL descriptors for existing subjects ─────────────────────────────
  // Using all stored descriptors (not just the representative) gives a much
  // better match: the minimum distance across all known faces is used.
  update({ currentItem: 'Loading subject descriptors…' })

  const subjectWhere = opts.libraryId
    ? and(eq(subjects.type, 'person'), eq(subjects.libraryId, opts.libraryId))
    : eq(subjects.type, 'person')

  const existingSubjects = await db
    .select({ id: subjects.id, libraryId: subjects.libraryId })
    .from(subjects)
    .where(subjectWhere)

  const pools: SubjectPool[] = []

  for (const s of existingSubjects) {
    const rows = await db
      .select({ descriptor: subjectDetections.descriptor })
      .from(subjectDetections)
      .where(eq(subjectDetections.subjectId, s.id))

    const descriptors = rows
      .filter(r => !!r.descriptor)
      .map(r => JSON.parse(r.descriptor!) as number[])

    if (descriptors.length > 0) {
      pools.push({ subjectId: s.id, libraryId: s.libraryId, descriptors })
    }
  }

  // ── Fetch unprocessed images ────────────────────────────────────────────────
  const whereClause: SQL | undefined = (() => {
    const hasLib = !!opts.libraryId
    if (!opts.reprocess && hasLib)  return and(isNull(media.facesProcessedAt), eq(libraryMedia.libraryId, opts.libraryId!))
    if (!opts.reprocess && !hasLib) return isNull(media.facesProcessedAt)
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

  const seen = new Set<string>()
  const rows2 = rows.filter(r => seen.has(r.id) ? false : (seen.add(r.id), true))

  update({ total: rows2.length })

  for (const item of rows2) {
    update({ currentItem: item.originalFilename })

    const isVideo = item.contentType.startsWith('video/')

    if (!item.contentType.startsWith('image/') && !isVideo) {
      processed++
      update({ processed })
      await markProcessed(item.id)
      continue
    }

    try {
      const buffer = await loadImageBuffer(item.objectKey)

      // Build a list of frame buffers (one for images, many for videos)
      const frameBuffers: Buffer[] = []

      if (isVideo) {
        const frames = await extractVideoFrames(buffer, item.durationSeconds ?? null)
        if (frames.length === 0) {
          await markProcessed(item.id)
          processed++
          update({ processed })
          continue
        }
        for (const f of frames) frameBuffers.push(f.buffer)
      } else {
        frameBuffers.push(buffer)
      }

      // ── Run face-api on every frame ─────────────────────────────────────────
      // For videos, aggregate: track the best (highest-confidence) detection
      // per subject across all frames. Only one subjectDetections row is written
      // per (mediaId, subjectId) — we pick the best bbox from any frame.

      interface BestDet {
        descriptor:   number[]
        confidence:   number
        matchDistance: number | null
        reviewNeeded: number
        boundingBox:  { x: number; y: number; w: number; h: number }
      }
      const bestDetBySubject = new Map<string, BestDet>()

      const now       = new Date()
      const libraryId = item.libraryId
      let anyFaces    = false

      for (const frameBuf of frameBuffers) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const imageTensor = tf.node.decodeImage(new Uint8Array(frameBuf), 3) as any
        const imgH: number = imageTensor.shape?.[0] ?? 720
        const imgW: number = imageTensor.shape?.[1] ?? 1280

        const detections = await faceapi
          .detectAllFaces(imageTensor, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
          .withFaceLandmarks()
          .withFaceDescriptors()

        // @ts-ignore
        imageTensor.dispose?.()

        for (const det of detections) {
          anyFaces = true
          const { box }    = det.detection
          const descriptor = Array.from(det.descriptor)
          const confidence = det.detection.score
          const boundingBox = {
            x: box.x      / imgW,
            y: box.y      / imgH,
            w: box.width  / imgW,
            h: box.height / imgH,
          }

          // ── Match against known subject pools ──────────────────────────
          let bestSubjectId: string | null = null
          let bestDistance  = Infinity
          let secondBest    = Infinity

          for (const pool of pools) {
            if (pool.libraryId !== libraryId) continue
            const minDist = Math.min(...pool.descriptors.map(d => euclidean(descriptor, d)))
            if (minDist < bestDistance) {
              secondBest    = bestDistance
              bestDistance  = minDist
              bestSubjectId = pool.subjectId
            } else if (minDist < secondBest) {
              secondBest = minDist
            }
          }

          let subjectId: string
          let matchDistance: number | null = null
          let reviewNeeded = 0

          if (bestSubjectId && bestDistance < CLUSTER_THRESHOLD) {
            subjectId     = bestSubjectId
            matchDistance = bestDistance
            const ambiguous = secondBest - bestDistance < MIN_GAP
            reviewNeeded = (bestDistance > REVIEW_THRESHOLD || ambiguous) ? 1 : 0
            // Expand pool for subsequent faces in the same job run
            const pool = pools.find(p => p.subjectId === subjectId)
            if (pool) pool.descriptors.push(descriptor)
          } else {
            subjectId = crypto.randomUUID()
            await db.insert(subjects).values({
              id:        subjectId,
              libraryId,
              type:      'person',
              createdAt: now,
              updatedAt: now,
            })
            pools.push({ subjectId, libraryId, descriptors: [descriptor] })
          }

          // Keep only the highest-confidence detection per subject for this media item
          const existing = bestDetBySubject.get(subjectId)
          if (!existing || confidence > existing.confidence) {
            bestDetBySubject.set(subjectId, {
              descriptor, confidence, matchDistance, reviewNeeded, boundingBox,
            })
          }
        }
      }

      if (!anyFaces) {
        await markProcessed(item.id)
        processed++
        update({ processed })
        continue
      }

      // Wipe previous detections for this item (idempotent on reprocess)
      await db.delete(subjectDetections).where(eq(subjectDetections.mediaId, item.id))

      // Insert one row per subject, using best detection across all frames
      for (const [subjectId, best] of bestDetBySubject) {
        const [inserted] = await db
          .insert(subjectDetections)
          .values({
            mediaId:      item.id,
            subjectId,
            boundingBox:  JSON.stringify(best.boundingBox),
            descriptor:   JSON.stringify(best.descriptor),
            confidence:   best.confidence,
            matchDistance: best.matchDistance,
            reviewNeeded: best.reviewNeeded,
            detectedAt:   now,
          })
          .returning({ id: subjectDetections.id })

        // Set representative detection if this subject doesn't have one yet
        const [subj] = await db
          .select({ representativeDetectionId: subjects.representativeDetectionId })
          .from(subjects)
          .where(eq(subjects.id, subjectId))
          .limit(1)

        if (subj && !subj.representativeDetectionId && inserted?.id) {
          await db
            .update(subjects)
            .set({ representativeDetectionId: inserted.id, updatedAt: now })
            .where(eq(subjects.id, subjectId))
        }
      }

      await markProcessed(item.id)
      processed++
      update({ processed })
    } catch (err) {
      console.error(`[face-grouping] ${item.originalFilename}:`, err)
      errors++
      processed++
      update({ processed, errors, lastError: `${item.originalFilename}: ${String(err)}` })
    }
  }
}

async function markProcessed(mediaId: string) {
  await db.update(media).set({ facesProcessedAt: new Date() }).where(eq(media.id, mediaId))
}
