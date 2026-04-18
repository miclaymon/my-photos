/**
 * POST /api/v1/library/:id/copy-from
 *
 * Copies selected media items into the target library by adding
 * library_media rows. Does not duplicate the underlying objects.
 *
 * Request body:
 *   { mediaIds: string[] }
 */
import { db } from '~/server/db'
import { libraryMedia } from '~/server/db/schema'
import { logger } from '~/server/utils/logger'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const targetLibraryId = getRouterParam(event, 'id')
  if (!targetLibraryId) throw createError({ statusCode: 400, message: 'Library ID required' })

  const body = await readBody<{ mediaIds?: string[] }>(event)
  if (!body.mediaIds?.length) {
    throw createError({ statusCode: 400, message: 'mediaIds is required' })
  }

  const rows = body.mediaIds.map(mediaId => ({ libraryId: targetLibraryId, mediaId }))
  await db.insert(libraryMedia).values(rows).onConflictDoNothing()

  logger.success('copy-from: linked items', { targetLibraryId, count: rows.length })
  return { copied: rows.length }
})
