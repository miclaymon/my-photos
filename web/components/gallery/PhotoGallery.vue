<script setup lang="ts">
import { LayoutGridIcon, LayoutIcon } from 'lucide-vue-next'
import type { GallerySection } from '~/composables/useGalleryData'

const props = withDefaults(defineProps<{
  sections:          ReadonlyArray<GallerySection>
  title?:            string
  loading?:          boolean
  /** Set false to hide the masonry/grid toggle (e.g. album detail, search). Default: true. */
  showModeToggle?:   boolean
  /** Set false to suppress year/month group boundary headers inside sections. Default: true. */
  showGroupHeaders?: boolean
}>(), {
  title:            'Photos',
  loading:          false,
  showModeToggle:   true,
  showGroupHeaders: true,
})

const { galleryMode, selectionMode, setMode } = useGallery()

// Track when the gallery header (title + inline toggle) has scrolled out of view
const galleryHeaderRef = ref<HTMLElement | null>(null)
const modeFloating     = ref(false)

onMounted(() => {
  const root = document.getElementById('main-content')
  if (!root || !galleryHeaderRef.value) return
  const obs = new IntersectionObserver(
    ([entry]) => { modeFloating.value = !entry!.isIntersecting },
    { root, threshold: 0 },
  )
  obs.observe(galleryHeaderRef.value)
  onUnmounted(() => obs.disconnect())
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

  <!-- Selection pill — delegates to shared GallerySelectionPill component -->
  <GallerySelectionPill>
    <template v-if="$slots['selection-actions']" #selection-actions="props">
      <slot name="selection-actions" v-bind="props" />
    </template>
  </GallerySelectionPill>
</template>
