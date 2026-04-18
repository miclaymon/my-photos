/**
 * OCR Job — Tesseract.js
 *
 * Extracts text from images and stores results in `media_ocr`.
 * Also updates `media.ocrProcessedAt` to mark completion.
 *
 * Tesseract language packs (~4 MB for English) are downloaded on first run
 * and cached by Tesseract in its default cache directory.
 */
import { eq, isNull, and, type SQL } from 'drizzle-orm'
import { db } from '~/server/db'
import { media, libraryMedia, mediaOcr } from '~/server/db/schema'
import { loadImageBuffer } from './lib/imageLoader'
import type { JobOptions, StatusUpdater } from './types'

// Tesseract worker singleton — created once, reused across all items
let _worker: import('tesseract.js').Worker | null = null

async function getWorker() {
  if (_worker) return _worker
  const { createWorker } = await import('tesseract.js')
  _worker = await createWorker('eng', 1, {
    logger: () => {},  // suppress per-progress logs
  })
  return _worker
}

export async function runOcrJob(opts: JobOptions, update: StatusUpdater) {
  let processed = 0
  let errors    = 0

  update({ currentItem: 'Initialising Tesseract worker…' })
  const worker = await getWorker()

  // ── Fetch unprocessed images ────────────────────────────────────────────────
  const whereClause: SQL | undefined = (() => {
    const hasLib = !!opts.libraryId
    if (!opts.reprocess && hasLib)  return and(isNull(media.ocrProcessedAt), eq(libraryMedia.libraryId, opts.libraryId!))
    if (!opts.reprocess && !hasLib) return isNull(media.ocrProcessedAt)
    if (opts.reprocess  && hasLib)  return eq(libraryMedia.libraryId, opts.libraryId!)
    return undefined
  })()

  const rows = await db
    .select({
      id:               media.id,
      objectKey:        media.objectKey,
      originalFilename: media.originalFilename,
      contentType:      media.contentType,
    })
    .from(media)
    .innerJoin(libraryMedia, eq(media.id, libraryMedia.mediaId))
    .where(whereClause)

  const seen = new Set<string>()
  const rows2 = rows.filter(r => seen.has(r.id) ? false : (seen.add(r.id), true))

  update({ total: rows2.length })

  for (const item of rows2) {
    update({ currentItem: item.originalFilename })

    // OCR only applies to images
    if (!item.contentType.startsWith('image/')) {
      processed++
      update({ processed })
      await markProcessed(item.id)
      continue
    }

    try {
      const buffer = await loadImageBuffer(item.objectKey)

      // Run OCR — tesseract.js accepts a Buffer directly
      const { data } = await worker.recognize(buffer)
      const text       = (data.text ?? '').trim()
      const confidence = data.confidence

      // Upsert OCR result (overwrite if reprocessing)
      await db
        .delete(mediaOcr)
        .where(eq(mediaOcr.mediaId, item.id))

      if (text.length > 0) {
        // Cap stored text at 64 KB to prevent runaway growth
        const cappedText = text.slice(0, 65_536)
        await db.insert(mediaOcr).values({
          mediaId:     item.id,
          text:        cappedText,
          confidence:  confidence ?? null,
          processedAt: new Date(),
        })
      }

      await markProcessed(item.id)
      processed++
      update({ processed })
    } catch (err) {
      console.error(`[ocr] ${item.originalFilename}:`, err)
      errors++
      processed++
      update({ processed, errors, lastError: `${item.originalFilename}: ${String(err)}` })
    }
  }
}

async function markProcessed(mediaId: string) {
  await db
    .update(media)
    .set({ ocrProcessedAt: new Date() })
    .where(eq(media.id, mediaId))
}
