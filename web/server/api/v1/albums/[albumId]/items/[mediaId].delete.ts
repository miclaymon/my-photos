/**
 * DELETE /api/v1/albums/:albumId/items/:mediaId
 *
 * Remove a media item from an album.
 */
import { eq, and } from 'drizzle-orm'
import { db } from '~/server/db'
import { albumItems } from '~/server/db/schema'
import { requireAlbum, requireAlbumEdit } from '~/server/utils/albumAuth'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const userId  = (session.user as { id: number }).id
  const albumId = getRouterParam(event, 'albumId')
  const mediaId = getRouterParam(event, 'mediaId')
  if (!albumId || !mediaId) throw createError({ statusCode: 400, message: 'IDs required' })

  const album = await requireAlbum(albumId)
  await requireAlbumEdit(userId, album)

  await db
    .delete(albumItems)
    .where(and(eq(albumItems.albumId, albumId), eq(albumItems.mediaId, mediaId)))

  return { ok: true }
})
