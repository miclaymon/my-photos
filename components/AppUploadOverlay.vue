<script setup lang="ts">
/**
 * Full-page drag target. Becomes visible when the user drags media files over
 * the window. Non-media files (documents, executables, etc.) are rejected with
 * a brief toast notification rather than silently ignored.
 */
const { overlayVisible, addFiles, startUploadDirect } = useUpload()
const { activeLibraryId } = useAppShell()

const shiftHeld = ref(false)

// Accepted MIME type prefixes
const ACCEPTED = ['image/', 'video/']

function isMediaFile(item: DataTransferItem | File) {
  const type = item.type
  return ACCEPTED.some(prefix => type.startsWith(prefix))
}

// During drag events, browsers only expose `type` for DataTransferItems
// (not for File objects until drop). We check what we can.
function dragHasMediaFiles(e: DragEvent) {
  const items = Array.from(e.dataTransfer?.items ?? [])
  return items.some(item => item.kind === 'file' && (
    !item.type || isMediaFile(item)   // empty type = OS file (allow, validate on drop)
  ))
}

let enterCount = 0   // track enter/leave pairs across nested elements
const rejectedCount = ref(0)
const rejectedVisible = ref(false)
let rejectedTimer = 0

function onDragEnter(e: DragEvent) {
  if (!dragHasMediaFiles(e)) return
  e.preventDefault()
  enterCount++
  overlayVisible.value = true
}

function onDragLeave() {
  enterCount--
  if (enterCount <= 0) {
    enterCount = 0
    overlayVisible.value = false
  }
}

function onDragOver(e: DragEvent) {
  if (!dragHasMediaFiles(e)) return
  e.preventDefault()
  shiftHeld.value = e.shiftKey
  e.dataTransfer!.dropEffect = 'copy'
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  enterCount = 0
  overlayVisible.value = false

  const all    = Array.from(e.dataTransfer?.files ?? [])
  const valid  = all.filter(isMediaFile)
  const invalid = all.length - valid.length

  if (invalid > 0) {
    rejectedCount.value   = invalid
    rejectedVisible.value = true
    clearTimeout(rejectedTimer)
    rejectedTimer = window.setTimeout(() => { rejectedVisible.value = false }, 3500)
  }

  if (valid.length) {
    if (e.shiftKey) {
      startUploadDirect([activeLibraryId.value], valid)
    } else {
      addFiles(valid)
    }
  }
}

function onKeyDown(e: KeyboardEvent) { if (e.key === 'Shift') shiftHeld.value = true }
function onKeyUp(e: KeyboardEvent)   { if (e.key === 'Shift') shiftHeld.value = false }

onMounted(() => {
  window.addEventListener('dragenter', onDragEnter)
  window.addEventListener('dragleave', onDragLeave)
  window.addEventListener('dragover',  onDragOver)
  window.addEventListener('drop',      onDrop)
  window.addEventListener('keydown',   onKeyDown)
  window.addEventListener('keyup',     onKeyUp)
})
onUnmounted(() => {
  window.removeEventListener('dragenter', onDragEnter)
  window.removeEventListener('dragleave', onDragLeave)
  window.removeEventListener('dragover',  onDragOver)
  window.removeEventListener('drop',      onDrop)
  window.removeEventListener('keydown',   onKeyDown)
  window.removeEventListener('keyup',     onKeyUp)
})
</script>

<template>
  <Teleport to="body">
    <!-- Drop-target overlay -->
    <Transition name="upload-overlay">
      <div v-if="overlayVisible" class="upload-overlay" aria-hidden="true">
        <div class="upload-overlay-inner">
          <svg class="upload-overlay-icon" width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <p class="upload-overlay-label">{{ shiftHeld ? 'Drop to upload here' : 'Drop to upload' }}</p>
          <p class="upload-overlay-sub">{{ shiftHeld ? 'Will upload to current library' : 'Photos and videos' }}</p>
          <p v-if="!shiftHeld" class="upload-overlay-hint">Hold <kbd>Shift</kbd> to skip library picker</p>
        </div>
      </div>
    </Transition>

    <!-- Rejection toast: shown when non-media files are dropped -->
    <Transition name="upload-overlay">
      <div v-if="rejectedVisible" class="upload-rejected" role="alert">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        {{ rejectedCount }} file{{ rejectedCount !== 1 ? 's' : '' }} skipped — photos and videos only
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.upload-overlay {
  position: fixed;
  inset: 0;
  z-index: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--color-accent) 25%, transparent);
  border: 3px dashed var(--color-accent);
  border-radius: 0;
  pointer-events: none;
}

.upload-overlay-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: var(--color-accent);
}

.upload-overlay-icon {
  opacity: 0.9;
}

.upload-overlay-label {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.upload-overlay-sub {
  font-size: 14px;
  opacity: 0.7;
}

.upload-overlay-hint {
  font-size: 12px;
  opacity: 0.55;
  margin-top: -4px;
}
.upload-overlay-hint kbd {
  font-family: 'Geist Mono', monospace;
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(255,255,255,0.15);
  border: 1px solid rgba(255,255,255,0.25);
}

/* Rejection toast */
.upload-rejected {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 520;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  background: #ef4444;
  color: #fff;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  box-shadow: 0 4px 16px rgba(0,0,0,0.22);
  white-space: nowrap;
}

/* Transition */
.upload-overlay-enter-active,
.upload-overlay-leave-active {
  transition: opacity 0.14s ease;
}

.upload-overlay-enter-from,
.upload-overlay-leave-to {
  opacity: 0;
}
</style>
