/**
 * PATCH /api/v1/subjects/:id
 *
 * Update a subject's name or hidden status.
 * Body: { name?: string | null, hidden?: boolean }
 *
 * If the new name conflicts with an existing subject of the same type in the
 * same library, responds with 409:
 *   { conflict: true, existingId: string, existingName: string }
 * The client can then prompt the user to merge.
 */
import { eq, and, ne } from 'drizzle-orm'
import { db } from '~/server/db'
import { subjects } from '~/server/db/schema'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'Subject ID required' })

  const body = await readBody<{ name?: string | null; hidden?: boolean; coverMediaId?: string }>(event)

  const [existing] = await db
    .select()
    .from(subjects)
    .where(eq(subjects.id, id))
    .limit(1)

  if (!existing) throw createError({ statusCode: 404, message: 'Subject not found' })

  // Check for name conflict before saving
  if ('name' in body && body.name) {
    const trimmed = body.name.trim()
    if (trimmed) {
      const siblings = await db
        .select({ id: subjects.id, name: subjects.name })
        .from(subjects)
        .where(and(
          eq(subjects.libraryId, existing.libraryId),
          eq(subjects.type, existing.type),
          ne(subjects.id, id),
        ))

      const conflict = siblings.find(r =>
        r.name?.trim().toLowerCase() === trimmed.toLowerCase(),
      )

      if (conflict) {
        throw createError({
          statusCode: 409,
          data: { conflict: true, existingId: conflict.id, existingName: conflict.name },
        })
      }
    }
  }

  const updates: Partial<typeof subjects.$inferInsert> = { updatedAt: new Date() }
  if ('name'         in body) updates.name         = body.name?.trim() || null
  if ('hidden'       in body) updates.hidden       = body.hidden ? 1 : 0
  if ('coverMediaId' in body) updates.coverMediaId = body.coverMediaId ?? null

  await db.update(subjects).set(updates).where(eq(subjects.id, id))

  return { ok: true }
})
