/**
 * PUT /api/v1/media/:id/favorite
 * Adds the current user's favorite on a media item (idempotent).
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

  // Upsert: ignore if already favorited
  await db
    .insert(userFavorites)
    .values({ userId, mediaId, addedAt: new Date() })
    .onConflictDoNothing()

  return { favorited: true }
})
