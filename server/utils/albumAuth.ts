/**
 * Album permission helpers
 *
 * canViewAlbum  — owner | library owner/editor/viewer | albumAccess view/edit
 * canEditAlbum  — owner | library owner/editor         | albumAccess edit
 */
import { eq, and, or, isNull } from 'drizzle-orm'
import { db } from '~/server/db'
import { albums, libraryAccess, albumAccess } from '~/server/db/schema'

export type AlbumRow = { id: string; libraryId: string; ownerId: number; deletedAt: Date | null }

/** Fetch a non-deleted album row or throw 404. */
export async function requireAlbum(albumId: string): Promise<AlbumRow> {
  const [row] = await db
    .select({
      id:        albums.id,
      libraryId: albums.libraryId,
      ownerId:   albums.ownerId,
      deletedAt: albums.deletedAt,
    })
    .from(albums)
    .where(and(eq(albums.id, albumId), isNull(albums.deletedAt)))
    .limit(1)

  if (!row) throw createError({ statusCode: 404, message: 'Album not found' })
  return row
}

async function libraryRole(userId: number, libraryId: string): Promise<string | null> {
  const [row] = await db
    .select({ role: libraryAccess.role })
    .from(libraryAccess)
    .where(and(eq(libraryAccess.libraryId, libraryId), eq(libraryAccess.userId, userId)))
    .limit(1)
  return row?.role ?? null
}

async function albumPermission(userId: number, albumId: string): Promise<string | null> {
  const [row] = await db
    .select({ permission: albumAccess.permission })
    .from(albumAccess)
    .where(and(eq(albumAccess.albumId, albumId), eq(albumAccess.userId, userId)))
    .limit(1)
  return row?.permission ?? null
}

/** Throws 403 if user cannot view the album. Returns canEdit boolean. */
export async function requireAlbumView(
  userId: number,
  album: AlbumRow,
): Promise<{ canEdit: boolean }> {
  if (userId === album.ownerId) return { canEdit: true }
  const role = await libraryRole(userId, album.libraryId)
  if (role === 'owner' || role === 'editor') return { canEdit: true }
  if (role === 'viewer') return { canEdit: false }
  const perm = await albumPermission(userId, album.id)
  if (perm === 'edit') return { canEdit: true }
  if (perm === 'view') return { canEdit: false }
  throw createError({ statusCode: 403, message: 'Access denied' })
}

/** Throws 403 if user cannot edit the album. */
export async function requireAlbumEdit(userId: number, album: AlbumRow): Promise<void> {
  if (userId === album.ownerId) return
  const role = await libraryRole(userId, album.libraryId)
  if (role === 'owner' || role === 'editor') return
  const perm = await albumPermission(userId, album.id)
  if (perm === 'edit') return
  throw createError({ statusCode: 403, message: 'Access denied' })
}
