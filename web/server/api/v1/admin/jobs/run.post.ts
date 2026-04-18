/**
 * POST /api/v1/admin/jobs/run
 *
 * Trigger a background processing job.
 * Jobs run asynchronously — this endpoint returns immediately.
 * Poll GET /api/v1/admin/jobs/status for progress.
 *
 * Body: { job: 'object-detection' | 'face-grouping' | 'ocr' | 'location-geocode', libraryId?: string, reprocess?: boolean }
 */
import { startJob } from '~/server/jobs'
import type { JobName } from '~/server/jobs'

const VALID_JOBS: JobName[] = ['object-detection', 'face-grouping', 'ocr', 'location-geocode']

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production') {
    throw createError({ statusCode: 404 })
  }

  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const body = await readBody<{ job?: string; libraryId?: string; reprocess?: boolean }>(event)

  if (!body?.job || !VALID_JOBS.includes(body.job as JobName)) {
    throw createError({
      statusCode: 400,
      message:    `Invalid job name. Valid options: ${VALID_JOBS.join(', ')}`,
    })
  }

  const { alreadyRunning } = startJob(body.job as JobName, {
    libraryId: body.libraryId,
    reprocess: body.reprocess ?? false,
  })

  return { started: !alreadyRunning, alreadyRunning }
})
