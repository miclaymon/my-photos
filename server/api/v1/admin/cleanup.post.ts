/**
 * POST /api/v1/admin/cleanup
 *
 * Dev-only. Permanently deletes all media items whose deletionDate has passed.
 * This is the manual equivalent of the scheduled cleanup job that doesn't
 * exist yet (FR-017A). Call it from the admin page to drain the trash queue.
 *
 * Returns { processed: number, failed: number } with per-item results logged.
 */
import { lte, eq } from 'drizzle-orm'
import { DeleteObjectsCommand } from '@aws-sdk/client-s3'
import { db } from '~/server/db'
import { media, libraryMedia, deletedItems } from '~/server/db/schema'
import { getStorageClient, getStorageBucket } from '~/server/utils/storage'
import { logger } from '~/server/utils/logger'

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production') {
    throw createError({ statusCode: 404, message: 'Not found' })
  }

  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const now = new Date()

  // Find all items whose retention window has expired
  const expired = await db
    .select({
      id:                 media.id,
      objectKey:          media.objectKey,
      thumbnailObjectKey: media.thumbnailObjectKey,
      previewObjectKey:   media.previewObjectKey,
    })
    .from(media)
    .where(lte(media.deletionDate, now))

  if (!expired.length) {
    logger.info('cleanup: no expired items found')
    return { processed: 0, failed: 0 }
  }

  logger.info('cleanup: processing expired items', { count: expired.length })

  const client = getStorageClient()
  const bucket = getStorageBucket()

  let processed = 0
  let failed    = 0

  for (const row of expired) {
    try {
      const keys = [row.objectKey, row.thumbnailObjectKey, row.previewObjectKey]
        .filter((k): k is string => !!k)

      if (keys.length) {
        await client.send(new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys.map(Key => ({ Key })) },
        }))
      }

      await db.delete(deletedItems).where(eq(deletedItems.mediaId, row.id))
      await db.delete(libraryMedia).where(eq(libraryMedia.mediaId, row.id))
      await db.delete(media).where(eq(media.id, row.id))

      processed++
    } catch (err) {
      logger.warn('cleanup: failed to delete item', { id: row.id, err })
      failed++
    }
  }

  logger.info('cleanup: complete', { processed, failed })
  return { processed, failed }
})
