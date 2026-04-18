/**
 * DELETE /api/v1/media/:id/favorite
 * Removes the current user's favorite from a media item (idempotent).
 */
import { eq, and } from 'drizzle-orm'
import { db } from '~/server/db'
import { userFavorites } from '~/server/db/schema'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const userId  = (session.user as { id?: number }).id
  if (!userId) throw createError({ statusCode: 401, message: 'Invalid session' })

  const mediaId = getRouterParam(event, 'id')!

  await db
    .delete(userFavorites)
    .where(and(eq(userFavorites.userId, userId), eq(userFavorites.mediaId, mediaId)))

  return { favorited: false }
})
