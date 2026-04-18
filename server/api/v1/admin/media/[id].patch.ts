/**
 * PATCH /api/v1/admin/media/:id
 *
 * Edits editable fields on a media DB record.
 * Only the fields present in the request body are updated.
 *
 * Guard: dev-only. Requires active session.
 *
 * Body: { originalFilename?, takenAt?, width?, height?, aspectRatio? }
 */
import { eq } from 'drizzle-orm'
import { db } from '~/server/db'
import { media } from '~/server/db/schema'
import { logger } from '~/server/utils/logger'

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production') {
    throw createError({ statusCode: 404, message: 'Not found' })
  }

  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'Media ID required' })

  const body = await readBody<{
    originalFilename?: string
    takenAt?:          string | null   // ISO string or null to clear
    width?:            number | null
    height?:           number | null
    aspectRatio?:      number | null
  }>(event)

  const patch: Partial<{
    originalFilename: string
    takenAt:          Date | null
    width:            number | null
    height:           number | null
    aspectRatio:      number | null
  }> = {}

  if (body.originalFilename !== undefined) patch.originalFilename = body.originalFilename
  if (body.takenAt          !== undefined) patch.takenAt          = body.takenAt ? new Date(body.takenAt) : null
  if (body.width            !== undefined) patch.width            = body.width
  if (body.height           !== undefined) patch.height           = body.height
  if (body.aspectRatio      !== undefined) patch.aspectRatio      = body.aspectRatio

  if (!Object.keys(patch).length) {
    throw createError({ statusCode: 400, message: 'No fields to update' })
  }

  await db.update(media).set(patch).where(eq(media.id, id))
  logger.info('admin: patched media record', { id, patch })

  return { ok: true }
})
