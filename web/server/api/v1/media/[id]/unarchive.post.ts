/**
 * POST /api/v1/media/:id/unarchive
 * Unarchives a media item.
 */
import { eq } from 'drizzle-orm'
import { db } from '~/server/db'
import { media } from '~/server/db/schema'
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

  await db.update(media).set({ archivedAt: null }).where(eq(media.id, id))
  logger.info('media: unarchived', { id })
  return { ok: true }
})
