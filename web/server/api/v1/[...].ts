/**
 * BFF catch-all proxy — forwards all /api/v1/* requests to the FastAPI data API.
 *
 * Auth routes (/api/v1/auth/login, /api/v1/auth/logout) are handled by specific
 * Nitro file-based routes that take priority over this catch-all.
 *
 * For all other requests:
 *   1. Reads the access token from the signed session cookie
 *   2. If the access token is expired (FastAPI returns 401), tries to refresh it
 *      using the stored refresh token and retries the original request once.
 *   3. Forwards the request (method + body + query string) to DATA_API_URL
 *   4. Adds Authorization: Bearer <token> so FastAPI can authenticate the user
 *   5. Returns the JSON response from FastAPI to the browser
 */
import type { H3Event } from 'h3'

const apiUrl: string|object = useRuntimeConfig()?.dataApiUrl ?? 'http://localhost:8000'

async function tryRefresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string } | null> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    if (!res.ok) return null
    const data = await res.json() as { access_token: string; refresh_token: string }
    return { accessToken: data.access_token, refreshToken: data.refresh_token }
  } catch {
    return null
  }
}

async function forwardRequest(upstream: string, method: string, headers: Record<string, string>, bodyText: string | undefined): Promise<Response> {
  try {
    return await fetch(upstream, { method, headers, body: bodyText })
  } catch {
    throw createError({ statusCode: 502, message: 'Data API unreachable' })
  }
}

async function parseAndReturn(event: H3Event, res: Response): Promise<unknown> {
  // Set the upstream status code on the Nitro response so $fetch on the client
  // throws a FetchError with the correct status. The raw FastAPI body is passed
  // through as-is so callers can inspect `error.response._data` to get details
  // (e.g. conflict info from 409 responses) without Nitro wrapping them.
  setResponseStatus(event, res.status)
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return await res.json()
  }
  return await res.text()
}

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const sess = session as Record<string, unknown>
  let accessToken  = sess.accessToken  as string | undefined
  let refreshToken = sess.refreshToken as string | undefined

  if (!accessToken) {
    throw createError({ statusCode: 401, message: 'Unauthorised' })
  }

  // Preserve full path + query string
  const fullPath = event.node.req.url ?? event.path
  const upstream  = `${apiUrl}${fullPath}`

  const method = getMethod(event)
  // Include DELETE so request bodies (e.g. delete-library options) are forwarded.
  // HTTP allows DELETE with a body; FastAPI/Pydantic accepts it.
  const isBodyMethod = !['GET', 'HEAD'].includes(method)

  let bodyText: string | undefined
  if (isBodyMethod) {
    try {
      const raw = await readBody(event)
      if (raw !== undefined && raw !== null) {
        bodyText = JSON.stringify(raw)
      }
    } catch {
      // No body or unparseable — send nothing
    }
  }

  let headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }

  let res = await forwardRequest(upstream, method, headers, bodyText)

  // On 401, try refreshing the access token once then retry
  if (res.status === 401 && refreshToken) {
    const refreshed = await tryRefresh(refreshToken)
    if (refreshed) {
      accessToken  = refreshed.accessToken
      refreshToken = refreshed.refreshToken
      // Persist updated tokens in the session cookie
      await setUserSession(event, {
        ...sess,
        accessToken,
        refreshToken,
      } as Parameters<typeof setUserSession>[1])
      headers = { ...headers, Authorization: `Bearer ${accessToken}` }
      res = await forwardRequest(upstream, method, headers, bodyText)
    } else {
      // Refresh token also expired — clear session so the client re-logs in
      await clearUserSession(event)
      throw createError({ statusCode: 401, message: 'Session expired — please log in again' })
    }
  }

  return parseAndReturn(event, res)
})
