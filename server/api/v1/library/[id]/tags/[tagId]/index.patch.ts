/**
 * PATCH /api/v1/library/:id/tags/:tagId
 * Updates a tag's name and/or color.
 * Body: { name?: string, color?: string | null }
 */
import { eq, and } from 'drizzle-orm'
import { db } from '~/server/db'
import { userTags } from '~/server/db/schema'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const libraryId = getRouterParam(event, 'id')!
  const tagId     = getRouterParam(event, 'tagId')!
  const body      = await readBody<{ name?: string; color?: string | null }>(event)

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (body.name !== undefined) {
    if (!body.name.trim()) throw createError({ statusCode: 400, message: 'Tag name cannot be empty' })
    updates.name = body.name.trim()
  }
  if ('color' in body) updates.color = body.color ?? null

  const [updated] = await db
    .update(userTags)
    .set(updates)
    .where(and(eq(userTags.id, tagId), eq(userTags.libraryId, libraryId)))
    .returning({ id: userTags.id, name: userTags.name, color: userTags.color })

  if (!updated) throw createError({ statusCode: 404, message: 'Tag not found' })

  return updated
})
