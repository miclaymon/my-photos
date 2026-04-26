export interface MediaItem {
  id:               string
  aspectRatio:      number
  width:            number
  height:           number
  takenAt:          string   // ISO date string
  isVideo:          boolean
  duration?:        string   // e.g. "1:23" — video tiles
  originalFilename: string
  /** Presigned URL to the full-resolution source (image or video). */
  src?:             string
  /**
   * Presigned URL to the extracted thumbnail image (video items only).
   * Populated by the background ffmpeg job after upload.
   */
  thumbnailSrc?:    string
  /**
   * Presigned URL to the short low-res preview clip (video items only).
   * Shown on tile hover. Populated by the background ffmpeg job.
   */
  previewSrc?:      string
  /** True while the item has been uploaded but the API hasn't confirmed it yet. */
  isProvisional?:   boolean
  /** ISO date at which the item will be permanently deleted (trash only). */
  deletionDate?:    string
  /** ISO date at which the item was archived (archive only). */
  archivedAt?:      string
}

export interface GallerySection {
  dateKey:         string
  label:           string
  items:           ReadonlyArray<MediaItem>
  /** "2026" */
  yearKey:         string
  /** "2026-04" */
  monthKey:        string
  /** Render a year heading above this section (first section of that year; suppressed for current year) */
  showYearHeader:  boolean
  yearLabel:       string
  /** Render a month heading above this section (first section of that month; suppressed for current month) */
  showMonthHeader: boolean
  /** Full month name e.g. "April" */
  monthLabel:      string
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function pad(n: number) { return String(n).padStart(2, '0') }

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${pad(s)}`
}

const DAY_NAMES        = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES      = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_NAMES_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/**
 * Extract a YYYY-MM-DD key from an ISO date string using LOCAL time methods.
 * Parsing with `new Date()` and using getFullYear/getMonth/getDate preserves
 * the user's local calendar day regardless of the UTC offset in the stored string.
 */
function localDateKey(isoString: string): string {
  const d = new Date(isoString)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export interface GroupOptions {
  /**
   * Extract the ISO date string to group by.
   * Return null/undefined to skip the item entirely.
   */
  dateKey:  (item: MediaItem) => string | null | undefined
  /** 'asc' = oldest/soonest first; 'desc' = newest first (default). */
  sortDir?: 'asc' | 'desc'
  /**
   * Override the sticky section header label.
   * Defaults to the standard "Day, Mon D" format.
   */
  dayLabel?: (dateKey: string, date: Date) => string
  /** Suppress the year heading for the current year (default: true). */
  suppressCurrentYear?:  boolean
  /** Suppress the month heading for the current month (default: true). */
  suppressCurrentMonth?: boolean
}

/**
 * Generic grouping function. Groups items into GallerySections using any
 * date field, in any sort direction, with optional custom section labels.
 */
export function groupItems(items: MediaItem[], opts: GroupOptions): GallerySection[] {
  const {
    dateKey:   getDateKey,
    sortDir  = 'desc',
    dayLabel,
    suppressCurrentYear  = true,
    suppressCurrentMonth = true,
  } = opts

  const map = new Map<string, MediaItem[]>()
  for (const item of items) {
    const iso = getDateKey(item)
    if (!iso) continue
    const key = localDateKey(iso)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(item)
  }

  const now          = new Date()
  const currentYear  = String(now.getFullYear())
  const currentMonth = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`

  const result: GallerySection[] = Array.from(map.entries())
    .sort(([a], [b]) => sortDir === 'asc' ? a.localeCompare(b) : b.localeCompare(a))
    .map(([key, dayItems]) => {
      const [y, m, d] = key.split('-').map(Number) as [number, number, number]
      const date      = new Date(y, m - 1, d)
      const yearKey   = String(y)
      const monthKey  = `${y}-${pad(m)}`
      return {
        dateKey:         key,
        label:           dayLabel
          ? dayLabel(key, date)
          : `${DAY_NAMES[date.getDay()]}, ${MONTH_NAMES[m - 1]} ${d}`,
        items:           dayItems,
        yearKey,
        monthKey,
        showYearHeader:  false,
        yearLabel:       yearKey,
        showMonthHeader: false,
        monthLabel:      MONTH_NAMES_FULL[m - 1]!,
      }
    })

  let prevYear  = ''
  let prevMonth = ''
  for (const s of result) {
    if (s.yearKey !== prevYear) {
      s.showYearHeader  = !(suppressCurrentYear  && s.yearKey  === currentYear)
      s.showMonthHeader = !(suppressCurrentMonth && s.monthKey === currentMonth)
      prevYear  = s.yearKey
      prevMonth = s.monthKey
    } else if (s.monthKey !== prevMonth) {
      s.showMonthHeader = !(suppressCurrentMonth && s.monthKey === currentMonth)
      prevMonth = s.monthKey
    }
  }

  return result
}

function groupByDay(items: MediaItem[]): GallerySection[] {
  return groupItems(items, { dateKey: item => item.takenAt, sortDir: 'desc' })
}

// ── Real-data fetch ───────────────────────────────────────────────────────────

const realItems        = ref<MediaItem[]>([])
const provisionalItems = ref<MediaItem[]>([])
// Tracks which library we have data for, and when it was fetched
const loadedLibraryId  = ref<string | null>(null)
const fetchingFor      = ref<string | null>(null)

// Blob URLs we've created for provisional items — revoke when replaced
const _blobUrls = new Map<string, string>()

export function addProvisionalItem(item: MediaItem) {
  // Deduplicate by id
  provisionalItems.value = [
    item,
    ...provisionalItems.value.filter(p => p.id !== item.id),
  ]
}

async function loadLibraryMedia(libraryId: string) {
  if (fetchingFor.value === libraryId) return   // request already in-flight

  fetchingFor.value = libraryId

  try {
    const data = await $fetch<{ items: Array<{
      id:                string
      original_filename: string
      content_type:      string
      width:             number
      height:            number
      aspect_ratio:      number
      taken_at:          string
      is_video:          boolean
      duration_seconds?: number
      // src is omitted for images (null) — only present for videos without a thumbnail.
      // The lightbox fetches the full-res URL lazily via GET /api/v1/media/{id}.
      src?:              string | null
      thumbnail_src?:    string | null
      // preview_src is always null in the list; loaded on demand.
      preview_src?:      string | null
    }> }>(`/api/v1/library/${libraryId}/media`)

    if (fetchingFor.value !== libraryId) return   // library changed while fetching

    // Preserve existing presigned thumbnail URLs to prevent flicker on re-fetch.
    // Presigned GET URLs are valid for 1 hour; reusing them avoids the browser
    // treating a new URL as a different resource and re-downloading the image.
    const prevById = new Map(realItems.value.map(i => [i.id, i]))

    const nextReal = data.items.map(item => {
      const prev    = prevById.get(item.id)
      const blobUrl = _blobUrls.get(item.id)

      // If the server now has a real thumbnail, revoke the provisional blob URL
      if (item.thumbnail_src && blobUrl) {
        URL.revokeObjectURL(blobUrl)
        _blobUrls.delete(item.id)
      }

      return {
        id:               item.id,
        originalFilename: item.original_filename,
        aspectRatio:      item.aspect_ratio,
        width:            item.width,
        height:           item.height,
        takenAt:          item.taken_at,
        isVideo:          item.is_video,
        duration:         item.duration_seconds
                            ? formatDuration(Math.round(item.duration_seconds)) : undefined,
        // Prefer server-provided URLs; fall back to the provisional blob URL so
        // newly-uploaded items remain visible while the background thumbnail job runs.
        src:          prev?.src          ?? item.src          ?? blobUrl ?? undefined,
        thumbnailSrc: prev?.thumbnailSrc ?? item.thumbnail_src ?? undefined,
        previewSrc:   prev?.previewSrc   ?? item.preview_src  ?? undefined,
      }
    })

    realItems.value       = nextReal
    loadedLibraryId.value = libraryId

    // Drop provisional items now represented by real items.
    // Blob URL lifecycle is managed in the nextReal loop above.
    const realIds = new Set(nextReal.map(i => i.id))
    provisionalItems.value = provisionalItems.value.filter(p => !realIds.has(p.id))
  } catch {
    // Fail silently — mock data still shows
    if (fetchingFor.value === libraryId) realItems.value = []
  } finally {
    if (fetchingFor.value === libraryId) fetchingFor.value = null
  }
}

// Register a blob URL so it can be revoked when the provisional is replaced
export function registerBlobUrl(itemId: string, blobUrl: string) {
  _blobUrls.set(itemId, blobUrl)
}

// ── Merged computed ───────────────────────────────────────────────────────────

const allItems = computed<MediaItem[]>(() => {
  // Provisionals first (newest uploads at top), then confirmed real items
  return [...provisionalItems.value, ...realItems.value]
})

const sections = computed(() => groupByDay(allItems.value))

// ── Public API ────────────────────────────────────────────────────────────────

const isLoading = computed(() => fetchingFor.value !== null)

export function useGalleryData() {
  return {
    sections:          readonly(sections),
    allItems:          readonly(allItems),
    isLoading:         readonly(isLoading),
    loadLibraryMedia,
    addProvisionalItem,
    registerBlobUrl,
  }
}

// Direct access for non-component composables (e.g. useUpload)
export { sections as gallerySections }
