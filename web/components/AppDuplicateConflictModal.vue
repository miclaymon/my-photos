<script setup lang="ts">
/**
 * Duplicate conflict resolution modal.
 *
 * Shown when the client-side hash check finds that one or more files being
 * uploaded already exist in the library. Lets the user choose per-file:
 *
 *   Keep existing — skip upload.
 *   Overwrite     — delete old object + record, upload new (⚠ removes from all libraries).
 *   New version   — upload as v2; version pointer updated in DB.
 */
import { XIcon, AlertTriangleIcon } from 'lucide-vue-next'
import type { DuplicateConflict, DuplicateResolution } from '~/composables/useUpload'

const { duplicateConflicts, conflictResolveOpen, resolveConflictsAndUpload, dismissConflicts } = useUpload()

// Local mutable copy of resolutions — synced back on confirm
const localResolutions = ref<Map<string, DuplicateResolution>>(new Map())

watch(conflictResolveOpen, (open) => {
  if (open) {
    const m = new Map<string, DuplicateResolution>()
    for (const c of duplicateConflicts.value) {
      m.set(c.uploadFile.id, 'keep')
    }
    localResolutions.value = m
  }
})

function setResolution(conflict: DuplicateConflict, resolution: DuplicateResolution) {
  localResolutions.value = new Map(localResolutions.value).set(conflict.uploadFile.id, resolution)
}

function getResolution(conflict: DuplicateConflict): DuplicateResolution {
  return localResolutions.value.get(conflict.uploadFile.id) ?? 'keep'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024)       return `${bytes} B`
  if (bytes < 1048576)    return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function formatDate(iso?: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

async function confirm() {
  await resolveConflictsAndUpload(new Map(localResolutions.value))
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="conflictResolveOpen" class="modal-backdrop conflict-backdrop">
        <div class="modal-panel conflict-panel" role="dialog" aria-modal="true" aria-label="Duplicate files found">

          <div class="modal-header">
            <AlertTriangleIcon :size="18" class="modal-header-icon" style="color: var(--color-warning, #f59e0b)" />
            <h2 class="modal-title">
              {{ duplicateConflicts.length === 1 ? 'Duplicate file found' : `${duplicateConflicts.length} duplicate files found` }}
            </h2>
            <button class="modal-close-btn" aria-label="Dismiss" @click="dismissConflicts">
              <XIcon :size="16" />
            </button>
          </div>

          <div class="modal-body conflict-body">
            <div
              v-for="conflict in duplicateConflicts"
              :key="conflict.uploadFile.id"
              class="conflict-item"
            >
              <!-- Thumbnails row -->
              <div class="conflict-thumbs">
                <div class="conflict-thumb-wrap">
                  <img
                    v-if="conflict.existing.thumbnailSrc"
                    :src="conflict.existing.thumbnailSrc"
                    class="conflict-thumb"
                    alt="Existing file"
                  />
                  <div v-else class="conflict-thumb conflict-thumb-placeholder" />
                  <span class="conflict-thumb-label">Existing</span>
                </div>

                <div class="conflict-arrow">→</div>

                <div class="conflict-thumb-wrap">
                  <!-- New file — no preview available (binary never passes through server) -->
                  <div class="conflict-thumb conflict-thumb-placeholder conflict-thumb-new" />
                  <span class="conflict-thumb-label">New</span>
                </div>
              </div>

              <!-- File info -->
              <div class="conflict-info">
                <div class="conflict-info-row">
                  <span class="conflict-info-key">File</span>
                  <span class="conflict-info-val">{{ conflict.existing.originalFilename }}</span>
                </div>
                <div class="conflict-info-row">
                  <span class="conflict-info-key">Existing size</span>
                  <span class="conflict-info-val">{{ formatBytes(conflict.existing.size) }}</span>
                </div>
                <div class="conflict-info-row">
                  <span class="conflict-info-key">New size</span>
                  <span class="conflict-info-val">{{ formatBytes(conflict.uploadFile.file.size) }}</span>
                </div>
                <div class="conflict-info-row">
                  <span class="conflict-info-key">Date taken</span>
                  <span class="conflict-info-val">{{ formatDate(conflict.existing.takenAt) }}</span>
                </div>
                <div v-if="conflict.existing.width && conflict.existing.height" class="conflict-info-row">
                  <span class="conflict-info-key">Dimensions</span>
                  <span class="conflict-info-val">{{ conflict.existing.width }} × {{ conflict.existing.height }}</span>
                </div>
              </div>

              <!-- Resolution options -->
              <div class="conflict-options" role="radiogroup" :aria-label="`Resolution for ${conflict.existing.originalFilename}`">
                <label
                  v-for="opt in ([
                    { value: 'keep',      label: 'Keep existing',  hint: 'Skip uploading this file' },
                    { value: 'overwrite', label: 'Overwrite',      hint: 'Removes from all libraries ⚠' },
                    { value: 'version',   label: 'New version',    hint: 'Adds as v2 of the existing record' },
                  ] as const)"
                  :key="opt.value"
                  class="conflict-option"
                  :class="{ 'is-selected': getResolution(conflict) === opt.value }"
                >
                  <input
                    type="radio"
                    :name="`conflict-${conflict.uploadFile.id}`"
                    :value="opt.value"
                    :checked="getResolution(conflict) === opt.value"
                    @change="setResolution(conflict, opt.value)"
                  />
                  <span class="conflict-option-label">{{ opt.label }}</span>
                  <span class="conflict-option-hint">{{ opt.hint }}</span>
                </label>
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-ghost" @click="dismissConflicts">Cancel</button>
            <button class="btn btn-primary" @click="confirm">Continue upload</button>
          </div>

        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.conflict-backdrop {
  z-index: 260;
}

.conflict-panel {
  width: 520px;
  max-height: calc(100dvh - 48px);
  display: flex;
  flex-direction: column;
}

.conflict-body {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* One conflict item */
.conflict-item {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface-raised, var(--color-surface));
}

/* Thumbnails */
.conflict-thumbs {
  display: flex;
  align-items: center;
  gap: 10px;
}

.conflict-thumb-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  flex: 1;
}

.conflict-thumb {
  width: 100%;
  aspect-ratio: 4/3;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: var(--color-skeleton-base);
}

.conflict-thumb-placeholder {
  background: var(--color-skeleton-base);
}

.conflict-thumb-new {
  border: 1.5px dashed var(--color-accent);
}

.conflict-thumb-label {
  font-size: 11px;
  color: var(--color-text-muted);
  font-weight: 500;
}

.conflict-arrow {
  font-size: 18px;
  color: var(--color-text-muted);
  flex-shrink: 0;
}

/* Info table */
.conflict-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.conflict-info-row {
  display: flex;
  gap: 8px;
  font-size: 12px;
}

.conflict-info-key {
  color: var(--color-text-muted);
  min-width: 90px;
  flex-shrink: 0;
}

.conflict-info-val {
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Resolution radio options */
.conflict-options {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.conflict-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 7px;
  border: 1.5px solid var(--color-border);
  cursor: pointer;
  transition: border-color 0.1s, background 0.1s;
}

.conflict-option input[type="radio"] {
  flex-shrink: 0;
  accent-color: var(--color-accent);
}

.conflict-option.is-selected {
  border-color: var(--color-accent);
  background: var(--color-accent-subtle);
}

.conflict-option-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-primary);
  flex-shrink: 0;
}

.conflict-option-hint {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-left: auto;
}
</style>
