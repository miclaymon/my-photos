/**
 * DELETE /api/v1/albums/:albumId
 *
 * Soft-deletes an album. Only the album owner may delete.
 */
import { eq } from 'drizzle-orm'
import { db } from '~/server/db'
import { albums } from '~/server/db/schema'
import { requireAlbum } from '~/server/utils/albumAuth'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const userId  = (session.user as { id: number }).id
  const albumId = getRouterParam(event, 'albumId')
  if (!albumId) throw createError({ statusCode: 400, message: 'Album ID required' })

  const album = await requireAlbum(albumId)
  if (album.ownerId !== userId) {
    throw createError({ statusCode: 403, message: 'Only the album owner can delete it' })
  }

  await db.update(albums).set({ deletedAt: new Date() }).where(eq(albums.id, albumId))
  return { ok: true }
})
