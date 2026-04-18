/**
 * PATCH /api/v1/albums/:albumId
 *
 * Update album metadata.
 * Body: { name?: string; coverId?: string | null }
 */
import { eq } from 'drizzle-orm'
import { db } from '~/server/db'
import { albums } from '~/server/db/schema'
import { requireAlbum, requireAlbumEdit } from '~/server/utils/albumAuth'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const userId  = (session.user as { id: number }).id
  const albumId = getRouterParam(event, 'albumId')
  if (!albumId) throw createError({ statusCode: 400, message: 'Album ID required' })

  const album = await requireAlbum(albumId)
  await requireAlbumEdit(userId, album)

  const body = await readBody<{ name?: string; coverId?: string | null }>(event)
  const updates: Record<string, unknown> = { updatedAt: new Date() }

  if (body.name !== undefined) {
    const name = body.name.trim()
    if (!name) throw createError({ statusCode: 400, message: 'Name cannot be empty' })
    updates.name = name
  }

  if ('coverId' in body) {
    updates.coverId = body.coverId ?? null
  }

  await db.update(albums).set(updates).where(eq(albums.id, albumId))
  return { ok: true }
})
