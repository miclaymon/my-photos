/**
 * GET /api/v1/media/:id/tags
 * Returns all user tags applied to a specific media item.
 */
import { eq } from 'drizzle-orm'
import { db } from '~/server/db'
import { mediaTags, userTags } from '~/server/db/schema'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const mediaId = getRouterParam(event, 'id')!

  const rows = await db
    .select({
      id:    userTags.id,
      name:  userTags.name,
      color: userTags.color,
    })
    .from(mediaTags)
    .innerJoin(userTags, eq(userTags.id, mediaTags.tagId))
    .where(eq(mediaTags.mediaId, mediaId))
    .orderBy(userTags.name)

  return { tags: rows }
})
