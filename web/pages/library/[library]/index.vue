<script setup lang="ts">
import { ArchiveIcon, Trash2Icon, GalleryHorizontalIcon, UploadIcon, LayoutIcon, BookmarkPlusIcon, HeartIcon, TagIcon, LockIcon } from 'lucide-vue-next'

definePageMeta({ middleware: 'auth', keepalive: true })

const route   = useRoute()
const router  = useRouter()
const { setActiveLibrary, activeLibraryId } = useAppShell()
const {
  sections, isLoading,
  hasMoreOlder, hasMoreNewer, isLoadingOlder, isLoadingNewer,
  initGallery, loadOlderMedia, loadNewerMedia, removeItems,
} = useGalleryData()
const { activeStickyKey, mountScrollTracking, unmountScrollTracking, recompute } = useActiveStickySection()
const { libraries }                         = useLibraries()
const { addFiles }                          = useUpload()
const { selectedIds, exitSelectionMode }    = useGallery()
const { showToast }                         = useToast()

// Only use the URL hash as an anchor on the very first load (page open / refresh).
// On subsequent library switches, always load from newest so we don't teleport
// the user to an unrelated date from a previously-viewed library.
let _isFirstLoad = true

// Sync URL param → active library state; reload real media when library changes
const librarySlug = computed(() => route.params.library as string)
watch(librarySlug, (id) => {
  setActiveLibrary(id)
  if (_isFirstLoad) {
    _isFirstLoad = false
    const anchorDate = route.hash?.match(/^#(\d{4}-\d{2}-\d{2})$/)?.[1] ?? undefined
    initGallery(id, anchorDate)
  } else {
    initGallery(id)
  }
}, { immediate: true })

// ── Scroll tracking + date hash ───────────────────────────────────────────
onMounted(() => { mountScrollTracking() })
onUnmounted(() => { unmountScrollTracking() })

// After sections load (data fetch returns), scroll to the hash target then
// recompute to set the initial active key correctly.
watch(sections, async (secs) => {
  if (secs.length === 0) return
  await nextTick()
  if (route.hash) {
    const dateKey = route.hash.slice(1)
    const el = document.querySelector<HTMLElement>(`[data-gallery-section="${dateKey}"]`)
    el?.scrollIntoView({ behavior: 'instant', block: 'start' })
    await nextTick()
  }
  recompute()
}, { once: true })

watch(activeStickyKey, (key) => {
  const newHash = key ? `#${key}` : ''
  if (route.hash !== newHash) router.replace({ hash: newHash })
})

// ── Infinite scroll handlers ──────────────────────────────────────────────
function handleLoadOlder() {
  if (hasMoreOlder.value && !isLoadingOlder.value) loadOlderMedia(activeLibraryId.value)
}

function handleLoadNewer() {
  if (hasMoreNewer.value && !isLoadingNewer.value) loadNewerMedia(activeLibraryId.value)
}

// ── Selection actions ─────────────────────────────────────────────────────
async function trashSelected() {
  const ids = Array.from(selectedIds.value)
  await Promise.all(ids.map(id => $fetch(`/api/v1/media/${id}/soft-delete`, { method: 'POST' }).catch(() => {})))
  removeItems(ids)
  exitSelectionMode()
}

async function archiveSelected() {
  const ids = Array.from(selectedIds.value)
  await Promise.all(ids.map(id => $fetch(`/api/v1/media/${id}/archive`, { method: 'POST' }).catch(() => {})))
  removeItems(ids)
  exitSelectionMode()
}

// ── Favorite ──────────────────────────────────────────────────────────────
async function favoriteSelected() {
  const ids = Array.from(selectedIds.value)
  await Promise.all(ids.map(id => $fetch(`/api/v1/media/${id}/favorite`, { method: 'PUT' }).catch(() => {})))
  showToast(`${ids.length} item${ids.length === 1 ? '' : 's'} added to favorites`, 'success')
  exitSelectionMode()
}

// ── Make private ──────────────────────────────────────────────────────────
async function makePrivateSelected() {
  const ids = Array.from(selectedIds.value)
  await Promise.all(ids.map(id => $fetch(`/api/v1/media/${id}/make-private`, { method: 'POST' }).catch(() => {})))
  removeItems(ids)
  exitSelectionMode()
  showToast(`${ids.length} item${ids.length === 1 ? '' : 's'} moved to Private`, 'success')
}

// ── Add to album ──────────────────────────────────────────────────────────
const addToAlbumOpen = ref(false)
const addTagsOpen    = ref(false)
const selectedMediaIds = computed(() => Array.from(selectedIds.value))

function handleAddedToAlbum(albumName: string) {
  showToast(`Added to "${albumName}"`, 'success')
  exitSelectionMode()
}

// ── Empty state ───────────────────────────────────────────────────────────
const copyOpen = ref(false)
const isRealEmptyLibrary = computed(() => {
  if (sections.value.length > 0) return false
  return libraries.value.some(l => l.id !== activeLibraryId.value)
})
</script>

<template>
  <PhotoGallery
    :sections="sections"
    :loading="isLoading"
    :has-more-older="hasMoreOlder"
    :has-more-newer="hasMoreNewer"
    :loading-older="isLoadingOlder"
    :loading-newer="isLoadingNewer"
    title="Photos"
    gallery-id="photos-and-videos"
    @load-older="handleLoadOlder"
    @load-newer="handleLoadNewer"
  >

    <template #selection-actions>
      <button class="pill-action" title="Add to favorites" @click="favoriteSelected">
        <HeartIcon :size="14" />
      </button>
      <button class="pill-action" title="Add to album" @click="addToAlbumOpen = true">
        <BookmarkPlusIcon :size="14" />
      </button>
      <button class="pill-action" title="Update tags" @click="addTagsOpen = true">
        <TagIcon :size="14" />
      </button>
      <button class="pill-action" title="Make private" @click="makePrivateSelected">
        <LockIcon :size="14" />
      </button>
      <button class="pill-action" title="Archive selected" @click="archiveSelected">
        <ArchiveIcon :size="14" />
      </button>
      <button class="pill-action pill-action-danger" title="Move to trash" @click="trashSelected">
        <Trash2Icon :size="14" />
      </button>
    </template>

    <template #empty>
      <LayoutIcon :size="48" class="gallery-empty-icon" />
      <p class="gallery-empty-title">This library is empty</p>
      <p class="gallery-empty-body">Drag photos here to upload, or</p>
      <div class="gallery-empty-actions">
        <label class="gallery-empty-upload-btn">
          <UploadIcon :size="14" />
          Upload photos
          <input type="file" accept="image/*,video/*" multiple style="display:none" @change="e => addFiles((e.target as HTMLInputElement).files!)" />
        </label>
        <button v-if="isRealEmptyLibrary" class="gallery-empty-copy-btn" @click="copyOpen = true">
          <GalleryHorizontalIcon :size="14" />
          Copy from another library
        </button>
      </div>
    </template>

  </PhotoGallery>

  <AppCopyFromLibraryModal v-model:open="copyOpen" />

  <AppAddToAlbumModal
    v-model:open="addToAlbumOpen"
    :media-ids="selectedMediaIds"
    @added="handleAddedToAlbum"
  />

  <AppAddTagsModal
    v-model:open="addTagsOpen"
    :media-ids="selectedMediaIds"
    @tagged="exitSelectionMode"
  />
</template>
