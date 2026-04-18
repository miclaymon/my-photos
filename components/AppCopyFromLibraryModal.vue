<script setup lang="ts">
/**
 * Modal that lets the user copy items from another library into the
 * currently active library.
 *
 * Flow:
 *  1. User picks a source library from the dropdown.
 *  2. Thumbnails from that library load in a grid.
 *  3. User clicks items to select them.
 *  4. Confirm → POST /api/v1/library/:id/copy-from → reload active library.
 */
import { CopyIcon, XIcon, CheckIcon } from 'lucide-vue-next'
import { onClickOutside } from '@vueuse/core'

interface LibraryMedia {
  id:               string
  originalFilename: string
  aspectRatio:      number
  src:              string
  isVideo:          boolean
}

const props = defineProps<{ open: boolean }>()
const emit  = defineEmits<{ 'update:open': [value: boolean] }>()

const { activeLibraryId }           = useAppShell()
const { libraries, fetchLibraries } = useLibraries()
const { loadLibraryMedia }          = useGalleryData()

const panelEl     = ref<HTMLElement | null>(null)
const sourceId    = ref('')
const sourceItems = ref<LibraryMedia[]>([])
const selectedIds = ref<Set<string>>(new Set())
const loading     = ref(false)
const saving      = ref(false)
const error       = ref('')

onClickOutside(panelEl, () => emit('update:open', false))

// Filter out the currently active library from the source options
const sourceOptions = computed(() =>
  libraries.value.filter(l => l.id !== activeLibraryId.value),
)

watch(() => props.open, async (open) => {
  if (!open) return
  selectedIds.value = new Set()
  sourceItems.value = []
  error.value       = ''
  await fetchLibraries()
  if (sourceOptions.value.length) {
    sourceId.value = sourceOptions.value[0]!.id
  }
})

watch(sourceId, async (id) => {
  if (!id) { sourceItems.value = []; return }
  loading.value = true
  try {
    const data = await $fetch<{ items: LibraryMedia[] }>(`/api/v1/library/${id}/media`)
    sourceItems.value = data.items
    selectedIds.value = new Set()
  } catch {
    sourceItems.value = []
  } finally {
    loading.value = false
  }
})

function toggleItem(id: string) {
  const set = new Set(selectedIds.value)
  if (set.has(id)) set.delete(id)
  else set.add(id)
  selectedIds.value = set
}

function selectAll() {
  selectedIds.value = new Set(sourceItems.value.map(i => i.id))
}

async function confirm() {
  if (!selectedIds.value.size) return
  saving.value = true
  error.value  = ''
  try {
    await $fetch(`/api/v1/library/${activeLibraryId.value}/copy-from`, {
      method: 'POST',
      body: { mediaIds: Array.from(selectedIds.value) },
    })
    emit('update:open', false)
    await loadLibraryMedia(activeLibraryId.value)
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Failed to copy items'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="open" class="modal-backdrop">
        <div
          ref="panelEl"
          class="modal-panel copy-library-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Copy from library"
        >
          <div class="modal-header">
            <CopyIcon :size="18" class="modal-header-icon" />
            <h2 class="modal-title">Copy from library</h2>
            <button class="modal-close-btn" aria-label="Close" @click="emit('update:open', false)">
              <XIcon :size="16" />
            </button>
          </div>

          <div class="modal-body copy-modal-body">
            <!-- Source library selector -->
            <div class="copy-source-row">
              <label class="copy-source-label" for="copy-source">Source library</label>
              <select id="copy-source" v-model="sourceId" class="copy-source-select">
                <option v-if="!sourceOptions.length" value="" disabled>No other libraries</option>
                <option v-for="lib in sourceOptions" :key="lib.id" :value="lib.id">
                  {{ lib.name }}
                </option>
              </select>
              <button
                v-if="sourceItems.length"
                class="copy-select-all-btn"
                :disabled="selectedIds.size === sourceItems.length"
                @click="selectAll"
              >
                Select all
              </button>
            </div>

            <!-- Media grid -->
            <div v-if="loading" class="copy-grid-loading">Loading…</div>
            <div v-else-if="!sourceItems.length && sourceId" class="copy-grid-empty">
              This library is empty.
            </div>
            <div v-else class="copy-grid">
              <button
                v-for="item in sourceItems"
                :key="item.id"
                class="copy-grid-item"
                :class="{ 'is-selected': selectedIds.has(item.id) }"
                :aria-pressed="selectedIds.has(item.id)"
                @click="toggleItem(item.id)"
              >
                <img :src="item.src" :alt="item.originalFilename" draggable="false" />
                <div class="copy-grid-item-check">
                  <CheckIcon :size="12" />
                </div>
              </button>
            </div>

            <p v-if="error" class="form-error" style="margin-top: 10px;">{{ error }}</p>
          </div>

          <div class="modal-footer">
            <span class="copy-selection-count">
              {{ selectedIds.size ? `${selectedIds.size} selected` : '' }}
            </span>
            <button class="btn btn-ghost" :disabled="saving" @click="emit('update:open', false)">
              Cancel
            </button>
            <button
              class="btn btn-primary"
              :disabled="saving || selectedIds.size === 0"
              @click="confirm"
            >
              {{ saving ? 'Copying…' : 'Copy here' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.copy-library-panel {
  width: min(680px, 92vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.copy-modal-body {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.copy-source-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.copy-source-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.copy-source-select {
  flex: 1;
  min-width: 140px;
  padding: 6px 8px;
  border-radius: 7px;
  border: 1.5px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-primary);
  font-size: 13px;
  outline: none;
  cursor: pointer;
}

.copy-source-select:focus {
  border-color: var(--color-accent);
}

.copy-select-all-btn {
  font-size: 12px;
  color: var(--color-accent);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 5px;
  white-space: nowrap;
}

.copy-select-all-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.copy-select-all-btn:not(:disabled):hover {
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
}

.copy-grid-loading,
.copy-grid-empty {
  font-size: 13px;
  color: var(--color-text-muted);
  text-align: center;
  padding: 32px 0;
}

.copy-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 4px;
}

.copy-grid-item {
  position: relative;
  aspect-ratio: 1;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  padding: 0;
  border: 2.5px solid transparent;
  transition: border-color 0.12s;
  background: var(--color-skeleton-base, #222);
}

.copy-grid-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
  user-select: none;
}

.copy-grid-item-check {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--color-accent);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transform: scale(0.7);
  transition: opacity 0.12s, transform 0.12s;
}

.copy-grid-item.is-selected {
  border-color: var(--color-accent);
}

.copy-grid-item.is-selected img {
  opacity: 0.75;
}

.copy-grid-item.is-selected .copy-grid-item-check {
  opacity: 1;
  transform: scale(1);
}

.copy-selection-count {
  flex: 1;
  font-size: 13px;
  color: var(--color-text-muted);
}
</style>
