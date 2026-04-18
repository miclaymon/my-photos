/**
 * DELETE /api/v1/admin/library/:id
 *
 * Deletes a non-personal library. Personal libraries cannot be deleted.
 *
 * Body:
 *   markOrphansForDeletion?:   boolean  — queue orphan media for deletion in 30 days
 *   deleteOrphansImmediately?: boolean  — permanently delete orphan media + bucket objects now
 *   (if both are true, immediate wins)
 *
 * Guard: dev-only. Requires active session.
 */
import { eq, ne, inArray, and } from 'drizzle-orm'
import { DeleteObjectsCommand } from '@aws-sdk/client-s3'
import { db } from '~/server/db'
import { libraries, libraryMedia, libraryAccess, shareLinks, media, deletedItems } from '~/server/db/schema'
import { getStorageClient, getStorageBucket } from '~/server/utils/storage'
import { logger } from '~/server/utils/logger'

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production') {
    throw createError({ statusCode: 404, message: 'Not found' })
  }

  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'Library ID required' })

  const body = await readBody<{
    markOrphansForDeletion?:   boolean
    deleteOrphansImmediately?: boolean
  }>(event).catch(() => ({ markOrphansForDeletion: false, deleteOrphansImmediately: false }))

  // Verify library exists and is not personal
  const rows = await db.select({ type: libraries.type }).from(libraries).where(eq(libraries.id, id))
  if (!rows.length) throw createError({ statusCode: 404, message: 'Library not found' })
  if (rows[0]!.type === 'personal') {
    throw createError({ statusCode: 400, message: 'Personal libraries cannot be deleted' })
  }

  // Find media exclusively in this library (not in any other library)
  const inThisLib = await db
    .select({ mediaId: libraryMedia.mediaId })
    .from(libraryMedia)
    .where(eq(libraryMedia.libraryId, id))

  const allMediaIds = inThisLib.map(r => r.mediaId)
  let orphanCount = 0

  if (allMediaIds.length) {
    const shared = await db
      .select({ mediaId: libraryMedia.mediaId })
      .from(libraryMedia)
      .where(and(
        inArray(libraryMedia.mediaId, allMediaIds),
        ne(libraryMedia.libraryId, id),
      ))

    const sharedIds = new Set(shared.map(r => r.mediaId))
    const orphanIds = allMediaIds.filter(mid => !sharedIds.has(mid))
    orphanCount = orphanIds.length

    if (orphanIds.length) {
      if (body.deleteOrphansImmediately) {
        // Fetch object keys for all orphans so we can delete from bucket
        const orphanRows = await db
          .select({
            id:                 media.id,
            objectKey:          media.objectKey,
            thumbnailObjectKey: media.thumbnailObjectKey,
            previewObjectKey:   media.previewObjectKey,
          })
          .from(media)
          .where(inArray(media.id, orphanIds))

        // Delete all bucket objects in one batch
        const keys = orphanRows.flatMap(r =>
          [r.objectKey, r.thumbnailObjectKey, r.previewObjectKey].filter((k): k is string => !!k),
        )
        if (keys.length) {
          const client = getStorageClient()
          const bucket = getStorageBucket()
          await client.send(new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: keys.map(Key => ({ Key })) },
          })).catch(err => logger.warn('admin: orphan bucket delete failed', { err }))
        }

        // Delete DB rows for orphans (FK order)
        await db.delete(deletedItems).where(inArray(deletedItems.mediaId, orphanIds))
        await db.delete(libraryMedia).where(inArray(libraryMedia.mediaId, orphanIds))
        await db.delete(media).where(inArray(media.id, orphanIds))

        logger.info('admin: immediately deleted orphan media', { libraryId: id, count: orphanIds.length })
      } else if (body.markOrphansForDeletion) {
        const deletionDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        for (const mediaId of orphanIds) {
          await db.update(media).set({ deletionDate }).where(eq(media.id, mediaId))
        }
        logger.info('admin: marked orphan media for deletion', { libraryId: id, count: orphanIds.length, deletionDate })
      }
    }
  }

  // Remove all FK-referencing rows then the library itself
  await db.delete(libraryMedia).where(eq(libraryMedia.libraryId, id))
  await db.delete(libraryAccess).where(eq(libraryAccess.libraryId, id))
  await db.delete(shareLinks).where(eq(shareLinks.libraryId, id))
  await db.delete(libraries).where(eq(libraries.id, id))

  logger.info('admin: deleted library', { id, orphanCount, deleteOrphansImmediately: !!body.deleteOrphansImmediately, markOrphansForDeletion: !!body.markOrphansForDeletion })
  return { ok: true, orphanCount }
})
