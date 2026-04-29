<script setup lang="ts">
/**
 * /library/:library/tags/:tagId — All items with a given tag.
 * Uses SimpleGallery. Selection mode allows removing items from the tag.
 */
import { TagIcon, PencilIcon, CheckIcon, XIcon, ArrowLeftIcon } from 'lucide-vue-next'
import type { MediaItem } from '~/composables/useGalleryData'

definePageMeta({ middleware: 'auth' })

const route     = useRoute()
const router    = useRouter()
const libraryId = computed(() => route.params.library as string)
const tagId     = computed(() => route.params.tagId   as string)

interface TagDetail {
  id:    string
  name:  string
  color: string | null
}
interface TagItem {
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

const { data, pending, error, refresh } = await useFetch<{ tag: TagDetail; items: TagItem[] }>(
  () => `/api/v1/library/${libraryId.value}/tags/${tagId.value}`,
)

const tag   = computed(() => data.value?.tag ?? null)
const items = computed<MediaItem[]>(() =>
  (data.value?.items ?? []).map(item => ({
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

// ── Inline rename ─────────────────────────────────────────────────────────────

const renaming    = ref(false)
const renameValue = ref('')
const renameError = ref<string | null>(null)

function startRename() {
  if (!tag.value) return
  renaming.value    = true
  renameValue.value = tag.value.name
  renameError.value = null
}

async function commitRename() {
  if (!tag.value || !renameValue.value.trim()) { renaming.value = false; return }
  if (renameValue.value.trim() === tag.value.name) { renaming.value = false; return }
  renameError.value = null
  try {
    await $fetch(`/api/v1/library/${libraryId.value}/tags/${tagId.value}`, {
      method: 'PATCH',
      body:   { name: renameValue.value.trim() },
    })
    renaming.value = false
    await refresh()
  } catch (e: unknown) {
    renameError.value = (e as { data?: { message?: string } })?.data?.message ?? 'Failed to rename'
  }
}

// ── Selection actions ─────────────────────────────────────────────────────────

const { selectedIds, exitSelectionMode } = useGallery()
const actionError = ref<string | null>(null)

async function removeFromTag() {
  const ids = Array.from(selectedIds.value)
  actionError.value = null
  try {
    await Promise.all(ids.map(mediaId =>
      $fetch(`/api/v1/library/${libraryId.value}/tags/${tagId.value}/items/${mediaId}`, { method: 'DELETE' }),
    ))
    exitSelectionMode()
    await refresh()
  } catch {
    actionError.value = 'Some items could not be removed from this tag.'
  }
}
</script>

<template>
  <div class="tag-detail-page">

    <div class="tag-detail-header">
      <!-- Back link -->
      <NuxtLink :to="`/library/${libraryId}/tags`" class="tag-detail-back">
        <ArrowLeftIcon :size="15" />
        <span>Tags</span>
      </NuxtLink>

      <div class="tag-detail-title-row">
        <!-- Color swatch -->
        <div
          class="tag-detail-swatch"
          :style="tag?.color ? { background: tag.color } : {}"
        >
          <TagIcon v-if="!tag?.color" :size="16" class="tag-detail-swatch-icon" />
        </div>

        <!-- Inline rename or title -->
        <div v-if="renaming" class="tag-detail-rename">
          <input
            v-model="renameValue"
            class="tag-detail-rename-input"
            @keydown.enter.prevent="commitRename"
            @keydown.esc.prevent="renaming = false"
            @blur="commitRename"
            autofocus
          />
          <button class="tag-detail-rename-confirm" @click="commitRename">
            <CheckIcon :size="13" />
          </button>
          <button class="tag-detail-rename-cancel" @click="renaming = false">
            <XIcon :size="13" />
          </button>
          <span v-if="renameError" class="tag-detail-rename-error">{{ renameError }}</span>
        </div>
        <template v-else>
          <h1 class="tag-detail-title">{{ tag?.name ?? '…' }}</h1>
          <button class="tag-detail-rename-btn" title="Rename tag" @click="startRename">
            <PencilIcon :size="14" />
          </button>
        </template>
      </div>

      <p class="tag-detail-subtitle">
        {{ items.length }} {{ items.length === 1 ? 'item' : 'items' }}
      </p>
      <p v-if="actionError" class="tag-detail-error">{{ actionError }}</p>
      <p v-if="error" class="tag-detail-error">{{ error.message }}</p>
    </div>

    <SimpleGallery :items="items" :loading="pending && !data?.items.length" gallery-id="tags">

      <template #selection-actions="{ selectedIds: selIds, exitSelectionMode: exit }">
        <button
          class="pill-action"
          :title="`Remove ${selIds.size} item${selIds.size === 1 ? '' : 's'} from tag`"
          @click="removeFromTag"
        >
          <TagIcon :size="14" />
        </button>
      </template>

      <template #empty>
        <TagIcon :size="48" class="gallery-empty-icon" />
        <p class="gallery-empty-title">{{ pending ? 'Loading…' : 'No items tagged yet' }}</p>
        <p class="gallery-empty-body">Add photos or videos to this tag from the gallery.</p>
      </template>

    </SimpleGallery>

  </div>
</template>

<style scoped>
.tag-detail-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.tag-detail-header {
  padding: 20px 28px 0;
  flex-shrink: 0;
}

.tag-detail-back {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  color: var(--color-text-muted);
  text-decoration: none;
  margin-bottom: 12px;
  transition: color 0.12s;
}
.tag-detail-back:hover { color: var(--color-text-primary); }

.tag-detail-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}

.tag-detail-swatch {
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
.tag-detail-swatch-icon { color: var(--color-text-muted); }

.tag-detail-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0;
  flex: 1;
}

.tag-detail-rename-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.tag-detail-rename-btn:hover {
  background: var(--color-hover);
  color: var(--color-text-primary);
}

.tag-detail-rename {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  flex-wrap: wrap;
}
.tag-detail-rename-input {
  font-size: 18px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 5px;
  border: 1px solid var(--color-accent);
  background: var(--color-surface);
  color: var(--color-text-primary);
  flex: 1;
  min-width: 120px;
  outline: none;
}
.tag-detail-rename-confirm,
.tag-detail-rename-cancel {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 5px;
  border: none;
  background: transparent;
  cursor: pointer;
  transition: background 0.1s;
}
.tag-detail-rename-confirm { color: #16a34a; }
.tag-detail-rename-confirm:hover { background: rgba(22,163,74,0.12); }
.tag-detail-rename-cancel { color: var(--color-text-muted); }
.tag-detail-rename-cancel:hover { background: var(--color-hover); }
.tag-detail-rename-error { width: 100%; font-size: 12px; color: #ef4444; }

.tag-detail-subtitle {
  font-size: 13px;
  color: var(--color-text-muted);
  margin: 0 0 4px;
}

.tag-detail-error {
  font-size: 12px;
  color: #ef4444;
  margin: 4px 0 0;
}
</style>
