/**
 * GET /api/v1/storage/health
 *
 * Tests connectivity to the configured S3-compatible storage backend.
 * Admin-only endpoint.
 */
import { storageHealthCheck } from '~/server/utils/storage'

export default defineEventHandler(async (event) => {
  // Require authentication
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  try {
    const result = await storageHealthCheck()
    return result
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Storage connection failed'
    throw createError({ statusCode: 502, message })
  }
})
