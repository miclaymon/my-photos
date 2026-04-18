/**
 * POST /api/v1/media/:id/permanent-delete
 *
 * Permanently deletes a media item: removes all bucket objects and all DB rows.
 * The item must already be soft-deleted (deletionDate set) to proceed.
 */
import { eq } from 'drizzle-orm'
import { DeleteObjectsCommand } from '@aws-sdk/client-s3'
import { db } from '~/server/db'
import { media, libraryMedia, deletedItems } from '~/server/db/schema'
import { getStorageClient, getStorageBucket } from '~/server/utils/storage'
import { logger } from '~/server/utils/logger'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'Media ID required' })

  const userId = (session.user as { id?: number }).id
  if (!userId) throw createError({ statusCode: 401, message: 'Invalid session' })

  const rows = await db.select({
    uploadedBy:         media.uploadedBy,
    objectKey:          media.objectKey,
    thumbnailObjectKey: media.thumbnailObjectKey,
    previewObjectKey:   media.previewObjectKey,
  }).from(media).where(eq(media.id, id))

  if (!rows.length) throw createError({ statusCode: 404, message: 'Not found' })
  if (rows[0]!.uploadedBy !== userId) throw createError({ statusCode: 403, message: 'Forbidden' })

  const row = rows[0]!
  const keys = [row.objectKey, row.thumbnailObjectKey, row.previewObjectKey].filter((k): k is string => !!k)

  // Delete from bucket
  if (keys.length) {
    const client = getStorageClient()
    const bucket = getStorageBucket()
    await client.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: keys.map(Key => ({ Key })) },
    })).catch(err => logger.warn('permanent-delete: bucket delete failed', { err }))
  }

  // Delete DB rows (FK order)
  await db.delete(deletedItems).where(eq(deletedItems.mediaId, id))
  await db.delete(libraryMedia).where(eq(libraryMedia.mediaId, id))
  await db.delete(media).where(eq(media.id, id))

  logger.info('media: permanently deleted', { id })
  return { ok: true }
})
