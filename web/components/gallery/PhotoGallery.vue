<script setup lang="ts">
import { LayoutGridIcon, LayoutIcon, XIcon } from 'lucide-vue-next'
import type { GallerySection } from '~/composables/useGalleryData'

const props = withDefaults(defineProps<{
  sections: ReadonlyArray<GallerySection>
  title?:   string
  loading?: boolean
}>(), {
  title:   'Photos',
  loading: false,
})

const { galleryMode, selectionMode, selectedCount, selectedIds, setMode, exitSelectionMode } = useGallery()

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

      <div class="gallery-mode-toggle" role="group" aria-label="Gallery display mode">
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
  <Teleport to="body">
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

  <!-- Selection pill — persistent bottom-center notification -->
  <Teleport to="body">
    <Transition name="pill-pop">
      <div v-if="selectionMode" class="selection-pill" role="status">
        <span class="selection-pill-label">
          {{ selectedCount }} {{ selectedCount === 1 ? 'item' : 'items' }} selected
        </span>
        <!-- Slot for context-specific actions (archive, trash, restore, etc.) -->
        <slot
          name="selection-actions"
          :selected-ids="selectedIds"
          :selected-count="selectedCount"
          :exit-selection-mode="exitSelectionMode"
        />
        <button
          class="selection-pill-close"
          aria-label="Exit selection mode"
          @click="exitSelectionMode"
        >
          <XIcon :size="14" />
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Slot-provided action buttons (archive, trash, restore, etc.) share this style
   via a global class so each page can use its own icons without repeating CSS. */
:deep(.pill-action) {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: rgba(128,128,128,0.18);
  color: inherit; /* inherits var(--color-bg) from .selection-pill, which inverts with theme */
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
:deep(.pill-action:hover)        { background: rgba(128,128,128,0.32); }
:deep(.pill-action-danger:hover) { background: rgba(220,38,38,0.18); color: #dc2626; }
</style>
