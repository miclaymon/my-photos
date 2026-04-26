/**
 * Custom tile drag — no native HTML drag API.
 *
 * Behaviour:
 *  • Mousedown on a tile starts drag tracking.
 *  • If the mouse moves more than THRESHOLD pixels, a ghost appears at the
 *    tile's position and follows the cursor. The original tile(s) stay in
 *    layout but dim to 40% opacity.
 *  • On mouseup with no drop target: the ghost animates back to the origin
 *    rect and fades out. Original tiles restore full opacity.
 *  • Escape cancels immediately.
 *  • Multiple selected tiles are shown as a stacked group in the ghost.
 */

import type { MediaItem } from './useGalleryData'

export interface DragSourceItem {
  item: MediaItem
  src:  string   // thumbnail URL to render in the ghost
}

// ── Module-level state ────────────────────────────────────────────────────────

const isDragging    = ref(false)
const isReturning   = ref(false)   // ghost animating back to origin
const dragItems     = ref<DragSourceItem[]>([])
const ghostX        = ref(0)       // ghost left (viewport px)
const ghostY        = ref(0)       // ghost top  (viewport px)
const ghostW        = ref(120)     // ghost width
const ghostH        = ref(90)      // ghost height

// IDs of the items currently being dragged
const draggedIds    = computed(() => new Set(dragItems.value.map(d => d.item.id)))

const THRESHOLD = 6    // px before drag activates

// ── Internal tracking ─────────────────────────────────────────────────────────

let startX       = 0
let startY       = 0
let originX      = 0   // tile's viewport left at drag-start
let originY      = 0   // tile's viewport top at drag-start
let offsetX      = 0   // where within the tile the user clicked
let offsetY      = 0
let dragActive   = false
let returnTimer  = 0

function onMouseMove(e: MouseEvent) {
  if (dragActive) {
    ghostX.value = e.clientX - offsetX
    ghostY.value = e.clientY - offsetY
    return
  }
  const dx = e.clientX - startX
  const dy = e.clientY - startY
  if (Math.hypot(dx, dy) >= THRESHOLD) {
    dragActive      = true
    isDragging.value = true
    ghostX.value    = e.clientX - offsetX
    ghostY.value    = e.clientY - offsetY
  }
}

function onMouseUp() {
  cleanup()
  if (!dragActive) {
    // Never passed threshold — treat as a click (no-op here, click fires normally)
    dragItems.value = []
    return
  }
  // Animate ghost back to origin then clean up
  isReturning.value = true
  ghostX.value      = originX
  ghostY.value      = originY

  clearTimeout(returnTimer)
  returnTimer = window.setTimeout(() => {
    isReturning.value = false
    isDragging.value  = false
    dragActive        = false
    dragItems.value   = []
  }, 280)   // matches the CSS transition duration
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    cleanup()
    cancelReturn()
  }
}

function cleanup() {
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup',   onMouseUp)
  document.removeEventListener('keydown',   onKeyDown)
}

function cancelReturn() {
  clearTimeout(returnTimer)
  isReturning.value = false
  isDragging.value  = false
  dragActive        = false
  dragItems.value   = []
}

// ── Public API ────────────────────────────────────────────────────────────────

export function useTileDrag() {
  /**
   * Call from a tile's mousedown handler.
   *
   * @param items    Items being dragged (selected group or single tile)
   * @param e        The originating MouseEvent
   * @param tileEl   The tile DOM element (used to compute origin rect + ghost size)
   */
  function startDrag(items: DragSourceItem[], e: MouseEvent, tileEl: HTMLElement) {
    if (e.button !== 0) return   // left button only

    const rect = tileEl.getBoundingClientRect()
    startX   = e.clientX
    startY   = e.clientY
    originX  = rect.left
    originY  = rect.top
    offsetX  = e.clientX - rect.left
    offsetY  = e.clientY - rect.top
    ghostW.value = rect.width
    ghostH.value = rect.height
    dragActive   = false

    dragItems.value = items

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup',   onMouseUp)
    document.addEventListener('keydown',   onKeyDown)
  }

  /** True if the drag threshold was exceeded during the last mousedown–mouseup cycle. */
  function wasDragConsumed() { return dragActive }

  return {
    isDragging:   readonly(isDragging),
    isReturning:  readonly(isReturning),
    draggedIds,
    dragItems:    readonly(dragItems),
    ghostX:       readonly(ghostX),
    ghostY:       readonly(ghostY),
    ghostW:       readonly(ghostW),
    ghostH:       readonly(ghostH),
    startDrag,
    wasDragConsumed,
  }
}
