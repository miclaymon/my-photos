<script setup lang="ts">
import { XIcon, CheckIcon, AlertCircleIcon, UploadCloudIcon, MinusIcon } from 'lucide-vue-next'

const { activeFiles, totalProgress, toastVisible, hasActive, dismissToast } = useUpload()

const doneCount   = computed(() => activeFiles.value.filter(f => f.status === 'done').length)
const errorCount  = computed(() => activeFiles.value.filter(f => f.status === 'error').length)
const uploadCount = computed(() => activeFiles.value.length)
const allDone     = computed(() => !hasActive.value && !errorCount.value)

const isMinimized = ref(false)

// Auto-expand if all done (so user sees the completion state)
watch(allDone, (done) => { if (done) isMinimized.value = false })
</script>

<template>
  <Teleport to="body">
    <Transition name="upload-toast">
      <div
        v-if="toastVisible"
        class="upload-toast"
        :class="{ 'upload-toast--minimized': isMinimized }"
        role="status"
        aria-live="polite"
      >
        <!-- Minimized pill — click to restore -->
        <button v-if="isMinimized" class="upload-toast-pill" @click="isMinimized = false">
          <UploadCloudIcon :size="14" class="upload-toast-icon" />
          <div class="upload-toast-pill-bar-track">
            <div class="upload-toast-pill-bar-fill" :style="{ width: totalProgress + '%' }" />
          </div>
          <span class="upload-toast-pill-label">{{ doneCount }}/{{ uploadCount }}</span>
        </button>

        <!-- Full view -->
        <template v-else>
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
            <!-- Minimize (only while active) -->
            <button
              v-if="hasActive"
              class="upload-toast-close"
              aria-label="Minimize"
              @click="isMinimized = true"
            >
              <MinusIcon :size="13" />
            </button>
            <!-- Dismiss (when done) -->
            <button
              v-else
              class="upload-toast-close"
              aria-label="Dismiss"
              @click="dismissToast"
            >
              <XIcon :size="13" />
            </button>
          </div>

          <!-- Progress bar (only while uploading) -->
          <div v-if="hasActive" class="upload-toast-bar-track">
            <div class="upload-toast-bar-fill" :style="{ width: totalProgress + '%' }" />
          </div>

          <!-- File list -->
          <ul class="upload-toast-files">
            <li
              v-for="f in activeFiles"
              :key="f.id"
              class="upload-toast-file"
              :class="`is-${f.status}`"
            >
              <div class="upload-toast-thumb">
                <img v-if="f.thumbnailUrl" :src="f.thumbnailUrl" alt="" class="upload-toast-thumb-img" />
                <div v-else class="upload-toast-thumb-shimmer" />
              </div>
              <span class="upload-toast-file-name">{{ f.file.name }}</span>
              <span class="upload-toast-file-state">
                <CheckIcon v-if="f.status === 'done'" :size="12" />
                <AlertCircleIcon
                  v-else-if="f.status === 'error'"
                  :size="12"
                  class="upload-toast-error-icon"
                  :title="f.error ?? 'Unknown error'"
                />
                <span v-else class="upload-toast-file-spinner" />
              </span>
            </li>
          </ul>
        </template>
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

/* Thumbnail */
.upload-toast-thumb {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 4px;
  overflow: hidden;
  background: var(--color-surface-raised);
}

.upload-toast-thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.upload-toast-thumb-shimmer {
  width: 100%;
  height: 100%;
  background: linear-gradient(
    90deg,
    var(--color-surface-raised) 25%,
    color-mix(in srgb, var(--color-text-primary) 8%, transparent) 50%,
    var(--color-surface-raised) 75%
  );
  background-size: 200% 100%;
  animation: toast-shimmer 1.4s ease-in-out infinite;
}

@keyframes toast-shimmer {
  0%   { background-position: 200% center; }
  100% { background-position: -200% center; }
}

/* Inline spinner for hashing/dupecheck/thumbnailing phases */
.upload-toast-file-spinner {
  display: inline-block;
  width: 11px;
  height: 11px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: toast-spin 0.7s linear infinite;
}

@keyframes toast-spin {
  to { transform: rotate(360deg); }
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

.upload-toast-error-icon {
  cursor: help;
}

.upload-toast-file-pct {
  font-family: 'Geist Mono', monospace;
  font-size: 11px;
  color: var(--color-accent);
}

/* Minimized pill */
.upload-toast--minimized {
  width: auto;
  min-width: 160px;
  max-width: 260px;
  border-radius: 999px;
  overflow: visible;
}

.upload-toast-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  width: 100%;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-primary);
}

.upload-toast-pill-bar-track {
  flex: 1;
  height: 4px;
  background: var(--color-border);
  border-radius: 2px;
  overflow: hidden;
}

.upload-toast-pill-bar-fill {
  height: 100%;
  background: var(--color-accent);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.upload-toast-pill-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary);
  white-space: nowrap;
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
