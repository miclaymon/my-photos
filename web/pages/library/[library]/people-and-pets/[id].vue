<script setup lang="ts">
import {
  ArrowLeftIcon, UserIcon, PawPrintIcon, EyeOffIcon, EyeIcon,
  PencilIcon, CheckIcon, XIcon, AlertTriangleIcon,
  RefreshCwIcon, MoreHorizontalIcon, ImageIcon,
  ArchiveIcon, Trash2Icon, BookmarkPlusIcon, UserMinusIcon,
} from 'lucide-vue-next'
import type { MediaItem as GalleryItem } from '~/composables/useGalleryData'

definePageMeta({ middleware: 'auth' })

const route     = useRoute()
const router    = useRouter()
const libraryId = computed(() => route.params.library as string)
const subjectId = computed(() => route.params.id as string)

// ── Data ──────────────────────────────────────────────────────────────────────

interface MediaItem {
  detectionId:      number | null
  mediaId:          string
  confidence:       number
  matchDistance:    number | null
  reviewNeeded:     boolean
  boundingBox:      { x: number; y: number; w: number; h: number } | null
  thumbnailUrl:     string | null
  faceCropUrl:      string | null
  imageUrl:         string | null
  originalFilename: string
  takenAt:          string | null
  width:            number | null
  height:           number | null
}

interface SubjectDetail {
  id:                        string
  type:                      'person' | 'pet'
  name:                      string | null
  hidden:                    boolean
  coverMediaId?:             string | null
  representativeDetectionId?: number | null
}

interface SubjectMediaRaw {
  subject: {
    id: string; type: string; name: string | null; hidden: boolean
    cover_media_id?: string | null
    representative_detection_id?: number | null
  }
  media: Array<Record<string, unknown>>
}

function mapMediaItem(raw: Record<string, unknown>): MediaItem {
  return {
    detectionId:      raw.detection_id      as number | null,
    mediaId:          raw.media_id          as string,
    confidence:       raw.confidence        as number,
    matchDistance:    raw.match_distance    as number | null,
    reviewNeeded:     raw.review_needed     as boolean,
    boundingBox:      raw.bounding_box      as { x: number; y: number; w: number; h: number } | null,
    thumbnailUrl:     raw.thumbnail_url     as string | null,
    faceCropUrl:      raw.face_crop_url     as string | null,
    imageUrl:         raw.image_url         as string | null,
    originalFilename: raw.original_filename as string,
    takenAt:          raw.taken_at          as string | null,
    width:            raw.width             as number | null,
    height:           raw.height            as number | null,
  }
}

const { data: rawData, pending, refresh: rawRefresh } = await useFetch<SubjectMediaRaw>(
  () => `/api/v1/library/${libraryId.value}/subjects/${subjectId.value}/media`,
)

const data = computed(() => {
  if (!rawData.value) return null
  const raw = rawData.value.subject
  return {
    subject: {
      id:                        raw.id,
      type:                      raw.type as 'person' | 'pet',
      name:                      raw.name,
      hidden:                    raw.hidden,
      coverMediaId:              raw.cover_media_id ?? null,
      representativeDetectionId: raw.representative_detection_id ?? null,
    } satisfies SubjectDetail,
    media: (rawData.value.media ?? []).map(mapMediaItem),
  }
})

async function refresh() {
  await rawRefresh()
}

const subject        = computed(() => data.value?.subject ?? null)
const allMedia       = computed(() => data.value?.media ?? [])
const reviewItems    = computed(() => allMedia.value.filter(m => m.reviewNeeded))
const confirmedItems = computed(() => allMedia.value.filter(m => !m.reviewNeeded))

// ── Cover photo ───────────────────────────────────────────────────────────────
// Optimistically updated when the user picks a new cover; reset on subject navigation.
const localCoverUrl = ref<string | null>(null)
watch(subjectId, () => { localCoverUrl.value = null })

// Resolve the server-designated cover item so detail header matches the index page thumbnail.
// Person: find the item whose detectionId === representativeDetectionId → use faceCropUrl.
// Pet:    find the item whose mediaId    === coverMediaId                → use thumbnailUrl.
// Fall back to the first item if no designated cover is stored yet.
const serverCoverUrl = computed<string | null>(() => {
  const subj = subject.value
  const media = allMedia.value
  if (!subj || !media.length) return null

  if (subj.type === 'person' && subj.representativeDetectionId != null) {
    const rep = media.find(m => m.detectionId === subj.representativeDetectionId)
    if (rep) return rep.faceCropUrl ?? rep.thumbnailUrl ?? null
  }
  if (subj.type === 'pet' && subj.coverMediaId) {
    const cover = media.find(m => m.mediaId === subj.coverMediaId)
    if (cover) return cover.thumbnailUrl ?? null
  }
  // No designated cover — use first item
  return media[0]?.faceCropUrl ?? media[0]?.thumbnailUrl ?? null
})

const headerCoverUrl = computed(() => localCoverUrl.value ?? serverCoverUrl.value)

// ── Rename ────────────────────────────────────────────────────────────────────

const renaming    = ref(false)
const renameName  = ref('')
const renameError = ref<string | null>(null)
const renameInput = ref<HTMLInputElement | null>(null)

function startRename() {
  renameName.value  = subject.value?.name ?? ''
  renameError.value = null
  renaming.value    = true
  nextTick(() => renameInput.value?.focus())
}

function cancelRename() { renaming.value = false }

const mergeFrom   = ref<string | null>(null)
const mergeName   = ref('')
const mergeTarget = ref<{ id: string; name: string } | null>(null)

async function commitRename() {
  if (!subject.value || !renameName.value.trim()) return
  renameError.value = null
  try {
    await $fetch(`/api/v1/subjects/${subject.value.id}`, {
      method: 'PATCH',
      body: { name: renameName.value.trim() },
    })
    renaming.value = false
    await refresh()
  } catch (err: any) {
    const errData = err?.data ?? err?.response?._data
    if (err?.statusCode === 409 || err?.response?.status === 409) {
      const conflict = (errData?.data ?? errData) as { existingId: string; existingName: string }
      renaming.value    = false
      mergeFrom.value   = subject.value.id
      mergeName.value   = renameName.value.trim()
      mergeTarget.value = { id: conflict.existingId, name: conflict.existingName }
      return
    }
    renameError.value = 'Rename failed. Try again.'
  }
}

function closeMerge() { mergeFrom.value = null; mergeTarget.value = null }

async function confirmMerge() {
  if (!mergeFrom.value || !mergeTarget.value) return
  await $fetch(`/api/v1/subjects/${mergeFrom.value}/merge`, {
    method: 'POST',
    body: { intoId: mergeTarget.value.id, name: mergeName.value || mergeTarget.value.name },
  })
  closeMerge()
  router.push(`/library/${libraryId.value}/people-and-pets/${mergeTarget.value.id}`)
}

// ── Hide / Unhide ─────────────────────────────────────────────────────────────

async function toggleHidden() {
  if (!subject.value || !rawData.value) return
  const newHidden = !subject.value.hidden
  // Optimistic update — mutate the raw data to avoid re-fetching all presigned URLs
  rawData.value.subject.hidden = newHidden
  try {
    await $fetch(`/api/v1/subjects/${subject.value.id}`, {
      method: 'PATCH',
      body: { hidden: newHidden },
    })
  } catch {
    if (rawData.value) rawData.value.subject.hidden = !newHidden
  }
}

// ── Review actions ────────────────────────────────────────────────────────────

async function confirmDetection(item: MediaItem) {
  if (!item.detectionId) return
  await $fetch(`/api/v1/subjects/detections/${item.detectionId}`, {
    method: 'PATCH',
    body: { action: 'confirm' },
  })
  await refresh()
}

async function dismissDetection(item: MediaItem) {
  if (!item.detectionId) return
  await $fetch(`/api/v1/subjects/detections/${item.detectionId}`, {
    method: 'PATCH',
    body: { action: 'dismiss' },
  })
  await refresh()
}

// ── Set cover ────────────────────────────────────────────────────────────────

const openMenuId   = ref<string | null>(null)

async function setCover(item: MediaItem) {
  openMenuId.value = null
  if (!subject.value) return

  // Optimistic update — show the selected photo immediately
  localCoverUrl.value = item.faceCropUrl ?? item.thumbnailUrl

  if (item.detectionId) {
    // Person: mark this detection as the representative → backend sets representative_detection_id
    await $fetch(`/api/v1/subjects/detections/${item.detectionId}`, {
      method: 'PATCH',
      body: { set_cover: true },
    })
  } else {
    // Pet: store cover_media_id on the subject
    await $fetch(`/api/v1/subjects/${subject.value.id}`, {
      method: 'PATCH',
      body: { cover_media_id: item.mediaId },
    })
  }
  // Refresh so serverCoverUrl resolves from the newly persisted cover fields
  await refresh()
  // Clear the optimistic URL — serverCoverUrl will now resolve correctly
  localCoverUrl.value = null
}

// Close menu when clicking outside
function handleGlobalClick(e: MouseEvent) {
  if (!(e.target as Element).closest('.spap-menu-anchor')) {
    openMenuId.value = null
  }
}

onMounted(() => document.addEventListener('click', handleGlobalClick))
onBeforeUnmount(() => document.removeEventListener('click', handleGlobalClick))

// ── Selection mode actions ────────────────────────────────────────────────────

const { selectedIds, selectedCount, exitSelectionMode } = useGallery()

// Reverse lookup: mediaId → detectionId (for confirmed person items)
const mediaToDetectionId = computed(() => {
  const map = new Map<string, number | null>()
  for (const item of confirmedItems.value) map.set(item.mediaId, item.detectionId)
  return map
})

// The single selected confirmed item (used to enable "set as cover" when exactly 1 selected)
const singleSelectedItem = computed<MediaItem | null>(() => {
  const ids = Array.from(selectedIds.value)
  if (ids.length !== 1) return null
  const mediaId = ids[0]!
  return confirmedItems.value.find(m => m.mediaId === mediaId) ?? null
})

async function removeSelectedFromSubject() {
  const ids = Array.from(selectedIds.value)
  await Promise.all(ids.map(async (mediaId) => {
    const detId = mediaToDetectionId.value.get(mediaId)
    if (detId) {
      // Person: dismiss this detection (unlinks it from the subject)
      await $fetch(`/api/v1/subjects/detections/${detId}`, {
        method: 'PATCH',
        body: { action: 'dismiss' },
      }).catch(() => {})
    }
    // Pets can't be dismissed per-photo (they're class-based); skip gracefully
  }))
  exitSelectionMode()
  await refresh()
}

async function archiveSelected() {
  const ids = Array.from(selectedIds.value)
  await Promise.all(ids.map(id => $fetch(`/api/v1/media/${id}/archive`, { method: 'POST' }).catch(() => {})))
  exitSelectionMode()
  await refresh()
}

async function deleteSelected() {
  const ids = Array.from(selectedIds.value)
  await Promise.all(ids.map(id => $fetch(`/api/v1/media/${id}/soft-delete`, { method: 'POST' }).catch(() => {})))
  exitSelectionMode()
  await refresh()
}

async function setCoverFromSelection() {
  const item = singleSelectedItem.value
  if (!item) return
  await setCover(item)
  exitSelectionMode()
}

// Add to album modal
const addToAlbumOpen  = ref(false)
const selectedMediaIds = computed(() => Array.from(selectedIds.value))
const { showToast }   = useToast()

function handleAddedToAlbum(albumName: string) {
  showToast(`Added to "${albumName}"`, 'success')
  exitSelectionMode()
}

// ── Preview navigation ────────────────────────────────────────────────────────

function openPreview(item: MediaItem) {
  router.push(`/library/${libraryId.value}/preview/${item.mediaId}`)
}

// ── Gallery items (confirmed section) ────────────────────────────────────────
// Map P&P MediaItem to the gallery MediaItem shape so SimpleGallery / MediaTile
// can render confirmed photos with full optimised loading + preview navigation.

const confirmedGalleryItems = computed<GalleryItem[]>(() =>
  confirmedItems.value.map(m => ({
    id:               m.mediaId,
    aspectRatio:      m.width && m.height ? m.width / m.height : 1,
    width:            m.width  ?? 0,
    height:           m.height ?? 0,
    takenAt:          m.takenAt ?? new Date().toISOString(),
    isVideo:          false,
    originalFilename: m.originalFilename,
    src:              m.imageUrl    ?? m.thumbnailUrl ?? undefined,
    thumbnailSrc:     m.thumbnailUrl ?? undefined,
  })),
)

// ── Thumbnail crop CSS ────────────────────────────────────────────────────────
// Fixed 140×140 container — pixel values are exact.


function thumbStyle(item: MediaItem): Record<string, string> {
  if (!item.thumbnailUrl) return {}
  return {
    backgroundImage:    `url(${item.thumbnailUrl})`,
    backgroundRepeat:   'no-repeat',
    backgroundSize:     '100%',
    backgroundPosition: 'center center',
  }
}

/** Confidence score 0–100 from matchDistance (lower distance = higher score). */
function matchScore(item: MediaItem): number {
  if (item.matchDistance === null) return Math.round(item.confidence * 100)
  return Math.max(0, Math.round((1 - item.matchDistance / 0.5) * 100))
}

function scoreClass(item: MediaItem): string {
  const s = matchScore(item)
  if (s >= 75) return 'score-high'
  if (s >= 50) return 'score-mid'
  return 'score-low'
}
</script>

<template>
  <div class="spap-page">
    <!-- ── Back nav ─────────────────────────────────────────────────────────── -->
    <div class="spap-topbar">
      <NuxtLink :to="`/library/${libraryId}/people-and-pets`" class="spap-back">
        <ArrowLeftIcon :size="14" />
        People &amp; Pets
      </NuxtLink>
      <button class="spap-refresh-btn" title="Refresh" @click="refresh()">
        <RefreshCwIcon :size="14" />
      </button>
    </div>

    <div v-if="pending" class="spap-loading">Loading…</div>

    <template v-else-if="subject">
      <!-- ── Header ──────────────────────────────────────────────────────── -->
      <div class="spap-header">
        <div class="spap-header-icon">
          <img
            v-if="headerCoverUrl"
            :src="headerCoverUrl"
            class="spap-header-cover"
            alt=""
          />
          <component :is="subject.type === 'person' ? UserIcon : PawPrintIcon" v-else :size="22" />
        </div>

        <div class="spap-header-info">
          <template v-if="renaming">
            <div class="spap-rename-row">
              <input
                ref="renameInput"
                v-model="renameName"
                class="spap-rename-input"
                placeholder="Enter a name…"
                @keydown.enter="commitRename"
                @keydown.escape="cancelRename"
              />
              <button class="spap-icon-btn" title="Save" @click="commitRename">
                <CheckIcon :size="14" />
              </button>
              <button class="spap-icon-btn" title="Cancel" @click="cancelRename">
                <XIcon :size="14" />
              </button>
            </div>
            <p v-if="renameError" class="spap-rename-error">{{ renameError }}</p>
          </template>

          <template v-else>
            <h1 class="spap-name">
              {{ subject.name ?? (subject.type === 'person' ? 'Unknown person' : 'Unknown pet') }}
              <button class="spap-rename-btn" title="Rename" @click="startRename">
                <PencilIcon :size="13" />
              </button>
            </h1>
          </template>

          <p class="spap-meta">
            {{ allMedia.length }} {{ allMedia.length === 1 ? 'photo' : 'photos' }}
            <span v-if="subject.hidden" class="spap-hidden-badge">Hidden</span>
          </p>
        </div>

        <div class="spap-header-actions">
          <button class="spap-action-btn" :title="subject.hidden ? 'Unhide' : 'Hide'" @click="toggleHidden">
            <component :is="subject.hidden ? EyeIcon : EyeOffIcon" :size="15" />
            {{ subject.hidden ? 'Unhide' : 'Hide' }}
          </button>
        </div>
      </div>

      <!-- ── Review section ─────────────────────────────────────────────── -->
      <section v-if="reviewItems.length" class="spap-section">
        <h2 class="spap-section-title">
          <AlertTriangleIcon :size="14" />
          Needs review
          <span class="spap-review-count">{{ reviewItems.length }}</span>
        </h2>
        <p class="spap-section-desc">
          These photos were matched with lower confidence. Confirm or dismiss each one.
        </p>

        <div class="spap-grid">
          <div
            v-for="item in reviewItems"
            :key="item.mediaId"
            class="spap-card spap-card-review"
          >
            <!-- Clickable photo area → preview page -->
            <div
              class="spap-thumb spap-thumb-clickable"
              :style="thumbStyle(item)"
              @click="openPreview(item)"
            />

            <!-- Confidence badge -->
            <div class="spap-card-foot">
              <span class="spap-score" :class="scoreClass(item)">{{ matchScore(item) }}%</span>
            </div>

            <!-- Overflow menu -->
            <div class="spap-menu-anchor">
              <button
                class="spap-menu-btn"
                title="More options"
                @click.stop="openMenuId = openMenuId === item.mediaId ? null : item.mediaId"
              >
                <MoreHorizontalIcon :size="14" />
              </button>
              <div v-if="openMenuId === item.mediaId" class="spap-menu">
                <button class="spap-menu-item" @click="setCover(item)">
                  <ImageIcon :size="13" />
                  Set as cover photo
                </button>
              </div>
            </div>

            <!-- Confirm / Dismiss overlay (only on hover for review items) -->
            <div v-if="item.detectionId" class="spap-review-overlay">
              <button
                class="spap-review-btn spap-review-confirm"
                title="Confirm — this is correct"
                @click.stop="confirmDetection(item)"
              >
                <CheckIcon :size="14" />
              </button>
              <button
                class="spap-review-btn spap-review-dismiss"
                title="Dismiss — not this person"
                @click.stop="dismissDetection(item)"
              >
                <XIcon :size="14" />
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- ── Confirmed photo grid ────────────────────────────────────────── -->
      <section class="spap-section spap-section-confirmed">
        <h2 v-if="reviewItems.length" class="spap-section-title">Confirmed</h2>

        <SimpleGallery :items="confirmedGalleryItems" gallery-id="people-and-pets">
          <template #selection-actions>
            <!-- Remove from this subject -->
            <button class="pill-action" :title="`Remove from ${subject?.name ?? 'subject'}`" @click="removeSelectedFromSubject">
              <UserMinusIcon :size="14" />
            </button>
            <!-- Set as cover (single selection only) -->
            <button
              v-if="singleSelectedItem"
              class="pill-action"
              title="Set as cover photo"
              @click="setCoverFromSelection"
            >
              <ImageIcon :size="14" />
            </button>
            <!-- Add to album -->
            <button class="pill-action" title="Add to album" @click="addToAlbumOpen = true">
              <BookmarkPlusIcon :size="14" />
            </button>
            <!-- Archive -->
            <button class="pill-action" title="Archive selected" @click="archiveSelected">
              <ArchiveIcon :size="14" />
            </button>
            <!-- Soft-delete -->
            <button class="pill-action pill-action-danger" title="Move to trash" @click="deleteSelected">
              <Trash2Icon :size="14" />
            </button>
          </template>

          <template #empty>
            <p v-if="!allMedia.length" class="spap-empty">
              No photos found for this subject.
            </p>
          </template>
        </SimpleGallery>
      </section>
    </template>

    <!-- ── Add-to-album modal ──────────────────────────────────────────────── -->
    <AppAddToAlbumModal
      :open="addToAlbumOpen"
      :media-ids="selectedMediaIds"
      @update:open="addToAlbumOpen = $event"
      @added="handleAddedToAlbum"
    />

    <!-- ── Merge dialog ────────────────────────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="mergeTarget" class="spap-merge-backdrop" @click.self="closeMerge">
        <div class="spap-merge-dialog" role="dialog" aria-modal="true">
          <h3 class="spap-merge-title">Combine?</h3>
          <p class="spap-merge-body">
            <strong>{{ mergeTarget.name }}</strong> already exists.
            Combine both into one entry named:
          </p>
          <input
            v-model="mergeName"
            class="spap-rename-input"
            :placeholder="mergeTarget.name"
            style="margin-bottom:16px;width:100%;box-sizing:border-box"
          />
          <div class="spap-merge-actions">
            <button class="spap-merge-btn spap-merge-cancel" @click="closeMerge">Keep separate</button>
            <button class="spap-merge-btn spap-merge-confirm" @click="confirmMerge">Combine</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.spap-page {
  padding: 24px 32px;
  max-width: 1100px;
}

.spap-loading { font-size: 13px; color: var(--color-text-muted); }

/* ── Top bar ─────────────────────────────────────────────────────────────── */
.spap-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.spap-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-muted);
  text-decoration: none;
  transition: color 0.1s;
}

.spap-back:hover { color: var(--color-text-primary); }

.spap-refresh-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--color-text-muted);
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 5px;
  transition: color 0.1s, background 0.1s;
}

.spap-refresh-btn:hover { color: var(--color-text-primary); background: var(--color-hover); }

/* ── Header ──────────────────────────────────────────────────────────────── */
.spap-header {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 32px;
}

.spap-header-icon {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--color-surface-raised);
  border: 2px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  flex-shrink: 0;
  overflow: hidden;
}

.spap-header-cover {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.spap-header-info { flex: 1; min-width: 0; }

.spap-name {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0 0 4px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.spap-rename-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-muted);
  padding: 2px;
  border-radius: 4px;
  display: flex;
  transition: color 0.1s;
}

.spap-rename-btn:hover { color: var(--color-text-primary); }

.spap-meta {
  font-size: 12px;
  color: var(--color-text-muted);
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.spap-hidden-badge {
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 1px 8px;
  font-size: 11px;
  font-weight: 600;
}

.spap-rename-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.spap-rename-input {
  flex: 1;
  padding: 5px 10px;
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  border: 1px solid var(--color-accent);
  border-radius: 6px;
  background: var(--color-surface-raised);
  color: var(--color-text-primary);
  outline: none;
}

.spap-rename-error {
  font-size: 12px;
  color: var(--color-danger, #f87171);
  margin: 2px 0 0;
}

.spap-icon-btn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--color-border);
  border-radius: 5px;
  background: var(--color-surface-raised);
  color: var(--color-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.1s;
}

.spap-icon-btn:hover { background: var(--color-hover); }

.spap-header-actions { display: flex; gap: 8px; }

.spap-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface-raised);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: background 0.1s;
}

.spap-action-btn:hover { background: var(--color-hover); }

/* ── Sections ─────────────────────────────────────────────────────────────── */
.spap-section { margin-bottom: 36px; }

/* SimpleGallery has 8px internal padding — remove it so confirmed items
   align with the review grid above */
.spap-section-confirmed :deep(.sg-wrap) { padding: 0; }

.spap-section-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0 0 8px;
}

.spap-review-count {
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 0 7px;
  font-size: 11px;
}

.spap-section-desc {
  font-size: 12px;
  color: var(--color-text-muted);
  margin: 0 0 14px;
}

.spap-empty { font-size: 13px; color: var(--color-text-muted); }

/* ── Grid ─────────────────────────────────────────────────────────────────── */
.spap-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, 140px);
  gap: 12px;
}

/* ── Card ─────────────────────────────────────────────────────────────────── */
.spap-card {
  position: relative;
  width: 140px;
  border-radius: 10px;
  overflow: hidden;
  border: 2px solid var(--color-border);
  background: var(--color-surface-raised);
  transition: border-color 0.15s;
  box-sizing: border-box;
}

.spap-card:hover { border-color: var(--color-accent); }
.spap-card-review { border-color: rgba(251, 191, 36, 0.5); }

/* Show overlay and menu btn on card hover */
.spap-card:hover .spap-review-overlay { opacity: 1; }
.spap-card:hover .spap-menu-btn { opacity: 1; }

/* ── Thumbnail ───────────────────────────────────────────────────────────── */
.spap-thumb {
  width: 136px;   /* 140px card - 2px border each side (box-sizing handled by card) */
  height: 136px;
  background-color: var(--color-surface-raised);
}

.spap-thumb-clickable {
  cursor: zoom-in;
}

/* ── Score badge ─────────────────────────────────────────────────────────── */
.spap-card-foot {
  padding: 4px 8px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.spap-score {
  font-size: 10px;
  font-weight: 700;
  border-radius: 4px;
  padding: 1px 5px;
}

.score-high { background: rgba(74, 222, 128, 0.15); color: #4ade80; }
.score-mid  { background: rgba(251, 191, 36,  0.15); color: #fbbf24; }
.score-low  { background: rgba(248, 113, 113, 0.15); color: #f87171; }

/* ── Overflow menu ────────────────────────────────────────────────────────── */
.spap-menu-anchor {
  position: absolute;
  top: 6px;
  right: 6px;
}

.spap-menu-btn {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: none;
  background: var(--color-surface-overlay);
  color: var(--color-text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s, background 0.1s;
  box-shadow: 0 1px 4px rgba(0,0,0,0.3);
}

.spap-menu-btn:hover { background: var(--color-hover); }

.spap-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 4px;
  min-width: 160px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.25);
  z-index: 100;
}

.spap-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  color: var(--color-text-primary);
  background: none;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
}

.spap-menu-item:hover { background: var(--color-hover); }

/* ── Review overlay (confirm / dismiss) ─────────────────────────────────── */
.spap-review-overlay {
  position: absolute;
  bottom: 28px; /* above the score foot */
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  gap: 8px;
  opacity: 0;
  transition: opacity 0.15s;
}

.spap-review-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.4);
  transition: transform 0.1s;
}

.spap-review-btn:hover { transform: scale(1.12); }

.spap-review-confirm {
  background: rgba(74, 222, 128, 0.9);
  color: #000;
}

.spap-review-dismiss {
  background: rgba(248, 113, 113, 0.9);
  color: #fff;
}

/* ── Merge dialog ─────────────────────────────────────────────────────────── */
.spap-merge-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 500;
}

.spap-merge-dialog {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 24px 28px;
  width: 320px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.spap-merge-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0 0 10px;
}

.spap-merge-body {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin: 0 0 14px;
  line-height: 1.5;
}

.spap-merge-actions { display: flex; gap: 8px; justify-content: flex-end; }

.spap-merge-btn {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  border: 1px solid var(--color-border);
  transition: background 0.1s;
}

.spap-merge-cancel { background: var(--color-surface-raised); color: var(--color-text-secondary); }
.spap-merge-cancel:hover { background: var(--color-hover); }
.spap-merge-confirm { background: var(--color-accent); color: #fff; border-color: var(--color-accent); }
.spap-merge-confirm:hover { opacity: 0.88; }
</style>
