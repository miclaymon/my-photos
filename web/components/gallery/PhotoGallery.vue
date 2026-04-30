<script setup lang="ts">
import { LayoutGridIcon, LayoutIcon } from 'lucide-vue-next'
import type { GallerySection } from '~/composables/useGalleryData'
import { GALLERY_CONFIG_KEY, useGalleryConfig, registerActiveGalleryConfig, unregisterActiveGalleryConfig } from '~/composables/useGallery'
import type { GalleryMode, GallerySize } from '~/composables/useGallery'

const props = withDefaults(defineProps<{
  sections:          ReadonlyArray<GallerySection>
  galleryId?:        string
  title?:            string
  loading?:          boolean
  /** Set false to hide the masonry/grid toggle (e.g. album detail, search). Default: true. */
  showModeToggle?:   boolean
  /** Set false to suppress year/month group boundary headers inside sections. Default: true. */
  showGroupHeaders?: boolean
  /** Initial mode for first-time visitors (can still be changed and saved). */
  defaultMode?:      GalleryMode
  /** Initial size for first-time visitors (can still be changed and saved). */
  defaultSize?:      GallerySize
  /** Infinite scroll — true while loading items older than current window. */
  loadingOlder?:     boolean
  /** Infinite scroll — true while loading items newer than current window. */
  loadingNewer?:     boolean
  /** Infinite scroll — whether more older items exist. */
  hasMoreOlder?:     boolean
  /** Infinite scroll — whether more newer items exist. */
  hasMoreNewer?:     boolean
}>(), {
  galleryId:        'default',
  title:            'Photos',
  loading:          false,
  showModeToggle:   true,
  showGroupHeaders: true,
  loadingOlder:     false,
  loadingNewer:     false,
  hasMoreOlder:     false,
  hasMoreNewer:     false,
})

const emit = defineEmits<{
  loadOlder: []
  loadNewer: []
}>()

const config = useGalleryConfig(props.galleryId, {
  ...(props.defaultMode ? { mode: props.defaultMode } : {}),
  ...(props.defaultSize ? { size: props.defaultSize } : {}),
})
provide(GALLERY_CONFIG_KEY, config)

const { galleryMode, setMode } = config
const { selectionMode, exitSelectionMode } = useGallery()

onMounted(()   => registerActiveGalleryConfig(config))
onUnmounted(() => { unregisterActiveGalleryConfig(config); exitSelectionMode() })

// Track when the gallery header (title + inline toggle) has scrolled out of view
const galleryHeaderRef  = ref<HTMLElement | null>(null)
const topSentinelRef    = ref<HTMLElement | null>(null)
const bottomSentinelRef = ref<HTMLElement | null>(null)
const modeFloating      = ref(false)

onMounted(() => {
  // Use watchEffect so each observer is (re)created whenever its sentinel ref
  // appears in the DOM — refs are null until v-if conditions become true after
  // data loads, so a plain onMounted check would always see null.

  // Header visibility — drives the floating mode toggle
  watchEffect((onCleanup) => {
    const el   = galleryHeaderRef.value
    const root = document.getElementById('main-content')
    if (!el || !root) return
    // Skip the transient "not intersecting" fire during View Transitions painting.
    nextTick(() => {
      const obs = new IntersectionObserver(
        ([entry]) => { modeFloating.value = !entry!.isIntersecting },
        { root, threshold: 0 },
      )
      obs.observe(el)
      onCleanup(() => obs.disconnect())
    })
  })

  // Bottom sentinel — fires loadOlder as user approaches the end
  watchEffect((onCleanup) => {
    const el   = bottomSentinelRef.value
    const root = document.getElementById('main-content')
    if (!el || !root) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry!.isIntersecting) emit('loadOlder') },
      { root, threshold: 0, rootMargin: '0px 0px 400px 0px' },
    )
    obs.observe(el)
    onCleanup(() => obs.disconnect())
  })

  // Top sentinel — fires loadNewer as user scrolls back above the loaded window
  watchEffect((onCleanup) => {
    const el   = topSentinelRef.value
    const root = document.getElementById('main-content')
    if (!el || !root) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry!.isIntersecting) emit('loadNewer') },
      { root, threshold: 0, rootMargin: '400px 0px 0px 0px' },
    )
    obs.observe(el)
    onCleanup(() => obs.disconnect())
  })
})
</script>

<template>
  <div class="gallery-wrap" :class="{ 'selection-mode': selectionMode }">

    <!-- Page title + inline mode toggle — both scroll away together -->
    <div ref="galleryHeaderRef" class="gallery-header">
      <h1 class="gallery-title">{{ title }}</h1>

      <div v-if="showModeToggle" class="gallery-mode-toggle" role="group" aria-label="Gallery display mode">
        <button
          class="gallery-mode-btn"
          :class="{ 'is-active': galleryMode === 'masonry' }"
          title="Justified layout"
          :aria-pressed="galleryMode === 'masonry'"
          @click="setMode('masonry')"
        >
          <LayoutIcon :size="16" />
        </button>
        <button
          class="gallery-mode-btn"
          :class="{ 'is-active': galleryMode === 'grid' }"
          title="Grid layout"
          :aria-pressed="galleryMode === 'grid'"
          @click="setMode('grid')"
        >
          <LayoutGridIcon :size="16" />
        </button>
      </div>
    </div>

    <!-- Top sentinel — triggers loadNewer when scrolled into view -->
    <div ref="topSentinelRef" class="gallery-sentinel" aria-hidden="true">
      <Transition name="gallery-sentinel-fade">
        <div v-if="loadingNewer" class="gallery-sentinel-spinner" />
      </Transition>
    </div>

    <!-- Sections — ClientOnly prevents SSR/localStorage mode mismatch flash -->
    <ClientOnly v-if="sections.length">
      <GallerySection
        v-for="section in sections"
        :key="section.dateKey"
        :section="section"
        :all-sections="sections"
        :show-group-headers="showGroupHeaders"
      />
      <!-- Skeleton shown during SSR / before client mount -->
      <template #fallback>
        <div class="gallery-ssr-skeleton" />
      </template>
    </ClientOnly>

    <!-- While fetching — show nothing rather than the empty state -->
    <div v-else-if="loading" class="gallery-loading" aria-busy="true" />

    <!-- Truly empty (fetch done, no items) -->
    <div v-else class="gallery-empty">
      <slot name="empty">
        <LayoutIcon :size="48" class="gallery-empty-icon" />
        <p class="gallery-empty-title">Nothing here yet</p>
      </slot>
    </div>

    <!-- Bottom sentinel — triggers loadOlder when scrolled into view -->
    <div v-if="sections.length" ref="bottomSentinelRef" class="gallery-sentinel" aria-hidden="true">
      <Transition name="gallery-sentinel-fade">
        <div v-if="loadingOlder" class="gallery-sentinel-spinner" />
      </Transition>
    </div>
  </div>

  <!-- Floating mode toggle — appears when header has scrolled out of view -->
  <Teleport v-if="showModeToggle" to="body">
    <Transition name="mode-float">
      <div v-if="modeFloating" class="gallery-mode-toggle gallery-mode-toggle-float" role="group" aria-label="Gallery display mode">
        <button
          class="gallery-mode-btn"
          :class="{ 'is-active': galleryMode === 'masonry' }"
          title="Justified layout"
          :aria-pressed="galleryMode === 'masonry'"
          @click="setMode('masonry')"
        >
          <LayoutIcon :size="16" />
        </button>
        <button
          class="gallery-mode-btn"
          :class="{ 'is-active': galleryMode === 'grid' }"
          title="Grid layout"
          :aria-pressed="galleryMode === 'grid'"
          @click="setMode('grid')"
        >
          <LayoutGridIcon :size="16" />
        </button>
      </div>
    </Transition>
  </Teleport>

  <!-- Timeline scrubber — hover the right edge to expand -->
  <GalleryScrollbar :sections="sections" />

  <!-- Selection pill — delegates to shared GallerySelectionPill component -->
  <GallerySelectionPill>
    <template v-if="$slots['selection-actions']" #selection-actions="props">
      <slot name="selection-actions" v-bind="props" />
    </template>
  </GallerySelectionPill>
</template>

<style scoped>
.gallery-sentinel {
  height: 1px;
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: visible;
}

.gallery-sentinel-spinner {
  width: 20px;
  height: 20px;
  margin: 12px 0;
  border: 2px solid var(--border, #e5e7eb);
  border-top-color: var(--text-secondary, #6b7280);
  border-radius: 50%;
  animation: gallery-spin 0.7s linear infinite;
}

@keyframes gallery-spin {
  to { transform: rotate(360deg); }
}

.gallery-sentinel-fade-enter-active,
.gallery-sentinel-fade-leave-active {
  transition: opacity 0.2s;
}
.gallery-sentinel-fade-enter-from,
.gallery-sentinel-fade-leave-to {
  opacity: 0;
}
</style>
