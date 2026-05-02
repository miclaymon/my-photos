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
  /** Presigned URL to the extracted thumbnail image. Stable within a 1-hour window (see s3.py). */
  thumbnailSrc?:    string
  /**
   * Presigned URL to the short low-res preview clip (video items only).
   * Shown on tile hover. Populated by the background ffmpeg job.
   */
  previewSrc?:      string
  /**
   * True while the item is being uploaded (queued, hashing, thumbnailing, uploading, notifying).
   * The tile shows a shimmer/spinner overlay and is NOT clickable.
   */
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

// ── Timeline types (for the gallery scrollbar) ────────────────────────────────

export interface TimelineBucket {
  year:  number
  month: number
  count: number
}

export interface TimelineData {
  buckets:   TimelineBucket[]
  total:     number
  newest_at: string | null
  oldest_at: string | null
}

// ── API types ─────────────────────────────────────────────────────────────────

type LibraryMediaItem = {
  id:                string
  original_filename: string
  content_type:      string
  width:             number
  height:            number
  aspect_ratio:      number
  taken_at:          string | null
  created_at?:       string
  is_video:          boolean
  duration_seconds?: number
  src?:              string | null
  thumbnail_src?:    string | null
  preview_src?:      string | null
}

interface LibraryMediaPage {
  items:        LibraryMediaItem[]
  has_older:    boolean
  has_newer:    boolean
  older_cursor: string | null
  newer_cursor: string | null
  next_cursor:  string | null
}

// ── Module state ──────────────────────────────────────────────────────────────

const realItems        = ref<MediaItem[]>([])
const provisionalItems = ref<MediaItem[]>([])
const loadedLibraryId  = ref<string | null>(null)

// Pagination cursors
const _olderCursor     = ref<string | null>(null)
const _newerCursor     = ref<string | null>(null)
const _hasMoreOlder    = ref(false)
const _hasMoreNewer    = ref(false)
const _loadingOlder    = ref(false)
const _loadingNewer    = ref(false)
const _initializing    = ref(false)

// Timeline data (per-month counts) for the gallery scrollbar
const _timelineCache = new Map<string, TimelineData>()
const _timelineData  = ref<TimelineData | null>(null)

// Blob URLs we've created for provisional items — revoke when replaced
const _blobUrls = new Map<string, string>()

// ── Provisional item management ───────────────────────────────────────────────

export function addProvisionalItem(item: MediaItem) {
  provisionalItems.value = [
    item,
    ...provisionalItems.value.filter(p => p.id !== item.id),
  ]
}

/** Patch fields on an existing provisional item (e.g. add the client thumbnail blob URL). */
export function updateProvisionalItem(id: string, patch: Partial<MediaItem>) {
  provisionalItems.value = provisionalItems.value.map(p =>
    p.id === id ? { ...p, ...patch } : p,
  )
}

/** Mark a provisional item as completed — it stays visible but is now clickable. */
export function promoteProvisionalItem(id: string) {
  provisionalItems.value = provisionalItems.value.map(p =>
    p.id === id ? { ...p, isProvisional: false } : p,
  )
}

// Register a blob URL so it can be revoked when the provisional is replaced
export function registerBlobUrl(itemId: string, blobUrl: string) {
  _blobUrls.set(itemId, blobUrl)
}

// ── Item mapping ──────────────────────────────────────────────────────────────

function _mapItem(item: LibraryMediaItem, prevById: Map<string, MediaItem>): MediaItem {
  const prev    = prevById.get(item.id)
  const blobUrl = _blobUrls.get(item.id)

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
    takenAt:          item.taken_at ?? item.created_at ?? new Date().toISOString(),
    isVideo:          item.is_video,
    duration:         item.duration_seconds
                        ? formatDuration(Math.round(item.duration_seconds)) : undefined,
    src:          prev?.src          ?? item.src          ?? blobUrl ?? undefined,
    thumbnailSrc: prev?.thumbnailSrc ?? item.thumbnail_src ?? undefined,
    previewSrc:   prev?.previewSrc   ?? item.preview_src  ?? undefined,
  }
}

async function _fetchPage(libraryId: string, params: Record<string, string>): Promise<LibraryMediaPage> {
  const qs = new URLSearchParams(params).toString()
  return $fetch<LibraryMediaPage>(`/api/v1/library/${libraryId}/media${qs ? '?' + qs : ''}`)
}

function _cleanProvisionals(loadedIds: Set<string>) {
  provisionalItems.value = provisionalItems.value.filter(p => !loadedIds.has(p.id))
}

// ── Core gallery functions ────────────────────────────────────────────────────

/**
 * Initialize (or reset) the gallery for a library, optionally centered around
 * a specific date (e.g. from the URL hash).  Loads 200 items from the anchor
 * backward, plus 50 items newer than the anchor for context above.
 */
export async function initGallery(libraryId: string, anchorDate?: string | null) {
  if (_initializing.value) return
  _initializing.value = true

  // Reset pagination state for a clean load
  realItems.value     = []
  _olderCursor.value  = null
  _newerCursor.value  = null
  _hasMoreOlder.value = false
  _hasMoreNewer.value = false

  try {
    const params: Record<string, string> = { limit: '100' }
    if (anchorDate) {
      // before = start of day after anchor → includes all items from anchor day and older
      const d = new Date(`${anchorDate}T00:00:00`)
      d.setDate(d.getDate() + 1)
      // Send without 'Z' so Python parses as naive datetime consistent with stored values
      params.before = d.toISOString().slice(0, 19)
    }

    const page     = await _fetchPage(libraryId, params)
    const prevById = new Map(realItems.value.map(i => [i.id, i]))
    const items    = page.items.map(i => _mapItem(i, prevById))

    _olderCursor.value  = page.older_cursor
    _hasMoreOlder.value = page.has_older

    let allItems = items

    // When anchoring to a past date, also load a window of newer items so
    // the user can scroll up to reach recent content without a hard boundary.
    if (anchorDate && page.has_newer && page.newer_cursor) {
      try {
        const newerPage  = await _fetchPage(libraryId, { limit: '50', after: page.newer_cursor })
        const newerItems = newerPage.items.map(i => _mapItem(i, prevById))
        allItems            = [...newerItems, ...items]
        _newerCursor.value  = newerPage.newer_cursor
        _hasMoreNewer.value = newerPage.has_newer
      } catch {
        _newerCursor.value  = page.newer_cursor
        _hasMoreNewer.value = page.has_newer
      }
    } else {
      _newerCursor.value  = page.newer_cursor
      _hasMoreNewer.value = page.has_newer
    }

    realItems.value       = allItems
    loadedLibraryId.value = libraryId
    _cleanProvisionals(new Set(allItems.map(i => i.id)))

    // Kick off timeline fetch for the scrollbar (non-blocking, cached)
    fetchTimeline(libraryId).catch(() => {})
  } catch {
    realItems.value = []
  } finally {
    _initializing.value = false
  }
}

/** Load the next batch of older items (scroll-down infinite scroll). */
export async function loadOlderMedia(libraryId: string) {
  if (!_olderCursor.value || _loadingOlder.value || !_hasMoreOlder.value) return
  _loadingOlder.value = true
  try {
    const page     = await _fetchPage(libraryId, { limit: '50', before: _olderCursor.value })
    const prevById = new Map(realItems.value.map(i => [i.id, i]))
    const newItems = page.items.map(i => _mapItem(i, prevById))
    const existing = new Set(realItems.value.map(i => i.id))
    const deduped  = newItems.filter(i => !existing.has(i.id))
    realItems.value     = [...realItems.value, ...deduped]
    _olderCursor.value  = page.older_cursor
    _hasMoreOlder.value = page.has_older
  } catch {
    // keep existing state on error
  } finally {
    _loadingOlder.value = false
  }
}

/** Load the next batch of newer items (scroll-up infinite scroll). */
export async function loadNewerMedia(libraryId: string) {
  if (!_newerCursor.value || _loadingNewer.value || !_hasMoreNewer.value) return
  _loadingNewer.value = true
  try {
    const page     = await _fetchPage(libraryId, { limit: '50', after: _newerCursor.value })
    const prevById = new Map(realItems.value.map(i => [i.id, i]))
    const newItems = page.items.map(i => _mapItem(i, prevById))
    const existing = new Set(realItems.value.map(i => i.id))
    const deduped  = newItems.filter(i => !existing.has(i.id))
    realItems.value     = [...deduped, ...realItems.value]  // prepend newer items
    _newerCursor.value  = page.newer_cursor
    _hasMoreNewer.value = page.has_newer
  } catch {
    // keep existing state on error
  } finally {
    _loadingNewer.value = false
  }
}

/**
 * Remove items from the in-memory gallery (e.g. after trash/archive).
 * Avoids a full reload and preserves scroll position.
 */
export function removeItems(ids: Set<string> | string[]) {
  const idSet = ids instanceof Set ? ids : new Set(ids)
  realItems.value        = realItems.value.filter(i => !idSet.has(i.id))
  provisionalItems.value = provisionalItems.value.filter(p => !idSet.has(p.id))
}

/** Backwards-compat alias: full reload from newest (no anchor). */
async function loadLibraryMedia(libraryId: string) {
  return initGallery(libraryId)
}

/**
 * Fetch per-month item counts for the gallery timeline scrollbar.
 * Results are cached by libraryId for the page lifetime.
 * Called automatically by initGallery — components don't need to call this directly.
 */
export async function fetchTimeline(libraryId: string): Promise<void> {
  if (_timelineCache.has(libraryId)) {
    _timelineData.value = _timelineCache.get(libraryId)!
    return
  }
  try {
    const data = await $fetch<TimelineData>(`/api/v1/library/${libraryId}/timeline`)
    _timelineCache.set(libraryId, data)
    _timelineData.value = data
  } catch {
    // Non-critical — scrollbar simply won't appear until data is available
  }
}

// ── Merged computed ───────────────────────────────────────────────────────────

const allItems = computed<MediaItem[]>(() => {
  // Provisionals first (newest uploads at top), then confirmed real items
  return [...provisionalItems.value, ...realItems.value]
})

const sections = computed(() => groupByDay(allItems.value))

// ── Public API ────────────────────────────────────────────────────────────────

const isLoading = computed(() => _initializing.value)

export function useGalleryData() {
  return {
    sections:               readonly(sections),
    allItems:               readonly(allItems),
    isLoading:              readonly(isLoading),
    hasMoreOlder:           readonly(_hasMoreOlder),
    hasMoreNewer:           readonly(_hasMoreNewer),
    isLoadingOlder:         readonly(_loadingOlder),
    isLoadingNewer:         readonly(_loadingNewer),
    loadedLibraryId:        readonly(loadedLibraryId),
    timelineData:           readonly(_timelineData),
    loadLibraryMedia,
    initGallery,
    loadOlderMedia,
    loadNewerMedia,
    removeItems,
    addProvisionalItem,
    updateProvisionalItem,
    promoteProvisionalItem,
    registerBlobUrl,
  }
}

// Direct access for non-component composables (e.g. useUpload)
export { sections as gallerySections }
