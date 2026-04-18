/**
 * POST /api/v1/media/complete
 *
 * Called by the client after a direct-to-storage PUT succeeds.
 * Records media metadata in the DB and associates it with the chosen libraries.
 *
 * The client now extracts EXIF date locally (full file in memory) and sends it
 * as `takenAt`, so we trust that value immediately and write the record fast.
 * For images, `processImage` runs fire-and-forget and updates the record with
 * server-verified dimensions, EXIF, and the generated thumbnail.
 * For videos, `processVideo` does the same plus thumbnail frame + preview clip.
 *
 * Request body:
 *   {
 *     objectKey:    string
 *     filename:     string
 *     contentType:  string
 *     size:         number   — bytes
 *     libraryIds:   string[]
 *     width?:       number   — client-measured; overwritten by server processing
 *     height?:      number
 *     aspectRatio?: number
 *     takenAt?:     string   — ISO date from client-side EXIF or file.lastModified
 *     hash?:        string   — SHA-256 hex (dedup key)
 *   }
 *
 * Response: { id: string }
 */
import { db } from '~/server/db'
import { media, libraries, libraryMedia } from '~/server/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { logger } from '~/server/utils/logger'
import { processImage, processVideo } from '~/server/utils/mediaProcessing'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const body = await readBody<{
    objectKey:    string
    filename:     string
    contentType:  string
    size:         number
    libraryIds:   string[]
    width?:       number
    height?:      number
    aspectRatio?: number
    takenAt?:     string
    hash?:        string
  }>(event)

  if (!body.objectKey || !body.filename || !body.contentType || !body.size) {
    throw createError({ statusCode: 400, message: 'objectKey, filename, contentType and size are required' })
  }

  const userId = (session.user as { id?: number }).id
  if (!userId) throw createError({ statusCode: 401, message: 'Invalid session' })

  const id      = crypto.randomUUID()
  const isVideo = body.contentType.startsWith('video/')
  const isImage = body.contentType.startsWith('image/')

  // Client sends takenAt from its own EXIF read (or file.lastModified fallback).
  // We trust it now for a fast response; server processing may update it later.
  const takenAt = body.takenAt ? new Date(body.takenAt) : null

  logger.info('media complete: recording', {
    id, userId,
    filename:  body.filename,
    objectKey: body.objectKey,
    size:      body.size,
    isVideo,
    libraryIds: body.libraryIds,
  })

  // ── Insert media record ────────────────────────────────────────────────────
  await db.insert(media).values({
    id,
    uploadedBy:       userId,
    objectKey:        body.objectKey,
    originalFilename: body.filename,
    contentType:      body.contentType,
    size:             body.size,
    width:            body.width       ?? null,
    height:           body.height      ?? null,
    aspectRatio:      body.aspectRatio ?? null,
    takenAt,
    hash:             body.hash ?? null,
  })

  // ── Library associations ───────────────────────────────────────────────────
  if (body.libraryIds?.length) {
    const requested = Array.from(new Set(body.libraryIds as string[]))

    const existing = await db
      .select({ id: libraries.id })
      .from(libraries)
      .where(inArray(libraries.id, requested))

    const existingIds = new Set(existing.map(r => r.id))
    const missing     = requested.filter((lid): lid is string => !existingIds.has(lid))

    if (missing.length) {
      await db.insert(libraries).values(
        missing.map((lid: string) => ({
          id:      lid,
          name:    lid.charAt(0).toUpperCase() + lid.slice(1),
          type:    (lid === 'personal' ? 'personal' : 'shared') as 'personal' | 'shared',
          ownerId: lid === 'personal' ? userId : null,
        })),
      ).onConflictDoNothing()
    }

    await db.insert(libraryMedia).values(
      requested.map((libId: string) => ({ libraryId: libId, mediaId: id })),
    ).onConflictDoNothing()
  }

  // ── Fire-and-forget media processing ──────────────────────────────────────
  // Return immediately; the gallery will show updated data on next refresh.
  if (isImage) {
    processImage(body.objectKey).then(async (result) => {
      if (!result) return
      await db.update(media).set({
        thumbnailObjectKey: result.thumbnailObjectKey,
        width:              result.width,
        height:             result.height,
        aspectRatio:        result.aspectRatio,
        // Only overwrite takenAt if the client didn't have EXIF data (server found one)
        ...(result.takenAt && !body.takenAt ? { takenAt: result.takenAt } : {}),
        exifData:           result.exifData ?? null,
      }).where(eq(media.id, id))
      logger.success('image: DB updated after processing', { id })
    }).catch(() => {})
  } else if (isVideo) {
    processVideo(body.objectKey).then(async (result) => {
      if (!result) return
      await db.update(media).set({
        thumbnailObjectKey: result.thumbnailObjectKey,
        previewObjectKey:   result.previewObjectKey,
        ...(result.width           ? { width: result.width }                             : {}),
        ...(result.height          ? { height: result.height }                           : {}),
        ...(result.aspectRatio     ? { aspectRatio: result.aspectRatio }                 : {}),
        ...(result.durationSeconds != null ? { durationSeconds: result.durationSeconds } : {}),
        // takenAt from QuickTime/XMP metadata — always prefer over the null sent by client
        ...(result.takenAt    ? { takenAt: result.takenAt }       : {}),
        exifData: result.exifData ?? null,
      }).where(eq(media.id, id))
      logger.success('video: DB updated with thumbnail/preview/dims/date/metadata', { id })
    }).catch(() => {})
  }

  logger.success('media complete: saved', { id, objectKey: body.objectKey, libraries: body.libraryIds })
  return { id }
})
