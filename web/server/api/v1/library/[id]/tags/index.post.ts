/**
 * POST /api/v1/library/:id/tags
 * Creates a new tag in the library.
 * Body: { name: string, color?: string }
 */
import { db } from '~/server/db'
import { userTags } from '~/server/db/schema'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const userId    = (session.user as { id?: number }).id
  if (!userId) throw createError({ statusCode: 401, message: 'Invalid session' })

  const libraryId = getRouterParam(event, 'id')!
  const body      = await readBody<{ name?: string; color?: string }>(event)

  if (!body.name?.trim()) throw createError({ statusCode: 400, message: 'Tag name is required' })

  const now = new Date()
  const id  = crypto.randomUUID()

  await db.insert(userTags).values({
    id,
    libraryId,
    name:      body.name.trim(),
    color:     body.color ?? null,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  })

  return { id, name: body.name.trim(), color: body.color ?? null, itemCount: 0 }
})
