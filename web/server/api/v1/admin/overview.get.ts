/**
 * GET /api/v1/admin/overview
 *
 * Developer overview: returns all media rows from the DB and all objects
 * from the RustFS bucket with presigned GET URLs.
 *
 * Guard: only available when NODE_ENV !== 'production'.
 * Requires an active session.
 */
import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { desc, eq } from 'drizzle-orm'
import { db } from '~/server/db'
import { media, libraries, libraryMedia, libraryAccess, shareLinks, users } from '~/server/db/schema'
import { getStorageClient, getStorageBucket } from '~/server/utils/storage'
import { logger } from '~/server/utils/logger'

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production') {
    throw createError({ statusCode: 404, message: 'Not found' })
  }

  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  logger.info('admin overview requested')

  // ── DB: all media with uploader and library memberships ───────────────────
  const dbMedia = await db
    .select({
      id:                  media.id,
      objectKey:           media.objectKey,
      thumbnailObjectKey:  media.thumbnailObjectKey,
      originalFilename:    media.originalFilename,
      contentType:         media.contentType,
      size:                media.size,
      width:               media.width,
      height:              media.height,
      aspectRatio:         media.aspectRatio,
      durationSeconds:     media.durationSeconds,
      takenAt:             media.takenAt,
      createdAt:           media.createdAt,
      uploaderEmail:       users.email,
    })
    .from(media)
    .leftJoin(users, eq(media.uploadedBy, users.id))
    .orderBy(desc(media.createdAt))

  // Fetch library memberships for each media item
  const memberships = await db
    .select({
      mediaId:     libraryMedia.mediaId,
      libraryId:   libraryMedia.libraryId,
      libraryName: libraries.name,
      libraryType: libraries.type,
    })
    .from(libraryMedia)
    .leftJoin(libraries, eq(libraryMedia.libraryId, libraries.id))

  const membershipMap = new Map<string, Array<{ id: string; name: string; type: string }>>()
  for (const m of memberships) {
    if (!membershipMap.has(m.mediaId)) membershipMap.set(m.mediaId, [])
    membershipMap.get(m.mediaId)!.push({
      id:   m.libraryId,
      name: m.libraryName ?? m.libraryId,
      type: m.libraryType ?? 'unknown',
    })
  }

  // ── DB: all libraries with owner email ───────────────────────────────────
  const dbLibraries = await db
    .select({
      id:         libraries.id,
      name:       libraries.name,
      type:       libraries.type,
      ownerId:    libraries.ownerId,
      ownerEmail: users.email,
      createdAt:  libraries.createdAt,
    })
    .from(libraries)
    .leftJoin(users, eq(libraries.ownerId, users.id))
    .orderBy(libraries.name)

  // ── DB: library access entries ────────────────────────────────────────────
  const accessRows = await db
    .select({
      libraryId: libraryAccess.libraryId,
      userId:    libraryAccess.userId,
      email:     users.email,
      role:      libraryAccess.role,
      addedAt:   libraryAccess.addedAt,
    })
    .from(libraryAccess)
    .leftJoin(users, eq(libraryAccess.userId, users.id))

  const accessByLibrary = new Map<string, typeof accessRows>()
  for (const row of accessRows) {
    if (!accessByLibrary.has(row.libraryId)) accessByLibrary.set(row.libraryId, [])
    accessByLibrary.get(row.libraryId)!.push(row)
  }

  // ── DB: share links ───────────────────────────────────────────────────────
  const linkRows = await db
    .select({
      id:             shareLinks.id,
      libraryId:      shareLinks.libraryId,
      albumId:        shareLinks.albumId,
      mediaIds:       shareLinks.mediaIds,
      createdByEmail: users.email,
      expiresAt:      shareLinks.expiresAt,
      lastUsedAt:     shareLinks.lastUsedAt,
      revokedAt:      shareLinks.revokedAt,
      createdAt:      shareLinks.createdAt,
    })
    .from(shareLinks)
    .leftJoin(users, eq(shareLinks.createdBy, users.id))
    .orderBy(desc(shareLinks.createdAt))

  const linksByLibrary = new Map<string, typeof linkRows>()
  for (const row of linkRows) {
    if (!linksByLibrary.has(row.libraryId)) linksByLibrary.set(row.libraryId, [])
    linksByLibrary.get(row.libraryId)!.push(row)
  }

  // ── Storage: list all objects in bucket ───────────────────────────────────
  const client = getStorageClient()
  const bucket = getStorageBucket()

  let bucketObjects: Array<{
    key:          string
    size:         number
    lastModified: string | null
    src:          string
  }> = []

  try {
    let continuationToken: string | undefined
    const allObjects: Array<{ Key?: string; Size?: number; LastModified?: Date }> = []

    do {
      const res = await client.send(new ListObjectsV2Command({
        Bucket:            bucket,
        ContinuationToken: continuationToken,
        MaxKeys:           1000,
      }))
      allObjects.push(...(res.Contents ?? []))
      continuationToken = res.NextContinuationToken
    } while (continuationToken)

    // Generate presigned GET URLs in parallel (capped to avoid timeout)
    const toSign = allObjects.slice(0, 200)
    bucketObjects = await Promise.all(
      toSign.map(async (obj) => {
        const key = obj.Key ?? ''
        const src = await getSignedUrl(
          client,
          new GetObjectCommand({ Bucket: bucket, Key: key }),
          { expiresIn: 3600 },
        )
        return {
          key,
          size:         obj.Size ?? 0,
          lastModified: obj.LastModified?.toISOString() ?? null,
          src,
        }
      }),
    )
  } catch (err) {
    logger.warn('admin overview: bucket listing failed', err)
  }

  // ── Merge: annotate DB items with a presigned src URL ────────────────────
  const objectKeyToSrc = new Map(bucketObjects.map(o => [o.key, o.src]))

  const mediaItems = dbMedia.map(row => ({
    ...row,
    createdAt:    row.createdAt instanceof Date ? row.createdAt.toISOString()
                    : row.createdAt ? new Date((row.createdAt as number) * 1000).toISOString() : null,
    takenAt:      row.takenAt instanceof Date ? row.takenAt.toISOString()
                    : row.takenAt ? new Date((row.takenAt as number) * 1000).toISOString() : null,
    src:          objectKeyToSrc.get(row.objectKey) ?? null,
    thumbnailSrc: row.thumbnailObjectKey ? (objectKeyToSrc.get(row.thumbnailObjectKey) ?? null) : null,
    libraries:    membershipMap.get(row.id) ?? [],
  }))

  function toIso(v: Date | number | null | undefined): string | null {
    if (!v) return null
    if (v instanceof Date) return v.toISOString()
    return new Date((v as number) * 1000).toISOString()
  }

  const enrichedLibraries = dbLibraries.map(lib => ({
    id:         lib.id,
    name:       lib.name,
    type:       lib.type,
    ownerId:    lib.ownerId,
    ownerEmail: lib.ownerEmail ?? null,
    createdAt:  toIso(lib.createdAt),
    access: (accessByLibrary.get(lib.id) ?? []).map(a => ({
      userId:  a.userId,
      email:   a.email ?? '',
      role:    a.role,
      addedAt: toIso(a.addedAt) ?? '',
    })),
    shareLinks: (linksByLibrary.get(lib.id) ?? []).map(l => ({
      id:             l.id,
      albumId:        l.albumId ?? null,
      mediaIds:       l.mediaIds ?? null,
      createdByEmail: l.createdByEmail ?? null,
      expiresAt:      toIso(l.expiresAt),
      lastUsedAt:     toIso(l.lastUsedAt),
      revokedAt:      toIso(l.revokedAt),
      createdAt:      toIso(l.createdAt) ?? '',
    })),
  }))

  return {
    counts: {
      dbMedia:       dbMedia.length,
      dbLibraries:   dbLibraries.length,
      bucketObjects: bucketObjects.length,
    },
    media:        mediaItems,
    libraries:    enrichedLibraries,
    bucketObjects,
  }
})
