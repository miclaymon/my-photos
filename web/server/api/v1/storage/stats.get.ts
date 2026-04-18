/**
 * GET /api/v1/storage/stats
 *
 * Returns storage usage metrics aggregated from the media table:
 *   - Total bytes used and item count
 *   - Breakdown by media type (images / videos)
 *   - Breakdown by year taken
 *   - Breakdown by library (personal libraries of other users are grouped
 *     together unless the requester is admin)
 *
 * "Admin" is currently the first created user (id === 1). This should be
 * replaced by a proper role column once a role system is added to the schema.
 *
 * Soft-deleted items (deletionDate set) are excluded; archived items are
 * included since they still occupy physical storage.
 */
import { sql, isNull, eq } from 'drizzle-orm'
import { db } from '~/server/db'
import { media, libraries, libraryMedia } from '~/server/db/schema'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const userId  = (session.user as { id: number }).id
  const isAdmin = userId === 1

  // ── Helpers ────────────────────────────────────────────────────────────────

  const bytesExpr = sql<number>`cast(coalesce(sum(${media.size}), 0) as integer)`
  const countExpr = sql<number>`cast(count(*) as integer)`

  // The takenAt column is a Unix timestamp (seconds). To get the calendar year
  // in the user's UTC offset we use SQLite's strftime with unixepoch modifier.
  const yearExpr  = sql<string>`strftime('%Y', datetime(${media.takenAt}, 'unixepoch'))`
  const typeExpr  = sql<string>`case when ${media.contentType} like 'video/%' then 'video' else 'image' end`

  // Only active items (not in trash)
  const activeWhere = isNull(media.deletionDate)

  // ── Total ──────────────────────────────────────────────────────────────────
  const [totals] = await db
    .select({ totalBytes: bytesExpr, totalCount: countExpr })
    .from(media)
    .where(activeWhere)

  // ── By media type ──────────────────────────────────────────────────────────
  const typeRows = await db
    .select({ type: typeExpr, bytes: bytesExpr, count: countExpr })
    .from(media)
    .where(activeWhere)
    .groupBy(typeExpr)

  const byType = typeRows.map(r => ({
    type:  r.type as 'image' | 'video',
    label: r.type === 'video' ? 'Videos' : 'Photos',
    bytes: r.bytes ?? 0,
    count: r.count ?? 0,
  }))

  // ── By year taken ──────────────────────────────────────────────────────────
  // Items without a takenAt are grouped under a null-year bucket and labelled
  // "Unknown". We use the createdAt year as a fallback for those items.
  const fallbackYearExpr = sql<string>`strftime('%Y', datetime(${media.createdAt}, 'unixepoch'))`
  const effectiveYearExpr = sql<string>`coalesce(
    case when ${media.takenAt} is not null
         then strftime('%Y', datetime(${media.takenAt}, 'unixepoch'))
         else null end,
    strftime('%Y', datetime(${media.createdAt}, 'unixepoch'))
  )`

  const yearRows = await db
    .select({ year: effectiveYearExpr, bytes: bytesExpr, count: countExpr })
    .from(media)
    .where(activeWhere)
    .groupBy(effectiveYearExpr)
    .orderBy(sql`1 desc`)

  const byYear = yearRows
    .filter(r => r.year != null)
    .map(r => ({
      year:  r.year ?? 'Unknown',
      bytes: r.bytes ?? 0,
      count: r.count ?? 0,
    }))

  // ── By library ─────────────────────────────────────────────────────────────
  // Bytes per library = sum of sizes of all active media associated with that
  // library. One item in N libraries is counted N times here, so the per-library
  // total may exceed the physical total.
  const libRows = await db
    .select({
      id:      libraries.id,
      name:    libraries.name,
      type:    libraries.type,
      ownerId: libraries.ownerId,
      bytes:   bytesExpr,
      count:   countExpr,
    })
    .from(libraryMedia)
    .innerJoin(media,     eq(libraryMedia.mediaId,   media.id))
    .innerJoin(libraries, eq(libraryMedia.libraryId, libraries.id))
    .where(isNull(media.deletionDate))
    .groupBy(libraries.id)
    .orderBy(sql`cast(coalesce(sum(${media.size}), 0) as integer) desc`)

  // For non-admin users: group personal libraries owned by other users together.
  type LibEntry = {
    id:    string
    name:  string
    type:  'personal' | 'shared' | 'other_personal'
    bytes: number
    count: number
  }

  let byLibrary: LibEntry[]
  if (isAdmin) {
    byLibrary = libRows.map(r => ({
      id:    r.id,
      name:  r.name,
      type:  r.type as 'personal' | 'shared',
      bytes: r.bytes ?? 0,
      count: r.count ?? 0,
    }))
  } else {
    let otherPersonalBytes = 0
    let otherPersonalCount = 0
    const visible: LibEntry[] = []

    for (const r of libRows) {
      const isOtherPersonal = r.type === 'personal' && r.ownerId !== userId
      if (isOtherPersonal) {
        otherPersonalBytes += r.bytes ?? 0
        otherPersonalCount += r.count ?? 0
      } else {
        visible.push({
          id:    r.id,
          name:  r.name,
          type:  r.type as 'personal' | 'shared',
          bytes: r.bytes ?? 0,
          count: r.count ?? 0,
        })
      }
    }

    if (otherPersonalBytes > 0) {
      visible.push({
        id:    '__other_personal__',
        name:  "Other users' libraries",
        type:  'other_personal',
        bytes: otherPersonalBytes,
        count: otherPersonalCount,
      })
    }

    byLibrary = visible
  }

  return {
    totalBytes: totals?.totalBytes ?? 0,
    totalCount: totals?.totalCount ?? 0,
    isAdmin,
    byType,
    byYear,
    byLibrary,
  }
})
