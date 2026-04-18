<script setup lang="ts">
/**
 * /library/:library/trash — Soft-deleted items for the selected library.
 * Grid-only layout with no date groupings (SimpleGallery).
 * Items sorted by soonest-expiring first so the most urgent items are at the top.
 */
import { Trash2Icon, RotateCcwIcon, AlertTriangleIcon, RefreshCwIcon } from 'lucide-vue-next'
import type { MediaItem } from '~/composables/useGalleryData'

definePageMeta({ middleware: 'auth' })

const route     = useRoute()
const libraryId = computed(() => route.params.library as string)

interface TrashApiItem {
  id:               string
  originalFilename: string
  contentType:      string
  width:            number
  height:           number
  aspectRatio:      number
  isVideo:          boolean
  takenAt:          string
  deletionDate:     string | null
  src?:             string
  thumbnailSrc?:    string
}

const { data, pending, error, refresh } = await useFetch<{ items: TrashApiItem[] }>(
  () => `/api/v1/trash?library=${libraryId.value}`,
)

const { selectedIds, exitSelectionMode } = useGallery()

const items = computed<MediaItem[]>(() =>
  (data.value?.items ?? [])
    .slice()
    .sort((a, b) => {
      const da = new Date(a.deletionDate ?? a.takenAt).getTime()
      const db = new Date(b.deletionDate ?? b.takenAt).getTime()
      return da - db
    })
    .map(item => ({
      id:               item.id,
      originalFilename: item.originalFilename,
      aspectRatio:      item.aspectRatio || 1.5,
      width:            item.width  || 0,
      height:           item.height || 0,
      takenAt:          item.takenAt,
      isVideo:          item.isVideo,
      src:              item.src,
      thumbnailSrc:     item.thumbnailSrc,
      deletionDate:     item.deletionDate ?? undefined,
    })),
)

const actionError = ref<string | null>(null)

async function restoreSelected() {
  const ids = Array.from(selectedIds.value)
  actionError.value = null
  try {
    await Promise.all(ids.map(id => $fetch(`/api/v1/media/${id}/restore`, { method: 'POST' })))
    exitSelectionMode()
    await refresh()
  } catch {
    actionError.value = 'Some items could not be restored.'
  }
}

async function deleteSelected() {
  const ids = Array.from(selectedIds.value)
  if (!confirm(`Permanently delete ${ids.length} item${ids.length !== 1 ? 's' : ''}? This cannot be undone.`)) return
  actionError.value = null
  try {
    await Promise.all(ids.map(id => $fetch(`/api/v1/media/${id}/permanent-delete`, { method: 'POST' })))
    exitSelectionMode()
    await refresh()
  } catch {
    actionError.value = 'Some items could not be deleted.'
  }
}
</script>

<template>
  <div class="trash-page">

    <div class="trash-page-header">
      <div class="trash-page-title-row">
        <Trash2Icon :size="18" class="trash-page-icon" />
        <h1 class="trash-page-title">Trash</h1>
        <button
          class="trash-page-refresh"
          :class="{ 'is-spinning': pending }"
          title="Refresh"
          @click="refresh()"
        >
          <RefreshCwIcon :size="14" />
        </button>
      </div>
      <p class="trash-page-subtitle">Items are permanently deleted after 30 days.</p>
      <p v-if="actionError" class="trash-page-error">{{ actionError }}</p>
      <p v-if="error" class="trash-page-error">{{ error.message }}</p>
    </div>

    <SimpleGallery :items="items" :loading="pending && !data?.items.length">

      <template #selection-actions>
        <button class="pill-action" title="Restore selected" @click="restoreSelected">
          <RotateCcwIcon :size="14" />
        </button>
        <button class="pill-action pill-action-danger" title="Delete forever" @click="deleteSelected">
          <AlertTriangleIcon :size="14" />
        </button>
      </template>

      <template #empty>
        <Trash2Icon :size="48" class="gallery-empty-icon" />
        <p class="gallery-empty-title">{{ pending ? 'Loading…' : 'Trash is empty' }}</p>
      </template>

    </SimpleGallery>

  </div>
</template>

<style scoped>
.trash-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.trash-page-header {
  padding: 24px 28px 0;
  flex-shrink: 0;
}

.trash-page-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}

.trash-page-icon  { color: var(--color-text-muted); flex-shrink: 0; }

.trash-page-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0;
  flex: 1;
}

.trash-page-refresh {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 7px;
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: background 0.12s;
}
.trash-page-refresh:hover   { background: var(--color-hover); }
.trash-page-refresh.is-spinning svg { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.trash-page-subtitle {
  font-size: 13px;
  color: var(--color-text-muted);
  margin: 0 0 4px;
}

.trash-page-error {
  font-size: 12px;
  color: #ef4444;
  margin: 4px 0 0;
}
</style>
