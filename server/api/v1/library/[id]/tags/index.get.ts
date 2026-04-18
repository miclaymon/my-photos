/**
 * GET /api/v1/library/:id/tags
 * Lists all user-created tags for the library, each with an item count.
 */
import { eq, count } from 'drizzle-orm'
import { db } from '~/server/db'
import { userTags, mediaTags } from '~/server/db/schema'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const libraryId = getRouterParam(event, 'id')!

  const rows = await db
    .select({
      id:        userTags.id,
      name:      userTags.name,
      color:     userTags.color,
      createdAt: userTags.createdAt,
      itemCount: count(mediaTags.mediaId),
    })
    .from(userTags)
    .leftJoin(mediaTags, eq(mediaTags.tagId, userTags.id))
    .where(eq(userTags.libraryId, libraryId))
    .groupBy(userTags.id)
    .orderBy(userTags.name)

  return {
    tags: rows.map(r => ({
      id:        r.id,
      name:      r.name,
      color:     r.color,
      itemCount: r.itemCount,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : new Date((r.createdAt as number) * 1000).toISOString(),
    })),
  }
})
