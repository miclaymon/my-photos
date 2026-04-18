/**
 * DELETE /api/v1/library/:id/tags/:tagId/items/:mediaId
 * Removes a single media item from a tag.
 */
import { eq, and } from 'drizzle-orm'
import { db } from '~/server/db'
import { mediaTags } from '~/server/db/schema'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const tagId   = getRouterParam(event, 'tagId')!
  const mediaId = getRouterParam(event, 'mediaId')!

  await db
    .delete(mediaTags)
    .where(and(eq(mediaTags.tagId, tagId), eq(mediaTags.mediaId, mediaId)))

  return { removed: true }
})
