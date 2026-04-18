/**
 * GET /api/v1/library/:id/places
 *
 * Returns the distinct reverse-geocoded location labels for media in this
 * library, along with item counts. Items that are in the trash or archived
 * are excluded.
 *
 * Response: { places: Array<{ label: string; count: number }> }
 */
import { eq, and, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from '~/server/db'
import { media, libraryMedia } from '~/server/db/schema'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const libraryId = getRouterParam(event, 'id')!

  const rows = await db
    .select({
      label: media.locationLabel,
      count: sql<number>`count(*)`.as('count'),
    })
    .from(media)
    .innerJoin(libraryMedia, eq(libraryMedia.mediaId, media.id))
    .where(
      and(
        eq(libraryMedia.libraryId, libraryId),
        isNotNull(media.locationLabel),
        isNull(media.deletionDate),
        isNull(media.archivedAt),
      ),
    )
    .groupBy(media.locationLabel)
    .orderBy(sql`count(*) desc`)

  return {
    places: rows.map(r => ({ label: r.label!, count: r.count })),
  }
})
