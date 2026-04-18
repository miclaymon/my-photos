/**
 * DELETE /api/v1/admin/library/:id/access/:userId
 *
 * Removes a user's access to a library.
 *
 * Guard: dev-only. Requires active session.
 */
import { eq, and } from 'drizzle-orm'
import { db } from '~/server/db'
import { libraryAccess } from '~/server/db/schema'
import { logger } from '~/server/utils/logger'

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production') {
    throw createError({ statusCode: 404, message: 'Not found' })
  }

  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const libraryId = getRouterParam(event, 'id')
  const userId    = Number(getRouterParam(event, 'userId'))
  if (!libraryId || !userId) throw createError({ statusCode: 400, message: 'Library ID and user ID required' })

  await db.delete(libraryAccess).where(and(
    eq(libraryAccess.libraryId, libraryId),
    eq(libraryAccess.userId, userId),
  ))

  logger.info('admin: removed library access', { libraryId, userId })
  return { ok: true }
})
