/**
 * POST /api/v1/library/:id/tags/:tagId/items
 * Adds one or more media items to a tag (idempotent per item).
 * Body: { mediaIds: string[] }
 */
import { eq, and } from 'drizzle-orm'
import { db } from '~/server/db'
import { userTags, mediaTags } from '~/server/db/schema'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const userId    = (session.user as { id?: number }).id
  if (!userId) throw createError({ statusCode: 401, message: 'Invalid session' })

  const libraryId = getRouterParam(event, 'id')!
  const tagId     = getRouterParam(event, 'tagId')!
  const body      = await readBody<{ mediaIds: string[] }>(event)

  if (!Array.isArray(body.mediaIds) || body.mediaIds.length === 0) {
    throw createError({ statusCode: 400, message: 'mediaIds must be a non-empty array' })
  }

  // Verify tag belongs to this library
  const [tag] = await db
    .select({ id: userTags.id })
    .from(userTags)
    .where(and(eq(userTags.id, tagId), eq(userTags.libraryId, libraryId)))
    .limit(1)

  if (!tag) throw createError({ statusCode: 404, message: 'Tag not found' })

  const now = new Date()

  await db
    .insert(mediaTags)
    .values(body.mediaIds.map(mediaId => ({ tagId, mediaId, addedBy: userId, addedAt: now })))
    .onConflictDoNothing()

  return { added: body.mediaIds.length }
})
