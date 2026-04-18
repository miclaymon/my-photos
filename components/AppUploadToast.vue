<script setup lang="ts">
/**
 * Persistent bottom-right progress toast.
 * Shows while uploads are in progress; dismissible once all are done.
 */
import { XIcon, CheckIcon, AlertCircleIcon, UploadCloudIcon } from 'lucide-vue-next'

const { activeFiles, totalProgress, toastVisible, hasActive, dismissToast } = useUpload()

const doneCount    = computed(() => activeFiles.value.filter(f => f.status === 'done').length)
const errorCount   = computed(() => activeFiles.value.filter(f => f.status === 'error').length)
const uploadCount  = computed(() => activeFiles.value.length)
const allDone      = computed(() => !hasActive.value && !errorCount.value)
</script>

<template>
  <Teleport to="body">
    <Transition name="upload-toast">
      <div v-if="toastVisible" class="upload-toast" role="status" aria-live="polite">
        <!-- Header row -->
        <div class="upload-toast-header">
          <UploadCloudIcon :size="16" class="upload-toast-icon" />
          <span class="upload-toast-title">
            <template v-if="allDone">Upload complete</template>
            <template v-else-if="errorCount && !hasActive">
              {{ errorCount }} failed
            </template>
            <template v-else>
              Uploading {{ doneCount }} / {{ uploadCount }}…
            </template>
          </span>
          <button
            v-if="!hasActive"
            class="upload-toast-close"
            aria-label="Dismiss"
            @click="dismissToast"
          >
            <XIcon :size="13" />
          </button>
        </div>

        <!-- Progress bar (only while uploading) -->
        <div v-if="hasActive" class="upload-toast-bar-track">
          <div
            class="upload-toast-bar-fill"
            :style="{ width: totalProgress + '%' }"
          />
        </div>

        <!-- File list (collapsed to 4 rows max) -->
        <ul class="upload-toast-files">
          <li
            v-for="f in activeFiles"
            :key="f.id"
            class="upload-toast-file"
            :class="`is-${f.status}`"
          >
            <span class="upload-toast-file-name">{{ f.file.name }}</span>
            <span class="upload-toast-file-state">
              <CheckIcon v-if="f.status === 'done'" :size="12" />
              <AlertCircleIcon v-else-if="f.status === 'error'" :size="12" />
              <span v-else-if="f.status === 'uploading'" class="upload-toast-file-pct">
                {{ f.progress }}%
              </span>
            </span>
          </li>
        </ul>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.upload-toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 450;
  width: 300px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.upload-toast-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 12px 10px;
}

.upload-toast-icon {
  color: var(--color-accent);
  flex-shrink: 0;
}

.upload-toast-title {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.upload-toast-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}

.upload-toast-close:hover {
  background: var(--color-hover);
  color: var(--color-text-primary);
}

/* Progress bar */
.upload-toast-bar-track {
  height: 3px;
  background: var(--color-border);
  margin: 0 12px 10px;
  border-radius: 2px;
  overflow: hidden;
}

.upload-toast-bar-fill {
  height: 100%;
  background: var(--color-accent);
  border-radius: 2px;
  transition: width 0.3s ease;
}

/* File list */
.upload-toast-files {
  list-style: none;
  padding: 0 0 8px;
  margin: 0;
  display: flex;
  flex-direction: column;
  max-height: 160px;
  overflow-y: auto;
}

.upload-toast-file {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.upload-toast-file-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.upload-toast-file-state {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.upload-toast-file.is-done .upload-toast-file-state {
  color: #22c55e;
}

.upload-toast-file.is-error .upload-toast-file-state {
  color: #ef4444;
}

.upload-toast-file-pct {
  font-family: 'Geist Mono', monospace;
  font-size: 11px;
  color: var(--color-accent);
}

/* Transition */
.upload-toast-enter-active,
.upload-toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.upload-toast-enter-from,
.upload-toast-leave-to {
  opacity: 0;
  transform: translateY(12px);
}
</style>
