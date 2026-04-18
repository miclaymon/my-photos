/**
 * POST /api/v1/admin/library/:id/access
 *
 * Adds a user to a library's access list (or updates their role if already present).
 *
 * Body: { email: string; role: 'owner' | 'editor' | 'viewer' }
 *
 * Guard: dev-only. Requires active session.
 */
import { eq, and } from 'drizzle-orm'
import { db } from '~/server/db'
import { libraries, libraryAccess, users } from '~/server/db/schema'
import { logger } from '~/server/utils/logger'

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production') {
    throw createError({ statusCode: 404, message: 'Not found' })
  }

  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const libraryId = getRouterParam(event, 'id')
  if (!libraryId) throw createError({ statusCode: 400, message: 'Library ID required' })

  const body = await readBody<{ email: string; role: 'owner' | 'editor' | 'viewer' }>(event)
  if (!body.email || !body.role) throw createError({ statusCode: 400, message: 'email and role required' })
  if (!['owner', 'editor', 'viewer'].includes(body.role)) {
    throw createError({ statusCode: 400, message: 'role must be owner, editor, or viewer' })
  }

  // Verify library exists
  const libs = await db.select({ id: libraries.id }).from(libraries).where(eq(libraries.id, libraryId))
  if (!libs.length) throw createError({ statusCode: 404, message: 'Library not found' })

  // Look up user by email
  const userRows = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email))
  if (!userRows.length) throw createError({ statusCode: 404, message: `No user found with email ${body.email}` })
  const userId = userRows[0]!.id

  // Upsert: remove existing entry then insert
  await db.delete(libraryAccess).where(and(
    eq(libraryAccess.libraryId, libraryId),
    eq(libraryAccess.userId, userId),
  ))
  await db.insert(libraryAccess).values({ libraryId, userId, role: body.role })

  logger.info('admin: added/updated library access', { libraryId, userId, role: body.role })
  return { ok: true }
})
