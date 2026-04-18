/**
 * POST /api/v1/library
 *
 * Creates a new library owned by the current user.
 *
 * Request body:
 *   { name: string; type: 'personal' | 'shared' }
 *
 * Response:
 *   { id: string; name: string; type: string }
 */
import { db } from '~/server/db'
import { libraries } from '~/server/db/schema'
import { logger } from '~/server/utils/logger'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const body = await readBody<{ name?: string; type?: string }>(event)
  if (!body.name?.trim()) {
    throw createError({ statusCode: 400, message: 'name is required' })
  }
  const type = body.type === 'personal' ? 'personal' : 'shared'

  const userId = (session.user as { id?: number }).id
  if (!userId) throw createError({ statusCode: 401, message: 'Invalid session' })

  const id = crypto.randomUUID()
  const name = body.name.trim()

  await db.insert(libraries).values({
    id,
    name,
    type,
    ownerId: userId,
  })

  logger.success('library created', { id, name, type, userId })
  return { id, name, type }
})
