/**
 * GET /api/v1/albums
 *
 * Returns all non-deleted albums across all libraries the user has access to,
 * ordered by most recently updated first.
 * Each album includes coverUrls (up to 4 presigned thumbnails).
 */
import { eq, and, isNull, desc, sql, or, inArray } from 'drizzle-orm'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { db } from '~/server/db'
import { albums, albumItems, media, libraries, libraryAccess } from '~/server/db/schema'
import { getStorageClient, getStorageBucket } from '~/server/utils/storage'

const URL_EXPIRY = 3600

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const userId = (session.user as { id: number }).id

  // Libraries the user has explicit access to
  const accessRows = await db
    .select({ libraryId: libraryAccess.libraryId, role: libraryAccess.role })
    .from(libraryAccess)
    .where(eq(libraryAccess.userId, userId))

  // Libraries the user owns
  const ownedLibraries = await db
    .select({ id: libraries.id })
    .from(libraries)
    .where(eq(libraries.ownerId, userId))

  const accessibleIds = new Set([
    ...accessRows.map(r => r.libraryId),
    ...ownedLibraries.map(r => r.id),
  ])

  if (!accessibleIds.size) return { albums: [] }

  const accessibleList = Array.from(accessibleIds)

  // Fetch albums with item count
  const albumRows = await db
    .select({
      id:        albums.id,
      name:      albums.name,
      libraryId: albums.libraryId,
      ownerId:   albums.ownerId,
      coverId:   albums.coverId,
      createdAt: albums.createdAt,
      updatedAt: albums.updatedAt,
      itemCount: sql<number>`cast(count(${albumItems.id}) as integer)`,
    })
    .from(albums)
    .leftJoin(albumItems, eq(albumItems.albumId, albums.id))
    .where(and(
      isNull(albums.deletedAt),
      inArray(albums.libraryId, accessibleList),
    ))
    .groupBy(albums.id)
    .orderBy(desc(albums.updatedAt))

  if (!albumRows.length) return { albums: [] }

  const accessMap = new Map(accessRows.map(r => [r.libraryId, r.role]))
  const client    = getStorageClient()
  const bucket    = getStorageBucket()
  const presign   = (key: string) =>
    getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: URL_EXPIRY })
      .catch(() => null)

  const result = await Promise.all(albumRows.map(async (album) => {
    const role    = accessMap.get(album.libraryId)
    const isOwner = ownedLibraries.some(l => l.id === album.libraryId)
    const canEdit = userId === album.ownerId
      || isOwner
      || role === 'owner'
      || role === 'editor'

    let coverKeys: string[] = []

    if (album.coverId) {
      const [cover] = await db
        .select({ objectKey: media.objectKey, thumbnailObjectKey: media.thumbnailObjectKey })
        .from(media)
        .where(eq(media.id, album.coverId))
        .limit(1)
      if (cover) coverKeys = [cover.thumbnailObjectKey ?? cover.objectKey]
    }

    if (!coverKeys.length) {
      const items = await db
        .select({ objectKey: media.objectKey, thumbnailObjectKey: media.thumbnailObjectKey })
        .from(albumItems)
        .innerJoin(media, eq(albumItems.mediaId, media.id))
        .where(eq(albumItems.albumId, album.id))
        .orderBy(albumItems.sortOrder)
        .limit(4)
      coverKeys = items.map(r => r.thumbnailObjectKey ?? r.objectKey)
    }

    const coverUrls = (await Promise.all(coverKeys.map(presign))).filter(Boolean) as string[]

    return {
      id:        album.id,
      name:      album.name,
      libraryId: album.libraryId,
      ownerId:   album.ownerId,
      itemCount: album.itemCount ?? 0,
      canEdit,
      coverUrls,
      createdAt: album.createdAt instanceof Date
        ? album.createdAt.toISOString()
        : new Date((album.createdAt as unknown as number) * 1000).toISOString(),
      updatedAt: album.updatedAt instanceof Date
        ? album.updatedAt.toISOString()
        : new Date((album.updatedAt as unknown as number) * 1000).toISOString(),
    }
  }))

  return { albums: result }
})
