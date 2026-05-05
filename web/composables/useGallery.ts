import { useLocalStorage } from '@vueuse/core'

export type GalleryMode = 'masonry' | 'grid'
export type GallerySize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'
export type GalleryGap  = 'tight' | 'normal' | 'loose'

export const ROW_HEIGHTS: Record<GallerySize, number> = {
  xs: 120, sm: 160, md: 220, lg: 280, xl: 360,
}

export const GAP_VALUES: Record<GalleryGap, number> = {
  tight: 2, normal: 3, loose: 8,
}

const _ALL_THUMB_SIZES = [64, 96, 128, 256, 512]

/**
 * Returns the thumbnail sizes (px) to request from the API for a given gallery
 * mode and size setting. Excludes sizes that are too small to ever be rendered
 * in this configuration, and always includes a safety-net size for wide tiles.
 *
 * Grid tiles are square; masonry tiles vary in width (portrait → panoramic).
 */
export function thumbSizesForGallery(mode: GalleryMode, size: GallerySize): number[] {
  const h = ROW_HEIGHTS[size]
  // Grid tiles are fixed squares; masonry can yield tiles up to ~2× row height wide
  const maxWidth = mode === 'grid' ? Math.round(h * 1.15) : Math.round(h * 2.2)
  // Portrait tiles in masonry can be as narrow as ~half the row height
  const minWidth = Math.round(h * 0.5)
  const useful = _ALL_THUMB_SIZES.filter(s => s >= minWidth && s <= maxWidth)
  // Ensure one size above maxWidth is always present so _pickThumbSize never returns undefined
  const safetyTop = _ALL_THUMB_SIZES.find(s => s > maxWidth) ?? 512
  if (!useful.includes(safetyTop)) useful.push(safetyTop)
  return useful
}

// ── Per-gallery display config ─────────────────────────────────────────────────
//
// Each gallery has its own settings stored as JSON under `gallery#<id>`.
// PhotoGallery / SimpleGallery create the config for their galleryId and
// provide() it via GALLERY_CONFIG_KEY so descendant components (GallerySection,
// MediaTile, etc.) get the right config via inject() inside useGallery().
//
// Components outside any gallery tree (AppSettingsModal) get the config of the
// most recently mounted gallery, tracked reactively via _activeConfig.

export const GALLERY_CONFIG_KEY = Symbol('galleryConfig')

interface GalleryConfig {
  mode:          GalleryMode
  size:          GallerySize
  gap:           GalleryGap
  showDayGroups: boolean
}

const CONFIG_DEFAULTS: GalleryConfig = {
  mode: 'masonry', size: 'md', gap: 'normal', showDayGroups: true,
}

export function useGalleryConfig(galleryId: string, defaults?: Partial<GalleryConfig>) {
  const stored = useLocalStorage<GalleryConfig>(`gallery#${galleryId}`, { ...CONFIG_DEFAULTS, ...defaults })

  return {
    galleryMode:      computed(() => stored.value.mode),
    gallerySize:      computed(() => stored.value.size),
    galleryGap:       computed(() => stored.value.gap),
    showDayGroups:    computed(() => stored.value.showDayGroups),
    galleryRowHeight: computed(() => ROW_HEIGHTS[stored.value.size] ?? ROW_HEIGHTS.md),
    galleryGapPx:     computed(() => GAP_VALUES[stored.value.gap]   ?? GAP_VALUES.normal),
    setMode:          (m: GalleryMode) => { stored.value = { ...stored.value, mode: m } },
    setSize:          (s: GallerySize) => { stored.value = { ...stored.value, size: s } },
    setGap:           (g: GalleryGap)  => { stored.value = { ...stored.value, gap:  g } },
    setShowDayGroups: (v: boolean)     => { stored.value = { ...stored.value, showDayGroups: v } },
  }
}

export type GalleryConfigRef = ReturnType<typeof useGalleryConfig>

// The config of the most recently mounted gallery component — read by components
// that are not descendants of a gallery (e.g. AppSettingsModal in the layout).
const _activeConfig = shallowRef<GalleryConfigRef | null>(null)

export function registerActiveGalleryConfig(config: GalleryConfigRef) {
  _activeConfig.value = config
}
export function unregisterActiveGalleryConfig(config: GalleryConfigRef) {
  if (_activeConfig.value === config) _activeConfig.value = null
}

// ── Session state (module-level, shared) ──────────────────────────────────────

const selectionMode   = ref(false)
const selectedIds     = ref(new Set<string>())
const lastSelectedId  = ref<string | null>(null)
const previewId       = ref<string | null>(null)
const transitioningId = ref<string | null>(null)

type VTDoc = Document & { startViewTransition: (cb: () => Promise<void> | void) => { finished: Promise<void> } }

function startVT(cb: () => Promise<void> | void): Promise<void> | null {
  if (typeof document !== 'undefined' && 'startViewTransition' in document) {
    return (document as VTDoc).startViewTransition(cb).finished
  }
  return null
}

function _closePreview() {
  const closingId = previewId.value
  const vt = startVT(async () => {
    previewId.value       = null
    transitioningId.value = closingId
    await nextTick()
  })
  if (vt) {
    vt.finally(() => { transitioningId.value = null })
  } else {
    previewId.value       = null
    transitioningId.value = null
  }
}

// Global keyboard handler — set up once at module level (client only)
if (import.meta.client) {
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Insert') {
      selectionMode.value = !selectionMode.value
      if (!selectionMode.value) {
        selectedIds.value    = new Set()
        lastSelectedId.value = null
      }
    }
    if (e.key === 'Escape') {
      if (previewId.value !== null) {
        _closePreview()
      } else if (selectionMode.value) {
        selectionMode.value  = false
        selectedIds.value    = new Set()
        lastSelectedId.value = null
      }
    }
  })
}

// ── useGallery ─────────────────────────────────────────────────────────────────

export function useGallery() {
  // Resolve display config: injected from nearest gallery ancestor (inside
  // PhotoGallery/SimpleGallery trees) or tracked active config (everywhere else).
  // inject() only works inside component setup — getCurrentInstance() guards that.
  const injected = getCurrentInstance()
    ? inject<GalleryConfigRef | null>(GALLERY_CONFIG_KEY, null)
    : null

  // For non-injected contexts, build computed refs that track _activeConfig
  // reactively so AppSettingsModal stays in sync when the user navigates.
  const galleryMode     = injected?.galleryMode     ?? computed(() => _activeConfig.value?.galleryMode.value     ?? CONFIG_DEFAULTS.mode)
  const gallerySize     = injected?.gallerySize     ?? computed(() => _activeConfig.value?.gallerySize.value     ?? CONFIG_DEFAULTS.size)
  const galleryGap      = injected?.galleryGap      ?? computed(() => _activeConfig.value?.galleryGap.value      ?? CONFIG_DEFAULTS.gap)
  const showDayGroups   = injected?.showDayGroups   ?? computed(() => _activeConfig.value?.showDayGroups.value   ?? CONFIG_DEFAULTS.showDayGroups)
  const galleryRowHeight = injected?.galleryRowHeight ?? computed(() => _activeConfig.value?.galleryRowHeight.value ?? ROW_HEIGHTS.md)
  const galleryGapPx    = injected?.galleryGapPx    ?? computed(() => _activeConfig.value?.galleryGapPx.value    ?? GAP_VALUES.normal)

  function resolvedConfig() { return injected ?? _activeConfig.value }

  function setMode(mode: GalleryMode) { resolvedConfig()?.setMode(mode) }
  function setSize(size: GallerySize) { resolvedConfig()?.setSize(size) }
  function setGap(gap: GalleryGap)    { resolvedConfig()?.setGap(gap)   }
  function setShowDayGroups(v: boolean) { resolvedConfig()?.setShowDayGroups(v) }

  function toggleSelectionMode() {
    selectionMode.value = !selectionMode.value
    if (!selectionMode.value) {
      selectedIds.value    = new Set()
      lastSelectedId.value = null
    }
  }

  function exitSelectionMode() {
    selectionMode.value  = false
    selectedIds.value    = new Set()
    lastSelectedId.value = null
  }

  /** Toggle a single item. Pass allIds + shiftKey for range selection. */
  function toggleItem(id: string, allIds?: string[], shiftKey = false) {
    if (shiftKey && lastSelectedId.value && allIds) {
      const from  = allIds.indexOf(lastSelectedId.value)
      const to    = allIds.indexOf(id)
      if (from !== -1 && to !== -1) {
        const set   = new Set(selectedIds.value)
        const start = Math.min(from, to)
        const end   = Math.max(from, to)
        for (let i = start; i <= end; i++) set.add(allIds[i]!)
        if (!selectionMode.value) selectionMode.value = true
        selectedIds.value    = set
        lastSelectedId.value = id
        return
      }
    }
    const set = new Set(selectedIds.value)
    if (set.has(id)) {
      set.delete(id)
    } else {
      set.add(id)
      if (!selectionMode.value) selectionMode.value = true
    }
    selectedIds.value    = set
    lastSelectedId.value = set.size > 0 ? id : null
  }

  function selectAll(ids: string[]) {
    const set = new Set(selectedIds.value)
    ids.forEach(id => set.add(id))
    if (!selectionMode.value && ids.length > 0) selectionMode.value = true
    selectedIds.value = set
  }

  function deselectAll(ids: string[]) {
    const set = new Set(selectedIds.value)
    ids.forEach(id => set.delete(id))
    selectedIds.value = set
  }

  function isSelected(id: string) { return selectedIds.value.has(id) }

  function openPreview(id: string) {
    if (typeof document !== 'undefined' && 'startViewTransition' in document) {
      transitioningId.value = id
      nextTick(() => {
        const vt = startVT(async () => {
          previewId.value       = id
          transitioningId.value = null
          await nextTick()
        })
        if (vt) {
          vt.catch(() => { transitioningId.value = null })
        }
      })
    } else {
      previewId.value = id
    }
  }

  function closePreview() { _closePreview() }

  function setTransitioning(id: string | null) {
    transitioningId.value = id
  }

  return {
    // Display config (per-gallery)
    galleryMode,
    gallerySize,
    galleryGap,
    showDayGroups,
    galleryRowHeight,
    galleryGapPx,
    setMode,
    setSize,
    setGap,
    setShowDayGroups,
    // Session state (shared)
    selectionMode:   readonly(selectionMode),
    selectedIds:     readonly(selectedIds),
    selectedCount:   computed(() => selectedIds.value.size),
    previewId:       readonly(previewId),
    transitioningId: readonly(transitioningId),
    toggleSelectionMode,
    exitSelectionMode,
    toggleItem,
    selectAll,
    deselectAll,
    isSelected,
    openPreview,
    closePreview,
    setTransitioning,
  }
}
