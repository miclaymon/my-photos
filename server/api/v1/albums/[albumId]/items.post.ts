/**
 * POST /api/v1/albums/:albumId/items
 *
 * Add media items to an album.
 * Body: { mediaIds: string[] }
 *
 * Items are appended after the current last item (highest sortOrder + 1).
 * Duplicate items (already in album) are silently skipped.
 */
import { eq, max, inArray } from 'drizzle-orm'
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

  const body = await readBody<{ mediaIds?: string[] }>(event)
  const mediaIds = body?.mediaIds?.filter(Boolean) ?? []
  if (!mediaIds.length) throw createError({ statusCode: 400, message: 'mediaIds is required' })

  // Find existing items to avoid duplicates
  const existing = await db
    .select({ mediaId: albumItems.mediaId })
    .from(albumItems)
    .where(eq(albumItems.albumId, albumId))
  const existingIds = new Set(existing.map(r => r.mediaId))

  const toAdd = mediaIds.filter(id => !existingIds.has(id))
  if (!toAdd.length) return { added: 0 }

  // Get current max sortOrder
  const [{ maxOrder }] = await db
    .select({ maxOrder: max(albumItems.sortOrder) })
    .from(albumItems)
    .where(eq(albumItems.albumId, albumId))
  const base = (maxOrder ?? -1) + 1

  const now = new Date()
  await db.insert(albumItems).values(
    toAdd.map((mediaId, i) => ({
      albumId,
      mediaId,
      sortOrder: base + i,
      addedAt:   now,
    })),
  )

  return { added: toAdd.length }
})
