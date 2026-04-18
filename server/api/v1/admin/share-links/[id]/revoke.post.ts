/**
 * POST /api/v1/admin/share-links/:id/revoke
 *
 * Immediately revokes a share link by setting revokedAt = now.
 *
 * Guard: dev-only. Requires active session.
 */
import { eq } from 'drizzle-orm'
import { db } from '~/server/db'
import { shareLinks } from '~/server/db/schema'
import { logger } from '~/server/utils/logger'

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production') {
    throw createError({ statusCode: 404, message: 'Not found' })
  }

  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'Share link ID required' })

  await db.update(shareLinks).set({ revokedAt: new Date() }).where(eq(shareLinks.id, id))

  logger.info('admin: revoked share link', { id })
  return { ok: true }
})
