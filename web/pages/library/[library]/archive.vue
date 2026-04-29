<script setup lang="ts">
/**
 * /library/:library/archive — Archived media items for the selected library.
 * Grid-only layout with no date groupings (SimpleGallery).
 */
import { ArchiveIcon, ArchiveRestoreIcon, RefreshCwIcon } from 'lucide-vue-next'
import type { MediaItem } from '~/composables/useGalleryData'

definePageMeta({ middleware: 'auth' })

const route     = useRoute()
const libraryId = computed(() => route.params.library as string)

interface ArchiveApiItem {
  id:               string
  originalFilename: string
  contentType:      string
  width:            number
  height:           number
  aspectRatio:      number
  isVideo:          boolean
  takenAt:          string
  archivedAt:       string | null
  src?:             string
  thumbnailSrc?:    string
}

const { data, pending, error, refresh } = await useFetch<{ items: ArchiveApiItem[] }>(
  () => `/api/v1/library/${libraryId.value}/archive`,
)

const { selectedIds, exitSelectionMode } = useGallery()

const items = computed<MediaItem[]>(() =>
  (data.value?.items ?? [])
    .slice()
    .sort((a, b) => new Date(b.takenAt).getTime() - new Date(a.takenAt).getTime())
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
      archivedAt:       item.archivedAt ?? undefined,
    })),
)

const actionError = ref<string | null>(null)

async function unarchiveSelected() {
  const ids = Array.from(selectedIds.value)
  actionError.value = null
  try {
    await Promise.all(ids.map(id => $fetch(`/api/v1/media/${id}/unarchive`, { method: 'POST' })))
    exitSelectionMode()
    await refresh()
  } catch {
    actionError.value = 'Some items could not be unarchived.'
  }
}
</script>

<template>
  <div class="archive-page">

    <div class="archive-page-header">
      <div class="archive-page-title-row">
        <ArchiveIcon :size="18" class="archive-page-icon" />
        <h1 class="archive-page-title">Archive</h1>
        <button
          class="archive-page-refresh"
          :class="{ 'is-spinning': pending }"
          title="Refresh"
          @click="refresh()"
        >
          <RefreshCwIcon :size="14" />
        </button>
      </div>
      <p class="archive-page-subtitle">Archived items are hidden from the gallery but not deleted.</p>
      <p v-if="actionError" class="archive-page-error">{{ actionError }}</p>
      <p v-if="error" class="archive-page-error">{{ error.message }}</p>
    </div>

    <SimpleGallery :items="items" :loading="pending && !data?.items.length" gallery-id="archive" forced-mode="grid" forced-size="xs">

      <template #selection-actions>
        <button class="pill-action" title="Unarchive selected" @click="unarchiveSelected">
          <ArchiveRestoreIcon :size="14" />
        </button>
      </template>

      <template #empty>
        <ArchiveIcon :size="48" class="gallery-empty-icon" />
        <p class="gallery-empty-title">{{ pending ? 'Loading…' : 'Archive is empty' }}</p>
      </template>

    </SimpleGallery>

  </div>
</template>

<style scoped>
.archive-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.archive-page-header {
  padding: 24px 28px 0;
  flex-shrink: 0;
}

.archive-page-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}

.archive-page-icon  { color: var(--color-text-muted); flex-shrink: 0; }

.archive-page-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0;
  flex: 1;
}

.archive-page-refresh {
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
.archive-page-refresh:hover   { background: var(--color-hover); }
.archive-page-refresh.is-spinning svg { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.archive-page-subtitle {
  font-size: 13px;
  color: var(--color-text-muted);
  margin: 0 0 4px;
}

.archive-page-error {
  font-size: 12px;
  color: #ef4444;
  margin: 4px 0 0;
}
</style>
