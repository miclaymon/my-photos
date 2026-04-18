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

// Module-level singletons
const galleryMode     = useLocalStorage<GalleryMode>('gallery-mode', 'masonry')
const gallerySize     = useLocalStorage<GallerySize>('gallery-size', 'md')
const galleryGap      = useLocalStorage<GalleryGap>('gallery-gap', 'normal')
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

export function useGallery() {
  const galleryRowHeight = computed(() => ROW_HEIGHTS[gallerySize.value])
  const galleryGapPx     = computed(() => GAP_VALUES[galleryGap.value])

  function setMode(mode: GalleryMode) { galleryMode.value = mode }
  function setSize(size: GallerySize) { gallerySize.value = size }
  function setGap(gap: GalleryGap)    { galleryGap.value  = gap  }

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

  /** Directly set the transitioning ID (used by preview page on close). */
  function setTransitioning(id: string | null) {
    transitioningId.value = id
  }

  return {
    galleryMode:    readonly(galleryMode),
    gallerySize:    readonly(gallerySize),
    galleryGap:     readonly(galleryGap),
    galleryRowHeight,
    galleryGapPx,
    selectionMode:   readonly(selectionMode),
    selectedIds:     readonly(selectedIds),
    selectedCount:   computed(() => selectedIds.value.size),
    previewId:       readonly(previewId),
    transitioningId: readonly(transitioningId),
    setMode,
    setSize,
    setGap,
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
