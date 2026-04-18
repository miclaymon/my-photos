import { db } from '~/server/db'
import { users } from '~/server/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { email, password } = await readBody<{ email: string; password: string }>(event)

  if (!email || !password) {
    throw createError({ statusCode: 400, message: 'Email and password are required' })
  }

  const user = await db.select().from(users).where(eq(users.email, email.toLowerCase())).get()

  // Always run verifyPassword to prevent timing-based user enumeration
  const dummyHash = '$scrypt$n=16384,r=8,p=1$dummy$dummy'
  const valid = user
    ? await verifyPassword(user.passwordHash, password)
    : await verifyPassword(dummyHash, password).catch(() => false)

  if (!user || !valid) {
    throw createError({ statusCode: 401, message: 'Invalid credentials' })
  }

  await setUserSession(event, {
    user: { id: user.id, email: user.email },
  })

  return { ok: true }
})
