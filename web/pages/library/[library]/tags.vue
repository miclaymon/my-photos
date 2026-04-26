<script setup lang="ts">
/**
 * /library/:library/tags — User-created tags index for the library.
 * Tags are library-visible (all members see the same tags).
 * Any member can create, rename, or delete tags.
 */
import { TagIcon, PlusIcon, PencilIcon, Trash2Icon, CheckIcon, XIcon } from 'lucide-vue-next'

definePageMeta({ middleware: 'auth' })

const route     = useRoute()
const libraryId = computed(() => route.params.library as string)

interface Tag {
  id:        string
  name:      string
  color:     string | null
  itemCount: number
}

const { data, pending, error, refresh } = await useFetch<{ tags: Tag[] }>(
  () => `/api/v1/library/${libraryId.value}/tags`,
)

const tags = computed(() => data.value?.tags ?? [])

// ── Create tag ────────────────────────────────────────────────────────────────

const showCreateForm = ref(false)
const newTagName     = ref('')
const newTagColor    = ref('')
const creating       = ref(false)
const createError    = ref<string | null>(null)

async function createTag() {
  if (!newTagName.value.trim()) return
  creating.value    = true
  createError.value = null
  try {
    await $fetch(`/api/v1/library/${libraryId.value}/tags`, {
      method: 'POST',
      body:   { name: newTagName.value.trim(), color: newTagColor.value || null },
    })
    newTagName.value    = ''
    newTagColor.value   = ''
    showCreateForm.value = false
    await refresh()
  } catch (e: unknown) {
    createError.value = (e as { data?: { message?: string } })?.data?.message ?? 'Failed to create tag'
  } finally {
    creating.value = false
  }
}

function cancelCreate() {
  showCreateForm.value = false
  newTagName.value    = ''
  newTagColor.value   = ''
  createError.value   = null
}

// ── Rename tag (inline) ───────────────────────────────────────────────────────

const renamingId   = ref<string | null>(null)
const renameValue  = ref('')
const renameError  = ref<string | null>(null)

function startRename(tag: Tag) {
  renamingId.value  = tag.id
  renameValue.value = tag.name
  renameError.value = null
}

async function commitRename(tag: Tag) {
  if (!renameValue.value.trim() || renameValue.value.trim() === tag.name) {
    renamingId.value = null
    return
  }
  renameError.value = null
  try {
    await $fetch(`/api/v1/library/${libraryId.value}/tags/${tag.id}`, {
      method: 'PATCH',
      body:   { name: renameValue.value.trim() },
    })
    renamingId.value = null
    await refresh()
  } catch (e: unknown) {
    renameError.value = (e as { data?: { message?: string } })?.data?.message ?? 'Failed to rename'
  }
}

// ── Delete tag ────────────────────────────────────────────────────────────────

const deletingId  = ref<string | null>(null)
const deleteError = ref<string | null>(null)

async function deleteTag(tag: Tag) {
  if (!confirm(`Delete tag "${tag.name}"? This will remove it from all ${tag.itemCount} item(s).`)) return
  deletingId.value  = tag.id
  deleteError.value = null
  try {
    await $fetch(`/api/v1/library/${libraryId.value}/tags/${tag.id}`, { method: 'DELETE' })
    await refresh()
  } catch (e: unknown) {
    deleteError.value = (e as { data?: { message?: string } })?.data?.message ?? 'Failed to delete tag'
  } finally {
    deletingId.value = null
  }
}
</script>

<template>
  <div class="tags-page">

    <div class="tags-page-header">
      <div class="tags-page-title-row">
        <TagIcon :size="18" class="tags-page-icon" />
        <h1 class="tags-page-title">Tags</h1>
        <button class="tags-create-btn" @click="showCreateForm = true">
          <PlusIcon :size="14" />
          <span>New tag</span>
        </button>
      </div>
      <p class="tags-page-subtitle">User-created tags are shared across all library members.</p>
      <p v-if="error" class="tags-page-error">{{ error.message }}</p>
      <p v-if="deleteError" class="tags-page-error">{{ deleteError }}</p>
    </div>

    <!-- Create form -->
    <div v-if="showCreateForm" class="tags-create-form">
      <input
        v-model="newTagName"
        class="tags-create-input"
        placeholder="Tag name…"
        maxlength="60"
        autofocus
        @keydown.enter="createTag"
        @keydown.esc="cancelCreate"
      />
      <input
        v-model="newTagColor"
        class="tags-create-color"
        type="color"
        title="Tag colour (optional)"
      />
      <button class="tags-create-confirm" :disabled="creating || !newTagName.trim()" @click="createTag">
        <CheckIcon :size="14" />
      </button>
      <button class="tags-create-cancel" @click="cancelCreate">
        <XIcon :size="14" />
      </button>
      <span v-if="createError" class="tags-create-error">{{ createError }}</span>
    </div>

    <!-- Loading skeleton -->
    <div v-if="pending && !tags.length" class="tags-skeleton-wrap">
      <div v-for="i in 6" :key="i" class="tags-card-skeleton" />
    </div>

    <!-- Empty state -->
    <div v-else-if="!pending && !tags.length" class="gallery-empty" style="padding-top: 60px;">
      <TagIcon :size="48" class="gallery-empty-icon" />
      <p class="gallery-empty-title">No tags yet</p>
      <p class="gallery-empty-body">Create a tag to start organising your photos.</p>
    </div>

    <!-- Tag grid -->
    <div v-else class="tags-grid">
      <NuxtLink
        v-for="tag in tags"
        :key="tag.id"
        :to="`/library/${libraryId}/tags/${tag.id}`"
        class="tags-card"
      >
        <!-- Colour swatch or icon -->
        <div
          class="tags-card-swatch"
          :style="tag.color ? { background: tag.color } : {}"
        >
          <TagIcon v-if="!tag.color" :size="20" class="tags-card-swatch-icon" />
        </div>

        <div class="tags-card-body">
          <!-- Inline rename -->
          <div v-if="renamingId === tag.id" class="tags-card-rename" @click.prevent>
            <input
              v-model="renameValue"
              class="tags-card-rename-input"
              @keydown.enter.prevent="commitRename(tag)"
              @keydown.esc.prevent="renamingId = null"
              @blur="commitRename(tag)"
              autofocus
            />
            <span v-if="renameError" class="tags-card-rename-error">{{ renameError }}</span>
          </div>
          <span v-else class="tags-card-name">{{ tag.name }}</span>

          <span class="tags-card-count">{{ tag.itemCount }} {{ tag.itemCount === 1 ? 'item' : 'items' }}</span>
        </div>

        <!-- Actions -->
        <div class="tags-card-actions" @click.prevent>
          <button
            class="tags-card-action"
            title="Rename"
            @click.prevent="startRename(tag)"
          >
            <PencilIcon :size="13" />
          </button>
          <button
            class="tags-card-action tags-card-action-danger"
            title="Delete tag"
            :disabled="deletingId === tag.id"
            @click.prevent="deleteTag(tag)"
          >
            <Trash2Icon :size="13" />
          </button>
        </div>
      </NuxtLink>
    </div>

  </div>
</template>

<style scoped>
.tags-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.tags-page-header {
  padding: 24px 28px 0;
  flex-shrink: 0;
}

.tags-page-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}

.tags-page-icon { color: var(--color-text-muted); flex-shrink: 0; }

.tags-page-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0;
  flex: 1;
}

.tags-page-subtitle {
  font-size: 13px;
  color: var(--color-text-muted);
  margin: 0 0 4px;
}

.tags-page-error {
  font-size: 12px;
  color: #ef4444;
  margin: 4px 0 0;
}

/* Create button */
.tags-create-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: 7px;
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.tags-create-btn:hover {
  background: var(--color-hover);
  color: var(--color-text-primary);
}

/* Create form */
.tags-create-form {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 28px;
  flex-wrap: wrap;
}

.tags-create-input {
  flex: 1;
  min-width: 180px;
  padding: 6px 10px;
  border-radius: 7px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-raised);
  color: var(--color-text-primary);
  font-size: 13px;
  outline: none;
}
.tags-create-input:focus { border-color: var(--color-accent); }

.tags-create-color {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  padding: 2px;
  cursor: pointer;
  background: var(--color-surface-raised);
}

.tags-create-confirm,
.tags-create-cancel {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: transparent;
  cursor: pointer;
  transition: background 0.1s;
}
.tags-create-confirm { color: #16a34a; }
.tags-create-confirm:hover { background: rgba(22,163,74,0.12); }
.tags-create-confirm:disabled { opacity: 0.4; cursor: not-allowed; }
.tags-create-cancel { color: var(--color-text-muted); }
.tags-create-cancel:hover { background: var(--color-hover); }

.tags-create-error {
  width: 100%;
  font-size: 12px;
  color: #ef4444;
}

/* Tag grid */
.tags-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  padding: 20px 28px;
  overflow-y: auto;
}

.tags-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-raised);
  text-decoration: none;
  color: inherit;
  transition: border-color 0.15s, background 0.15s;
  position: relative;
}
.tags-card:hover {
  border-color: var(--color-accent);
  background: var(--color-hover);
}

.tags-card-swatch {
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
.tags-card-swatch-icon { color: var(--color-text-muted); }

.tags-card-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tags-card-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tags-card-count {
  font-size: 12px;
  color: var(--color-text-muted);
}

.tags-card-rename { display: flex; flex-direction: column; gap: 2px; }
.tags-card-rename-input {
  font-size: 14px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--color-accent);
  background: var(--color-surface);
  color: var(--color-text-primary);
  width: 100%;
  outline: none;
}
.tags-card-rename-error { font-size: 11px; color: #ef4444; }

.tags-card-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s;
}
.tags-card:hover .tags-card-actions { opacity: 1; }

.tags-card-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.tags-card-action:hover { background: var(--color-hover); color: var(--color-text-primary); }
.tags-card-action-danger:hover { background: rgba(220,38,38,0.12); color: #dc2626; }
.tags-card-action:disabled { opacity: 0.4; cursor: not-allowed; }

/* Skeleton */
.tags-skeleton-wrap {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  padding: 20px 28px;
}
.tags-card-skeleton {
  height: 66px;
  border-radius: 10px;
  background: var(--color-surface-raised);
  animation: pulse 1.5s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 0.5; }
  50%       { opacity: 1; }
}
</style>
