export default defineEventHandler(async (event) => {
  const { email, password } = await readBody<{ email: string; password: string }>(event)

  if (!email || !password) {
    throw createError({ statusCode: 400, message: 'Email and password are required' })
  }

  const apiUrl = process.env.DATA_API_URL ?? 'http://localhost:8000'

  // 1. Exchange credentials for tokens
  let tokenData: { access_token: string; token_type: string; refresh_token: string }
  try {
    const res = await fetch(`${apiUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (res.status === 401) throw createError({ statusCode: 401, message: 'Invalid credentials' })
    if (!res.ok)           throw createError({ statusCode: 502, message: 'Auth service error' })
    tokenData = await res.json()
  } catch (err: unknown) {
    const h3err = err as { statusCode?: number }
    if (h3err?.statusCode) throw err
    throw createError({ statusCode: 502, message: 'Auth service unavailable' })
  }

  // 2. Fetch the authenticated user's profile so we can store real id + is_admin
  let userInfo: { id: number; email: string; display_name: string | null; is_admin: boolean }
  try {
    const res = await fetch(`${apiUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    userInfo = await res.json()
  } catch {
    // Non-fatal — fall back to minimal shape if /me is unreachable
    userInfo = { id: 0, email, display_name: null, is_admin: false }
  }

  await setUserSession(event, {
    user: {
      id:       userInfo.id,
      email:    userInfo.email,
      isAdmin:  userInfo.is_admin,
    },
    accessToken:  tokenData.access_token,
    refreshToken: tokenData.refresh_token,
  })

  return { ok: true }
})
