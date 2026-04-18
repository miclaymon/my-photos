/**
 * DELETE /api/v1/library/:id/tags/:tagId
 * Deletes a tag and all its media associations (via ON DELETE CASCADE).
 */
import { eq, and } from 'drizzle-orm'
import { db } from '~/server/db'
import { userTags } from '~/server/db/schema'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const libraryId = getRouterParam(event, 'id')!
  const tagId     = getRouterParam(event, 'tagId')!

  const result = await db
    .delete(userTags)
    .where(and(eq(userTags.id, tagId), eq(userTags.libraryId, libraryId)))
    .returning({ id: userTags.id })

  if (!result.length) throw createError({ statusCode: 404, message: 'Tag not found' })

  return { deleted: true }
})
