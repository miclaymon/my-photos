/**
 * GET /api/v1/admin/jobs/status
 *
 * Returns the current status of all background jobs.
 * Dates are serialised as ISO strings for JSON transport.
 */
import { getAllJobStatuses } from '~/server/jobs'

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production') {
    throw createError({ statusCode: 404 })
  }

  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const statuses = getAllJobStatuses()

  // Serialise Date objects to ISO strings
  return Object.fromEntries(
    Object.entries(statuses).map(([name, s]) => [
      name,
      {
        ...s,
        startedAt:  s.startedAt?.toISOString()  ?? null,
        finishedAt: s.finishedAt?.toISOString()  ?? null,
      },
    ]),
  )
})
