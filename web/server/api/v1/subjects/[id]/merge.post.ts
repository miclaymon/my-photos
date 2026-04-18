/**
 * POST /api/v1/subjects/:id/merge
 *
 * Merge subject `id` into `intoId`. The subject at `id` is absorbed;
 * `intoId` survives and takes on the combined data.
 *
 * Body: { intoId: string, name?: string }
 *
 * For people: reassigns all subject_detections to intoId.
 * For pets:   merges petClass arrays so both COCO classes map to the survivor.
 */
import { eq, and } from 'drizzle-orm'
import { db } from '~/server/db'
import { subjects, subjectDetections } from '~/server/db/schema'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const fromId = getRouterParam(event, 'id')
  if (!fromId) throw createError({ statusCode: 400, message: 'Subject ID required' })

  const body = await readBody<{ intoId: string; name?: string }>(event)
  if (!body?.intoId) throw createError({ statusCode: 400, message: 'intoId required' })

  const [fromSubject] = await db.select().from(subjects).where(eq(subjects.id, fromId)).limit(1)
  const [intoSubject] = await db.select().from(subjects).where(eq(subjects.id, body.intoId)).limit(1)

  if (!fromSubject) throw createError({ statusCode: 404, message: 'Source subject not found' })
  if (!intoSubject) throw createError({ statusCode: 404, message: 'Target subject not found' })

  if (fromSubject.libraryId !== intoSubject.libraryId)
    throw createError({ statusCode: 400, message: 'Subjects must belong to the same library' })
  if (fromSubject.type !== intoSubject.type)
    throw createError({ statusCode: 400, message: 'Cannot merge subjects of different types' })

  const now = new Date()

  if (fromSubject.type === 'person') {
    // Reassign all face detections from the merged subject to the survivor
    await db
      .update(subjectDetections)
      .set({ subjectId: intoSubject.id })
      .where(eq(subjectDetections.subjectId, fromSubject.id))
  } else {
    // Merge petClass arrays
    let fromClasses: string[] = []
    let intoClasses: string[] = []
    try { fromClasses = JSON.parse(fromSubject.petClass ?? '[]') } catch { /* ignore */ }
    try { intoClasses = JSON.parse(intoSubject.petClass ?? '[]') } catch { /* ignore */ }

    // Fallback: derive from name if petClass not set (pre-migration rows)
    if (!fromClasses.length && fromSubject.name) fromClasses = [fromSubject.name.toLowerCase()]
    if (!intoClasses.length && intoSubject.name) intoClasses = [intoSubject.name.toLowerCase()]

    const merged = [...new Set([...intoClasses, ...fromClasses])]

    await db
      .update(subjects)
      .set({ petClass: JSON.stringify(merged), updatedAt: now })
      .where(eq(subjects.id, intoSubject.id))
  }

  // Apply new name to survivor if provided
  const survivorName = body.name?.trim() || intoSubject.name
  await db
    .update(subjects)
    .set({ name: survivorName, updatedAt: now })
    .where(eq(subjects.id, intoSubject.id))

  // Delete the merged-away subject
  await db.delete(subjects).where(eq(subjects.id, fromSubject.id))

  return { ok: true, survivorId: intoSubject.id }
})
