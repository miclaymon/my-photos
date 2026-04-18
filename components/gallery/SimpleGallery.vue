<script setup lang="ts">
/**
 * SimpleGallery — grid-only gallery with no date groupings, no mode toggle.
 * Accepts a flat list of MediaItem and renders them using MediaTile.
 * Clicking a tile navigates to /library/:id/preview/:id (same as the main gallery).
 * Supports selection mode with a customisable action pill slot.
 */
import { useElementSize } from '@vueuse/core'
import { XIcon } from 'lucide-vue-next'
import type { MediaItem } from '~/composables/useGalleryData'

withDefaults(defineProps<{
  items:    ReadonlyArray<MediaItem>
  loading?: boolean
}>(), {
  loading: false,
})

const containerRef = ref<HTMLElement | null>(null)
const { width: containerWidth } = useElementSize(containerRef)

// 3px gap, matching PhotoGallery's 'normal' gap preset
const GAP = 3

const gridCols = computed(() => {
  const w = containerWidth.value
  if (!w || w < 400) return 3
  if (w < 640)  return 4
  if (w < 900)  return 5
  return 6
})

const tileSize = computed(() => {
  if (!containerWidth.value) return 0
  return Math.floor((containerWidth.value - (gridCols.value - 1) * GAP) / gridCols.value)
})

const { selectionMode, selectedCount, selectedIds, exitSelectionMode } = useGallery()
</script>

<template>
  <div ref="containerRef" class="sg-wrap" :class="{ 'selection-mode': selectionMode }">
    <!-- ClientOnly prevents SSR/hydration size-mismatch -->
    <ClientOnly>
      <template v-if="tileSize > 0">
        <div
          v-if="items.length"
          class="sg-grid"
          :style="{
            gap:                 GAP + 'px',
            gridTemplateColumns: `repeat(${gridCols}, ${tileSize}px)`,
          }"
        >
          <MediaTile
            v-for="item in items"
            :key="item.id"
            :item="item"
            :width="tileSize"
            :height="tileSize"
            grid-mode
          />
        </div>

        <div v-else-if="!loading" class="gallery-empty">
          <slot name="empty" />
        </div>
      </template>

      <!-- Skeleton while width is being measured or data loading -->
      <div v-else class="sg-skeleton" />

      <template #fallback>
        <div class="sg-skeleton" />
      </template>
    </ClientOnly>
  </div>

  <!-- Selection pill — Teleported to body, same pattern as PhotoGallery -->
  <Teleport to="body">
    <Transition name="pill-pop">
      <div v-if="selectionMode" class="selection-pill" role="status">
        <span class="selection-pill-label">
          {{ selectedCount }} {{ selectedCount === 1 ? 'item' : 'items' }} selected
        </span>
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
.sg-wrap {
  width: 100%;
  padding: 8px;
  box-sizing: border-box;
}

.sg-grid {
  display: grid;
  align-items: start;
}

.sg-skeleton {
  width: 100%;
  height: 200px;
  border-radius: 6px;
  background: var(--color-surface-raised);
  animation: sg-pulse 1.5s ease-in-out infinite;
}

@keyframes sg-pulse {
  0%, 100% { opacity: 0.5; }
  50%       { opacity: 1; }
}

/* Pill action buttons provided via selection-actions slot.
   The pill background is var(--color-text-primary) and its text/icon color is
   var(--color-bg), both of which invert with the theme. Use `color: inherit` so
   these buttons match the pill's own text colour regardless of light/dark mode. */
:deep(.pill-action) {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: rgba(128,128,128,0.18);
  color: inherit;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
:deep(.pill-action:hover)        { background: rgba(128,128,128,0.32); }
:deep(.pill-action-danger:hover) { background: rgba(220,38,38,0.18); color: #dc2626; }
</style>
