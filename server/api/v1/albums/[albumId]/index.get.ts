/**
 * GET /api/v1/albums/:albumId
 *
 * Returns album metadata + all items ordered by sortOrder.
 * Each item has presigned URLs for display.
 */
import { eq, asc } from 'drizzle-orm'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { db } from '~/server/db'
import { albums, albumItems, media } from '~/server/db/schema'
import { getStorageClient, getStorageBucket } from '~/server/utils/storage'
import { requireAlbum, requireAlbumView } from '~/server/utils/albumAuth'

const URL_EXPIRY = 3600

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const userId  = (session.user as { id: number }).id
  const albumId = getRouterParam(event, 'albumId')
  if (!albumId) throw createError({ statusCode: 400, message: 'Album ID required' })

  const album              = await requireAlbum(albumId)
  const { canEdit }        = await requireAlbumView(userId, album)

  // Fetch all items in sort order
  const itemRows = await db
    .select({
      id:                 albumItems.id,
      albumId:            albumItems.albumId,
      mediaId:            albumItems.mediaId,
      sortOrder:          albumItems.sortOrder,
      caption:            albumItems.caption,
      addedAt:            albumItems.addedAt,
      objectKey:          media.objectKey,
      thumbnailObjectKey: media.thumbnailObjectKey,
      previewObjectKey:   media.previewObjectKey,
      contentType:        media.contentType,
      width:              media.width,
      height:             media.height,
      aspectRatio:        media.aspectRatio,
      durationSeconds:    media.durationSeconds,
      takenAt:            media.takenAt,
      createdAt:          media.createdAt,
      originalFilename:   media.originalFilename,
    })
    .from(albumItems)
    .innerJoin(media, eq(albumItems.mediaId, media.id))
    .where(eq(albumItems.albumId, albumId))
    .orderBy(asc(albumItems.sortOrder))

  const client = getStorageClient()
  const bucket = getStorageBucket()

  const presign = (key: string) =>
    getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: URL_EXPIRY })
      .catch(() => null)

  const items = await Promise.all(itemRows.map(async (row) => {
    const src          = await presign(row.objectKey)
    const thumbnailSrc = row.thumbnailObjectKey ? await presign(row.thumbnailObjectKey) : null
    const previewSrc   = row.previewObjectKey   ? await presign(row.previewObjectKey)   : null

    const aspectRatio  = row.aspectRatio ?? (row.width && row.height ? row.width / row.height : 1.5)
    const width        = row.width  ?? Math.round(aspectRatio >= 1 ? 1200 : 800)
    const height       = row.height ?? Math.round(width / aspectRatio)
    const isVideo      = row.contentType.startsWith('video/')
    const takenAt      = row.takenAt ?? row.createdAt
    const takenAtISO   = takenAt instanceof Date
      ? takenAt.toISOString()
      : new Date((takenAt as unknown as number) * 1000).toISOString()

    return {
      id:               row.id,
      mediaId:          row.mediaId,
      sortOrder:        row.sortOrder,
      caption:          row.caption ?? null,
      originalFilename: row.originalFilename,
      contentType:      row.contentType,
      width,
      height,
      aspectRatio,
      isVideo,
      durationSeconds:  row.durationSeconds ?? undefined,
      takenAt:          takenAtISO,
      src,
      thumbnailSrc,
      previewSrc,
    }
  }))

  // Fetch full album record for name/dates/cover
  const [full] = await db
    .select({ name: albums.name, createdAt: albums.createdAt, updatedAt: albums.updatedAt, libraryId: albums.libraryId, ownerId: albums.ownerId, coverId: albums.coverId })
    .from(albums)
    .where(eq(albums.id, albumId))
    .limit(1)

  // Resolve cover URL (explicit cover or first item)
  let coverUrl: string | null = null
  if (full?.coverId) {
    const [cover] = await db
      .select({ objectKey: media.objectKey, thumbnailObjectKey: media.thumbnailObjectKey })
      .from(media)
      .where(eq(media.id, full.coverId))
      .limit(1)
    if (cover) coverUrl = await presign(cover.thumbnailObjectKey ?? cover.objectKey)
  }
  if (!coverUrl && items[0]) {
    coverUrl = items[0].thumbnailSrc ?? items[0].src ?? null
  }

  return {
    id:        albumId,
    name:      full!.name,
    libraryId: full!.libraryId,
    ownerId:   full!.ownerId,
    coverId:   full!.coverId ?? null,
    coverUrl,
    canEdit,
    createdAt: full!.createdAt instanceof Date
      ? full!.createdAt.toISOString()
      : new Date((full!.createdAt as unknown as number) * 1000).toISOString(),
    updatedAt: full!.updatedAt instanceof Date
      ? full!.updatedAt.toISOString()
      : new Date((full!.updatedAt as unknown as number) * 1000).toISOString(),
    items,
  }
})
