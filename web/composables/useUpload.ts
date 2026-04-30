/**
 * Upload composable — delegates all heavy work to the upload Service Worker.
 *
 * Flow:
 *   1. Files are staged → addFiles() / drag → startUpload(libraryIds) → posts ADD_JOBS to SW
 *   2. SW broadcasts progress events via BroadcastChannel('upload')
 *   3. This composable listens and keeps reactive UI state in sync
 *   4. On page load, GET_STATE syncs any in-progress jobs from a previous session
 *
 * Gallery integration:
 *   METADATA_READY  → add shimmer provisional item at the correct date position
 *   THUMBNAIL_READY → update provisional item with the client-generated blob thumbnail
 *   COMPLETE        → promote provisional item (mark non-provisional, trigger gallery refresh)
 */

import {
  addProvisionalItem,
  updateProvisionalItem,
  promoteProvisionalItem,
  registerBlobUrl,
} from '~/composables/useGalleryData'

// ── Types ─────────────────────────────────────────────────────────────────────

export type UploadStatus =
  | 'queued' | 'hashing' | 'dupecheck' | 'conflict'
  | 'thumbnailing' | 'waiting' | 'uploading' | 'notifying'
  | 'done' | 'error' | 'skipped'

export interface UploadFile {
  id:            string
  file:          File
  progress:      number
  status:        UploadStatus
  error?:        string
  thumbnailUrl?: string   // client-generated blob URL (shown in toast)
}

export interface DuplicateInfo {
  hash:             string
  id:               string
  originalFilename: string
  contentType:      string
  size:             number
  width?:           number
  height?:          number
  takenAt?:         string
  thumbnailSrc?:    string
}

export type DuplicateResolution = 'keep' | 'overwrite' | 'version'

export interface DuplicateConflict {
  uploadFile: UploadFile
  existing:   DuplicateInfo
}

// ── Module-level singletons ───────────────────────────────────────────────────

const pendingFiles       = ref<UploadFile[]>([])
const activeFiles        = ref<UploadFile[]>([])
const overlayVisible     = ref(false)
const pickerOpen         = ref(false)
const duplicateConflicts = ref<DuplicateConflict[]>([])
const conflictResolveOpen = ref(false)

// Track which provisional item IDs we've added to the gallery (so we don't
// add them again if STATE_SYNC arrives after a page refresh)
const provisionalIds = new Set<string>()

// Blob URLs for client thumbnails — revoke when the job is done
const _thumbUrls = new Map<string, string>()

const hasActive = computed(() =>
  activeFiles.value.some(f =>
    f.status !== 'done' && f.status !== 'error' && f.status !== 'skipped',
  ),
)

const totalProgress = computed(() => {
  const files = activeFiles.value.filter(f => f.status !== 'error' && f.status !== 'skipped')
  if (!files.length) return 0
  return Math.round(files.reduce((a, f) => a + f.progress, 0) / files.length)
})

const toastVisible = computed(() =>
  activeFiles.value.length > 0 &&
  activeFiles.value.some(f => f.status !== 'done' && f.status !== 'skipped'),
)

// ── SW channel setup (client-side only) ──────────────────────────────────────

let _channel: BroadcastChannel | null = null

function getChannel(): BroadcastChannel {
  if (!_channel) {
    _channel = new BroadcastChannel('upload')
    _channel.addEventListener('message', onSWMessage)
  }
  return _channel
}

function postToSW(msg: unknown) {
  getChannel().postMessage(msg)
}

function onSWMessage(e: MessageEvent) {
  const msg = e.data as {
    type: string
    id?: string
    jobs?: unknown[]
    conflicts?: unknown[]
    takenAt?: string | null
    width?: number
    height?: number
    aspectRatio?: number
    thumbnail?: ArrayBuffer
    mimeType?: string
    progress?: number
    mediaId?: string
    error?: string
  }

  switch (msg.type) {
    case 'JOB_ADDED': {
      // Jobs were acknowledged by the SW — already in activeFiles (added by startUpload)
      break
    }

    case 'STATE_SYNC': {
      // Re-sync after page refresh: restore in-progress jobs into activeFiles
      const jobs = (msg.jobs ?? []) as Array<{
        id: string; filename?: string; status: UploadStatus; progress: number
        error?: string; mediaId?: string
      }>
      for (const job of jobs) {
        if (job.status === 'skipped') continue

        // For completed jobs: if we still have a provisional in the gallery (COMPLETE
        // event was missed while the page was unloaded), promote it now.
        if (job.status === 'done') {
          if (provisionalIds.has(job.id) && job.mediaId) {
            const thumbUrl = _thumbUrls.get(job.id)
            if (thumbUrl) registerBlobUrl(job.mediaId, thumbUrl)
            updateProvisionalItem(job.id, { id: job.mediaId })
            promoteProvisionalItem(job.mediaId)
            provisionalIds.delete(job.id)
            const { activeLibraryId } = useAppShell()
            const { loadLibraryMedia } = useGalleryData()
            loadLibraryMedia(activeLibraryId.value)
          }
          continue
        }

        // For error jobs: clear any stuck gallery provisional (ERROR event may have
        // been missed if the page was reloading when the SW broadcast it).
        if (job.status === 'error' && provisionalIds.has(job.id)) {
          updateProvisionalItem(job.id, { isProvisional: false, src: undefined })
          provisionalIds.delete(job.id)
        }

        const existing = activeFiles.value.find(f => f.id === job.id)
        if (!existing) {
          activeFiles.value.push({
            id:       job.id,
            file:     new File([], job.filename ?? ''),
            progress: job.progress,
            status:   job.status,
            error:    job.error,
          })
        } else {
          existing.status   = job.status
          existing.progress = job.progress
        }
      }
      break
    }

    case 'METADATA_READY': {
      const { id, takenAt, width, height, aspectRatio } = msg as {
        id: string; takenAt: string | null; width: number; height: number; aspectRatio: number
      }
      const uf = activeFiles.value.find(f => f.id === id)

      // Add a shimmer provisional item to the gallery at the correct date position
      if (!provisionalIds.has(id)) {
        provisionalIds.add(id)
        const { activeLibraryId } = useAppShell()
        const libraryId = activeLibraryId.value
        if (libraryId && takenAt) {
          addProvisionalItem({
            id,
            originalFilename: uf?.file.name ?? '',
            aspectRatio:      aspectRatio || 1.5,
            width:            width  || Math.round((aspectRatio || 1.5) >= 1 ? 1200 : 800),
            height:           height || Math.round((aspectRatio || 1.5) >= 1 ? 800 : 1200),
            takenAt:          takenAt,
            isVideo:          uf ? uf.file.type.startsWith('video/') : false,
            src:              undefined,   // no thumbnail yet — tile shows shimmer fallback
            isProvisional:    true,
          })
        }
      }
      break
    }

    case 'THUMBNAIL_READY': {
      const { id, thumbnail, mimeType } = msg as {
        id: string; thumbnail: ArrayBuffer; mimeType: string
      }
      // Create a blob URL from the transferred ArrayBuffer
      const blob   = new Blob([thumbnail], { type: mimeType })
      const blobUrl = URL.createObjectURL(blob)

      // Register for deferred revocation
      const prev = _thumbUrls.get(id)
      if (prev) URL.revokeObjectURL(prev)
      _thumbUrls.set(id, blobUrl)

      // Show thumbnail in toast
      const uf = activeFiles.value.find(f => f.id === id)
      if (uf) uf.thumbnailUrl = blobUrl

      // Update gallery provisional item with the client thumbnail
      updateProvisionalItem(id, { src: blobUrl })
      break
    }

    case 'PROGRESS': {
      const uf = activeFiles.value.find(f => f.id === msg.id)
      if (uf) {
        uf.progress = msg.progress ?? 0
        uf.status   = 'uploading'
      }
      break
    }

    case 'COMPLETE': {
      const { id, mediaId } = msg as { id: string; mediaId: string }
      const uf = activeFiles.value.find(f => f.id === id)
      if (uf) {
        uf.progress = 100
        uf.status   = 'done'
      }

      // Keep blob thumbnail alive as the provisional item's src (until server thumbnail arrives)
      const thumbUrl = _thumbUrls.get(id)
      if (thumbUrl) registerBlobUrl(mediaId, thumbUrl)

      // Rename the provisional item to use the real mediaId so gallery can match it
      updateProvisionalItem(id, { id: mediaId })
      promoteProvisionalItem(mediaId)
      provisionalIds.delete(id)

      // Refresh gallery so the server item replaces the provisional
      const { activeLibraryId } = useAppShell()
      const { loadLibraryMedia } = useGalleryData()
      loadLibraryMedia(activeLibraryId.value)
      break
    }

    case 'ERROR': {
      const uf = activeFiles.value.find(f => f.id === msg.id)
      if (uf) {
        uf.status = 'error'
        uf.error  = msg.error
      }
      console.error('[upload] error for', uf?.file.name ?? msg.id, '—', msg.error)
      provisionalIds.delete(msg.id!)
      // Remove the shimmer from the gallery on error
      updateProvisionalItem(msg.id!, { isProvisional: false, src: undefined })
      break
    }

    case 'CONFLICT': {
      type ConflictRaw = { jobId: string; existing: DuplicateInfo }
      const rawConflicts = (msg.conflicts ?? []) as ConflictRaw[]
      const conflicts: DuplicateConflict[] = rawConflicts.map(c => ({
        uploadFile: activeFiles.value.find(f => f.id === c.jobId) ?? {
          id: c.jobId, file: new File([], ''), progress: 0, status: 'conflict' as UploadStatus,
        },
        existing: c.existing,
      }))
      duplicateConflicts.value  = conflicts
      conflictResolveOpen.value = true
      break
    }
  }
}

// Initialize the BroadcastChannel and request state sync on client
if (import.meta.client) {
  // Open channel immediately so we don't miss early SW broadcasts
  getChannel()
  // Ask the SW for any in-progress jobs (handles page refresh recovery)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(() => {
      postToSW({ type: 'GET_STATE' })
    })
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function useUpload() {
  function addFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter(f =>
      f.type.startsWith('image/') || f.type.startsWith('video/'),
    )
    if (!files.length) return

    pendingFiles.value = files.map(file => ({
      id: crypto.randomUUID(), file, progress: 0, status: 'pending' as UploadStatus,
    }))
    pickerOpen.value = true
  }

  function cancelStaged() {
    pendingFiles.value   = []
    pickerOpen.value     = false
    overlayVisible.value = false
  }

  async function startUpload(libraryIds: string[]) {
    if (!pendingFiles.value.length) return

    const batch = pendingFiles.value.slice()
    pendingFiles.value   = []
    pickerOpen.value     = false
    overlayVisible.value = false

    _dispatchJobs(batch, libraryIds)
  }

  async function startUploadDirect(libraryIds: string[], fileList: FileList | File[]) {
    const files = Array.from(fileList).filter(f =>
      f.type.startsWith('image/') || f.type.startsWith('video/'),
    )
    if (!files.length) return
    const batch: UploadFile[] = files.map(file => ({
      id: crypto.randomUUID(), file, progress: 0, status: 'pending' as UploadStatus,
    }))
    _dispatchJobs(batch, libraryIds)
  }

  function resolveConflictsAndUpload(resolutions: Map<string, DuplicateResolution>) {
    const resolvedConflicts = duplicateConflicts.value.slice()
    duplicateConflicts.value  = []
    conflictResolveOpen.value = false

    const swResolutions = resolvedConflicts.map(c => {
      const res = resolutions.get(c.uploadFile.id) ?? 'keep'
      return {
        id:         c.uploadFile.id,
        resolution: res,
        existingId: c.existing.id,
      }
    })

    postToSW({ type: 'RESOLVE_CONFLICTS', resolutions: swResolutions })
  }

  function dismissConflicts() {
    // Treat all conflicts as 'keep' (skip)
    resolveConflictsAndUpload(new Map())
    duplicateConflicts.value  = []
    conflictResolveOpen.value = false
  }

  function dismissToast() {
    activeFiles.value = activeFiles.value.filter(
      f => f.status !== 'done' && f.status !== 'skipped' && f.status !== 'error',
    )
    postToSW({ type: 'CLEAR_DONE' })
  }

  return {
    pendingFiles:         readonly(pendingFiles),
    activeFiles:          readonly(activeFiles),
    overlayVisible,
    pickerOpen,
    hasActive,
    totalProgress,
    toastVisible,
    duplicateConflicts:   readonly(duplicateConflicts),
    conflictResolveOpen:  readonly(conflictResolveOpen),
    addFiles,
    cancelStaged,
    startUpload,
    startUploadDirect,
    resolveConflictsAndUpload,
    dismissConflicts,
    dismissToast,
  }
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _dispatchJobs(batch: UploadFile[], libraryIds: string[]) {
  // Add to activeFiles immediately so the toast appears
  for (const uf of batch) {
    uf.status = 'queued'
    activeFiles.value.push(uf)
  }

  // Send File objects + metadata to the SW via BroadcastChannel
  postToSW({
    type: 'ADD_JOBS',
    jobs: batch.map(uf => ({
      id:         uf.id,
      file:       uf.file,
      libraryIds,
    })),
  })
}
