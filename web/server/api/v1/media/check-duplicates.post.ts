/**
 * POST /api/v1/media/check-duplicates
 *
 * Accepts an array of SHA-256 hex hashes and returns any existing media
 * records that match. Used client-side before upload to detect duplicates.
 *
 * Request body: { hashes: string[] }
 *
 * Response: { duplicates: Array<{
 *   hash:             string
 *   id:               string
 *   originalFilename: string
 *   contentType:      string
 *   size:             number
 *   width?:           number
 *   height?:          number
 *   takenAt?:         string
 *   thumbnailSrc?:    string   — presigned URL for the existing thumbnail
 * }> }
 */
import { inArray } from 'drizzle-orm'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { db } from '~/server/db'
import { media } from '~/server/db/schema'
import { getStorageClient, getStorageBucket } from '~/server/utils/storage'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const body = await readBody<{ hashes: string[] }>(event)
  if (!Array.isArray(body?.hashes) || body.hashes.length === 0) {
    return { duplicates: [] }
  }

  // Cap to 50 hashes per request to prevent abuse
  const hashes = body.hashes.slice(0, 50)

  const rows = await db
    .select({
      id:                 media.id,
      hash:               media.hash,
      originalFilename:   media.originalFilename,
      contentType:        media.contentType,
      size:               media.size,
      width:              media.width,
      height:             media.height,
      takenAt:            media.takenAt,
      createdAt:          media.createdAt,
      objectKey:          media.objectKey,
      thumbnailObjectKey: media.thumbnailObjectKey,
    })
    .from(media)
    .where(inArray(media.hash, hashes))

  if (!rows.length) return { duplicates: [] }

  const client = getStorageClient()
  const bucket = getStorageBucket()

  const duplicates = await Promise.all(rows.map(async (row) => {
    // Generate a short-lived presigned URL for the thumbnail (or main object for images)
    const thumbKey = row.thumbnailObjectKey ?? row.objectKey
    const thumbnailSrc = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: bucket, Key: thumbKey }),
      { expiresIn: 300 },
    ).catch(() => undefined)

    const takenAtRaw = row.takenAt ?? row.createdAt
    const takenAt = takenAtRaw instanceof Date
      ? takenAtRaw.toISOString()
      : new Date((takenAtRaw as number) * 1000).toISOString()

    return {
      hash:             row.hash!,
      id:               row.id,
      originalFilename: row.originalFilename,
      contentType:      row.contentType,
      size:             row.size,
      width:            row.width ?? undefined,
      height:           row.height ?? undefined,
      takenAt,
      thumbnailSrc,
    }
  }))

  return { duplicates }
})
