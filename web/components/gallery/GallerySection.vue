<script setup lang="ts">
import { useElementSize, useLocalStorage } from '@vueuse/core'
import { CheckIcon, MinusIcon } from 'lucide-vue-next'
import type { GallerySection } from '~/composables/useGalleryData'

const props = defineProps<{
  section:           GallerySection
  /** All sections in the current gallery — used for cross-section year/month selection.
   *  Falls back to useGalleryData().sections when omitted (backwards-compatible). */
  allSections?:      ReadonlyArray<GallerySection>
  /** Set false to suppress the year/month group boundary headers. Default: true. */
  showGroupHeaders?: boolean
}>()

const contentEl  = ref<HTMLElement | null>(null)
const headerEl   = ref<HTMLElement | null>(null)
const isStuck    = ref(false)

const { width: containerWidth } = useElementSize(contentEl)

const { registerSection, unregisterSection, activeStickyKey } = useActiveStickySection()

// Register the sticky header element so the scroll-based tracker can measure it.
// isStuck is derived from whether this section is currently the active pinned one.
onMounted(() => {
  if (headerEl.value) registerSection(props.section.dateKey, headerEl.value)
})
onUnmounted(() => {
  unregisterSection(props.section.dateKey)
})

// A section is visually stuck only when it is the active pinned one.
watch(activeStickyKey, (key) => {
  isStuck.value = key === props.section.dateKey
}, { immediate: true })

const {
  galleryMode,
  galleryRowHeight,
  galleryGapPx,
  selectionMode,
  selectedIds,
  selectAll,
  deselectAll,
} = useGallery()

// User setting: whether to show day-level sticky headers (Settings → Appearance).
const showDayGroups = useLocalStorage('gallery-show-day-groups', true)

// ── Hover-reveal logic ────────────────────────────────────────────────────
// Hovering any header for HOVER_DELAY ms reveals its checkbox without
// requiring the user to enter selection mode.
const HOVER_DELAY = 500

const yearHoverReveal    = ref(false)
const monthHoverReveal   = ref(false)
const sectionHoverReveal = ref(false)

let yearTimer:    ReturnType<typeof setTimeout> | null = null
let monthTimer:   ReturnType<typeof setTimeout> | null = null
let sectionTimer: ReturnType<typeof setTimeout> | null = null

function onYearEnter()    { yearTimer    ??= setTimeout(() => { yearHoverReveal.value    = true }, HOVER_DELAY) }
function onYearLeave()    { clearTimeout(yearTimer!);    yearTimer    = null; yearHoverReveal.value    = false }
function onMonthEnter()   { monthTimer   ??= setTimeout(() => { monthHoverReveal.value   = true }, HOVER_DELAY) }
function onMonthLeave()   { clearTimeout(monthTimer!);   monthTimer   = null; monthHoverReveal.value   = false }
function onSectionEnter() { sectionTimer ??= setTimeout(() => { sectionHoverReveal.value = true }, HOVER_DELAY) }
function onSectionLeave() { clearTimeout(sectionTimer!); sectionTimer = null; sectionHoverReveal.value = false }

onUnmounted(() => {
  clearTimeout(yearTimer!);    yearTimer    = null
  clearTimeout(monthTimer!);   monthTimer   = null
  clearTimeout(sectionTimer!); sectionTimer = null
})

// Use the allSections prop when provided; fall back to the library gallery sections
// so this component works both in the main gallery and in standalone pages.
const { sections: librarySections } = useGalleryData()
const effectiveSections = computed(() => props.allSections ?? librarySections.value)

// IDs for all items sharing the same year / month as this section
// (used by the year/month checkbox to select/deselect the whole group)
const yearIds = computed(() =>
  effectiveSections.value
    .filter(s => s.yearKey === props.section.yearKey)
    .flatMap(s => s.items.map(i => i.id)),
)
const monthIds = computed(() =>
  effectiveSections.value
    .filter(s => s.monthKey === props.section.monthKey)
    .flatMap(s => s.items.map(i => i.id)),
)

const yearSelectedCount  = computed(() => yearIds.value.filter(id => selectedIds.value.has(id)).length)
const monthSelectedCount = computed(() => monthIds.value.filter(id => selectedIds.value.has(id)).length)

const yearAllSelected  = computed(() => yearIds.value.length > 0 && yearSelectedCount.value === yearIds.value.length)
const yearSomeSelected = computed(() => yearSelectedCount.value > 0 && !yearAllSelected.value)

const monthAllSelected  = computed(() => monthIds.value.length > 0 && monthSelectedCount.value === monthIds.value.length)
const monthSomeSelected = computed(() => monthSelectedCount.value > 0 && !monthAllSelected.value)

function toggleYearSelection() {
  if (yearAllSelected.value) deselectAll(yearIds.value)
  else selectAll(yearIds.value)
}
function toggleMonthSelection() {
  if (monthAllSelected.value) deselectAll(monthIds.value)
  else selectAll(monthIds.value)
}

const { rows } = useJustifiedLayout(
  computed(() => props.section.items),
  containerWidth,
  galleryRowHeight,
  galleryGapPx,
)

// Flat list of item IDs for this section (used for range selection + group toggle)
const sectionIds = computed(() => props.section.items.map(i => i.id))

const selectedInSection = computed(
  () => sectionIds.value.filter(id => selectedIds.value.has(id)).length,
)
const allSelected  = computed(
  () => sectionIds.value.length > 0 && selectedInSection.value === sectionIds.value.length,
)
const someSelected = computed(
  () => selectedInSection.value > 0 && !allSelected.value,
)

function toggleSectionSelection() {
  if (allSelected.value) {
    deselectAll(sectionIds.value)
  } else {
    selectAll(sectionIds.value)
  }
}

// Grid mode: calculate column count + tile size
const GRID_COLS_BY_SIZE: Record<string, number> = {
  xs: 8, sm: 6, md: 5, lg: 4, xl: 3,
}
const { gallerySize } = useGallery()
const gridCols = computed(() => {
  const base = GRID_COLS_BY_SIZE[gallerySize.value] ?? 5
  if (containerWidth.value < 480) return Math.min(3, base)
  if (containerWidth.value < 768) return Math.min(4, base)
  return base
})
const gridTileSize = computed(() => {
  if (!containerWidth.value) return 0
  return Math.floor(
    (containerWidth.value - (gridCols.value - 1) * galleryGapPx.value) / gridCols.value,
  )
})
</script>

<template>
  <section class="gallery-section" :id="section.dateKey" :data-gallery-section="section.dateKey" :aria-label="section.label">

    <!-- Year boundary header (non-sticky, appears once per year) -->
    <div
      v-if="showGroupHeaders !== false && section.showYearHeader"
      class="gallery-group-header gallery-year-header"
      :class="{ 'reveal-checkbox': selectionMode || yearSomeSelected || yearAllSelected || yearHoverReveal }"
      @mouseenter="onYearEnter"
      @mouseleave="onYearLeave"
    >
      <button
        class="gallery-group-checkbox gallery-year-checkbox"
        :class="{ 'is-checked': yearAllSelected, 'is-indeterminate': yearSomeSelected }"
        :aria-label="yearAllSelected ? `Deselect all in ${section.yearLabel}` : `Select all in ${section.yearLabel}`"
        :aria-checked="yearAllSelected ? 'true' : yearSomeSelected ? 'mixed' : 'false'"
        role="checkbox"
        @click="toggleYearSelection"
      >
        <MinusIcon v-if="yearSomeSelected" :size="16" />
        <CheckIcon v-else-if="yearAllSelected" :size="16" />
      </button>
      <span class="gallery-group-label gallery-year-label">{{ section.yearLabel }}</span>
    </div>

    <!-- Month boundary header (non-sticky, appears once per month) -->
    <div
      v-if="showGroupHeaders !== false && section.showMonthHeader"
      class="gallery-group-header gallery-month-header"
      :class="{ 'reveal-checkbox': selectionMode || monthSomeSelected || monthAllSelected || monthHoverReveal }"
      @mouseenter="onMonthEnter"
      @mouseleave="onMonthLeave"
    >
      <button
        class="gallery-group-checkbox gallery-month-checkbox"
        :class="{ 'is-checked': monthAllSelected, 'is-indeterminate': monthSomeSelected }"
        :aria-label="monthAllSelected ? `Deselect all in ${section.monthLabel}` : `Select all in ${section.monthLabel}`"
        :aria-checked="monthAllSelected ? 'true' : monthSomeSelected ? 'mixed' : 'false'"
        role="checkbox"
        @click="toggleMonthSelection"
      >
        <MinusIcon v-if="monthSomeSelected" :size="14" />
        <CheckIcon v-else-if="monthAllSelected" :size="14" />
      </button>
      <span class="gallery-group-label gallery-month-label">{{ section.monthLabel }}</span>
    </div>

    <!-- Sticky date header (hidden when user turns off day groupings in Settings) -->
    <div
      v-show="showDayGroups"
      ref="headerEl"
      class="gallery-section-header"
      :class="{ 'reveal-checkbox': selectionMode || someSelected || allSelected || sectionHoverReveal, 'is-stuck': isStuck }"
      @mouseenter="onSectionEnter"
      @mouseleave="onSectionLeave"
    >
      <button
        class="gallery-section-checkbox"
        :class="{ 'is-checked': allSelected, 'is-indeterminate': someSelected }"
        :aria-label="allSelected ? 'Deselect all in group' : 'Select all in group'"
        :aria-checked="allSelected ? 'true' : someSelected ? 'mixed' : 'false'"
        role="checkbox"
        @click="toggleSectionSelection"
      >
        <MinusIcon v-if="someSelected" :size="12" />
        <CheckIcon v-else-if="allSelected" :size="12" />
      </button>
      <span class="gallery-section-date">{{ section.label }}</span>
    </div>

    <!-- Content -->
    <div ref="contentEl" class="gallery-section-content">

      <!-- Masonry / justified layout -->
      <template v-if="galleryMode === 'masonry'">
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

        <!-- Skeleton placeholder while width not yet measured -->
        <div
          v-if="containerWidth === 0"
          :style="{ height: galleryRowHeight + 'px' }"
          class="skeleton"
        />
      </template>

      <!-- Grid layout (fixed-square tiles) -->
      <template v-else-if="galleryMode === 'grid' && gridTileSize > 0">
        <div
          class="gallery-grid"
          :style="{ gap: galleryGapPx + 'px', gridTemplateColumns: `repeat(${gridCols}, ${gridTileSize}px)` }"
        >
          <MediaTile
            v-for="item in section.items"
            :key="item.id"
            :item="item"
            :width="gridTileSize"
            :height="gridTileSize"
            grid-mode
          />
        </div>
      </template>

      <!-- Grid skeleton -->
      <template v-else-if="galleryMode === 'grid' && gridTileSize === 0">
        <div class="gallery-grid-skeleton skeleton" style="height: 200px;" />
      </template>

    </div>
  </section>
</template>
