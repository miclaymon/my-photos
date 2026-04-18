/**
 * DELETE /api/v1/admin/media/:id
 *
 * Hard-deletes a media DB record (and all its library_media rows).
 * Optionally also deletes the associated bucket objects (main, thumbnail, preview).
 *
 * Guard: dev-only. Requires active session.
 *
 * Body: { deleteObjects?: boolean }
 */
import { eq, inArray } from 'drizzle-orm'
import { DeleteObjectsCommand } from '@aws-sdk/client-s3'
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

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'Media ID required' })

  const body = await readBody<{ deleteObjects?: boolean }>(event).catch(() => ({ deleteObjects: false }))

  // Fetch the record so we know which object keys to delete
  const rows = await db.select({
    objectKey:          media.objectKey,
    thumbnailObjectKey: media.thumbnailObjectKey,
    previewObjectKey:   media.previewObjectKey,
  }).from(media).where(eq(media.id, id))

  if (!rows.length) throw createError({ statusCode: 404, message: 'Media record not found' })
  const row = rows[0]!

  // Delete library associations first (FK constraint)
  await db.delete(libraryMedia).where(eq(libraryMedia.mediaId, id))

  // Delete the media row
  await db.delete(media).where(eq(media.id, id))
  logger.info('admin: deleted media DB record', { id })

  // Optionally delete bucket objects
  if (body.deleteObjects) {
    const keys = [row.objectKey, row.thumbnailObjectKey, row.previewObjectKey]
      .filter((k): k is string => !!k)

    if (keys.length) {
      try {
        const client = getStorageClient()
        const bucket = getStorageBucket()
        await client.send(new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys.map(Key => ({ Key })) },
        }))
        logger.info('admin: deleted bucket objects', { keys })
      } catch (err) {
        logger.warn('admin: bucket delete failed (DB record already gone)', { err })
      }
    }
  }

  return { ok: true }
})
