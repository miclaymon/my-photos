<script setup lang="ts">
/**
 * Modal shown after files are dropped.
 * User selects which libraries to add the uploads to, then confirms.
 */
import { CheckIcon, XIcon, UploadIcon } from 'lucide-vue-next'
import { onClickOutside } from '@vueuse/core'

const { pendingFiles, pickerOpen, cancelStaged, startUpload } = useUpload()
const { libraries, fetchLibraries }                            = useLibraries()
const { activeLibraryId }                                      = useAppShell()

const panelEl     = ref<HTMLElement | null>(null)
const selectedIds = ref<Set<string>>(new Set())

onClickOutside(panelEl, () => cancelStaged())

// When the picker opens, fetch the live library list and pre-select the active library
watch(pickerOpen, async (open) => {
  if (!open) return
  await fetchLibraries()
  selectedIds.value = new Set([activeLibraryId.value])
})

function toggle(id: string) {
  if (selectedIds.value.has(id)) {
    selectedIds.value.delete(id)
  } else {
    selectedIds.value.add(id)
  }
  // Force Vue reactivity on Set mutation
  selectedIds.value = new Set(selectedIds.value)
}

function confirm() {
  if (!selectedIds.value.size) return
  startUpload(Array.from(selectedIds.value))
}

const fileCount = computed(() => pendingFiles.value.length)
const totalSize = computed(() => {
  const bytes = pendingFiles.value.reduce((acc, f) => acc + f.file.size, 0)
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
})
</script>

<template>
  <Teleport to="body">
    <Transition name="library-picker">
      <div v-if="pickerOpen" class="library-picker-backdrop">
        <div ref="panelEl" class="library-picker-panel" role="dialog" aria-modal="true" aria-label="Choose libraries">
          <!-- Header -->
          <div class="library-picker-header">
            <span class="library-picker-title">Add to library</span>
            <button class="library-picker-close" aria-label="Cancel" @click="cancelStaged">
              <XIcon :size="16" />
            </button>
          </div>

          <!-- File summary -->
          <p class="library-picker-summary">
            {{ fileCount }} {{ fileCount === 1 ? 'file' : 'files' }} · {{ totalSize }}
          </p>

          <!-- Library list -->
          <ul class="library-picker-list" role="listbox" aria-multiselectable="true">
            <li
              v-for="lib in libraries"
              :key="lib.id"
              class="library-picker-item"
              :class="{ 'is-selected': selectedIds.has(lib.id) }"
              role="option"
              :aria-selected="selectedIds.has(lib.id)"
              @click="toggle(lib.id)"
            >
              <span class="library-picker-item-check">
                <CheckIcon v-if="selectedIds.has(lib.id)" :size="13" />
              </span>
              <span class="library-picker-item-name">{{ lib.name }}</span>
              <span class="library-picker-item-type">{{ lib.type }}</span>
            </li>
          </ul>

          <!-- Actions -->
          <div class="library-picker-actions">
            <button class="library-picker-btn-cancel" @click="cancelStaged">Cancel</button>
            <button
              class="library-picker-btn-confirm"
              :disabled="selectedIds.size === 0"
              @click="confirm"
            >
              <UploadIcon :size="14" />
              Upload
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.library-picker-backdrop {
  position: fixed;
  inset: 0;
  z-index: 510;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
}

.library-picker-panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 14px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.2);
  width: min(380px, 90vw);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.library-picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 16px 0;
}

.library-picker-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.library-picker-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.library-picker-close:hover {
  background: var(--color-hover);
  color: var(--color-text-primary);
}

.library-picker-summary {
  padding: 6px 16px 12px;
  font-size: 12px;
  color: var(--color-text-muted);
  font-family: 'Geist Mono', monospace;
}

.library-picker-list {
  list-style: none;
  padding: 0 8px;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.library-picker-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.1s;
  color: var(--color-text-primary);
}

.library-picker-item:hover {
  background: var(--color-hover);
}

.library-picker-item.is-selected {
  background: color-mix(in srgb, var(--color-accent) 12%, transparent);
}

.library-picker-item-check {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--color-accent);
  transition: background 0.1s, border-color 0.1s;
}

.library-picker-item.is-selected .library-picker-item-check {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: #fff;
}

.library-picker-item-name {
  flex: 1;
  font-size: 14px;
}

.library-picker-item-type {
  font-size: 11px;
  color: var(--color-text-muted);
  font-family: 'Geist Mono', monospace;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.library-picker-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 16px;
  border-top: 1px solid var(--color-border);
  margin-top: 8px;
}

.library-picker-btn-cancel {
  padding: 7px 14px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.1s;
}

.library-picker-btn-cancel:hover {
  background: var(--color-hover);
}

.library-picker-btn-confirm {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 16px;
  border-radius: 8px;
  border: none;
  background: var(--color-accent);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.12s;
}

.library-picker-btn-confirm:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.library-picker-btn-confirm:not(:disabled):hover {
  opacity: 0.88;
}

/* Transition */
.library-picker-enter-active,
.library-picker-leave-active {
  transition: opacity 0.18s ease;
}

.library-picker-enter-active .library-picker-panel,
.library-picker-leave-active .library-picker-panel {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.library-picker-enter-from,
.library-picker-leave-to {
  opacity: 0;
}

.library-picker-enter-from .library-picker-panel,
.library-picker-leave-to .library-picker-panel {
  opacity: 0;
  transform: scale(0.96) translateY(8px);
}
</style>
