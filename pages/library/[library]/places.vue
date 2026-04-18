<script setup lang="ts">
/**
 * /library/:library/places
 *
 * No ?place param → grid of all distinct location labels.
 * ?place=Houston%2C+Texas → gallery of photos at that location.
 *
 * Locations are derived from reverse-geocoded GPS data. Run the
 * "location-geocode" background job (Admin → Jobs tab) to populate them.
 */
import { MapPinIcon, ArrowLeftIcon } from 'lucide-vue-next'
import type { MediaItem } from '~/composables/useGalleryData'

definePageMeta({ middleware: 'auth' })

const route     = useRoute()
const router    = useRouter()
const libraryId = computed(() => route.params.library as string)

// ── Mode: index vs. detail ────────────────────────────────────────────────────

const activePlace = computed(() => {
  const q = route.query.place
  return typeof q === 'string' && q ? q : null
})

function openPlace(label: string) {
  router.push({ query: { place: label } })
}

function backToIndex() {
  router.push({ query: {} })
}

// ── Places index ──────────────────────────────────────────────────────────────

interface PlaceEntry {
  label: string
  count: number
}

const {
  data:    indexData,
  pending: indexPending,
  error:   indexError,
} = await useFetch<{ places: PlaceEntry[] }>(
  () => `/api/v1/library/${libraryId.value}/places`,
  { watch: [libraryId] },
)

const places = computed(() => indexData.value?.places ?? [])

// ── Place detail ──────────────────────────────────────────────────────────────

interface PlaceItem {
  id:               string
  originalFilename: string
  contentType:      string
  width:            number
  height:           number
  aspectRatio:      number
  isVideo:          boolean
  takenAt:          string
  src?:             string
  thumbnailSrc?:    string
}

const detailData    = ref<{ label: string; items: PlaceItem[] } | null>(null)
const detailPending = ref(false)
const detailError   = ref<string | null>(null)

async function loadDetail(label: string) {
  detailPending.value = true
  detailError.value   = null
  detailData.value    = null
  try {
    detailData.value = await $fetch<{ label: string; items: PlaceItem[] }>(
      `/api/v1/library/${libraryId.value}/places/items`,
      { query: { label } },
    )
  } catch (e: unknown) {
    detailError.value = (e as { data?: { message?: string } })?.data?.message ?? 'Failed to load'
  } finally {
    detailPending.value = false
  }
}

// Load detail whenever the active place changes
watch(activePlace, (label) => {
  if (label) loadDetail(label)
  else detailData.value = null
}, { immediate: true })

const detailItems = computed<MediaItem[]>(() =>
  (detailData.value?.items ?? []).map(item => ({
    id:               item.id,
    originalFilename: item.originalFilename,
    aspectRatio:      item.aspectRatio || 1.5,
    width:            item.width  || 0,
    height:           item.height || 0,
    takenAt:          item.takenAt,
    isVideo:          item.isVideo,
    src:              item.src,
    thumbnailSrc:     item.thumbnailSrc,
  })),
)
</script>

<template>
  <!-- ── Detail view ───────────────────────────────────────────────────────── -->
  <div v-if="activePlace" class="places-detail-page">

    <div class="places-detail-header">
      <button class="places-back" @click="backToIndex">
        <ArrowLeftIcon :size="15" />
        <span>Places</span>
      </button>

      <div class="places-detail-title-row">
        <div class="places-detail-pin">
          <MapPinIcon :size="16" class="places-detail-pin-icon" />
        </div>
        <h1 class="places-detail-title">{{ activePlace }}</h1>
      </div>

      <p class="places-detail-subtitle">
        {{ detailItems.length }} {{ detailItems.length === 1 ? 'item' : 'items' }}
      </p>
      <p v-if="detailError" class="places-error">{{ detailError }}</p>
    </div>

    <SimpleGallery :items="detailItems" :loading="detailPending && !detailData">
      <template #empty>
        <MapPinIcon :size="48" class="gallery-empty-icon" />
        <p class="gallery-empty-title">{{ detailPending ? 'Loading…' : 'No items here' }}</p>
      </template>
    </SimpleGallery>

  </div>

  <!-- ── Index view ────────────────────────────────────────────────────────── -->
  <div v-else class="places-page">

    <div class="places-page-header">
      <div class="places-page-title-row">
        <MapPinIcon :size="18" class="places-page-icon" />
        <h1 class="places-page-title">Places</h1>
      </div>
      <p class="places-page-subtitle">Photos and videos grouped by where they were taken.</p>
      <p v-if="indexError" class="places-error">{{ indexError.message }}</p>
    </div>

    <!-- Loading skeleton -->
    <div v-if="indexPending && !places.length" class="places-skeleton-wrap">
      <div v-for="i in 8" :key="i" class="places-card-skeleton" />
    </div>

    <!-- Empty state -->
    <div v-else-if="!indexPending && !places.length" class="gallery-empty" style="padding-top: 60px;">
      <MapPinIcon :size="48" class="gallery-empty-icon" />
      <p class="gallery-empty-title">No places yet</p>
      <p class="gallery-empty-body">
        Photos with GPS data will appear here once the location geocoding job has run.
      </p>
    </div>

    <!-- Places grid -->
    <div v-else class="places-grid">
      <button
        v-for="place in places"
        :key="place.label"
        class="places-card"
        @click="openPlace(place.label)"
      >
        <div class="places-card-pin">
          <MapPinIcon :size="20" class="places-card-pin-icon" />
        </div>

        <div class="places-card-body">
          <span class="places-card-name">{{ place.label }}</span>
          <span class="places-card-count">{{ place.count }} {{ place.count === 1 ? 'item' : 'items' }}</span>
        </div>
      </button>
    </div>

  </div>
</template>

<style scoped>
/* ── Shared ───────────────────────────────────────────────────────────────── */
.places-page,
.places-detail-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.places-error {
  font-size: 12px;
  color: #ef4444;
  margin: 4px 0 0;
}

/* ── Index header ─────────────────────────────────────────────────────────── */
.places-page-header {
  padding: 24px 28px 0;
  flex-shrink: 0;
}

.places-page-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}

.places-page-icon { color: var(--color-text-muted); flex-shrink: 0; }

.places-page-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0;
}

.places-page-subtitle {
  font-size: 13px;
  color: var(--color-text-muted);
  margin: 0 0 4px;
}

/* ── Places grid ──────────────────────────────────────────────────────────── */
.places-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  padding: 20px 28px;
  overflow-y: auto;
}

.places-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-raised);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.places-card:hover {
  border-color: var(--color-accent);
  background: var(--color-hover);
}

.places-card-pin {
  width: 38px;
  height: 38px;
  border-radius: 8px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.places-card-pin-icon { color: var(--color-text-muted); }

.places-card-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.places-card-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.places-card-count {
  font-size: 12px;
  color: var(--color-text-muted);
}

/* ── Skeleton ─────────────────────────────────────────────────────────────── */
.places-skeleton-wrap {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  padding: 20px 28px;
}

.places-card-skeleton {
  height: 66px;
  border-radius: 10px;
  background: var(--color-surface-raised);
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.5; }
  50%       { opacity: 1; }
}

/* ── Detail header ────────────────────────────────────────────────────────── */
.places-detail-header {
  padding: 20px 28px 0;
  flex-shrink: 0;
}

.places-back {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  color: var(--color-text-muted);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
  margin-bottom: 12px;
  transition: color 0.12s;
}
.places-back:hover { color: var(--color-text-primary); }

.places-detail-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}

.places-detail-pin {
  width: 32px;
  height: 32px;
  border-radius: 7px;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.places-detail-pin-icon { color: var(--color-text-muted); }

.places-detail-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0;
}

.places-detail-subtitle {
  font-size: 13px;
  color: var(--color-text-muted);
  margin: 0 0 4px;
}
</style>
