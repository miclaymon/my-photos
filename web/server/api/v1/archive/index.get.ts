/**
 * GET /api/v1/archive
 * Returns archived media items for the current user.
 */
import { eq, isNotNull, and, desc } from 'drizzle-orm'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { db } from '~/server/db'
import { media, libraryMedia } from '~/server/db/schema'
import { getStorageClient, getStorageBucket } from '~/server/utils/storage'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const userId = (session.user as { id?: number }).id
  if (!userId) throw createError({ statusCode: 401, message: 'Invalid session' })

  const { library: libraryId } = getQuery(event) as { library?: string }

  const baseWhere = and(eq(media.uploadedBy, userId), isNotNull(media.archivedAt))

  const rows = libraryId
    ? await db.select({
        id:               media.id,
        objectKey:        media.objectKey,
        originalFilename: media.originalFilename,
        contentType:      media.contentType,
        size:             media.size,
        width:            media.width,
        height:           media.height,
        aspectRatio:      media.aspectRatio,
        takenAt:          media.takenAt,
        createdAt:        media.createdAt,
        archivedAt:       media.archivedAt,
        thumbnailObjectKey: media.thumbnailObjectKey,
      }).from(media)
        .innerJoin(libraryMedia, and(eq(libraryMedia.mediaId, media.id), eq(libraryMedia.libraryId, libraryId)))
        .where(baseWhere)
        .orderBy(desc(media.archivedAt))
    : await db.select({
        id:               media.id,
        objectKey:        media.objectKey,
        originalFilename: media.originalFilename,
        contentType:      media.contentType,
        size:             media.size,
        width:            media.width,
        height:           media.height,
        aspectRatio:      media.aspectRatio,
        takenAt:          media.takenAt,
        createdAt:        media.createdAt,
        archivedAt:       media.archivedAt,
        thumbnailObjectKey: media.thumbnailObjectKey,
      }).from(media)
        .where(baseWhere)
        .orderBy(desc(media.archivedAt))

  const client = getStorageClient()
  const bucket = getStorageBucket()

  const items = await Promise.all(rows.map(async (row) => {
    const src = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: row.objectKey }), { expiresIn: 3600 }).catch(() => undefined)
    let thumbnailSrc: string | undefined
    if (row.thumbnailObjectKey) {
      thumbnailSrc = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: row.thumbnailObjectKey }), { expiresIn: 3600 }).catch(() => undefined)
    }
    const aspectRatio = row.aspectRatio ?? 1.5
    const width  = row.width  ?? Math.round(aspectRatio >= 1 ? 1200 : 800)
    const height = row.height ?? Math.round(width / aspectRatio)
    const takenAt = row.takenAt ?? row.createdAt
    const archivedAt = row.archivedAt
    return {
      id: row.id,
      originalFilename: row.originalFilename,
      contentType: row.contentType,
      width, height, aspectRatio,
      isVideo: row.contentType.startsWith('video/'),
      takenAt: takenAt instanceof Date ? takenAt.toISOString() : new Date((takenAt as number) * 1000).toISOString(),
      archivedAt: archivedAt instanceof Date ? archivedAt.toISOString() : archivedAt ? new Date((archivedAt as number) * 1000).toISOString() : null,
      src,
      thumbnailSrc,
    }
  }))

  return { items }
})
