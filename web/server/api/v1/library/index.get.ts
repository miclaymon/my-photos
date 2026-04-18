/**
 * GET /api/v1/library
 *
 * Returns all libraries the current user has access to.
 * For now: all libraries in the DB (personal + all shared).
 */
import { db } from '~/server/db'
import { libraries } from '~/server/db/schema'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const rows = await db.select().from(libraries).orderBy(libraries.createdAt)
  return { libraries: rows }
})
