/**
 * POST /api/v1/admin/subjects/reset
 *
 * Resets detection data so jobs can be re-run cleanly.
 * Dev/admin only — returns 404 in production.
 *
 * Body: {
 *   libraryId?: string   — scope to one library (omit for all)
 *   what: 'processing' | 'detections' | 'all'
 *     processing  — clears objects_processed_at / faces_processed_at / ocr_processed_at
 *                   so jobs pick up all media on the next run, but keeps subjects/detections.
 *     detections  — removes subjects, subject_detections, media_objects, media_ocr rows.
 *     all         — both of the above (full clean slate).
 * }
 */
import { eq, inArray } from 'drizzle-orm'
import { db } from '~/server/db'
import { media, libraryMedia, subjects, subjectDetections, mediaObjects, mediaOcr } from '~/server/db/schema'

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production')
    throw createError({ statusCode: 404 })

  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const body = await readBody<{ libraryId?: string; what: 'processing' | 'detections' | 'all' }>(event)

  if (!body?.what || !['processing', 'detections', 'all'].includes(body.what))
    throw createError({ statusCode: 400, message: 'what must be processing | detections | all' })

  const libraryId = body.libraryId?.trim() || null
  const counts: Record<string, number> = {}

  // ── Resolve affected mediaIds for scoped resets ────────────────────────────
  let affectedMediaIds: string[] | null = null   // null = all
  if (libraryId) {
    const rows = await db
      .select({ mediaId: libraryMedia.mediaId })
      .from(libraryMedia)
      .where(eq(libraryMedia.libraryId, libraryId))
    affectedMediaIds = rows.map(r => r.mediaId)
  }

  // ── Clear processed_at timestamps ─────────────────────────────────────────
  if (body.what === 'processing' || body.what === 'all') {
    const update = { objectsProcessedAt: null, facesProcessedAt: null, ocrProcessedAt: null } as any

    if (affectedMediaIds === null) {
      const res = await db.update(media).set(update)
      counts.mediaReset = (res as any).changes ?? 0
    } else if (affectedMediaIds.length > 0) {
      await db.update(media).set(update).where(inArray(media.id, affectedMediaIds))
      counts.mediaReset = affectedMediaIds.length
    }
  }

  // ── Delete detection rows ─────────────────────────────────────────────────
  if (body.what === 'detections' || body.what === 'all') {
    if (libraryId) {
      // Delete subjects for this library (cascades subject_detections via app-level)
      const librarySubjects = await db
        .select({ id: subjects.id })
        .from(subjects)
        .where(eq(subjects.libraryId, libraryId))

      const subjectIds = librarySubjects.map(s => s.id)

      if (subjectIds.length > 0) {
        await db.delete(subjectDetections).where(inArray(subjectDetections.subjectId, subjectIds))
        await db.delete(subjects).where(inArray(subjects.id, subjectIds))
        counts.subjectsDeleted = subjectIds.length
      }

      if (affectedMediaIds && affectedMediaIds.length > 0) {
        await db.delete(mediaObjects).where(inArray(mediaObjects.mediaId, affectedMediaIds))
        await db.delete(mediaOcr).where(inArray(mediaOcr.mediaId, affectedMediaIds))
        counts.objectsDeleted = affectedMediaIds.length
      }

      // Also delete detections for media in this library that belong to cross-library subjects
      if (affectedMediaIds && affectedMediaIds.length > 0) {
        await db.delete(subjectDetections).where(inArray(subjectDetections.mediaId, affectedMediaIds))
      }
    } else {
      // Full global reset
      await db.delete(subjectDetections)
      await db.delete(subjects)
      await db.delete(mediaObjects)
      await db.delete(mediaOcr)
      counts.fullReset = 1
    }
  }

  return { ok: true, counts }
})
