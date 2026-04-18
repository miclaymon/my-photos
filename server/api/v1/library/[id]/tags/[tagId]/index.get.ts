/**
 * GET /api/v1/library/:id/tags/:tagId
 * Returns a tag's metadata plus all media items tagged with it.
 */
import { eq, and } from 'drizzle-orm'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { db } from '~/server/db'
import { userTags, mediaTags, media } from '~/server/db/schema'
import { getStorageClient, getStorageBucket } from '~/server/utils/storage'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const libraryId = getRouterParam(event, 'id')!
  const tagId     = getRouterParam(event, 'tagId')!

  // Verify tag belongs to this library
  const [tag] = await db
    .select({ id: userTags.id, name: userTags.name, color: userTags.color })
    .from(userTags)
    .where(and(eq(userTags.id, tagId), eq(userTags.libraryId, libraryId)))
    .limit(1)

  if (!tag) throw createError({ statusCode: 404, message: 'Tag not found' })

  const rows = await db
    .select({
      id:               media.id,
      objectKey:        media.objectKey,
      originalFilename: media.originalFilename,
      contentType:      media.contentType,
      width:            media.width,
      height:           media.height,
      aspectRatio:      media.aspectRatio,
      takenAt:          media.takenAt,
      createdAt:        media.createdAt,
      thumbnailObjectKey: media.thumbnailObjectKey,
      addedAt:          mediaTags.addedAt,
    })
    .from(mediaTags)
    .innerJoin(media, eq(media.id, mediaTags.mediaId))
    .where(eq(mediaTags.tagId, tagId))
    .orderBy(mediaTags.addedAt)

  const client = getStorageClient()
  const bucket = getStorageBucket()

  const items = await Promise.all(rows.map(async (row) => {
    const src = await getSignedUrl(
      client, new GetObjectCommand({ Bucket: bucket, Key: row.objectKey }), { expiresIn: 3600 },
    ).catch(() => undefined)

    let thumbnailSrc: string | undefined
    if (row.thumbnailObjectKey) {
      thumbnailSrc = await getSignedUrl(
        client, new GetObjectCommand({ Bucket: bucket, Key: row.thumbnailObjectKey }), { expiresIn: 3600 },
      ).catch(() => undefined)
    }

    const aspectRatio = row.aspectRatio ?? 1.5
    const width  = row.width  ?? Math.round(aspectRatio >= 1 ? 1200 : 800)
    const height = row.height ?? Math.round(width / aspectRatio)
    const takenAt = row.takenAt ?? row.createdAt

    return {
      id: row.id,
      originalFilename: row.originalFilename,
      contentType:      row.contentType,
      width, height, aspectRatio,
      isVideo:  row.contentType.startsWith('video/'),
      takenAt:  takenAt instanceof Date ? takenAt.toISOString() : new Date((takenAt as number) * 1000).toISOString(),
      src,
      thumbnailSrc,
    }
  }))

  return { tag, items }
})
