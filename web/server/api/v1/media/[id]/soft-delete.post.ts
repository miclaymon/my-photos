/**
 * POST /api/v1/media/:id/soft-delete
 *
 * Soft-deletes a media item: sets deletionDate = now + 30 days on the media record
 * and inserts a row into deleted_items. The item is hidden from all gallery views
 * until restored or permanently deleted.
 *
 * Requires: session. User must be the uploader.
 */
import { eq } from 'drizzle-orm'
import { db } from '~/server/db'
import { media, deletedItems } from '~/server/db/schema'
import { logger } from '~/server/utils/logger'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'Media ID required' })

  const userId = (session.user as { id?: number }).id
  if (!userId) throw createError({ statusCode: 401, message: 'Invalid session' })

  const rows = await db.select({ uploadedBy: media.uploadedBy }).from(media).where(eq(media.id, id))
  if (!rows.length) throw createError({ statusCode: 404, message: 'Not found' })
  if (rows[0]!.uploadedBy !== userId) throw createError({ statusCode: 403, message: 'Forbidden' })

  const deletionDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

  await db.update(media).set({ deletionDate }).where(eq(media.id, id))
  await db.insert(deletedItems).values({
    mediaId:      id,
    deletedBy:    userId,
    deletionDate,
  })

  logger.info('media: soft-deleted', { id, deletionDate })
  return { ok: true, deletionDate: deletionDate.toISOString() }
})
