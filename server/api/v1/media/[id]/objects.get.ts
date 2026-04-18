/**
 * GET /api/v1/media/:id/objects
 *
 * Returns all COCO-SSD detected objects for a media item.
 * Bounding boxes are normalised to fractions (0–1) of image dimensions
 * (the raw DB values are stored in pixels).
 *
 * Response: { objects: MediaObjectResult[] }
 */
import { eq } from 'drizzle-orm'
import { db } from '~/server/db'
import { media, mediaObjects } from '~/server/db/schema'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const mediaId = getRouterParam(event, 'id')!

  const [row] = await db
    .select({ width: media.width, height: media.height })
    .from(media)
    .where(eq(media.id, mediaId))
    .limit(1)

  if (!row) throw createError({ statusCode: 404, message: 'Not found' })

  const rows = await db
    .select({
      id:          mediaObjects.id,
      class:       mediaObjects.class,
      confidence:  mediaObjects.confidence,
      boundingBox: mediaObjects.boundingBox,
    })
    .from(mediaObjects)
    .where(eq(mediaObjects.mediaId, mediaId))

  const imgW = row.width  ?? 1
  const imgH = row.height ?? 1

  const objects = rows.map(o => {
    const bb = JSON.parse(o.boundingBox) as { x: number; y: number; w: number; h: number }
    return {
      id:         o.id,
      class:      o.class,
      confidence: o.confidence,
      boundingBox: {
        x: bb.x / imgW,
        y: bb.y / imgH,
        w: bb.w / imgW,
        h: bb.h / imgH,
      },
    }
  })

  return { objects }
})
