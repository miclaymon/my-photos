/**
 * GET /api/v1/media/:id/subjects
 *
 * Returns all subjects (people & pets) detected in a given media item,
 * with bounding boxes expressed as fractions 0–1 of the image dimensions.
 * Used by the preview page to render face/pet detection overlays.
 *
 * Response shape:
 *   { subjects: Array<{ subjectId, name, type, thumbnailUrl, boundingBox }> }
 */
import { eq, and, isNotNull } from 'drizzle-orm'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { db } from '~/server/db'
import { subjectDetections, subjects, mediaObjects, media } from '~/server/db/schema'
import { getStorageClient, getStorageBucket } from '~/server/utils/storage'

const URL_EXPIRY = 3600

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const mediaId = getRouterParam(event, 'id')
  if (!mediaId) throw createError({ statusCode: 400, message: 'Media ID required' })

  const client = getStorageClient()
  const bucket = getStorageBucket()

  const presign = (key: string) =>
    getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: URL_EXPIRY })
      .catch(() => null)

  // Media dimensions — needed to normalise pet pixel bboxes to fractions
  const [mediaRow] = await db
    .select({ width: media.width, height: media.height })
    .from(media)
    .where(eq(media.id, mediaId))
    .limit(1)

  const results: Array<{
    subjectId:    string
    name:         string | null
    type:         'person' | 'pet'
    thumbnailUrl: string | null
    boundingBox:  { x: number; y: number; w: number; h: number }
  }> = []

  // ── Person detections ─────────────────────────────────────────────────────────
  const personDets = await db
    .select({
      subjectId:    subjectDetections.subjectId,
      boundingBox:  subjectDetections.boundingBox,
      name:         subjects.name,
      coverMediaId: subjects.coverMediaId,
      repDetId:     subjects.representativeDetectionId,
    })
    .from(subjectDetections)
    .innerJoin(subjects, eq(subjectDetections.subjectId, subjects.id))
    .where(and(
      eq(subjectDetections.mediaId, mediaId),
      isNotNull(subjectDetections.subjectId),
    ))

  for (const det of personDets) {
    let bbox: { x: number; y: number; w: number; h: number }
    try { bbox = JSON.parse(det.boundingBox) } catch { continue }

    // Resolve cover thumbnail: coverMediaId takes priority over repDetId heuristic
    let thumbnailUrl: string | null = null
    if (det.coverMediaId) {
      const [cm] = await db
        .select({ thumbnailObjectKey: media.thumbnailObjectKey, objectKey: media.objectKey })
        .from(media).where(eq(media.id, det.coverMediaId)).limit(1)
      if (cm) thumbnailUrl = await presign(cm.thumbnailObjectKey ?? cm.objectKey)
    } else if (det.repDetId) {
      const [rd] = await db
        .select({ mediaId: subjectDetections.mediaId })
        .from(subjectDetections).where(eq(subjectDetections.id, det.repDetId)).limit(1)
      if (rd) {
        const [rm] = await db
          .select({ thumbnailObjectKey: media.thumbnailObjectKey, objectKey: media.objectKey })
          .from(media).where(eq(media.id, rd.mediaId)).limit(1)
        if (rm) thumbnailUrl = await presign(rm.thumbnailObjectKey ?? rm.objectKey)
      }
    }

    results.push({
      subjectId:   det.subjectId!,
      name:        det.name,
      type:        'person',
      thumbnailUrl,
      boundingBox: bbox,
    })
  }

  // ── Pet detections ────────────────────────────────────────────────────────────
  if (mediaRow?.width && mediaRow?.height) {
    const petObjs = await db
      .select({ class: mediaObjects.class, boundingBox: mediaObjects.boundingBox })
      .from(mediaObjects)
      .where(eq(mediaObjects.mediaId, mediaId))

    if (petObjs.length > 0) {
      // Load all pet subjects so we can match by petClass JSON array
      const allPetSubjects = await db
        .select({
          id:          subjects.id,
          name:        subjects.name,
          petClass:    subjects.petClass,
          coverMediaId: subjects.coverMediaId,
        })
        .from(subjects)
        .where(eq(subjects.type, 'pet'))

      // Track which subjectIds have already been added (avoid duplicate chips)
      const addedSubjects = new Set<string>()

      for (const obj of petObjs) {
        const match = allPetSubjects.find(s => {
          try {
            const classes = JSON.parse(s.petClass ?? '[]') as string[]
            return classes.includes(obj.class.toLowerCase())
          } catch { return false }
        })
        if (!match || addedSubjects.has(match.id)) continue
        addedSubjects.add(match.id)

        let bbox: { x: number; y: number; w: number; h: number }
        try {
          const px = JSON.parse(obj.boundingBox)
          bbox = {
            x: px.x / mediaRow.width!,
            y: px.y / mediaRow.height!,
            w: px.w / mediaRow.width!,
            h: px.h / mediaRow.height!,
          }
        } catch { continue }

        let thumbnailUrl: string | null = null
        if (match.coverMediaId) {
          const [cm] = await db
            .select({ thumbnailObjectKey: media.thumbnailObjectKey, objectKey: media.objectKey })
            .from(media).where(eq(media.id, match.coverMediaId)).limit(1)
          if (cm) thumbnailUrl = await presign(cm.thumbnailObjectKey ?? cm.objectKey)
        }

        results.push({
          subjectId:   match.id,
          name:        match.name,
          type:        'pet',
          thumbnailUrl,
          boundingBox: bbox,
        })
      }
    }
  }

  return { subjects: results }
})
