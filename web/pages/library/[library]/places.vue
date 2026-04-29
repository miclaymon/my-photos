<script setup lang="ts">
/**
 * /library/:library/places
 *
 * No ?place param → grid of all distinct location labels (with UUIDs).
 * ?place=<uuid>   → gallery of photos at that location.
 *
 * Locations are derived from reverse-geocoded GPS data. Run the
 * "location-geocode" background job (Admin → Jobs tab) to populate them.
 * Place names can be customised with the rename (pencil) button.
 */
import { MapPinIcon, ArrowLeftIcon, PencilIcon, CheckIcon, XIcon } from 'lucide-vue-next'
import type { MediaItem } from '~/composables/useGalleryData'

definePageMeta({ middleware: 'auth' })

const route     = useRoute()
const router    = useRouter()
const libraryId = computed(() => route.params.library as string)

// ── Mode: index vs. detail ────────────────────────────────────────────────────

const activePlaceId    = computed(() => {
  const q = route.query.place
  return typeof q === 'string' && q ? q : null
})
const activePlaceEntry = ref<PlaceEntry | null>(null)

function openPlace(id: string, entry: PlaceEntry) {
  activePlaceEntry.value = entry
  router.push({ query: { place: id } })
}

function backToIndex() {
  activePlaceEntry.value = null
  router.push({ query: {} })
}

// ── Places index ──────────────────────────────────────────────────────────────

interface PlaceEntry {
  id:        string
  label:     string
  count:     number
  coverUrls: string[]
}

const {
  data:    indexData,
  pending: indexPending,
  error:   indexError,
  refresh: refreshIndex,
} = await useFetch<{ places: PlaceEntry[] }>(
  () => `/api/v1/library/${libraryId.value}/places`,
  { watch: [libraryId] },
)

const places = computed(() =>
  (indexData.value?.places ?? []).map((p: Record<string, unknown>) => ({
    id:        p.id        as string,
    label:     p.label     as string,
    count:     p.count     as number,
    coverUrls: (p.cover_urls ?? []) as string[],
  })),
)

// ── Rename ────────────────────────────────────────────────────────────────────

const renamingId    = ref<string | null>(null)
const renameInput   = ref('')
const renameSaving  = ref(false)
const renameError   = ref<string | null>(null)
const renameInputEl = ref<HTMLInputElement | null>(null)

function startRename(place: PlaceEntry, e: MouseEvent) {
  e.stopPropagation()
  renamingId.value  = place.id
  renameInput.value = place.label
  renameError.value = null
  nextTick(() => renameInputEl.value?.select())
}

function cancelRename() {
  renamingId.value = null
  renameInput.value = ''
  renameError.value = null
}

async function saveRename(placeId: string) {
  if (renameSaving.value) return
  renameSaving.value = true
  renameError.value  = null
  try {
    await $fetch(`/api/v1/library/${libraryId.value}/places/${placeId}`, {
      method: 'PATCH',
      body:   { display_name: renameInput.value.trim() || null },
    })
    await refreshIndex()
    renamingId.value = null
  } catch {
    renameError.value = 'Failed to save name.'
  } finally {
    renameSaving.value = false
  }
}

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

const detailData    = ref<{ id: string; label: string; items: PlaceItem[] } | null>(null)
const detailPending = ref(false)
const detailError   = ref<string | null>(null)

async function loadDetail(placeId: string) {
  detailPending.value = true
  detailError.value   = null
  detailData.value    = null
  try {
    detailData.value = await $fetch<{ id: string; label: string; items: PlaceItem[] }>(
      `/api/v1/library/${libraryId.value}/places/${placeId}/items`,
    )
  } catch (e: unknown) {
    detailError.value = (e as { data?: { message?: string } })?.data?.message ?? 'Failed to load'
  } finally {
    detailPending.value = false
  }
}

// Load detail whenever the active place changes
watch(activePlaceId, (id) => {
  if (id) loadDetail(id)
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

// ── Detail rename ─────────────────────────────────────────────────────────────

const detailRenaming    = ref(false)
const detailRenameInput = ref('')
const detailRenameSaving = ref(false)
const detailRenameInputEl = ref<HTMLInputElement | null>(null)

function startDetailRename() {
  detailRenaming.value    = true
  detailRenameInput.value = detailData.value?.label ?? ''
  nextTick(() => detailRenameInputEl.value?.select())
}

function cancelDetailRename() {
  detailRenaming.value = false
}

async function saveDetailRename() {
  if (!activePlaceId.value || detailRenameSaving.value) return
  detailRenameSaving.value = true
  try {
    const res = await $fetch<{ label: string }>(`/api/v1/library/${libraryId.value}/places/${activePlaceId.value}`, {
      method: 'PATCH',
      body:   { display_name: detailRenameInput.value.trim() || null },
    })
    if (detailData.value) detailData.value.label = res.label
    detailRenaming.value = false
    await refreshIndex()
  } catch {
    // silently ignore
  } finally {
    detailRenameSaving.value = false
  }
}
</script>

<template>
  <!-- ── Detail view ───────────────────────────────────────────────────────── -->
  <div v-if="activePlaceId" class="places-detail-page">

    <div class="places-detail-header">
      <button class="places-back" @click="backToIndex">
        <ArrowLeftIcon :size="15" />
        <span>Places</span>
      </button>

      <div class="places-detail-title-row">
        <div class="places-detail-pin">
          <img
            v-if="activePlaceEntry?.coverUrls[0]"
            :src="activePlaceEntry.coverUrls[0]"
            class="places-detail-cover-img"
            alt=""
            draggable="false"
          />
          <MapPinIcon v-else :size="16" class="places-detail-pin-icon" />
        </div>

        <!-- Inline rename for detail view -->
        <template v-if="detailRenaming">
          <input
            ref="detailRenameInputEl"
            v-model="detailRenameInput"
            class="places-detail-rename-input"
            @keydown.enter.prevent="saveDetailRename"
            @keydown.escape.prevent="cancelDetailRename"
            @keydown.stop
          />
          <button class="places-rename-action" :disabled="detailRenameSaving" @click="saveDetailRename">
            <CheckIcon :size="14" />
          </button>
          <button class="places-rename-action places-rename-cancel" @click="cancelDetailRename">
            <XIcon :size="14" />
          </button>
        </template>
        <template v-else>
          <h1 class="places-detail-title">{{ detailData?.label ?? '…' }}</h1>
          <button class="places-rename-action places-rename-pencil" title="Rename place" @click="startDetailRename">
            <PencilIcon :size="13" />
          </button>
        </template>
      </div>

      <p class="places-detail-subtitle">
        {{ detailItems.length }} {{ detailItems.length === 1 ? 'item' : 'items' }}
      </p>
      <p v-if="detailError" class="places-error">{{ detailError }}</p>
    </div>

    <SimpleGallery :items="detailItems" :loading="detailPending && !detailData" gallery-id="places">
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
      <div
        v-for="place in places"
        :key="place.id"
        class="places-card"
        @click="renamingId !== place.id && openPlace(place.id, place)"
      >
        <!-- Cover thumbnail (replaces the old pin icon) -->
        <div class="places-card-cover">
          <!-- Single photo -->
          <template v-if="place.coverUrls.length <= 1">
            <img
              v-if="place.coverUrls[0]"
              :src="place.coverUrls[0]"
              :alt="place.label"
              class="places-cover-img"
              draggable="false"
            />
            <div v-else class="places-cover-empty">
              <MapPinIcon :size="20" class="places-cover-empty-icon" />
            </div>
          </template>

          <!-- 2×2 collage -->
          <template v-else>
            <div class="places-cover-collage">
              <div v-for="i in 4" :key="i" class="places-cover-cell">
                <img
                  v-if="place.coverUrls[i - 1]"
                  :src="place.coverUrls[i - 1]"
                  :alt="`${place.label} photo ${i}`"
                  class="places-cover-cell-img"
                  draggable="false"
                />
              </div>
            </div>
          </template>
        </div>

        <!-- Name / count / rename -->
        <div class="places-card-body">
          <template v-if="renamingId === place.id">
            <input
              ref="renameInputEl"
              v-model="renameInput"
              class="places-card-rename-input"
              @click.stop
              @keydown.enter.prevent="saveRename(place.id)"
              @keydown.escape.prevent="cancelRename"
              @keydown.stop
            />
            <div class="places-card-rename-actions" @click.stop>
              <button class="places-rename-action" :disabled="renameSaving" @click="saveRename(place.id)">
                <CheckIcon :size="12" />
              </button>
              <button class="places-rename-action places-rename-cancel" @click="cancelRename">
                <XIcon :size="12" />
              </button>
            </div>
            <p v-if="renameError" class="places-rename-error">{{ renameError }}</p>
          </template>
          <template v-else>
            <span class="places-card-name">{{ place.label }}</span>
            <span class="places-card-count">{{ place.count }} {{ place.count === 1 ? 'item' : 'items' }}</span>
          </template>
        </div>

        <!-- Rename pencil button (shown on card hover) -->
        <button
          v-if="renamingId !== place.id"
          class="places-card-rename-btn"
          title="Rename place"
          @click.stop="startRename(place, $event)"
        >
          <PencilIcon :size="13" />
        </button>
      </div>
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
  position: relative;
}

.places-card:hover {
  border-color: var(--color-accent);
  background: var(--color-hover);
}

.places-card:hover .places-card-rename-btn {
  opacity: 1;
}

/* ── Cover (replaces the old pin icon) ───────────────────────────────────── */
.places-card-cover {
  width: 56px;
  height: 56px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
  background: var(--color-surface);
}

.places-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.places-cover-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
}

.places-cover-empty-icon { color: var(--color-text-muted); }

/* Collage */
.places-cover-collage {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows:    1fr 1fr;
  width: 100%;
  height: 100%;
  gap: 1.5px;
}

.places-cover-cell {
  overflow: hidden;
  background: var(--color-surface-raised);
}

.places-cover-cell-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* ── Body (name + count) ──────────────────────────────────────────────────── */
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

/* Rename button */
.places-card-rename-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  border-radius: 5px;
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.12s, background 0.12s;
}
.places-card-rename-btn:hover {
  background: var(--color-surface);
  color: var(--color-text-primary);
}

.places-card-rename-input {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
  background: var(--color-surface);
  border: 1px solid var(--color-accent);
  border-radius: 5px;
  padding: 2px 6px;
  outline: none;
  width: 100%;
  font-family: inherit;
}

.places-card-rename-actions {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}

.places-rename-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: background 0.1s;
}
.places-rename-action:hover { background: var(--color-hover); color: var(--color-text-primary); }
.places-rename-action:disabled { opacity: 0.4; cursor: default; }
.places-rename-cancel { color: #ef4444; }
.places-rename-cancel:hover { background: rgba(239,68,68,0.1); color: #ef4444; }

.places-rename-error {
  font-size: 11px;
  color: #ef4444;
  margin: 2px 0 0;
}

.places-rename-pencil {
  background: transparent;
  border: none;
  color: var(--color-text-muted);
}
.places-rename-pencil:hover { background: rgba(255,255,255,0.08); color: var(--color-text-primary); }

/* ── Skeleton ─────────────────────────────────────────────────────────────── */
.places-skeleton-wrap {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  padding: 20px 28px;
}

.places-card-skeleton {
  height: 80px;
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

.places-detail-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  border-radius: 7px;
}

.places-detail-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0;
  flex: 1;
}

.places-detail-rename-input {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-text-primary);
  background: var(--color-surface);
  border: 1px solid var(--color-accent);
  border-radius: 6px;
  padding: 3px 8px;
  outline: none;
  flex: 1;
  min-width: 0;
}

.places-detail-subtitle {
  font-size: 13px;
  color: var(--color-text-muted);
  margin: 0 0 4px;
}
</style>
