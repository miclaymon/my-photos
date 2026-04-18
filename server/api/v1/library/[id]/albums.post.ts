/**
 * POST /api/v1/library/:id/albums
 *
 * Creates a new album in the library.
 * Body: { name: string }
 *
 * Only library owners and editors may create albums.
 */
import { eq, and } from 'drizzle-orm'
import { db } from '~/server/db'
import { albums, libraryAccess, libraries } from '~/server/db/schema'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const userId    = (session.user as { id: number }).id
  const libraryId = getRouterParam(event, 'id')
  if (!libraryId) throw createError({ statusCode: 400, message: 'Library ID required' })

  const body = await readBody<{ name?: string }>(event)
  const name = body?.name?.trim()
  if (!name) throw createError({ statusCode: 400, message: 'Album name is required' })

  // Check the library exists
  const [library] = await db
    .select({ id: libraries.id, ownerId: libraries.ownerId })
    .from(libraries)
    .where(eq(libraries.id, libraryId))
    .limit(1)
  if (!library) throw createError({ statusCode: 404, message: 'Library not found' })

  // Only owner/editor may create albums
  const isLibraryOwner = library.ownerId === userId
  if (!isLibraryOwner) {
    const [access] = await db
      .select({ role: libraryAccess.role })
      .from(libraryAccess)
      .where(and(eq(libraryAccess.libraryId, libraryId), eq(libraryAccess.userId, userId)))
      .limit(1)
    const role = access?.role
    if (role !== 'owner' && role !== 'editor') {
      throw createError({ statusCode: 403, message: 'Only library owners and editors can create albums' })
    }
  }

  const now = new Date()
  const id  = crypto.randomUUID()

  await db.insert(albums).values({
    id,
    libraryId,
    ownerId:   userId,
    name,
    createdAt: now,
    updatedAt: now,
  })

  return { id, name, libraryId, ownerId: userId, createdAt: now.toISOString() }
})
