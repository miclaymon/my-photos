/**
 * GET /api/v1/library/:id/media
 *
 * Returns media items for a library, newest first (by takenAt → createdAt).
 * Each item includes a presigned GET URL for direct browser fetch from RustFS.
 * Videos also include presigned URLs for their thumbnail and hover-preview clip
 * when those have been processed by the background ffmpeg job.
 *
 * Query params:
 *   limit  — max items to return (default 200)
 *   cursor — ISO date string; return items older than this (pagination, future)
 */
import { eq, desc, isNull, and } from 'drizzle-orm'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { db } from '~/server/db'
import { media, libraryMedia } from '~/server/db/schema'
import { getStorageClient, getStorageBucket } from '~/server/utils/storage'
import { logger } from '~/server/utils/logger'

const URL_EXPIRY_SECONDS = 3600

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const libraryId = getRouterParam(event, 'id')
  if (!libraryId) throw createError({ statusCode: 400, message: 'Library ID required' })

  const query = getQuery(event)
  const limit = Math.min(Number(query.limit ?? 200), 500)

  // Fetch media for this library, excluding soft-deleted items (deletionDate set),
  // newest first (using takenAt when available, falling back to createdAt)
  const rows = await db
    .select({
      id:                 media.id,
      objectKey:          media.objectKey,
      originalFilename:   media.originalFilename,
      contentType:        media.contentType,
      size:               media.size,
      width:              media.width,
      height:             media.height,
      aspectRatio:        media.aspectRatio,
      durationSeconds:    media.durationSeconds,
      takenAt:            media.takenAt,
      createdAt:          media.createdAt,
      thumbnailObjectKey: media.thumbnailObjectKey,
      previewObjectKey:   media.previewObjectKey,
    })
    .from(libraryMedia)
    .innerJoin(media, eq(libraryMedia.mediaId, media.id))
    .where(and(
      eq(libraryMedia.libraryId, libraryId),
      isNull(media.deletionDate),
      isNull(media.archivedAt),
    ))
    .orderBy(desc(media.takenAt), desc(media.createdAt))
    .limit(limit)

  logger.info('library media list', { libraryId, rowCount: rows.length })
  if (!rows.length) return { items: [] }

  const client = getStorageClient()
  const bucket = getStorageBucket()

  const items = await Promise.all(
    rows.map(async (row) => {
      // Presigned URL for the main object
      const src = await getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: bucket, Key: row.objectKey }),
        { expiresIn: URL_EXPIRY_SECONDS },
      )

      // Presigned URL for video thumbnail (if processed)
      let thumbnailSrc: string | undefined
      if (row.thumbnailObjectKey) {
        thumbnailSrc = await getSignedUrl(
          client,
          new GetObjectCommand({ Bucket: bucket, Key: row.thumbnailObjectKey }),
          { expiresIn: URL_EXPIRY_SECONDS },
        ).catch(() => undefined)
      }

      // Presigned URL for hover-preview clip (if processed)
      let previewSrc: string | undefined
      if (row.previewObjectKey) {
        previewSrc = await getSignedUrl(
          client,
          new GetObjectCommand({ Bucket: bucket, Key: row.previewObjectKey }),
          { expiresIn: URL_EXPIRY_SECONDS },
        ).catch(() => undefined)
      }

      const aspectRatio = row.aspectRatio ?? (row.width && row.height ? row.width / row.height : 1.5)
      const width  = row.width  ?? Math.round(aspectRatio >= 1 ? 1200 : 800)
      const height = row.height ?? Math.round(width / aspectRatio)
      const isVideo   = row.contentType.startsWith('video/')
      const takenAt   = row.takenAt ?? row.createdAt

      return {
        id:               row.id,
        originalFilename: row.originalFilename,
        contentType:      row.contentType,
        width,
        height,
        aspectRatio,
        takenAt:          takenAt instanceof Date
          ? takenAt.toISOString()
          : new Date((takenAt as number) * 1000).toISOString(),
        isVideo,
        durationSeconds:  row.durationSeconds ?? undefined,
        src,
        thumbnailSrc,
        previewSrc,
      }
    }),
  )

  return { items }
})
