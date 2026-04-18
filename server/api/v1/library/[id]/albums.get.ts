/**
 * GET /api/v1/library/:id/albums
 *
 * Returns all non-deleted albums in the library, newest first.
 * Each album includes:
 *   - metadata (id, name, createdAt, itemCount, canEdit)
 *   - coverUrls: up to 4 presigned thumbnail URLs for the cover collage
 *     (explicit coverId first, then the first 4 album items by sortOrder)
 */
import { eq, and, isNull, asc, sql } from 'drizzle-orm'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { db } from '~/server/db'
import { albums, albumItems, media, libraryAccess } from '~/server/db/schema'
import { getStorageClient, getStorageBucket } from '~/server/utils/storage'

const URL_EXPIRY = 3600

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const userId   = (session.user as { id: number }).id
  const libraryId = getRouterParam(event, 'id')
  if (!libraryId) throw createError({ statusCode: 400, message: 'Library ID required' })

  // Determine edit permission (owner/editor of the library)
  const [access] = await db
    .select({ role: libraryAccess.role })
    .from(libraryAccess)
    .where(and(eq(libraryAccess.libraryId, libraryId), eq(libraryAccess.userId, userId)))
    .limit(1)
  const libraryRole = access?.role ?? null

  // Fetch all non-deleted albums in this library with item count
  const albumRows = await db
    .select({
      id:        albums.id,
      name:      albums.name,
      ownerId:   albums.ownerId,
      coverId:   albums.coverId,
      createdAt: albums.createdAt,
      updatedAt: albums.updatedAt,
      itemCount: sql<number>`cast(count(${albumItems.id}) as integer)`,
    })
    .from(albums)
    .leftJoin(albumItems, eq(albumItems.albumId, albums.id))
    .where(and(eq(albums.libraryId, libraryId), isNull(albums.deletedAt)))
    .groupBy(albums.id)
    .orderBy(asc(albums.createdAt))

  if (!albumRows.length) return { albums: [] }

  const client = getStorageClient()
  const bucket = getStorageBucket()

  const presign = (key: string) =>
    getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: URL_EXPIRY })
      .catch(() => null)

  // For each album, resolve cover URLs (up to 4 items)
  const result = await Promise.all(albumRows.map(async (album) => {
    const canEdit = userId === album.ownerId
      || libraryRole === 'owner'
      || libraryRole === 'editor'

    // Fetch cover media rows: explicit cover first, then first 4 items by sortOrder
    let coverKeys: string[] = []

    if (album.coverId) {
      const [coverRow] = await db
        .select({ objectKey: media.objectKey, thumbnailObjectKey: media.thumbnailObjectKey })
        .from(media)
        .where(eq(media.id, album.coverId))
        .limit(1)
      if (coverRow) {
        coverKeys = [coverRow.thumbnailObjectKey ?? coverRow.objectKey]
      }
    }

    if (!coverKeys.length) {
      const itemRows = await db
        .select({ objectKey: media.objectKey, thumbnailObjectKey: media.thumbnailObjectKey })
        .from(albumItems)
        .innerJoin(media, eq(albumItems.mediaId, media.id))
        .where(eq(albumItems.albumId, album.id))
        .orderBy(asc(albumItems.sortOrder))
        .limit(4)
      coverKeys = itemRows.map(r => r.thumbnailObjectKey ?? r.objectKey)
    }

    const coverUrls = (await Promise.all(coverKeys.map(presign))).filter(Boolean) as string[]

    return {
      id:        album.id,
      name:      album.name,
      ownerId:   album.ownerId,
      createdAt: album.createdAt instanceof Date
        ? album.createdAt.toISOString()
        : new Date((album.createdAt as unknown as number) * 1000).toISOString(),
      updatedAt: album.updatedAt instanceof Date
        ? album.updatedAt.toISOString()
        : new Date((album.updatedAt as unknown as number) * 1000).toISOString(),
      itemCount: album.itemCount ?? 0,
      canEdit,
      coverUrls,
    }
  }))

  return { albums: result }
})
