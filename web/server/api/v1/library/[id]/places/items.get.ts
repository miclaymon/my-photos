/**
 * GET /api/v1/library/:id/places/items?label=Houston%2C+Texas
 *
 * Returns all media items in the library that have the given location label.
 * Archived and trashed items are excluded.
 * Each item includes presigned image/thumbnail URLs.
 *
 * Response: { label: string; items: MediaItem[] }
 */
import { eq, and, isNull, desc } from 'drizzle-orm'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { db } from '~/server/db'
import { media, libraryMedia } from '~/server/db/schema'
import { getStorageClient, getStorageBucket } from '~/server/utils/storage'

const URL_EXPIRY = 3600

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const libraryId = getRouterParam(event, 'id')!
  const query     = getQuery(event)
  const label     = query.label as string | undefined

  if (!label) throw createError({ statusCode: 400, message: 'label query param required' })

  const rows = await db
    .select({
      id:                 media.id,
      objectKey:          media.objectKey,
      thumbnailObjectKey: media.thumbnailObjectKey,
      originalFilename:   media.originalFilename,
      contentType:        media.contentType,
      width:              media.width,
      height:             media.height,
      aspectRatio:        media.aspectRatio,
      takenAt:            media.takenAt,
      createdAt:          media.createdAt,
    })
    .from(media)
    .innerJoin(libraryMedia, eq(libraryMedia.mediaId, media.id))
    .where(
      and(
        eq(libraryMedia.libraryId, libraryId),
        eq(media.locationLabel, label),
        isNull(media.deletionDate),
        isNull(media.archivedAt),
      ),
    )
    .orderBy(desc(media.takenAt))

  const client = getStorageClient()
  const bucket = getStorageBucket()

  const items = await Promise.all(rows.map(async (row) => {
    const src = await getSignedUrl(
      client, new GetObjectCommand({ Bucket: bucket, Key: row.objectKey }), { expiresIn: URL_EXPIRY },
    ).catch(() => undefined)

    let thumbnailSrc: string | undefined
    if (row.thumbnailObjectKey) {
      thumbnailSrc = await getSignedUrl(
        client, new GetObjectCommand({ Bucket: bucket, Key: row.thumbnailObjectKey }), { expiresIn: URL_EXPIRY },
      ).catch(() => undefined)
    }

    const aspectRatio = row.aspectRatio ?? 1.5
    const width  = row.width  ?? Math.round(aspectRatio >= 1 ? 1200 : 800)
    const height = row.height ?? Math.round(width / aspectRatio)
    const rawDate = row.takenAt ?? row.createdAt

    return {
      id:               row.id,
      originalFilename: row.originalFilename,
      contentType:      row.contentType,
      width, height, aspectRatio,
      isVideo:  row.contentType.startsWith('video/'),
      takenAt:  rawDate instanceof Date
        ? rawDate.toISOString()
        : new Date((rawDate as number) * 1000).toISOString(),
      src,
      thumbnailSrc,
    }
  }))

  return { label, items }
})
