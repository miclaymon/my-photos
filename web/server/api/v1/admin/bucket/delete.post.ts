/**
 * POST /api/v1/admin/bucket/delete
 *
 * Deletes a single object from the RustFS bucket by key.
 * Optionally also deletes the DB record(s) that reference this key
 * (matched against objectKey, thumbnailObjectKey, or previewObjectKey).
 *
 * Guard: dev-only. Requires active session.
 *
 * Body: { key: string, deleteDbRecord?: boolean }
 */
import { or, eq } from 'drizzle-orm'
import { DeleteObjectCommand } from '@aws-sdk/client-s3'
import { db } from '~/server/db'
import { media, libraryMedia } from '~/server/db/schema'
import { getStorageClient, getStorageBucket } from '~/server/utils/storage'
import { logger } from '~/server/utils/logger'

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production') {
    throw createError({ statusCode: 404, message: 'Not found' })
  }

  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const body = await readBody<{ key: string; deleteDbRecord?: boolean }>(event)
  if (!body.key) throw createError({ statusCode: 400, message: 'key is required' })

  // Delete the bucket object
  const client = getStorageClient()
  const bucket = getStorageBucket()
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: body.key }))
  logger.info('admin: deleted bucket object', { key: body.key })

  let deletedDbRecords = 0

  if (body.deleteDbRecord) {
    // Find media rows that reference this key in any of the three columns
    const rows = await db.select({ id: media.id }).from(media).where(
      or(
        eq(media.objectKey,          body.key),
        eq(media.thumbnailObjectKey, body.key),
        eq(media.previewObjectKey,   body.key),
      ),
    )

    for (const row of rows) {
      await db.delete(libraryMedia).where(eq(libraryMedia.mediaId, row.id))
      await db.delete(media).where(eq(media.id, row.id))
      deletedDbRecords++
    }

    if (deletedDbRecords) {
      logger.info('admin: deleted DB records referencing key', { key: body.key, count: deletedDbRecords })
    }
  }

  return { ok: true, deletedDbRecords }
})
