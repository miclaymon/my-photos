/**
 * Tracks which gallery section day-header is currently "stuck" (pinned at top).
 *
 * Each GallerySection registers its sticky header element on mount. A single
 * rAF-throttled scroll listener on #main-content checks positions on every
 * scroll event: the active section is the last header whose top is at or
 * above the container's inner top edge (i.e. it is currently pinned there).
 *
 * This replaces the previous IntersectionObserver sentinel approach, which
 * suffered from non-deterministic callback ordering when multiple sections
 * left/entered the viewport simultaneously (e.g. initial hash-scroll).
 */

type Entry = { key: string; el: HTMLElement }

// Module-level shared state — one instance across all uses of the composable.
const registry: Entry[] = []
const activeStickyKey   = ref<string | null>(null)

let container: HTMLElement | null = null
let rafId:     number | null      = null

function compute() {
  if (!container) return
  const containerTop = container.getBoundingClientRect().top
  let active: string | null = null

  for (const { key, el } of registry) {
    // el is the sticky day-header div. When it is pinned at the top of the
    // scroll container its top equals containerTop (within a pixel).
    const relTop = el.getBoundingClientRect().top - containerTop
    if (relTop <= 1) {
      active = key
    } else {
      // Sections are in DOM order (newest → oldest, top → bottom).
      // Once a header is below the fold we can stop.
      break
    }
  }

  activeStickyKey.value = active
}

function onScroll() {
  if (rafId !== null) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    compute()
  })
}

export function useActiveStickySection() {
  function registerSection(key: string, el: HTMLElement) {
    const existing = registry.findIndex(e => e.key === key)
    if (existing >= 0) {
      registry[existing]!.el = el
    } else {
      registry.push({ key, el })
      // Keep sorted by DOM order so the iteration in compute() is top → bottom.
      registry.sort((a, b) =>
        a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
      )
    }
  }

  function unregisterSection(key: string) {
    const i = registry.findIndex(e => e.key === key)
    if (i >= 0) registry.splice(i, 1)
  }

  function mountScrollTracking() {
    container = document.getElementById('main-content')
    container?.addEventListener('scroll', onScroll, { passive: true })
    // Run once immediately to set the initial state (handles hash-scroll on load).
    compute()
  }

  function unmountScrollTracking() {
    container?.removeEventListener('scroll', onScroll)
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
    container = null
    activeStickyKey.value = null
  }

  return {
    activeStickyKey:       readonly(activeStickyKey),
    registerSection,
    unregisterSection,
    mountScrollTracking,
    unmountScrollTracking,
    /** Re-run the position computation without a scroll event (call after data loads). */
    recompute: compute,
  }
}
