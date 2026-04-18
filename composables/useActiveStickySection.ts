/**
 * Tracks which gallery section header is currently "stuck" (pinned at top).
 *
 * GallerySection calls setStickySection / clearStickySection as its
 * IntersectionObserver fires. [library].vue watches activeStickyKey
 * and mirrors it to the URL fragment so the link stays bookmarkable.
 *
 * Fix for scroll-up: we keep an ordered list of ALL currently-stuck keys
 * (insertion order = order they became stuck while scrolling down).
 * The "active" key is the LAST one in the list — the most recently stuck
 * section, which is the one you're currently viewing at the top.
 *
 * When scrolling up, sections become un-stuck in reverse order (most recent
 * first), so removing from the tail gives us the correct previous section.
 */

// Ordered array of currently-stuck section keys.
// Invariant: each key appears at most once.
const stuckKeys = ref<string[]>([])

export function useActiveStickySection() {
  function setStickySection(key: string) {
    // Remove first (de-dupe), then append so it's the "most recent"
    stuckKeys.value = [...stuckKeys.value.filter(k => k !== key), key]
  }

  function clearStickySection(key: string) {
    stuckKeys.value = stuckKeys.value.filter(k => k !== key)
  }

  // The active key is always the last element — the most recently stuck section.
  // When scrolling up, sections unstick in reverse order, so the last element
  // naturally regresses to the previous section.
  const activeStickyKey = computed<string | null>(() =>
    stuckKeys.value.length > 0
      ? stuckKeys.value[stuckKeys.value.length - 1]!
      : null,
  )

  return {
    activeStickyKey: readonly(activeStickyKey),
    setStickySection,
    clearStickySection,
  }
}
