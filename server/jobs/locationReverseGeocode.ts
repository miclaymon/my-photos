/**
 * Location reverse geocoding job.
 *
 * Reads GPS coordinates stored in `exif_data` JSON for each media item and
 * calls the OpenStreetMap Nominatim API to resolve a human-readable location
 * label (e.g. "Houston, Texas" or "Circuit of the Americas").
 *
 * The original EXIF/video metadata is never modified — the result is stored
 * in the `location_label` column only.
 *
 * Rate limit: Nominatim asks for at most 1 request/second. We wait 1100ms
 * between calls to be safe.
 */
import { isNull, isNotNull, and, eq } from 'drizzle-orm'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import ExifReader from 'exifreader'
import { db } from '~/server/db'
import { media } from '~/server/db/schema'
import { getStorageClient, getStorageBucket } from '~/server/utils/storage'
import type { JobOptions, StatusUpdater } from './types'

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse'
const RATE_LIMIT_MS = 1100

// ── GPS parsing ───────────────────────────────────────────────────────────────

/**
 * Parse a DMS string like "33 deg 44' 56.4\" N" or "33°44'56.4\"N" to decimal degrees.
 * Returns null if parsing fails.
 */
function parseDMS(dms: string, ref: string): number | null {
  // Match patterns like "33 deg 44' 56.4\" N" or "33 44 56.4"
  const m = dms.match(/(\d+)[°\s]+(?:deg\s+)?(\d+)['\s]+([0-9.]+)["\s]*([NSEW])?/i)
  if (!m) return null
  const deg = parseFloat(m[1]!)
  const min = parseFloat(m[2]!)
  const sec = parseFloat(m[3]!)
  const direction = (m[4] ?? ref ?? '').toUpperCase()
  const decimal = deg + min / 60 + sec / 3600
  return (direction === 'S' || direction === 'W') ? -decimal : decimal
}

/** True only for bare signed/unsigned decimal strings — no DMS components. */
function isPureDecimal(s: string): boolean {
  return /^-?[0-9]+(\.[0-9]+)?$/.test(s.trim())
}

/**
 * Extract decimal lat/lon from the parsed exifData object.
 * Handles several formats produced by ExifReader and exiftool.
 *
 * ExifReader's `description` for GPS tags is typically a DMS string like
 * "33 deg 44' 56.4\" N" — NOT a plain decimal. parseFloat() of such a string
 * returns only the leading degrees (e.g. 33) without direction, so we must
 * route DMS strings through the DMS parser, not the decimal path.
 */
function extractCoordinates(exif: Record<string, unknown>): { lat: number; lon: number } | null {
  try {
    const latRaw = exif['GPSLatitude']
    const lonRaw = exif['GPSLongitude']
    const latRef = (exif['GPSLatitudeRef'] as string | undefined) ?? ''
    const lonRef = (exif['GPSLongitudeRef'] as string | undefined) ?? ''

    if (!latRaw || !lonRaw) return null

    // Normalise ref strings: ExifReader description may be "North latitude" /
    // "West longitude" (full word) or just "N" / "W" (single char).
    // Grab the first character uppercased so comparisons work for both forms.
    const latDir = latRef.trim().toUpperCase()[0] ?? ''
    const lonDir = lonRef.trim().toUpperCase()[0] ?? ''

    // Pre-signed decimal numbers (some parsers return these directly).
    // ExifReader stores GPS as *unsigned* decimals — the ref fields carry the sign.
    if (typeof latRaw === 'number' && typeof lonRaw === 'number') {
      const lat = (latDir === 'S' && latRaw > 0) ? -latRaw : latRaw
      const lon = (lonDir === 'W' && lonRaw > 0) ? -lonRaw : lonRaw
      return { lat, lon }
    }

    if (typeof latRaw === 'string' && typeof lonRaw === 'string') {
      // Only use the decimal path when the string is a bare decimal — never for
      // DMS strings ("33 deg 44' 56.4\" N"), which parseFloat would silently
      // truncate to just the degree component and lose the hemisphere direction.
      if (isPureDecimal(latRaw) && isPureDecimal(lonRaw)) {
        const latNum = parseFloat(latRaw)
        const lonNum = parseFloat(lonRaw)
        const lat = (latDir === 'S' && latNum > 0) ? -latNum : latNum
        const lon = (lonDir === 'W' && lonNum > 0) ? -lonNum : lonNum
        if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon }
      }

      // DMS strings: direction may be embedded ("33 deg 44' 56.4\" N")
      // or provided via the separate GPSLatitudeRef / GPSLongitudeRef fields.
      const lat = parseDMS(latRaw, latDir)
      const lon = parseDMS(lonRaw, lonDir)
      if (lat !== null && lon !== null) return { lat, lon }
    }

    return null
  } catch {
    return null
  }
}

// ── GPS ref recovery ──────────────────────────────────────────────────────────

/**
 * Download the first 64 KB of the original file from storage and re-extract
 * GPSLatitudeRef / GPSLongitudeRef using ExifReader.
 *
 * This is needed when mediaProcessing.ts stored GPS lat/lon as unsigned
 * decimal numbers but did not record the hemisphere ref tags.  The refs live
 * in the EXIF header near the top of the file, so a 64 KB byte-range fetch
 * is sufficient for every JPEG/HEIC/MP4 we care about.
 */
async function fetchGpsRefsFromFile(
  objectKey: string,
): Promise<{ latRef: string; lonRef: string } | null> {
  try {
    const client = getStorageClient()
    const bucket = getStorageBucket()
    const resp = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: objectKey, Range: 'bytes=0-65535' }),
    )
    if (!resp.Body) return null

    const chunks: Uint8Array[] = []
    for await (const chunk of resp.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk)
    }
    const buf    = Buffer.concat(chunks)
    const tags   = ExifReader.load(buf, { expanded: false })
    const latRef = ((tags['GPSLatitudeRef']  as { description?: string } | undefined)?.description ?? '').toUpperCase()
    const lonRef = ((tags['GPSLongitudeRef'] as { description?: string } | undefined)?.description ?? '').toUpperCase()

    return (latRef || lonRef) ? { latRef, lonRef } : null
  } catch {
    return null
  }
}

// ── Nominatim call ────────────────────────────────────────────────────────────

interface NominatimResponse {
  display_name?: string
  address?: {
    amenity?:     string
    tourism?:     string
    leisure?:     string
    stadium?:     string
    city?:        string
    town?:        string
    village?:     string
    suburb?:      string
    county?:      string
    state?:       string
    country?:     string
    country_code?: string
  }
}

async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  try {
    const url = `${NOMINATIM_URL}?lat=${lat}&lon=${lon}&format=json&zoom=14&accept-language=en`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'my-photos-app/1.0 (private photo management app)' },
    })
    if (!res.ok) return null

    const data = await res.json() as NominatimResponse
    const addr = data.address
    if (!addr) return null

    // Prefer a specific named venue
    const venue = addr.amenity ?? addr.tourism ?? addr.leisure ?? addr.stadium
    const place = addr.city ?? addr.town ?? addr.village ?? addr.suburb ?? addr.county
    const region = addr.state
    const countryCode = (addr.country_code ?? '').toUpperCase()

    if (venue && place) {
      // "Circuit of the Americas, Austin"
      return `${venue}, ${place}`
    }
    if (venue) {
      return venue
    }
    if (place && region && countryCode === 'US') {
      // "Houston, Texas"
      return `${place}, ${region}`
    }
    if (place && addr.country) {
      // "Paris, France"
      return `${place}, ${addr.country}`
    }
    if (place) return place
    return data.display_name?.split(',').slice(0, 2).join(', ') ?? null
  } catch {
    return null
  }
}

// ── Job runner ────────────────────────────────────────────────────────────────

export async function runLocationGeocodeJob(opts: JobOptions, update: StatusUpdater): Promise<void> {
  // Fetch items that have exif_data and haven't been geocoded yet (or reprocess flag set)
  const rows = await db
    .select({
      id:        media.id,
      objectKey: media.objectKey,
      exifData:  media.exifData,
    })
    .from(media)
    .where(
      and(
        isNotNull(media.exifData),
        opts.reprocess ? undefined : isNull(media.locationProcessedAt),
      ),
    )

  // Filter to only items that actually have GPS data — avoids unnecessary DB writes
  const candidates = rows.filter(r => {
    if (!r.exifData) return false
    try {
      const exif = JSON.parse(r.exifData) as Record<string, unknown>
      return !!(exif['GPSLatitude'] && exif['GPSLongitude'])
    } catch {
      return false
    }
  })

  // If libraryId filter requested, scope to that library
  // (for simplicity we filter in memory since the join is complex here)
  const filtered = opts.libraryId
    ? await (async () => {
        const { libraryMedia } = await import('~/server/db/schema')
        const { inArray } = await import('drizzle-orm')
        const libRows = await db
          .select({ mediaId: libraryMedia.mediaId })
          .from(libraryMedia)
          .where(eq(libraryMedia.libraryId, opts.libraryId!))
        const libSet = new Set(libRows.map(r => r.mediaId))
        return candidates.filter(c => libSet.has(c.id))
      })()
    : candidates

  update({ total: filtered.length, processed: 0, errors: 0 })

  let processed = 0
  let errors    = 0

  for (const row of filtered) {
    update({ currentItem: row.id })
    const now = new Date()

    try {
      const exif = JSON.parse(row.exifData!) as Record<string, unknown>

      // If GPS values are unsigned numbers but hemisphere refs are absent, the
      // sign cannot be determined from exifData alone.  Re-extract the refs
      // from the first 64 KB of the original file and patch them in so that
      // extractCoordinates can apply the correct sign.
      if (
        typeof exif['GPSLatitude']  === 'number' &&
        typeof exif['GPSLongitude'] === 'number' &&
        !exif['GPSLatitudeRef'] &&
        !exif['GPSLongitudeRef']
      ) {
        const refs = await fetchGpsRefsFromFile(row.objectKey)
        if (refs) {
          exif['GPSLatitudeRef']  = refs.latRef
          exif['GPSLongitudeRef'] = refs.lonRef
          // Persist the recovered refs so future jobs skip the S3 fetch.
          await db
            .update(media)
            .set({ exifData: JSON.stringify(exif) })
            .where(eq(media.id, row.id))
        }
      }

      const coords = extractCoordinates(exif)

      let label: string | null = null
      if (coords) {
        label = await reverseGeocode(coords.lat, coords.lon)
      }

      await db
        .update(media)
        .set({ locationLabel: label, locationProcessedAt: now })
        .where(eq(media.id, row.id))
    } catch {
      errors++
      update({ errors })
    }

    processed++
    update({ processed })

    // Respect Nominatim rate limit
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS))
  }
}
