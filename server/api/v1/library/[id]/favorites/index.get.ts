/**
 * GET /api/v1/library/:id/favorites
 * Returns the current user's favorited items within the specified library.
 *
 * Favorites are per-user (not shared). In shared libraries each member has their
 * own independent set of favorites. Items are filtered to only those that belong
 * to the requested library via the library_media join.
 */
import { eq, and } from 'drizzle-orm'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { db } from '~/server/db'
import { media, libraryMedia, userFavorites } from '~/server/db/schema'
import { getStorageClient, getStorageBucket } from '~/server/utils/storage'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const userId    = (session.user as { id?: number }).id
  if (!userId) throw createError({ statusCode: 401, message: 'Invalid session' })

  const libraryId = getRouterParam(event, 'id')!

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
    })
    .from(userFavorites)
    .innerJoin(media, eq(media.id, userFavorites.mediaId))
    .innerJoin(
      libraryMedia,
      and(eq(libraryMedia.mediaId, media.id), eq(libraryMedia.libraryId, libraryId)),
    )
    .where(eq(userFavorites.userId, userId))
    .orderBy(userFavorites.addedAt)

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
      isVideo:    row.contentType.startsWith('video/'),
      takenAt:    takenAt instanceof Date ? takenAt.toISOString() : new Date((takenAt as number) * 1000).toISOString(),
      src,
      thumbnailSrc,
    }
  }))

  return { items }
})
