/**
 * GET /api/v1/media/:id
 *
 * Returns full metadata for a single media item, including presigned URLs
 * (thumbnailUrl / imageUrl) and EXIF data.
 * Used by the preview page when the item is not available in gallery state.
 */
import { eq } from 'drizzle-orm'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { db } from '~/server/db'
import { media } from '~/server/db/schema'
import { getStorageClient, getStorageBucket } from '~/server/utils/storage'

const URL_EXPIRY = 3600

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'Media ID required' })

  const rows = await db.select({
    id:                 media.id,
    objectKey:          media.objectKey,
    thumbnailObjectKey: media.thumbnailObjectKey,
    originalFilename:   media.originalFilename,
    contentType:        media.contentType,
    size:               media.size,
    width:              media.width,
    height:             media.height,
    aspectRatio:        media.aspectRatio,
    durationSeconds:    media.durationSeconds,
    takenAt:            media.takenAt,
    createdAt:          media.createdAt,
    exifData:           media.exifData,
    locationLabel:      media.locationLabel,
  }).from(media).where(eq(media.id, id))

  if (!rows.length) throw createError({ statusCode: 404, message: 'Not found' })

  const row = rows[0]!

  function toIso(v: Date | number | null | undefined): string | null {
    if (!v) return null
    if (v instanceof Date) return v.toISOString()
    return new Date((v as number) * 1000).toISOString()
  }

  const client = getStorageClient()
  const bucket = getStorageBucket()
  const presign = (key: string) =>
    getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: URL_EXPIRY })
      .catch(() => null)

  const imageUrl     = await presign(row.objectKey)
  const thumbnailUrl = row.thumbnailObjectKey ? await presign(row.thumbnailObjectKey) : imageUrl

  return {
    id:               row.id,
    originalFilename: row.originalFilename,
    contentType:      row.contentType,
    size:             row.size,
    width:            row.width,
    height:           row.height,
    aspectRatio:      row.aspectRatio ?? 1,
    durationSeconds:  row.durationSeconds,
    takenAt:          toIso(row.takenAt),
    createdAt:        toIso(row.createdAt),
    isVideo:          row.contentType.startsWith('video/'),
    imageUrl,
    thumbnailUrl,
    // exifData is stored as a JSON string; parse it for the client
    exif:             row.exifData ? (JSON.parse(row.exifData) as Record<string, unknown>) : null,
    locationLabel:    row.locationLabel ?? null,
  }
})
