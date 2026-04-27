<script setup lang="ts">
/**
 * SimpleGallery — flat-list gallery with no date groupings.
 * Supports both masonry (justified) and grid modes, respecting the user's
 * gallery-mode setting from useGallery(). Ideal for archive, trash, search
 * results, or any other flat-list context.
 */
import { useElementSize } from '@vueuse/core'
import type { MediaItem } from '~/composables/useGalleryData'

const props = withDefaults(defineProps<{
  items:    ReadonlyArray<MediaItem>
  loading?: boolean
}>(), {
  loading: false,
})

const containerRef = ref<HTMLElement | null>(null)
const { width: containerWidth } = useElementSize(containerRef)

const { galleryMode, gallerySize, galleryRowHeight, galleryGapPx, selectionMode } = useGallery()

// ── Masonry (justified) layout ─────────────────────────────────────────────
const { rows } = useJustifiedLayout(
  computed(() => props.items as MediaItem[]),
  containerWidth,
  galleryRowHeight,
  galleryGapPx,
)

// ── Grid layout ────────────────────────────────────────────────────────────
const GRID_COLS_BY_SIZE: Record<string, number> = {
  xs: 8, sm: 6, md: 5, lg: 4, xl: 3,
}

const gridCols = computed(() => {
  const base = GRID_COLS_BY_SIZE[gallerySize.value] ?? 5
  if (!containerWidth.value || containerWidth.value < 480) return Math.min(3, base)
  if (containerWidth.value < 768) return Math.min(4, base)
  return base
})

const tileSize = computed(() => {
  if (!containerWidth.value) return 0
  return Math.floor((containerWidth.value - (gridCols.value - 1) * galleryGapPx.value) / gridCols.value)
})
</script>

<template>
  <div ref="containerRef" class="sg-wrap" :class="{ 'selection-mode': selectionMode }">
    <ClientOnly>

      <!-- Masonry (justified) layout -->
      <template v-if="galleryMode === 'masonry' && items.length">
        <div
          v-for="(row, ri) in rows"
          :key="ri"
          class="gallery-row"
          :style="{ gap: galleryGapPx + 'px', marginBottom: galleryGapPx + 'px' }"
        >
          <MediaTile
            v-for="(item, ii) in row.items"
            :key="item.id"
            :item="item"
            :width="row.widths[ii]!"
            :height="row.height"
          />
        </div>
        <!-- Skeleton while container width is not yet measured -->
        <div v-if="containerWidth === 0" :style="{ height: galleryRowHeight + 'px' }" class="skeleton" />
      </template>

      <!-- Grid layout -->
      <template v-else-if="galleryMode === 'grid' && tileSize > 0 && items.length">
        <div
          class="sg-grid"
          :style="{ gap: galleryGapPx + 'px', gridTemplateColumns: `repeat(${gridCols}, ${tileSize}px)` }"
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
      </template>

      <!-- Empty state (data loaded, nothing to show) -->
      <div v-else-if="!loading && !items.length" class="gallery-empty">
        <slot name="empty" />
      </div>

      <!-- Skeleton while width is being measured or data is loading -->
      <div v-else-if="!items.length" class="sg-skeleton" />

      <template #fallback>
        <div class="sg-skeleton" />
      </template>
    </ClientOnly>
  </div>

  <!-- Selection pill — delegates to shared GallerySelectionPill component -->
  <GallerySelectionPill>
    <template v-if="$slots['selection-actions']" #selection-actions="props">
      <slot name="selection-actions" v-bind="props" />
    </template>
  </GallerySelectionPill>
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
</style>
