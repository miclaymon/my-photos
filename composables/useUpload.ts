import { gallerySections } from '~/composables/useGalleryData'

/**
 * Upload state management.
 *
 * Flow:
 *   1. Files are dragged/dropped → addFiles() stages them.
 *   2. User picks libraries in AppLibraryPicker → startUpload(libraryIds) begins.
 *   3. For each file: request a presigned PUT URL from the API, then PUT directly
 *      to RustFS; update progress via XHR upload events.
 *   4. On completion, notify the API so it can record metadata in the DB.
 */

export type UploadStatus = 'pending' | 'uploading' | 'done' | 'error'

export interface UploadFile {
  id:       string
  file:     File
  progress: number   // 0–100
  status:   UploadStatus
  error?:   string
  /** SHA-256 hex digest — computed before upload for duplicate detection */
  hash?:                   string
  /** If this is a resolved conflict, the chosen resolution */
  _conflictResolution?:    DuplicateResolution
  /** Existing media ID targeted by overwrite/version resolution */
  _conflictExistingId?:    string
}

// ── Duplicate detection types ─────────────────────────────────────────────────

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

// ── Module-level singletons shared across all component instances ─────────────

const pendingFiles      = ref<UploadFile[]>([])        // staged, awaiting library choice
const activeFiles       = ref<UploadFile[]>([])        // currently uploading / recently done
const overlayVisible    = ref(false)                   // drag-over overlay
const pickerOpen        = ref(false)                   // library picker modal
const duplicateConflicts = ref<DuplicateConflict[]>([]) // pending conflict resolutions
const conflictResolveOpen = ref(false)

// Derived helpers
const hasActive = computed(() =>
  activeFiles.value.some(f => f.status === 'uploading' || f.status === 'pending'),
)
const totalProgress = computed(() => {
  const files = activeFiles.value.filter(f => f.status !== 'error')
  if (!files.length) return 0
  return Math.round(files.reduce((acc, f) => acc + f.progress, 0) / files.length)
})
const toastVisible = computed(() =>
  activeFiles.value.length > 0 &&
  activeFiles.value.some(f => f.status !== 'done'),
)

// ── Public API ────────────────────────────────────────────────────────────────

export function useUpload() {
  function addFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter(f =>
      f.type.startsWith('image/') || f.type.startsWith('video/'),
    )
    if (!files.length) return

    pendingFiles.value = files.map(file => ({
      id:       crypto.randomUUID(),
      file,
      progress: 0,
      status:   'pending' as UploadStatus,
    }))
    pickerOpen.value = true
  }

  function cancelStaged() {
    pendingFiles.value = []
    pickerOpen.value   = false
    overlayVisible.value = false
  }

  async function startUpload(libraryIds: string[]) {
    if (!pendingFiles.value.length) return

    const batch = pendingFiles.value.slice()
    pendingFiles.value   = []
    pickerOpen.value     = false
    overlayVisible.value = false

    // 1. Hash all files in parallel
    await Promise.all(batch.map(async (uf) => {
      uf.hash = await computeHash(uf.file)
    }))

    // 2. Check for duplicates server-side
    const hashes = batch.map(uf => uf.hash).filter(Boolean) as string[]
    const { duplicates } = await $fetch<{ duplicates: DuplicateInfo[] }>(
      '/api/v1/media/check-duplicates',
      { method: 'POST', body: { hashes } },
    ).catch(() => ({ duplicates: [] }))

    const dupeMap = new Map(duplicates.map(d => [d.hash, d]))
    const conflicts: DuplicateConflict[] = batch
      .filter(uf => uf.hash && dupeMap.has(uf.hash))
      .map(uf => ({ uploadFile: uf, existing: dupeMap.get(uf.hash!)! }))

    if (conflicts.length > 0) {
      // Pause — show conflict resolution modal
      duplicateConflicts.value  = conflicts
      conflictResolveOpen.value = true
      // Store the non-conflicting files and libraryIds for after resolution
      _pendingUploadBatch.value   = batch.filter(uf => !uf.hash || !dupeMap.has(uf.hash))
      _pendingUploadLibraries.value = libraryIds
      return
    }

    await _executeBatch(batch, libraryIds)
  }

  /** Called by the conflict modal once the user has chosen a resolution per file. */
  async function resolveConflictsAndUpload(resolutions: Map<string, DuplicateResolution>) {
    const conflicts    = duplicateConflicts.value.slice()
    const clean        = _pendingUploadBatch.value.slice()
    const libraryIds   = _pendingUploadLibraries.value.slice()

    duplicateConflicts.value      = []
    conflictResolveOpen.value     = false
    _pendingUploadBatch.value     = []
    _pendingUploadLibraries.value = []

    const toUpload: UploadFile[] = [...clean]
    for (const conflict of conflicts) {
      const res = resolutions.get(conflict.uploadFile.id) ?? 'keep'
      if (res === 'keep') continue
      conflict.uploadFile._conflictResolution = res
      conflict.uploadFile._conflictExistingId = conflict.existing.id
      toUpload.push(conflict.uploadFile)
    }

    if (toUpload.length > 0) {
      await _executeBatch(toUpload, libraryIds)
    }
  }

  function dismissConflicts() {
    duplicateConflicts.value    = []
    conflictResolveOpen.value   = false
    _pendingUploadBatch.value   = []
    _pendingUploadLibraries.value = []
  }

  function dismissToast() {
    activeFiles.value = activeFiles.value.filter(f => f.status !== 'done')
    if (!activeFiles.value.length) activeFiles.value = []
  }

  async function startUploadDirect(libraryIds: string[], fileList: FileList | File[]) {
    const files = Array.from(fileList).filter(f =>
      f.type.startsWith('image/') || f.type.startsWith('video/'),
    )
    if (!files.length) return
    const batch: UploadFile[] = files.map(file => ({
      id:       crypto.randomUUID(),
      file,
      progress: 0,
      status:   'pending' as UploadStatus,
    }))
    await _executeBatch(batch, libraryIds)
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

// ── Internal batch state (between library picker and conflict resolution) ──────

const _pendingUploadBatch     = ref<UploadFile[]>([])
const _pendingUploadLibraries = ref<string[]>([])

async function _executeBatch(batch: UploadFile[], libraryIds: string[]) {
  activeFiles.value.push(...batch)
  await Promise.all(batch.map(uf => uploadOne(uf, libraryIds)))

  const { activeLibraryId } = useAppShell()
  const { loadLibraryMedia } = useGalleryData()
  await loadLibraryMedia(activeLibraryId.value)
}

// ── EXIF date helper ──────────────────────────────────────────────────────────

/**
 * Read DateTimeOriginal (or fallback EXIF date tags) from the first 64 KB of
 * the file. Returns a Date if found, null otherwise.
 *
 * We slice the file rather than reading it all — JPEG EXIF lives right at the
 * start so 64 KB is always enough.
 */
async function readExifDate(file: File): Promise<Date | null> {
  if (!file.type.startsWith('image/')) return null
  try {
    const ExifReader = (await import('exifreader')).default
    const slice = file.slice(0, 65536)
    const buffer = await slice.arrayBuffer()
    const tags = ExifReader.load(buffer, { expanded: false })

    const rawDate =
      (tags['DateTimeOriginal'] as { description?: string } | undefined)?.description ??
      (tags['DateTimeDigitized'] as { description?: string } | undefined)?.description ??
      (tags['DateTime'] as { description?: string } | undefined)?.description

    if (!rawDate) return null

    // EXIF format: "YYYY:MM:DD HH:MM:SS" — normalise date part separator
    const normalized = rawDate.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
    const d = new Date(normalized)
    return isNaN(d.getTime()) ? null : d
  } catch {
    return null
  }
}

// ── SHA-256 hash helper ────────────────────────────────────────────────────────

async function computeHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ── Dimension helper ──────────────────────────────────────────────────────────

function measureImageDimensions(file: File): Promise<{ width: number; height: number; aspectRatio: number } | null> {
  if (!file.type.startsWith('image/')) return Promise.resolve(null)
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const w = img.naturalWidth
      const h = img.naturalHeight
      resolve(h > 0 ? { width: w, height: h, aspectRatio: w / h } : null)
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    img.src = url
  })
}

// ── Internal upload helper ─────────────────────────────────────────────────────

async function uploadOne(uf: UploadFile, libraryIds: string[]) {
  const entry = activeFiles.value.find(f => f.id === uf.id)
  if (!entry) return

  try {
    entry.status = 'uploading'

    // Measure dimensions before we start the XHR (browser already has the file)
    const dims = await measureImageDimensions(uf.file)

    // 1. Request presigned URL from our API
    const { uploadUrl, objectKey } = await $fetch<{ uploadUrl: string; objectKey: string }>(
      '/api/v1/media/upload-url',
      {
        method: 'POST',
        body: { filename: uf.file.name, contentType: uf.file.type, libraryIds },
      },
    )

    // 2. PUT directly to RustFS via XHR for upload-progress events
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', uploadUrl)
      xhr.setRequestHeader('Content-Type', uf.file.type)

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          entry.progress = Math.round((e.loaded / e.total) * 100)
        }
      })

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve()
        } else {
          reject(new Error(`Upload failed: HTTP ${xhr.status}`))
        }
      })
      xhr.addEventListener('error', () => reject(new Error('Network error during upload')))
      xhr.send(uf.file)
    })

    // 3. Notify the API that the upload is complete so it can persist metadata.
    //    For images: try client-side EXIF first, fall back to File.lastModified
    //    (phone photos often have the shot date as the file date).
    //    For videos: File.lastModified is unreliable (it's the copy/download date,
    //    not the recording date). Send null and let the server extract creation_time
    //    from the MP4 container via ffprobe.
    const isVideoFile = uf.file.type.startsWith('video/')
    const exifDate    = await readExifDate(uf.file)   // returns null for videos
    const itemTakenAt = isVideoFile
      ? null
      : (exifDate ?? new Date(uf.file.lastModified))

    const { id: mediaId } = await $fetch<{ id: string }>('/api/v1/media/complete', {
      method: 'POST',
      body: {
        objectKey,
        filename:    uf.file.name,
        contentType: uf.file.type,
        size:        uf.file.size,
        libraryIds,
        width:       dims?.width,
        height:      dims?.height,
        aspectRatio: dims?.aspectRatio,
        takenAt:     itemTakenAt?.toISOString() ?? null,
        hash:        uf.hash,
      },
    })

    // 4. Optimistically add the item to the gallery — but only if the date
    //    group for today is already rendered. If the user's library doesn't
    //    have any items for today, the section isn't in the DOM yet, so
    //    optimistically injecting would create a phantom section that
    //    disappears on the next full refresh.
    const provisionalTakenAt = itemTakenAt ?? new Date()
    const localKey = `${provisionalTakenAt.getFullYear()}-${String(provisionalTakenAt.getMonth() + 1).padStart(2, '0')}-${String(provisionalTakenAt.getDate()).padStart(2, '0')}`
    const groupAlreadyVisible = gallerySections.value.some(s => s.dateKey === localKey)

    if (groupAlreadyVisible) {
      const blobUrl = URL.createObjectURL(uf.file)
      registerBlobUrl(mediaId, blobUrl)
      addProvisionalItem({
        id:               mediaId,
        originalFilename: uf.file.name,
        aspectRatio:      dims?.aspectRatio ?? 1.5,
        width:            dims?.width  ?? Math.round((dims?.aspectRatio ?? 1.5) >= 1 ? 1200 : 800),
        height:           dims?.height ?? Math.round((dims?.aspectRatio ?? 1.5) >= 1 ? 800 : 1200),
        takenAt:          provisionalTakenAt.toISOString(),
        isVideo:          uf.file.type.startsWith('video/'),
        src:              blobUrl,
        isProvisional:    true,
      })
    }

    entry.progress = 100
    entry.status   = 'done'
  } catch (err: unknown) {
    entry.status = 'error'
    entry.error  = err instanceof Error ? err.message : 'Unknown error'
  }
}
