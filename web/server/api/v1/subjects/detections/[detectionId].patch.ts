/**
 * PATCH /api/v1/subjects/detections/:detectionId
 *
 * Update a subject detection.
 * Body:
 *   { action: 'confirm' }   — clears reviewNeeded flag (user confirmed this is correct)
 *   { action: 'dismiss' }   — unlinks detection from subject (subjectId → null)
 *   { setCover: true }      — sets this detection as the subject's representativeDetectionId
 */
import { eq } from 'drizzle-orm'
import { db } from '~/server/db'
import { subjectDetections, subjects } from '~/server/db/schema'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const detectionId = Number(getRouterParam(event, 'detectionId'))
  if (!detectionId || isNaN(detectionId))
    throw createError({ statusCode: 400, message: 'Detection ID required' })

  const body = await readBody<{ action?: 'confirm' | 'dismiss'; setCover?: boolean }>(event)

  const [det] = await db
    .select()
    .from(subjectDetections)
    .where(eq(subjectDetections.id, detectionId))
    .limit(1)

  if (!det) throw createError({ statusCode: 404, message: 'Detection not found' })

  if (body.action === 'confirm') {
    await db
      .update(subjectDetections)
      .set({ reviewNeeded: 0 })
      .where(eq(subjectDetections.id, detectionId))
  } else if (body.action === 'dismiss') {
    // Unlink from subject — detection remains in DB but no longer associated
    await db
      .update(subjectDetections)
      .set({ subjectId: null, reviewNeeded: 0 })
      .where(eq(subjectDetections.id, detectionId))

    // If this was the representative detection for the subject, clear it
    if (det.subjectId) {
      const [subject] = await db
        .select({ representativeDetectionId: subjects.representativeDetectionId })
        .from(subjects)
        .where(eq(subjects.id, det.subjectId))
        .limit(1)

      if (subject?.representativeDetectionId === detectionId) {
        // Pick the next best detection as representative
        const [next] = await db
          .select({ id: subjectDetections.id })
          .from(subjectDetections)
          .where(eq(subjectDetections.subjectId, det.subjectId))
          .limit(1)

        await db
          .update(subjects)
          .set({ representativeDetectionId: next?.id ?? null, updatedAt: new Date() })
          .where(eq(subjects.id, det.subjectId))
      }
    }
  }

  if (body.setCover && det.subjectId) {
    // Set both coverMediaId (direct pointer, takes priority in thumbnail lookup)
    // and representativeDetectionId (preserves the face-crop bbox context).
    await db
      .update(subjects)
      .set({
        coverMediaId:              det.mediaId,
        representativeDetectionId: detectionId,
        updatedAt:                 new Date(),
      })
      .where(eq(subjects.id, det.subjectId))
  }

  return { ok: true }
})
