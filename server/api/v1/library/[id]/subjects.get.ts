/**
 * GET /api/v1/library/:id/subjects
 *
 * Returns all subjects (people & pets) identified in the library, with:
 *   - metadata (id, type, name, hidden)
 *   - photoCount — number of distinct photos containing this subject
 *   - thumbnailUrl — presigned URL for the representative photo
 *   - boundingBox — face/pet bbox as fractions 0–1 (for face crop display)
 *
 * Ordered: visible subjects first (people, then pets), then hidden.
 */
import { eq, and, desc, sql, inArray } from 'drizzle-orm'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { db } from '~/server/db'
import {
  subjects, subjectDetections, mediaObjects, media, libraryMedia,
} from '~/server/db/schema'
import { getStorageClient, getStorageBucket } from '~/server/utils/storage'

const URL_EXPIRY = 3600

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const libraryId = getRouterParam(event, 'id')
  if (!libraryId) throw createError({ statusCode: 400, message: 'Library ID required' })

  const client = getStorageClient()
  const bucket = getStorageBucket()

  const presign = (key: string) =>
    getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: URL_EXPIRY })
      .catch(() => null)

  // ── Fetch all subjects for this library ────────────────────────────────────
  const subjectRows = await db
    .select()
    .from(subjects)
    .where(eq(subjects.libraryId, libraryId))
    .orderBy(subjects.type, subjects.name)

  const result = await Promise.all(subjectRows.map(async (subject) => {
    let photoCount   = 0
    let thumbnailUrl: string | null = null
    let boundingBox: { x: number; y: number; w: number; h: number } | null = null

    if (subject.type === 'person') {
      // Count distinct photos with a detection for this subject
      const [countRow] = await db
        .select({ n: sql<number>`count(distinct ${subjectDetections.mediaId})` })
        .from(subjectDetections)
        .where(eq(subjectDetections.subjectId, subject.id))
      photoCount = countRow?.n ?? 0

      // Cover photo: user-selected coverMediaId takes priority over representative detection
      const coverMediaId = subject.coverMediaId
      if (coverMediaId) {
        const [mediaRow] = await db
          .select({ objectKey: media.objectKey, thumbnailObjectKey: media.thumbnailObjectKey })
          .from(media)
          .where(eq(media.id, coverMediaId))
          .limit(1)
        if (mediaRow) thumbnailUrl = await presign(mediaRow.thumbnailObjectKey ?? mediaRow.objectKey)
        // No face bbox for user-picked cover — show full image
      } else if (subject.representativeDetectionId) {
        const [det] = await db
          .select({
            mediaId:     subjectDetections.mediaId,
            boundingBox: subjectDetections.boundingBox,
          })
          .from(subjectDetections)
          .where(eq(subjectDetections.id, subject.representativeDetectionId))
          .limit(1)

        if (det) {
          const [mediaRow] = await db
            .select({ objectKey: media.objectKey, thumbnailObjectKey: media.thumbnailObjectKey })
            .from(media)
            .where(eq(media.id, det.mediaId))
            .limit(1)

          if (mediaRow) {
            thumbnailUrl = await presign(mediaRow.thumbnailObjectKey ?? mediaRow.objectKey)
            try { boundingBox = JSON.parse(det.boundingBox) } catch { /* ignore */ }
          }
        }
      }
    } else {
      // type === 'pet' — representative photo from media_objects
      // petClass is a JSON string[] of COCO class names (supports merged subjects)
      let petClasses: string[] = []
      try { petClasses = JSON.parse(subject.petClass ?? '[]') } catch { /* ignore */ }
      // Fall back to lowercased name for subjects created before the migration
      if (!petClasses.length && subject.name) petClasses = [subject.name.toLowerCase()]
      if (!petClasses.length) petClasses = ['__none__']

      const classFilter = petClasses.length === 1
        ? eq(mediaObjects.class, petClasses[0])
        : inArray(mediaObjects.class, petClasses)

      // Count distinct photos in this library that have any of these classes
      const [countRow] = await db
        .select({ n: sql<number>`count(distinct ${mediaObjects.mediaId})` })
        .from(mediaObjects)
        .innerJoin(libraryMedia, and(
          eq(mediaObjects.mediaId, libraryMedia.mediaId),
          eq(libraryMedia.libraryId, libraryId),
        ))
        .where(classFilter)
      photoCount = countRow?.n ?? 0

      // Best-confidence detection for thumbnail
      const [topObj] = await db
        .select({
          mediaId:     mediaObjects.mediaId,
          boundingBox: mediaObjects.boundingBox,
        })
        .from(mediaObjects)
        .innerJoin(libraryMedia, and(
          eq(mediaObjects.mediaId, libraryMedia.mediaId),
          eq(libraryMedia.libraryId, libraryId),
        ))
        .where(classFilter)
        .orderBy(desc(mediaObjects.confidence))
        .limit(1)

      if (topObj) {
        const [mediaRow] = await db
          .select({ objectKey: media.objectKey, thumbnailObjectKey: media.thumbnailObjectKey, width: media.width, height: media.height })
          .from(media)
          .where(eq(media.id, topObj.mediaId))
          .limit(1)

        if (mediaRow) {
          thumbnailUrl = await presign(mediaRow.thumbnailObjectKey ?? mediaRow.objectKey)
          // Pet bounding boxes are stored in pixels — convert to fractions using stored dims
          if (mediaRow.width && mediaRow.height) {
            try {
              const px = JSON.parse(topObj.boundingBox)
              boundingBox = {
                x: px.x / mediaRow.width,
                y: px.y / mediaRow.height,
                w: px.w / mediaRow.width,
                h: px.h / mediaRow.height,
              }
            } catch { /* ignore */ }
          }
        }
      }
    }

    return {
      id:          subject.id,
      type:        subject.type,
      name:        subject.name,
      hidden:      !!subject.hidden,
      photoCount,
      thumbnailUrl,
      boundingBox,
    }
  }))

  return { subjects: result }
})
