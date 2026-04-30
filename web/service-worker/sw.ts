/// <reference lib="webworker" />
/// <reference lib="es2021" />

// exifreader checks for DOMParser to parse XMP tags; it doesn't exist in a SW.
// Stub it so the library skips XMP silently instead of printing a console warning.
// We only use EXIF date tags (DateTimeOriginal etc.) which don't need DOMParser.
if (typeof DOMParser === 'undefined') {
  ;(globalThis as unknown as Record<string, unknown>).DOMParser = class {
    parseFromString() {
      return { documentElement: null, getElementsByTagNameNS: () => ({ length: 0, item: () => null }) }
    }
  }
}

import ExifReader from 'exifreader'

declare const self: ServiceWorkerGlobalScope & typeof globalThis

// ─── Constants ────────────────────────────────────────────────────────────────

const DB_NAME    = 'my-photos-uploads'
const DB_VERSION     = 1
const STORE          = 'jobs'
const MAX_CONCURRENT = 8
// Jobs older than this that haven't completed are considered abandoned and purged.
const MAX_JOB_AGE_MS = 24 * 60 * 60 * 1000   // 24 hours

// ─── Types ────────────────────────────────────────────────────────────────────

export type JobStatus =
  | 'queued' | 'hashing' | 'dupecheck' | 'conflict'
  | 'thumbnailing' | 'waiting' | 'uploading' | 'notifying'
  | 'done' | 'error' | 'skipped'

export interface UploadJob {
  id:                  string
  file:                File
  filename:            string   // kept in JobSummary so the page can display it after restore
  status:              JobStatus
  progress:            number
  libraryIds:          string[]
  hash?:               string
  takenAt?:            string | null
  width?:              number
  height?:             number
  aspectRatio?:        number
  uploadUrl?:          string
  objectKey?:          string
  mediaId?:            string
  conflictExistingId?: string
  conflictResolution?: 'keep' | 'overwrite' | 'version'
  error?:              string
  createdAt:           number
}

export type JobSummary = Omit<UploadJob, 'file'>

export interface ExistingMedia {
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

export type SWMessage =
  | { type: 'JOB_ADDED';      jobs: JobSummary[] }
  | { type: 'METADATA_READY'; id: string; takenAt: string | null; width: number; height: number; aspectRatio: number }
  | { type: 'THUMBNAIL_READY'; id: string; thumbnail: ArrayBuffer; mimeType: string }
  | { type: 'CONFLICT';       conflicts: Array<{ jobId: string; existing: ExistingMedia }> }
  | { type: 'PROGRESS';       id: string; progress: number }
  | { type: 'COMPLETE';       id: string; mediaId: string }
  | { type: 'ERROR';          id: string; error: string }
  | { type: 'STATE_SYNC';     jobs: JobSummary[] }

export type PageMessage =
  | { type: 'ADD_JOBS';         jobs: Array<{ id: string; file: File; libraryIds: string[] }> }
  | { type: 'RESOLVE_CONFLICTS'; resolutions: Array<{ id: string; resolution: 'keep' | 'overwrite' | 'version'; existingId?: string }> }
  | { type: 'GET_STATE' }
  | { type: 'GET_STATE_RAW' }   // like GET_STATE but skips purge — for the dev panel
  | { type: 'CLEAR_DONE' }
  | { type: 'RETRY_JOB';  id: string }
  | { type: 'CANCEL_JOB'; id: string }

// ─── SW Lifecycle ─────────────────────────────────────────────────────────────

self.addEventListener('install', () => void self.skipWaiting())
self.addEventListener('activate', (e: ExtendableEvent) => e.waitUntil(self.clients.claim()))

// Catch any unhandled promise rejections in the SW and log them to IDB so the
// page can surface them. Without this, silent SW crashes leave gallery tiles stuck.
self.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
  const msg = e.reason instanceof Error ? e.reason.message : String(e.reason ?? 'Unknown SW error')
  console.error('[sw] unhandledrejection:', msg)
  // Persist to IDB so it survives until the next GET_STATE query
  openDB().then(db => {
    const tx    = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const logId = `sw-error-${Date.now()}`
    store.put({
      id: logId, filename: '', status: 'error', progress: 0,
      libraryIds: [], error: msg, createdAt: Date.now(),
      file: new File([], ''),
    } satisfies UploadJob)
  }).catch(() => {})
})

// ─── IndexedDB ────────────────────────────────────────────────────────────────

let _db: IDBDatabase | null = null

async function openDB(): Promise<IDBDatabase> {
  if (_db) return _db
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess  = () => { _db = req.result; resolve(_db!) }
    req.onerror    = () => reject(req.error)
  })
}

async function idbPut(job: UploadJob): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(job)
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}

async function idbGetAll(): Promise<UploadJob[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result as UploadJob[])
    req.onerror   = () => reject(req.error)
  })
}

async function idbDelete(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}

// ─── BroadcastChannel ─────────────────────────────────────────────────────────

const channel = new BroadcastChannel('upload')

function broadcast(msg: SWMessage, transfer?: Transferable[]): void {
  if (transfer?.length) {
    channel.postMessage(msg, transfer)
  } else {
    channel.postMessage(msg)
  }
}

function toSummary(job: UploadJob): JobSummary {
  const { file: _file, ...rest } = job
  return rest
}

// ─── SHA-256 ─────────────────────────────────────────────────────────────────

async function sha256(file: File): Promise<string> {
  const buf    = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

// ─── EXIF date ────────────────────────────────────────────────────────────────

async function readExifDate(file: File): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null
  try {
    const buf  = await file.slice(0, 65536).arrayBuffer()
    const tags = ExifReader.load(buf, { expanded: false })
    const raw  =
      (tags['DateTimeOriginal']  as { description?: string } | undefined)?.description ??
      (tags['DateTimeDigitized'] as { description?: string } | undefined)?.description ??
      (tags['DateTime']          as { description?: string } | undefined)?.description
    if (!raw) return null
    const d = new Date(raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3'))
    return isNaN(d.getTime()) ? null : d.toISOString()
  } catch { return null }
}

// ─── Dimensions ──────────────────────────────────────────────────────────────

async function measureDimensions(file: File): Promise<{ width: number; height: number; aspectRatio: number } | null> {
  try {
    const bmp = await createImageBitmap(file)
    const w = bmp.width, h = bmp.height
    bmp.close()
    return h > 0 ? { width: w, height: h, aspectRatio: w / h } : null
  } catch { return null }
}

// ─── Thumbnail (OffscreenCanvas) ──────────────────────────────────────────────

async function generateThumbnail(file: File): Promise<{ buffer: ArrayBuffer; mimeType: string } | null> {
  if (!file.type.startsWith('image/')) return null
  try {
    const bmp   = await createImageBitmap(file)
    const MAX   = 360
    const scale = Math.min(MAX / bmp.width, MAX / bmp.height, 1)
    const w     = Math.max(1, Math.round(bmp.width  * scale))
    const h     = Math.max(1, Math.round(bmp.height * scale))
    const canvas = new OffscreenCanvas(w, h)
    const ctx    = canvas.getContext('2d')
    if (!ctx) { bmp.close(); return null }
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.75 })
    return { buffer: await blob.arrayBuffer(), mimeType: 'image/jpeg' }
  } catch { return null }
}

// ─── Concurrency semaphore ────────────────────────────────────────────────────

class Semaphore {
  private available: number
  private queue: Array<() => void> = []
  constructor(max: number) { this.available = max }
  acquire(): Promise<void> {
    if (this.available > 0) { this.available--; return Promise.resolve() }
    return new Promise(r => this.queue.push(r))
  }
  release(): void {
    const next = this.queue.shift()
    if (next) next()
    else this.available++
  }
}

const uploadSem = new Semaphore(MAX_CONCURRENT)

// ─── Conflict resolution gate ─────────────────────────────────────────────────
// When duplicates are found, we pause all uploads and wait for the page to
// send back resolutions. We gate the entire batch so only one conflict prompt
// fires at a time.

type Resolution = { resolution: 'keep' | 'overwrite' | 'version'; existingId?: string }
let pendingConflictResolve: ((r: Map<string, Resolution>) => void) | null = null

// ─── Main pipeline ────────────────────────────────────────────────────────────

async function runPipeline(jobs: UploadJob[]): Promise<void> {
  // ── Phase 1: metadata — parallel, unbounded ──
  await Promise.all(jobs.map(async (job) => {
    try {
      job.status = 'hashing'
      await idbPut(job)

      const [hash, exifDate, dims] = await Promise.all([
        sha256(job.file),
        readExifDate(job.file),
        measureDimensions(job.file),
      ])

      job.hash        = hash
      job.takenAt     = job.file.type.startsWith('video/')
        ? null
        : (exifDate ?? new Date(job.file.lastModified).toISOString())
      job.width       = dims?.width
      job.height      = dims?.height
      job.aspectRatio = dims?.aspectRatio
      job.status      = 'dupecheck'
      await idbPut(job)

      broadcast({
        type:        'METADATA_READY',
        id:          job.id,
        takenAt:     job.takenAt ?? null,
        width:       job.width      ?? 0,
        height:      job.height     ?? 0,
        aspectRatio: job.aspectRatio ?? 1,
      })
    } catch (err) {
      job.status = 'error'
      job.error  = String(err)
      await idbPut(job)
      broadcast({ type: 'ERROR', id: job.id, error: job.error })
    }
  }))

  // ── Phase 2: duplicate check — one batch request ──
  const toCheck = jobs.filter(j => j.status === 'dupecheck' && j.hash)
  if (toCheck.length) {
    try {
      const res = await fetch('/api/v1/media/check-duplicates', {
        method:      'POST',
        credentials: 'same-origin',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ hashes: toCheck.map(j => j.hash) }),
      })
      if (res.ok) {
        const data = await res.json() as { duplicates: Array<{
          id: string; hash: string; original_filename: string; content_type: string; size: number
          width?: number | null; height?: number | null; taken_at?: string | null; thumbnail_url?: string | null
        }> }
        const dupeMap = new Map(data.duplicates.map(d => [d.hash, d]))
        const conflicts = toCheck
          .filter(j => j.hash && dupeMap.has(j.hash!))
          .map(j => {
            const d = dupeMap.get(j.hash!)!
            return {
              jobId:    j.id,
              existing: {
                hash: d.hash, id: d.id, originalFilename: d.original_filename,
                contentType: d.content_type, size: d.size,
                width:       d.width ?? undefined, height: d.height ?? undefined,
                takenAt:     d.taken_at ?? undefined, thumbnailSrc: d.thumbnail_url ?? undefined,
              } satisfies ExistingMedia,
            }
          })

        if (conflicts.length) {
          for (const c of conflicts) {
            const job = jobs.find(j => j.id === c.jobId)!
            job.status = 'conflict'
            await idbPut(job)
          }
          broadcast({ type: 'CONFLICT', conflicts })

          // Wait for page to send RESOLVE_CONFLICTS
          const resolutions = await new Promise<Map<string, Resolution>>(r => {
            pendingConflictResolve = r
          })
          pendingConflictResolve = null

          for (const c of conflicts) {
            const job = jobs.find(j => j.id === c.jobId)!
            const res = resolutions.get(job.id)
            if (!res || res.resolution === 'keep') {
              job.status = 'skipped'
            } else {
              job.conflictResolution = res.resolution
              job.conflictExistingId = res.existingId
              job.status = 'thumbnailing'
            }
            await idbPut(job)
          }
        }
      }
    } catch { /* non-fatal — proceed without dupe check */ }

    // Advance any dupecheck jobs that weren't conflicts
    for (const j of toCheck) {
      if (j.status === 'dupecheck') { j.status = 'thumbnailing'; await idbPut(j) }
    }
  }

  // ── Phase 3: thumbnail generation — parallel ──
  await Promise.all(jobs.filter(j => j.status === 'thumbnailing').map(async (job) => {
    const result = await generateThumbnail(job.file)
    if (result) {
      broadcast(
        { type: 'THUMBNAIL_READY', id: job.id, thumbnail: result.buffer, mimeType: result.mimeType },
        [result.buffer],  // transfer (zero-copy)
      )
    }
    job.status = 'waiting'
    await idbPut(job)
  }))

  // ── Phase 4 + 5: upload + notify — bounded by semaphore ──
  await Promise.all(jobs.filter(j => j.status === 'waiting').map(async (job) => {
    await uploadSem.acquire()
    try {
      job.status = 'uploading'
      await idbPut(job)

      // 4a. Get presigned PUT URL
      const urlRes = await fetch('/api/v1/media/upload-url', {
        method:      'POST',
        credentials: 'same-origin',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({
          filename:     job.file.name,
          content_type: job.file.type,
          library_ids:  job.libraryIds,
        }),
      })
      if (!urlRes.ok) throw new Error(`upload-url ${urlRes.status}`)
      const { upload_url: uploadUrl, object_key: objectKey } =
        await urlRes.json() as { upload_url: string; object_key: string }
      job.uploadUrl = uploadUrl
      job.objectKey = objectKey

      // 4b. PUT the file to the proxy upload endpoint (same-origin Nuxt route).
      // The Nuxt server forwards the binary body to S3, avoiding any CORS issue
      // with a storage endpoint on a different host.
      const putRes = await fetch(uploadUrl, {
        method:      'PUT',
        credentials: 'same-origin',
        body:        job.file,
        headers:     { 'Content-Type': job.file.type },
      })
      if (!putRes.ok) {
        const detail = await putRes.text().catch(() => '')
        throw new Error(`PUT ${putRes.status}${detail ? ': ' + detail : ''}`)
      }

      // 5. Notify API
      job.status = 'notifying'
      await idbPut(job)

      const notifyRes = await fetch('/api/v1/media/complete', {
        method:      'POST',
        credentials: 'same-origin',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({
          object_key:   job.objectKey,
          filename:     job.file.name,
          content_type: job.file.type,
          size:         job.file.size,
          library_ids:  job.libraryIds,
          width:        job.width,
          height:       job.height,
          aspect_ratio: job.aspectRatio,
          taken_at:     job.takenAt ?? null,
          hash:         job.hash,
        }),
      })
      if (!notifyRes.ok) throw new Error(`complete ${notifyRes.status}`)
      const { id: mediaId } = await notifyRes.json() as { id: string }

      job.mediaId  = mediaId
      job.progress = 100
      job.status   = 'done'
      await idbPut(job)

      // Overwrite resolution: remove the superseded item
      if (job.conflictResolution === 'overwrite' && job.conflictExistingId) {
        await fetch(`/api/v1/media/${job.conflictExistingId}/permanent-delete`, {
          method: 'POST', credentials: 'same-origin',
        }).catch(() => {})
      }

      broadcast({ type: 'COMPLETE', id: job.id, mediaId })
    } catch (err) {
      job.status = 'error'
      job.error  = String(err)
      await idbPut(job)
      broadcast({ type: 'ERROR', id: job.id, error: job.error! })
    } finally {
      uploadSem.release()
    }
  }))
}

// ─── Message handler ──────────────────────────────────────────────────────────

channel.addEventListener('message', async (e: MessageEvent<PageMessage>) => {
  const msg = e.data

  if (msg.type === 'ADD_JOBS') {
    const jobs: UploadJob[] = msg.jobs.map(j => ({
      id: j.id, file: j.file, filename: j.file.name, status: 'queued', progress: 0,
      libraryIds: j.libraryIds, createdAt: Date.now(),
    }))
    for (const job of jobs) await idbPut(job)
    broadcast({ type: 'JOB_ADDED', jobs: jobs.map(toSummary) })
    runPipeline(jobs).catch(console.error)
    return
  }

  if (msg.type === 'GET_STATE') {
    await purgeStaleJobs()
    const all = await idbGetAll()
    broadcast({ type: 'STATE_SYNC', jobs: all.map(toSummary) })
    return
  }

  if (msg.type === 'GET_STATE_RAW') {
    // Returns all jobs without purging — used by the dev admin panel so stale
    // error jobs remain visible for inspection/retry even after a page reload.
    const all = await idbGetAll()
    broadcast({ type: 'STATE_SYNC', jobs: all.map(toSummary) })
    return
  }

  if (msg.type === 'RETRY_JOB') {
    const all = await idbGetAll()
    const job = all.find(j => j.id === msg.id)
    if (!job) return
    const readable = await isFileReadable(job.file).catch(() => false)
    if (!readable) {
      job.status = 'error'
      job.error  = 'File no longer readable — please re-upload this file'
      await idbPut(job)
      broadcast({ type: 'ERROR', id: job.id, error: job.error })
      return
    }
    job.status   = 'queued'
    job.progress = 0
    job.error    = undefined
    await idbPut(job)
    // Re-enter pipeline from the start so all phases re-run
    runPipeline([job]).catch(console.error)
    return
  }

  if (msg.type === 'CANCEL_JOB') {
    await idbDelete(msg.id)
    return
  }

  if (msg.type === 'RESOLVE_CONFLICTS') {
    if (pendingConflictResolve) {
      const map = new Map(
        msg.resolutions.map(r => [r.id, { resolution: r.resolution, existingId: r.existingId }]),
      )
      pendingConflictResolve(map)
    }
    return
  }

  if (msg.type === 'CLEAR_DONE') {
    const all = await idbGetAll()
    for (const job of all) {
      if (job.status === 'done' || job.status === 'error' || job.status === 'skipped') {
        await idbDelete(job.id)
      }
    }
  }
})

// Delete IDB entries for:
//   - error jobs: always (terminal, not retryable — user already saw the notification)
//   - non-terminal jobs older than MAX_JOB_AGE_MS (truly abandoned)
async function purgeStaleJobs(): Promise<void> {
  const cutoff = Date.now() - MAX_JOB_AGE_MS
  const all    = await idbGetAll()
  for (const job of all) {
    const expired = job.createdAt < cutoff && job.status !== 'done' && job.status !== 'skipped'
    if (job.status === 'error' || expired) {
      await idbDelete(job.id)
    }
  }
}

// Probe whether a File object stored in IDB still has accessible binary data.
// File data tied to a user gesture (file picker / drag-drop) can become
// inaccessible after a full SW restart even though the IDB record survives.
async function isFileReadable(file: File): Promise<boolean> {
  try {
    await file.slice(0, 1).arrayBuffer()
    return true
  } catch {
    return false
  }
}

// On activation, attempt to recover any interrupted jobs from IDB.
// Jobs whose File data is no longer readable are immediately marked as error
// with a clear message so the user knows they need to re-upload.
self.addEventListener('activate', (e: ExtendableEvent) => {
  e.waitUntil(
    (async () => {
      await purgeStaleJobs()
      const all = await idbGetAll()
      const interrupted = all.filter(j =>
        j.status !== 'done' && j.status !== 'error' && j.status !== 'skipped',
      )
      if (!interrupted.length) return

      const resumable: UploadJob[] = []
      for (const job of interrupted) {
        const readable = await isFileReadable(job.file).catch(() => false)
        if (readable) {
          resumable.push(job)
        } else {
          job.status = 'error'
          job.error  = 'Upload interrupted — please re-upload this file'
          await idbPut(job)
        }
      }

      // Broadcast the full updated state (errors + any still-resumable jobs)
      const updated = await idbGetAll()
      const active  = updated.filter(j => j.status !== 'done' && j.status !== 'skipped')
      if (active.length) {
        broadcast({ type: 'STATE_SYNC', jobs: active.map(toSummary) })
      }

      // Resume jobs whose Files are still accessible, re-entering at the waiting phase
      if (resumable.length) {
        const toResume = resumable.filter(j => j.status === 'waiting')
        if (toResume.length) runPipeline(toResume).catch(console.error)
      }
    })(),
  )
})
