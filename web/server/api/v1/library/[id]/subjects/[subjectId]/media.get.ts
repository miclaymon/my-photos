/**
 * GET /api/v1/library/:id/subjects/:subjectId/media
 *
 * Returns all media items for a subject with per-item confidence data.
 *
 * For person subjects: each row comes from subject_detections.
 *   - matchDistance: Euclidean distance to centroid (lower = more confident)
 *   - confidence: face detection score from face-api
 *   - boundingBox: face bbox as fractions 0–1
 *
 * For pet subjects: each row comes from media_objects matching petClass.
 *   - confidence: COCO-SSD object detection score
 *   - boundingBox: bbox as fractions 0–1 (converted from pixels using media dims)
 *   - matchDistance: null (class-based, not descriptor-based)
 *
 * Sorted by confidence descending.
 */
import { eq, and, desc, inArray } from 'drizzle-orm'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { db } from '~/server/db'
import { subjects, subjectDetections, mediaObjects, media, libraryMedia } from '~/server/db/schema'
import { getStorageClient, getStorageBucket } from '~/server/utils/storage'

const URL_EXPIRY = 3600

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const libraryId  = getRouterParam(event, 'id')
  const subjectId  = getRouterParam(event, 'subjectId')
  if (!libraryId || !subjectId) throw createError({ statusCode: 400, message: 'Library and subject IDs required' })

  const [subject] = await db
    .select()
    .from(subjects)
    .where(and(eq(subjects.id, subjectId), eq(subjects.libraryId, libraryId)))
    .limit(1)

  if (!subject) throw createError({ statusCode: 404, message: 'Subject not found' })

  const client = getStorageClient()
  const bucket  = getStorageBucket()
  const presign = (key: string) =>
    getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: URL_EXPIRY })
      .catch(() => null)

  interface MediaItem {
    detectionId:   number | null   // subject_detections.id (persons only)
    mediaId:       string
    confidence:    number
    matchDistance: number | null
    reviewNeeded:  boolean
    boundingBox:   { x: number; y: number; w: number; h: number } | null
    thumbnailUrl:  string | null
    imageUrl:      string | null   // presigned URL for full-size image
    originalFilename: string
    takenAt:       Date | null
    width:         number | null
    height:        number | null
  }

  const items: MediaItem[] = []

  if (subject.type === 'person') {
    const detections = await db
      .select({
        id:            subjectDetections.id,
        mediaId:       subjectDetections.mediaId,
        boundingBox:   subjectDetections.boundingBox,
        confidence:    subjectDetections.confidence,
        matchDistance: subjectDetections.matchDistance,
        reviewNeeded:  subjectDetections.reviewNeeded,
      })
      .from(subjectDetections)
      .where(eq(subjectDetections.subjectId, subjectId))
      .orderBy(desc(subjectDetections.confidence))

    for (const det of detections) {
      const [m] = await db
        .select({
          objectKey:        media.objectKey,
          thumbnailObjectKey: media.thumbnailObjectKey,
          originalFilename: media.originalFilename,
          takenAt:          media.takenAt,
          width:            media.width,
          height:           media.height,
        })
        .from(media)
        .where(eq(media.id, det.mediaId))
        .limit(1)

      if (!m) continue

      let bbox: { x: number; y: number; w: number; h: number } | null = null
      try { bbox = JSON.parse(det.boundingBox) } catch { /* ignore */ }

      const [thumbUrl, imgUrl] = await Promise.all([
        presign(m.thumbnailObjectKey ?? m.objectKey),
        m.thumbnailObjectKey ? presign(m.objectKey) : null,
      ])

      items.push({
        detectionId:      det.id,
        mediaId:          det.mediaId,
        confidence:       det.confidence,
        matchDistance:    det.matchDistance ?? null,
        reviewNeeded:     !!det.reviewNeeded,
        boundingBox:      bbox,
        thumbnailUrl:     thumbUrl,
        imageUrl:         imgUrl ?? thumbUrl,
        originalFilename: m.originalFilename,
        takenAt:          m.takenAt,
        width:            m.width,
        height:           m.height,
      })
    }
  } else {
    // Pet: query media_objects by petClass
    let petClasses: string[] = []
    try { petClasses = JSON.parse(subject.petClass ?? '[]') } catch { /* ignore */ }
    if (!petClasses.length && subject.name) petClasses = [subject.name.toLowerCase()]
    if (!petClasses.length) return { subject, media: [] }

    const classFilter = petClasses.length === 1
      ? eq(mediaObjects.class, petClasses[0])
      : inArray(mediaObjects.class, petClasses)

    const objects = await db
      .select({
        mediaId:     mediaObjects.mediaId,
        boundingBox: mediaObjects.boundingBox,
        confidence:  mediaObjects.confidence,
      })
      .from(mediaObjects)
      .innerJoin(libraryMedia, and(
        eq(mediaObjects.mediaId, libraryMedia.mediaId),
        eq(libraryMedia.libraryId, libraryId),
      ))
      .where(classFilter)
      .orderBy(desc(mediaObjects.confidence))

    // Deduplicate by mediaId (keep best-confidence detection per photo)
    const seenMedia = new Set<string>()
    for (const obj of objects) {
      if (seenMedia.has(obj.mediaId)) continue
      seenMedia.add(obj.mediaId)

      const [m] = await db
        .select({
          objectKey:          media.objectKey,
          thumbnailObjectKey: media.thumbnailObjectKey,
          originalFilename:   media.originalFilename,
          takenAt:            media.takenAt,
          width:              media.width,
          height:             media.height,
        })
        .from(media)
        .where(eq(media.id, obj.mediaId))
        .limit(1)

      if (!m) continue

      let bbox: { x: number; y: number; w: number; h: number } | null = null
      if (m.width && m.height) {
        try {
          const px = JSON.parse(obj.boundingBox)
          bbox = {
            x: px.x / m.width,
            y: px.y / m.height,
            w: px.w / m.width,
            h: px.h / m.height,
          }
        } catch { /* ignore */ }
      }

      const [thumbUrl, imgUrl] = await Promise.all([
        presign(m.thumbnailObjectKey ?? m.objectKey),
        m.thumbnailObjectKey ? presign(m.objectKey) : null,
      ])

      items.push({
        detectionId:      null,
        mediaId:          obj.mediaId,
        confidence:       obj.confidence,
        matchDistance:    null,
        reviewNeeded:     false,
        boundingBox:      bbox,
        thumbnailUrl:     thumbUrl,
        imageUrl:         imgUrl ?? thumbUrl,
        originalFilename: m.originalFilename,
        takenAt:          m.takenAt,
        width:            m.width,
        height:           m.height,
      })
    }
  }

  return {
    subject: {
      id:     subject.id,
      type:   subject.type,
      name:   subject.name,
      hidden: !!subject.hidden,
    },
    media: items,
  }
})
