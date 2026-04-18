/**
 * POST /api/v1/albums/:albumId/reorder
 *
 * Reorder album items.
 * Body: { order: number[] }  — array of albumItem IDs in the new desired order.
 *
 * Assigns sortOrder 0, 1, 2, … to the supplied IDs.
 */
import { eq, and, inArray } from 'drizzle-orm'
import { db } from '~/server/db'
import { albumItems } from '~/server/db/schema'
import { requireAlbum, requireAlbumEdit } from '~/server/utils/albumAuth'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const userId  = (session.user as { id: number }).id
  const albumId = getRouterParam(event, 'albumId')
  if (!albumId) throw createError({ statusCode: 400, message: 'Album ID required' })

  const album = await requireAlbum(albumId)
  await requireAlbumEdit(userId, album)

  const body = await readBody<{ order?: number[] }>(event)
  const order = body?.order
  if (!Array.isArray(order) || !order.length) {
    throw createError({ statusCode: 400, message: 'order array is required' })
  }

  // Update each item's sortOrder in a single transaction
  await db.transaction(async (tx) => {
    await Promise.all(
      order.map((itemId, idx) =>
        tx
          .update(albumItems)
          .set({ sortOrder: idx })
          .where(and(eq(albumItems.id, itemId), eq(albumItems.albumId, albumId))),
      ),
    )
  })

  return { ok: true }
})
