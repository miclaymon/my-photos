<script setup lang="ts">
/**
 * Developer admin overview — not available in production.
 * Shows all media rows from the DB and all objects in the RustFS bucket side-by-side.
 * Supports editing and deleting records with optional bucket object cleanup.
 */
import { RefreshCwIcon, DatabaseIcon, HardDriveIcon, ImageIcon, InfoIcon, XIcon, Trash2Icon, PencilIcon, AlertTriangleIcon, UsersIcon, LinkIcon, ShieldOffIcon, UserPlusIcon, CpuIcon, CheckCircleIcon, XCircleIcon, LoaderIcon } from 'lucide-vue-next'

definePageMeta({ middleware: 'auth' })

type LibraryRef = { id: string; name: string; type: string }

interface MediaRow {
  id:               string
  objectKey:        string
  originalFilename: string
  contentType:      string
  size:             number
  width:            number | null
  height:           number | null
  aspectRatio:      number | null
  takenAt:          string | null
  createdAt:        string | null
  uploaderEmail:    string | null
  src:              string | null
  thumbnailSrc:     string | null
  libraries:        LibraryRef[]
}

interface BucketObject {
  key:          string
  size:         number
  lastModified: string | null
  src:          string
}

interface LibraryAccessEntry {
  userId:  number
  email:   string
  role:    'owner' | 'editor' | 'viewer'
  addedAt: string
}

interface ShareLinkEntry {
  id:             string
  albumId:        string | null
  mediaIds:       string | null
  createdByEmail: string | null
  expiresAt:      string | null
  lastUsedAt:     string | null
  revokedAt:      string | null
  createdAt:      string
}

interface LibraryRow {
  id:         string
  name:       string
  type:       string
  ownerId:    number | null
  ownerEmail: string | null
  createdAt:  string | null
  access:     LibraryAccessEntry[]
  shareLinks: ShareLinkEntry[]
}

interface OverviewData {
  counts:        { dbMedia: number; dbLibraries: number; bucketObjects: number }
  media:         MediaRow[]
  libraries:     LibraryRow[]
  bucketObjects: BucketObject[]
}

const { data, pending, error, refresh } = await useFetch<OverviewData>('/api/v1/admin/overview')

// Active tab
const tab = ref<'media' | 'bucket' | 'libraries' | 'jobs'>('media')

// ── Trash cleanup ─────────────────────────────────────────────────────────────
const cleanupPending = ref(false)
const cleanupResult  = ref<{ processed: number; failed: number } | null>(null)

async function runCleanup() {
  cleanupPending.value = true
  cleanupResult.value  = null
  try {
    cleanupResult.value = await $fetch<{ processed: number; failed: number }>(
      '/api/v1/admin/cleanup', { method: 'POST' },
    )
    await refresh()
  } finally {
    cleanupPending.value = false
  }
}

// Preview lightbox
const previewSrc = ref<string | null>(null)

// Item detail modal
const detailItem = ref<MediaRow | null>(null)

// ── Delete DB record dialog ────────────────────────────────────────────────────
const deleteDbTarget   = ref<MediaRow | null>(null)
const deleteDbObjects  = ref(false)
const deleteDbPending  = ref(false)
const deleteDbError    = ref<string | null>(null)

function openDeleteDb(row: MediaRow) {
  deleteDbTarget.value  = row
  deleteDbObjects.value = true   // default: also clean up bucket objects
  deleteDbError.value   = null
}

async function confirmDeleteDb() {
  if (!deleteDbTarget.value) return
  deleteDbPending.value = true
  deleteDbError.value   = null
  try {
    await $fetch(`/api/v1/admin/media/${deleteDbTarget.value.id}`, {
      method: 'DELETE',
      body:   { deleteObjects: deleteDbObjects.value },
    })
    deleteDbTarget.value = null
    await refresh()
  } catch (e: unknown) {
    deleteDbError.value = e instanceof Error ? e.message : 'Delete failed'
  } finally {
    deleteDbPending.value = false
  }
}

// ── Edit DB record dialog ──────────────────────────────────────────────────────
interface EditForm {
  originalFilename: string
  takenAt:          string   // ISO datetime-local value
  width:            string
  height:           string
  aspectRatio:      string
}

const editTarget  = ref<MediaRow | null>(null)
const editForm    = ref<EditForm>({ originalFilename: '', takenAt: '', width: '', height: '', aspectRatio: '' })
const editPending = ref(false)
const editError   = ref<string | null>(null)

function openEdit(row: MediaRow) {
  editTarget.value = row
  editError.value  = null
  editForm.value = {
    originalFilename: row.originalFilename,
    takenAt:          row.takenAt ? row.takenAt.slice(0, 16) : '',  // datetime-local format
    width:            row.width  != null ? String(row.width)  : '',
    height:           row.height != null ? String(row.height) : '',
    aspectRatio:      row.aspectRatio != null ? String(row.aspectRatio) : '',
  }
}

async function confirmEdit() {
  if (!editTarget.value) return
  editPending.value = true
  editError.value   = null
  try {
    const patch: Record<string, unknown> = {}
    patch.originalFilename = editForm.value.originalFilename || editTarget.value.originalFilename
    patch.takenAt          = editForm.value.takenAt ? new Date(editForm.value.takenAt).toISOString() : null
    patch.width            = editForm.value.width       ? Number(editForm.value.width)       : null
    patch.height           = editForm.value.height      ? Number(editForm.value.height)      : null
    patch.aspectRatio      = editForm.value.aspectRatio ? Number(editForm.value.aspectRatio) : null

    await $fetch(`/api/v1/admin/media/${editTarget.value.id}`, { method: 'PATCH', body: patch })
    editTarget.value = null
    await refresh()
  } catch (e: unknown) {
    editError.value = e instanceof Error ? e.message : 'Edit failed'
  } finally {
    editPending.value = false
  }
}

// ── Delete bucket object dialog ────────────────────────────────────────────────
const deleteBucketTarget   = ref<BucketObject | null>(null)
const deleteBucketDbRecord = ref(false)
const deleteBucketPending  = ref(false)
const deleteBucketError    = ref<string | null>(null)

function openDeleteBucket(obj: BucketObject) {
  deleteBucketTarget.value   = obj
  deleteBucketDbRecord.value = true   // default: also remove the DB record
  deleteBucketError.value    = null
}

async function confirmDeleteBucket() {
  if (!deleteBucketTarget.value) return
  deleteBucketPending.value = true
  deleteBucketError.value   = null
  try {
    await $fetch('/api/v1/admin/bucket/delete', {
      method: 'POST',
      body:   { key: deleteBucketTarget.value.key, deleteDbRecord: deleteBucketDbRecord.value },
    })
    deleteBucketTarget.value = null
    await refresh()
  } catch (e: unknown) {
    deleteBucketError.value = e instanceof Error ? e.message : 'Delete failed'
  } finally {
    deleteBucketPending.value = false
  }
}

// ── Library helpers ────────────────────────────────────────────────────────────

/** Display name: personal libraries show "Personal (owner@email)" */
function libraryDisplayName(lib: LibraryRow): string {
  if (lib.type === 'personal' && lib.ownerEmail) return `Personal (${lib.ownerEmail})`
  return lib.name
}

/** Count media items exclusively in one library (used in delete warning) */
function libraryOrphanCount(libraryId: string): number {
  if (!data.value) return 0
  return data.value.media.filter(m =>
    m.libraries.some(l => l.id === libraryId) && m.libraries.length === 1,
  ).length
}

/** Share link status label */
function shareLinkStatus(link: ShareLinkEntry): { label: string; style: string } {
  const now = Date.now()
  if (link.revokedAt) return { label: 'Revoked', style: 'color:#ef4444' }
  if (link.expiresAt && new Date(link.expiresAt).getTime() < now) {
    return { label: `Expired (${new Date(link.expiresAt).toLocaleDateString()})`, style: 'color:#f59e0b' }
  }
  if (link.lastUsedAt) {
    return { label: `Active (last used ${new Date(link.lastUsedAt).toLocaleDateString()})`, style: 'color:#22c55e' }
  }
  return { label: 'Active (not yet used)', style: 'color:#22c55e' }
}

// ── Delete library dialog ──────────────────────────────────────────────────────
const deleteLibTarget          = ref<LibraryRow | null>(null)
const deleteLibConfirmText     = ref('')
const deleteLibMarkOrphans     = ref(true)    // default: handle orphans
const deleteLibForceImmediate  = ref(false)   // when true: delete now instead of 30-day queue
const deleteLibPending         = ref(false)
const deleteLibError           = ref<string | null>(null)

function openDeleteLib(lib: LibraryRow) {
  deleteLibTarget.value         = lib
  deleteLibConfirmText.value    = ''
  deleteLibMarkOrphans.value    = true
  deleteLibForceImmediate.value = false
  deleteLibError.value          = null
}

const deleteLibConfirmMatch = computed(() =>
  deleteLibTarget.value ? deleteLibConfirmText.value === deleteLibTarget.value.name : false,
)

async function confirmDeleteLib() {
  if (!deleteLibTarget.value || !deleteLibConfirmMatch.value) return
  deleteLibPending.value = true
  deleteLibError.value   = null
  try {
    await $fetch(`/api/v1/admin/library/${deleteLibTarget.value.id}`, {
      method: 'DELETE',
      body: {
        markOrphansForDeletion:   deleteLibMarkOrphans.value && !deleteLibForceImmediate.value,
        deleteOrphansImmediately: deleteLibMarkOrphans.value && deleteLibForceImmediate.value,
      },
    })
    deleteLibTarget.value = null
    await refresh()
  } catch (e: unknown) {
    deleteLibError.value = e instanceof Error ? e.message : 'Delete failed'
  } finally {
    deleteLibPending.value = false
  }
}

// ── Library access management dialog ──────────────────────────────────────────
const accessLibTarget  = ref<LibraryRow | null>(null)
const accessAddEmail   = ref('')
const accessAddRole    = ref<'owner' | 'editor' | 'viewer'>('viewer')
const accessAddPending = ref(false)
const accessAddError   = ref<string | null>(null)

function openManageAccess(lib: LibraryRow) {
  accessLibTarget.value = lib
  accessAddEmail.value  = ''
  accessAddRole.value   = 'viewer'
  accessAddError.value  = null
}

async function addAccess() {
  if (!accessLibTarget.value || !accessAddEmail.value) return
  accessAddPending.value = true
  accessAddError.value   = null
  try {
    await $fetch(`/api/v1/admin/library/${accessLibTarget.value.id}/access`, {
      method: 'POST',
      body:   { email: accessAddEmail.value, role: accessAddRole.value },
    })
    accessAddEmail.value = ''
    await refresh()
    // Refresh the local ref from the updated data
    if (data.value) {
      accessLibTarget.value = data.value.libraries.find(l => l.id === accessLibTarget.value!.id) ?? null
    }
  } catch (e: unknown) {
    accessAddError.value = e instanceof Error ? e.message : 'Failed to add user'
  } finally {
    accessAddPending.value = false
  }
}

async function changeAccessRole(userId: number, role: 'owner' | 'editor' | 'viewer') {
  if (!accessLibTarget.value) return
  await $fetch(`/api/v1/admin/library/${accessLibTarget.value.id}/access/${userId}`, {
    method: 'PATCH',
    body:   { role },
  })
  await refresh()
  if (data.value) {
    accessLibTarget.value = data.value.libraries.find(l => l.id === accessLibTarget.value!.id) ?? null
  }
}

async function removeAccess(userId: number) {
  if (!accessLibTarget.value) return
  await $fetch(`/api/v1/admin/library/${accessLibTarget.value.id}/access/${userId}`, { method: 'DELETE' })
  await refresh()
  if (data.value) {
    accessLibTarget.value = data.value.libraries.find(l => l.id === accessLibTarget.value!.id) ?? null
  }
}

// ── Share links dialog ─────────────────────────────────────────────────────────
const shareLinksLibTarget = ref<LibraryRow | null>(null)

async function revokeShareLink(linkId: string) {
  await $fetch(`/api/v1/admin/share-links/${linkId}/revoke`, { method: 'POST' })
  await refresh()
  if (data.value && shareLinksLibTarget.value) {
    shareLinksLibTarget.value = data.value.libraries.find(l => l.id === shareLinksLibTarget.value!.id) ?? null
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function formatBytes(bytes: number) {
  if (bytes < 1024)        return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function shortKey(key: string) {
  const parts = key.split('/')
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : key
}

function relativeTime(iso: string | null) {
  if (!iso) return '—'
  const d    = new Date(iso)
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs  < 24)  return `${hrs}h ago`
  return d.toLocaleDateString()
}

const isImage = (ct: string) => ct.startsWith('image/')

// ── Jobs tab ──────────────────────────────────────────────────────────────────

type JobName = 'object-detection' | 'face-grouping' | 'ocr' | 'location-geocode'

interface JobStatus {
  running:     boolean
  startedAt:   string | null
  finishedAt:  string | null
  total:       number
  processed:   number
  errors:      number
  lastError:   string | null
  currentItem: string | null
}

const jobStatuses  = ref<Record<JobName, JobStatus> | null>(null)
const jobPending   = ref<Record<JobName, boolean>>({ 'object-detection': false, 'face-grouping': false, ocr: false, 'location-geocode': false })
const jobLibraryId = ref('')
const jobReprocess = ref(false)

const JOB_LABELS: Record<JobName, { label: string; desc: string }> = {
  'object-detection': { label: 'Object Detection',  desc: 'COCO-SSD — detects objects, animals in photos' },
  'face-grouping':    { label: 'Face Grouping',     desc: 'face-api — detects + clusters faces into subjects' },
  'ocr':              { label: 'OCR (Text)',         desc: 'Tesseract — extracts legible text from images' },
  'location-geocode': { label: 'Location Geocoding', desc: 'Nominatim — reverse-geocodes GPS coordinates to city/state labels' },
}

async function fetchJobStatuses() {
  try {
    jobStatuses.value = await $fetch<Record<JobName, JobStatus>>('/api/v1/admin/jobs/status')
  } catch { /* ignore */ }
}

// Auto-refresh statuses while any job is running
let _jobPoller: ReturnType<typeof setInterval> | null = null

watch(tab, (t) => {
  if (t === 'jobs') {
    fetchJobStatuses()
    _jobPoller = setInterval(() => {
      if (Object.values(jobStatuses.value ?? {}).some(s => s.running)) fetchJobStatuses()
    }, 1500)
  } else {
    if (_jobPoller) { clearInterval(_jobPoller); _jobPoller = null }
  }
})

async function runJob(name: JobName) {
  jobPending.value[name] = true
  try {
    await $fetch('/api/v1/admin/jobs/run', {
      method: 'POST',
      body:   { job: name, libraryId: jobLibraryId.value || undefined, reprocess: jobReprocess.value },
    })
    await fetchJobStatuses()
  } finally {
    jobPending.value[name] = false
  }
}

// ── Reset ─────────────────────────────────────────────────────────────────────
type ResetWhat = 'processing' | 'detections' | 'all'
const resetPending = ref(false)
const resetResult  = ref<string | null>(null)
const resetConfirm = ref<ResetWhat | null>(null)

const RESET_LABELS: Record<ResetWhat, { label: string; desc: string; danger: boolean }> = {
  processing:  { label: 'Clear processed timestamps',  desc: 'Re-queue all media for re-processing (keeps subject data)', danger: false },
  detections:  { label: 'Delete all detection data',   desc: 'Remove subjects, detections, objects, OCR (keeps timestamps)', danger: true },
  all:         { label: 'Full reset',                   desc: 'Delete all detection data AND clear processed timestamps', danger: true },
}

async function confirmReset() {
  if (!resetConfirm.value) return
  resetPending.value = true
  resetResult.value  = null
  try {
    const res = await $fetch<{ ok: boolean; counts: Record<string, number> }>(
      '/api/v1/admin/subjects/reset',
      { method: 'POST', body: { libraryId: jobLibraryId.value || undefined, what: resetConfirm.value } },
    )
    resetResult.value = `Done — ${JSON.stringify(res.counts)}`
  } catch (e: unknown) {
    resetResult.value = `Error: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    resetPending.value  = false
    resetConfirm.value  = null
  }
}

function jobProgress(s: JobStatus): number {
  if (!s.total) return 0
  return Math.round((s.processed / s.total) * 100)
}

function formatDuration(s: JobStatus): string {
  if (!s.startedAt) return '—'
  const end  = s.finishedAt ? new Date(s.finishedAt) : new Date()
  const ms   = end.getTime() - new Date(s.startedAt).getTime()
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}
</script>

<template>
  <div class="dev-admin">
    <!-- Header -->
    <div class="dev-admin-header">
      <div class="dev-admin-title-row">
        <span class="dev-admin-badge">DEV</span>
        <h1 class="dev-admin-title">Storage Overview</h1>
        <button class="dev-admin-refresh" :class="{ 'is-spinning': pending }" @click="refresh()">
          <RefreshCwIcon :size="15" />
          Refresh
        </button>
        <button class="dev-admin-cleanup" :disabled="cleanupPending" @click="runCleanup">
          <Trash2Icon :size="15" />
          {{ cleanupPending ? 'Running…' : 'Run trash cleanup' }}
        </button>
        <span v-if="cleanupResult" class="dev-cleanup-result">
          {{ cleanupResult.processed }} deleted{{ cleanupResult.failed ? `, ${cleanupResult.failed} failed` : '' }}
        </span>
      </div>

      <!-- Stat pills -->
      <div v-if="data" class="dev-admin-stats">
        <div class="dev-stat">
          <DatabaseIcon :size="14" />
          <span>{{ data.counts.dbMedia }} media in DB</span>
        </div>
        <div class="dev-stat">
          <HardDriveIcon :size="14" />
          <span>{{ data.counts.bucketObjects }} objects in bucket</span>
        </div>
        <div class="dev-stat">
          <ImageIcon :size="14" />
          <span>{{ data.counts.dbLibraries }} libraries</span>
        </div>
      </div>

      <!-- Tabs -->
      <div class="dev-admin-tabs">
        <button
          v-for="t in (['media', 'bucket', 'libraries', 'jobs'] as const)"
          :key="t"
          class="dev-admin-tab"
          :class="{ 'is-active': tab === t }"
          @click="tab = t"
        >
          {{ t === 'media' ? 'DB Media' : t === 'bucket' ? 'Bucket Objects' : t === 'libraries' ? 'Libraries' : 'Background Jobs' }}
        </button>
      </div>
    </div>

    <!-- Error -->
    <div v-if="error" class="dev-admin-error">
      <strong>Error:</strong> {{ error.message }}
    </div>

    <!-- Loading -->
    <div v-else-if="pending" class="dev-admin-loading">Loading…</div>

    <!-- ── DB Media tab ─────────────────────────────────────────────────── -->
    <div v-else-if="data && tab === 'media'" class="dev-admin-content">
      <p v-if="!data.media.length" class="dev-admin-empty">No media in the database yet.</p>

      <div v-else class="dev-table-wrap">
        <table class="dev-table">
          <thead>
            <tr>
              <th>Preview</th>
              <th>Filename</th>
              <th>Type</th>
              <th>Size</th>
              <th>Dimensions</th>
              <th>Libraries</th>
              <th>Uploaded</th>
              <th>By</th>
              <th>ID</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in data.media" :key="row.id">
              <!-- Thumbnail: prefer server-resized thumbnail, fall back to full src -->
              <td class="dev-table-thumb-cell">
                <button
                  v-if="row.thumbnailSrc || row.src"
                  class="dev-thumb-btn"
                  @click="previewSrc = row.src"
                >
                  <img
                    :src="row.thumbnailSrc ?? row.src ?? undefined"
                    :alt="row.originalFilename"
                    class="dev-thumb lazy-img"
                    @load="(e) => (e.target as HTMLImageElement).classList.add('is-loaded')"
                  />
                </button>
                <span v-else class="dev-thumb-placeholder">—</span>
              </td>

              <td class="dev-table-filename">
                <span :title="row.originalFilename">{{ row.originalFilename }}</span>
                <code class="dev-object-key" :title="row.objectKey">{{ shortKey(row.objectKey) }}</code>
              </td>

              <td><code class="dev-tag">{{ row.contentType }}</code></td>
              <td class="dev-mono">{{ formatBytes(row.size) }}</td>

              <td class="dev-mono">
                <template v-if="row.width && row.height">
                  {{ row.width }}×{{ row.height }}
                  <span class="dev-muted"> ({{ row.aspectRatio?.toFixed(2) }})</span>
                </template>
                <span v-else class="dev-muted">unknown</span>
              </td>

              <td>
                <span
                  v-for="lib in row.libraries"
                  :key="lib.id"
                  class="dev-tag dev-tag-lib"
                >{{ lib.name }}</span>
                <span v-if="!row.libraries.length" class="dev-muted">—</span>
              </td>

              <td class="dev-mono">{{ relativeTime(row.createdAt) }}</td>
              <td class="dev-mono dev-muted">{{ row.uploaderEmail ?? '—' }}</td>
              <td><code class="dev-uuid" :title="row.id">{{ row.id.slice(0, 8) }}…</code></td>
              <td class="dev-table-action-cell">
                <div class="dev-action-group">
                  <button class="dev-info-btn" title="View details" @click="detailItem = row">
                    <InfoIcon :size="14" />
                  </button>
                  <button class="dev-edit-btn" title="Edit record" @click="openEdit(row)">
                    <PencilIcon :size="14" />
                  </button>
                  <button class="dev-delete-btn" title="Delete record" @click="openDeleteDb(row)">
                    <Trash2Icon :size="14" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ── Bucket tab ──────────────────────────────────────────────────── -->
    <div v-else-if="data && tab === 'bucket'" class="dev-admin-content">
      <p v-if="!data.bucketObjects.length" class="dev-admin-empty">Bucket is empty.</p>

      <div v-else class="dev-table-wrap">
        <table class="dev-table">
          <thead>
            <tr>
              <th>Preview</th>
              <th>Key</th>
              <th>Size</th>
              <th>Last modified</th>
              <th>In DB?</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="obj in data.bucketObjects" :key="obj.key">
              <td class="dev-table-thumb-cell">
                <button
                  v-if="obj.src"
                  class="dev-thumb-btn"
                  @click="previewSrc = obj.src"
                >
                  <img
                    :src="obj.src"
                    :alt="obj.key"
                    class="dev-thumb lazy-img"
                    @load="(e) => (e.target as HTMLImageElement).classList.add('is-loaded')"
                  />
                </button>
              </td>

              <td>
                <code class="dev-object-key-full">{{ obj.key }}</code>
              </td>

              <td class="dev-mono">{{ formatBytes(obj.size) }}</td>
              <td class="dev-mono">{{ relativeTime(obj.lastModified) }}</td>

              <td>
                <span
                  v-if="data.media.some(m => m.objectKey === obj.key)"
                  class="dev-badge-ok"
                >✓ DB</span>
                <span v-else class="dev-badge-warn">orphan</span>
              </td>
              <td class="dev-table-action-cell">
                <button class="dev-delete-btn" title="Delete object" @click="openDeleteBucket(obj)">
                  <Trash2Icon :size="14" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ── Libraries tab ──────────────────────────────────────────────── -->
    <div v-else-if="data && tab === 'libraries'" class="dev-admin-content">
      <p v-if="!data.libraries.length" class="dev-admin-empty">No libraries yet.</p>

      <div v-else class="dev-table-wrap">
        <table class="dev-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Owner</th>
              <th>Media</th>
              <th>Access</th>
              <th>ID</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="lib in data.libraries" :key="lib.id">
              <td class="dev-table-filename">
                <span :title="lib.id">{{ libraryDisplayName(lib) }}</span>
              </td>
              <td><code class="dev-tag">{{ lib.type }}</code></td>
              <td class="dev-mono dev-muted">{{ lib.ownerEmail ?? '—' }}</td>
              <td class="dev-mono">
                {{ data.media.filter(m => m.libraries.some(l => l.id === lib.id)).length }}
                <span v-if="libraryOrphanCount(lib.id)" class="dev-muted"> ({{ libraryOrphanCount(lib.id) }} exclusive)</span>
              </td>
              <td class="dev-mono">
                {{ lib.access.length }} users
                <span class="dev-muted"> · {{ lib.shareLinks.length }} links</span>
              </td>
              <td><code class="dev-uuid" :title="lib.id">{{ lib.id.slice(0, 8) }}…</code></td>
              <td class="dev-table-action-cell">
                <div class="dev-action-group">
                  <button class="dev-info-btn" title="Manage access" @click="openManageAccess(lib)">
                    <UsersIcon :size="14" />
                  </button>
                  <button class="dev-info-btn" title="Share links" @click="shareLinksLibTarget = lib">
                    <LinkIcon :size="14" />
                  </button>
                  <button
                    v-if="lib.type !== 'personal'"
                    class="dev-delete-btn"
                    title="Delete library"
                    @click="openDeleteLib(lib)"
                  >
                    <Trash2Icon :size="14" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ── Delete DB record dialog ──────────────────────────────────────── -->
    <Transition name="dev-lightbox">
      <div v-if="deleteDbTarget" class="dev-lightbox" @click="deleteDbTarget = null">
        <div class="dev-dialog" @click.stop>
          <div class="dev-dialog-header">
            <AlertTriangleIcon :size="16" style="color:#ef4444" />
            <span class="dev-dialog-title">Delete DB record</span>
            <button class="dev-detail-close" @click="deleteDbTarget = null"><XIcon :size="16" /></button>
          </div>
          <div class="dev-dialog-body">
            <p>Delete <strong>{{ deleteDbTarget.originalFilename }}</strong> from the database?</p>
            <p class="dev-muted" style="font-size:11px;margin-top:4px">ID: {{ deleteDbTarget.id }}</p>
            <label class="dev-dialog-check">
              <input v-model="deleteDbObjects" type="checkbox" />
              Also delete bucket object(s) <span class="dev-muted">(main + thumbnail + preview)</span>
            </label>
            <p v-if="deleteDbError" class="dev-dialog-error">{{ deleteDbError }}</p>
          </div>
          <div class="dev-dialog-footer">
            <button class="dev-btn dev-btn-ghost" :disabled="deleteDbPending" @click="deleteDbTarget = null">Cancel</button>
            <button class="dev-btn dev-btn-danger" :disabled="deleteDbPending" @click="confirmDeleteDb">
              {{ deleteDbPending ? 'Deleting…' : 'Delete' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ── Edit DB record dialog ──────────────────────────────────────────── -->
    <Transition name="dev-lightbox">
      <div v-if="editTarget" class="dev-lightbox" @click="editTarget = null">
        <div class="dev-dialog dev-dialog-wide" @click.stop>
          <div class="dev-dialog-header">
            <PencilIcon :size="16" />
            <span class="dev-dialog-title">Edit record — {{ editTarget.id.slice(0, 8) }}…</span>
            <button class="dev-detail-close" @click="editTarget = null"><XIcon :size="16" /></button>
          </div>
          <div class="dev-dialog-body">
            <div class="dev-form-field">
              <label class="dev-form-label">Filename</label>
              <input v-model="editForm.originalFilename" type="text" class="dev-form-input" />
            </div>
            <div class="dev-form-field">
              <label class="dev-form-label">Taken at <span class="dev-muted">(local time)</span></label>
              <input v-model="editForm.takenAt" type="datetime-local" class="dev-form-input" />
            </div>
            <div class="dev-form-row">
              <div class="dev-form-field">
                <label class="dev-form-label">Width (px)</label>
                <input v-model="editForm.width" type="number" min="1" class="dev-form-input" />
              </div>
              <div class="dev-form-field">
                <label class="dev-form-label">Height (px)</label>
                <input v-model="editForm.height" type="number" min="1" class="dev-form-input" />
              </div>
              <div class="dev-form-field">
                <label class="dev-form-label">Aspect ratio</label>
                <input v-model="editForm.aspectRatio" type="number" step="0.0001" min="0" class="dev-form-input" />
              </div>
            </div>
            <p v-if="editError" class="dev-dialog-error">{{ editError }}</p>
          </div>
          <div class="dev-dialog-footer">
            <button class="dev-btn dev-btn-ghost" :disabled="editPending" @click="editTarget = null">Cancel</button>
            <button class="dev-btn dev-btn-primary" :disabled="editPending" @click="confirmEdit">
              {{ editPending ? 'Saving…' : 'Save changes' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ── Delete bucket object dialog ───────────────────────────────────── -->
    <Transition name="dev-lightbox">
      <div v-if="deleteBucketTarget" class="dev-lightbox" @click="deleteBucketTarget = null">
        <div class="dev-dialog" @click.stop>
          <div class="dev-dialog-header">
            <AlertTriangleIcon :size="16" style="color:#ef4444" />
            <span class="dev-dialog-title">Delete bucket object</span>
            <button class="dev-detail-close" @click="deleteBucketTarget = null"><XIcon :size="16" /></button>
          </div>
          <div class="dev-dialog-body">
            <p>Delete object from storage?</p>
            <code class="dev-object-key-full" style="margin-top:6px;display:block">{{ deleteBucketTarget.key }}</code>
            <label class="dev-dialog-check">
              <input v-model="deleteBucketDbRecord" type="checkbox" />
              Also delete associated DB record(s)
              <span class="dev-muted">(matched by objectKey / thumbnailObjectKey / previewObjectKey)</span>
            </label>
            <p v-if="deleteBucketError" class="dev-dialog-error">{{ deleteBucketError }}</p>
          </div>
          <div class="dev-dialog-footer">
            <button class="dev-btn dev-btn-ghost" :disabled="deleteBucketPending" @click="deleteBucketTarget = null">Cancel</button>
            <button class="dev-btn dev-btn-danger" :disabled="deleteBucketPending" @click="confirmDeleteBucket">
              {{ deleteBucketPending ? 'Deleting…' : 'Delete' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ── Delete library dialog ──────────────────────────────────────── -->
    <Transition name="dev-lightbox">
      <div v-if="deleteLibTarget" class="dev-lightbox" @click="deleteLibTarget = null">
        <div class="dev-dialog dev-dialog-wide" @click.stop>
          <div class="dev-dialog-header">
            <AlertTriangleIcon :size="16" style="color:#ef4444" />
            <span class="dev-dialog-title">Delete library</span>
            <button class="dev-detail-close" @click="deleteLibTarget = null"><XIcon :size="16" /></button>
          </div>
          <div class="dev-dialog-body">
            <p>Permanently delete <strong>{{ deleteLibTarget.name }}</strong>?</p>
            <p class="dev-muted" style="font-size:11px;margin-top:2px">
              This removes the library and all photo associations. The library's photos remain in the bucket unless orphaned and the option below is checked.
            </p>

            <div
              v-if="libraryOrphanCount(deleteLibTarget.id) > 0"
              style="padding:10px 12px;border-radius:8px;background:color-mix(in srgb,#f59e0b 10%,transparent);border:1px solid color-mix(in srgb,#f59e0b 30%,transparent);font-size:12px;"
            >
              <strong style="color:#f59e0b">⚠ {{ libraryOrphanCount(deleteLibTarget.id) }} photo(s)</strong>
              exist only in this library and will be orphaned in the bucket.
            </div>

            <template v-if="libraryOrphanCount(deleteLibTarget.id) > 0">
              <label class="dev-dialog-check">
                <input v-model="deleteLibMarkOrphans" type="checkbox" />
                Also delete {{ libraryOrphanCount(deleteLibTarget.id) }} orphaned photo(s)
              </label>
              <label v-if="deleteLibMarkOrphans" class="dev-dialog-check dev-dialog-check-sub">
                <input v-model="deleteLibForceImmediate" type="checkbox" />
                Delete immediately <span class="dev-muted">(unchecked = queue for 30 days)</span>
              </label>
            </template>

            <div class="dev-form-field">
              <label class="dev-form-label">Type <strong>{{ deleteLibTarget.name }}</strong> to confirm</label>
              <input
                v-model="deleteLibConfirmText"
                type="text"
                class="dev-form-input"
                :placeholder="deleteLibTarget.name"
                autocomplete="off"
              />
            </div>
            <p v-if="deleteLibError" class="dev-dialog-error">{{ deleteLibError }}</p>
          </div>
          <div class="dev-dialog-footer">
            <button class="dev-btn dev-btn-ghost" :disabled="deleteLibPending" @click="deleteLibTarget = null">Cancel</button>
            <button
              class="dev-btn dev-btn-danger"
              :disabled="deleteLibPending || !deleteLibConfirmMatch"
              @click="confirmDeleteLib"
            >
              {{ deleteLibPending ? 'Deleting…' : 'Delete library' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ── Manage library access dialog ──────────────────────────────── -->
    <Transition name="dev-lightbox">
      <div v-if="accessLibTarget" class="dev-lightbox" @click="accessLibTarget = null">
        <div class="dev-dialog dev-dialog-wide" @click.stop>
          <div class="dev-dialog-header">
            <UsersIcon :size="16" />
            <span class="dev-dialog-title">Access — {{ libraryDisplayName(accessLibTarget) }}</span>
            <button class="dev-detail-close" @click="accessLibTarget = null"><XIcon :size="16" /></button>
          </div>
          <div class="dev-dialog-body">

            <!-- Owner row (always shown from ownerId) -->
            <div v-if="accessLibTarget.ownerEmail" class="dev-access-row dev-access-row-owner">
              <span class="dev-access-email">{{ accessLibTarget.ownerEmail }}</span>
              <code class="dev-tag">owner</code>
              <span class="dev-muted" style="font-size:11px;margin-left:auto">library owner</span>
            </div>

            <!-- library_access entries -->
            <div
              v-for="entry in accessLibTarget.access"
              :key="entry.userId"
              class="dev-access-row"
            >
              <span class="dev-access-email">{{ entry.email }}</span>
              <select
                class="dev-role-select"
                :value="entry.role"
                @change="changeAccessRole(entry.userId, ($event.target as HTMLSelectElement).value as 'owner' | 'editor' | 'viewer')"
              >
                <option value="owner">owner</option>
                <option value="editor">editor</option>
                <option value="viewer">viewer</option>
              </select>
              <button class="dev-delete-btn" title="Remove access" @click="removeAccess(entry.userId)">
                <XIcon :size="13" />
              </button>
            </div>

            <p v-if="!accessLibTarget.ownerEmail && !accessLibTarget.access.length" class="dev-muted" style="font-size:12px">
              No access entries. Add a user below.
            </p>

            <!-- Add user row -->
            <div class="dev-access-add-row">
              <input
                v-model="accessAddEmail"
                type="email"
                class="dev-form-input"
                placeholder="user@example.com"
                style="flex:1"
                @keydown.enter="addAccess"
              />
              <select v-model="accessAddRole" class="dev-role-select">
                <option value="owner">owner</option>
                <option value="editor">editor</option>
                <option value="viewer">viewer</option>
              </select>
              <button
                class="dev-btn dev-btn-primary"
                style="padding:6px 12px;white-space:nowrap"
                :disabled="accessAddPending || !accessAddEmail"
                @click="addAccess"
              >
                <UserPlusIcon :size="13" />
                Add
              </button>
            </div>
            <p v-if="accessAddError" class="dev-dialog-error">{{ accessAddError }}</p>
          </div>
          <div class="dev-dialog-footer">
            <button class="dev-btn dev-btn-ghost" @click="accessLibTarget = null">Close</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ── Share links dialog ─────────────────────────────────────────── -->
    <Transition name="dev-lightbox">
      <div v-if="shareLinksLibTarget" class="dev-lightbox" @click="shareLinksLibTarget = null">
        <div class="dev-dialog dev-dialog-wide" @click.stop>
          <div class="dev-dialog-header">
            <LinkIcon :size="16" />
            <span class="dev-dialog-title">Share links — {{ libraryDisplayName(shareLinksLibTarget) }}</span>
            <button class="dev-detail-close" @click="shareLinksLibTarget = null"><XIcon :size="16" /></button>
          </div>
          <div class="dev-dialog-body" style="padding:0">
            <p v-if="!shareLinksLibTarget.shareLinks.length" class="dev-admin-empty" style="padding:24px">
              No share links for this library yet.
            </p>
            <table v-else class="dev-table" style="border:none">
              <thead>
                <tr>
                  <th>Scope</th>
                  <th>Created by</th>
                  <th>Created</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="link in shareLinksLibTarget.shareLinks" :key="link.id">
                  <td class="dev-mono" style="font-size:11px">
                    <span v-if="link.mediaIds">{{ JSON.parse(link.mediaIds).length }} photo(s)</span>
                    <span v-else-if="link.albumId">Album</span>
                    <span v-else>Whole library</span>
                  </td>
                  <td class="dev-mono dev-muted">{{ link.createdByEmail ?? '—' }}</td>
                  <td class="dev-mono">{{ relativeTime(link.createdAt) }}</td>
                  <td class="dev-mono">{{ link.expiresAt ? relativeTime(link.expiresAt) : 'Never' }}</td>
                  <td>
                    <span :style="shareLinkStatus(link).style" style="font-size:11px;font-family:monospace">
                      {{ shareLinkStatus(link).label }}
                    </span>
                  </td>
                  <td class="dev-table-action-cell">
                    <button
                      v-if="!link.revokedAt"
                      class="dev-delete-btn"
                      title="Revoke link"
                      @click="revokeShareLink(link.id)"
                    >
                      <ShieldOffIcon :size="13" />
                    </button>
                    <span v-else class="dev-muted" style="font-size:11px">revoked</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="dev-dialog-footer">
            <button class="dev-btn dev-btn-ghost" @click="shareLinksLibTarget = null">Close</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ── Background Jobs tab ───────────────────────────────────────── -->
    <div v-if="tab === 'jobs'" class="dev-admin-content">
      <div class="dev-jobs-header">
        <div class="dev-jobs-controls">
          <div class="dev-jobs-control-group">
            <label class="dev-jobs-label">Library ID (optional)</label>
            <input
              v-model="jobLibraryId"
              class="dev-form-input"
              style="width:260px;font-size:12px;font-family:monospace"
              placeholder="Leave blank to process all libraries"
            />
          </div>
          <label class="dev-jobs-checkbox-label">
            <input v-model="jobReprocess" type="checkbox" />
            Re-process already-processed items
          </label>
        </div>
        <button class="dev-btn dev-btn-ghost" style="font-size:12px" @click="fetchJobStatuses">
          <RefreshCwIcon :size="13" />
          Refresh
        </button>
      </div>

      <div class="dev-jobs-grid">
        <template v-if="!jobStatuses">
          <p class="dev-muted" style="padding:16px">Loading job statuses…</p>
        </template>

        <template v-else>
          <div
            v-for="(meta, name) in JOB_LABELS"
            :key="name"
            class="dev-job-card"
            :class="{ 'is-running': jobStatuses[name as JobName]?.running }"
          >
            <div class="dev-job-card-header">
              <CpuIcon :size="16" class="dev-job-icon" />
              <div class="dev-job-info">
                <span class="dev-job-name">{{ meta.label }}</span>
                <span class="dev-job-desc">{{ meta.desc }}</span>
              </div>
              <button
                class="dev-btn dev-btn-primary"
                style="padding:6px 14px;font-size:12px;white-space:nowrap;flex-shrink:0"
                :disabled="jobPending[name as JobName] || jobStatuses[name as JobName]?.running"
                @click="runJob(name as JobName)"
              >
                <LoaderIcon v-if="jobStatuses[name as JobName]?.running" :size="12" class="dev-spin" />
                {{ jobStatuses[name as JobName]?.running ? 'Running…' : 'Run job' }}
              </button>
            </div>

            <!-- Status -->
            <div class="dev-job-status-row">
              <template v-if="jobStatuses[name as JobName] as JobStatus | undefined">
                <template v-if="(jobStatuses[name as JobName] as JobStatus).startedAt">
                  <!-- Progress bar -->
                  <div class="dev-job-progress-wrap">
                    <div
                      class="dev-job-progress-bar"
                      :style="{ width: jobProgress(jobStatuses[name as JobName] as JobStatus) + '%' }"
                    />
                  </div>
                  <div class="dev-job-stats">
                    <span>
                      <CheckCircleIcon v-if="!(jobStatuses[name as JobName] as JobStatus).running && !(jobStatuses[name as JobName] as JobStatus).errors" :size="12" style="color:#4ade80;vertical-align:middle" />
                      <XCircleIcon    v-if="!(jobStatuses[name as JobName] as JobStatus).running && (jobStatuses[name as JobName] as JobStatus).errors" :size="12" style="color:#f87171;vertical-align:middle" />
                      {{ (jobStatuses[name as JobName] as JobStatus).processed }} / {{ (jobStatuses[name as JobName] as JobStatus).total }} items
                    </span>
                    <span v-if="(jobStatuses[name as JobName] as JobStatus).errors" style="color:#f87171">
                      {{ (jobStatuses[name as JobName] as JobStatus).errors }} errors
                    </span>
                    <span class="dev-muted">{{ formatDuration(jobStatuses[name as JobName] as JobStatus) }}</span>
                  </div>
                  <div
                    v-if="(jobStatuses[name as JobName] as JobStatus).currentItem && (jobStatuses[name as JobName] as JobStatus).running"
                    class="dev-job-current"
                  >
                    ↳ {{ (jobStatuses[name as JobName] as JobStatus).currentItem }}
                  </div>
                  <div
                    v-if="(jobStatuses[name as JobName] as JobStatus).lastError"
                    class="dev-job-error"
                  >
                    {{ (jobStatuses[name as JobName] as JobStatus).lastError }}
                  </div>
                </template>
                <span v-else class="dev-muted" style="font-size:12px">Never run</span>
              </template>
            </div>
          </div>
        </template>
      </div>

      <!-- ── Reset section ─────────────────────────────────────────────── -->
      <div class="dev-reset-section">
        <h3 class="dev-reset-title">Reset detection data</h3>
        <p class="dev-muted" style="font-size:12px;margin-bottom:14px">
          Scoped to the Library ID above if set, otherwise affects all libraries.
        </p>
        <div class="dev-reset-grid">
          <div v-for="(meta, what) in RESET_LABELS" :key="what" class="dev-reset-card" :class="{ 'is-danger': meta.danger }">
            <div class="dev-reset-card-body">
              <strong class="dev-reset-card-label">{{ meta.label }}</strong>
              <span class="dev-muted" style="font-size:11px">{{ meta.desc }}</span>
            </div>
            <button
              class="dev-btn dev-btn-ghost"
              style="font-size:12px;white-space:nowrap;flex-shrink:0"
              :class="{ 'dev-btn-danger': meta.danger }"
              :disabled="resetPending"
              @click="resetConfirm = what as ResetWhat"
            >
              {{ meta.label }}
            </button>
          </div>
        </div>
        <p v-if="resetResult" class="dev-reset-result">{{ resetResult }}</p>
      </div>
    </div>

    <!-- Image lightbox -->
    <Transition name="dev-lightbox">
      <div v-if="previewSrc" class="dev-lightbox" @click="previewSrc = null">
        <img :src="previewSrc" class="dev-lightbox-img" @click.stop />
        <p class="dev-lightbox-hint">Click outside to close</p>
      </div>
    </Transition>

    <!-- Item detail modal -->
    <Transition name="dev-lightbox">
      <div v-if="detailItem" class="dev-lightbox" @click="detailItem = null">
        <div class="dev-detail-panel" @click.stop>
          <div class="dev-detail-header">
            <span class="dev-detail-title">Media details</span>
            <button class="dev-detail-close" @click="detailItem = null">
              <XIcon :size="16" />
            </button>
          </div>

          <div class="dev-detail-body">
            <!-- Thumbnail -->
            <div v-if="detailItem.src && isImage(detailItem.contentType)" class="dev-detail-thumb-wrap">
              <img :src="detailItem.src" class="dev-detail-thumb" :alt="detailItem.originalFilename" />
            </div>

            <table class="dev-detail-table">
              <tbody>
                <tr><th>ID</th><td><code>{{ detailItem.id }}</code></td></tr>
                <tr><th>Filename</th><td>{{ detailItem.originalFilename }}</td></tr>
                <tr><th>Object key</th><td><code>{{ detailItem.objectKey }}</code></td></tr>
                <tr><th>Content type</th><td><code>{{ detailItem.contentType }}</code></td></tr>
                <tr><th>Size</th><td>{{ formatBytes(detailItem.size) }} ({{ detailItem.size.toLocaleString() }} bytes)</td></tr>
                <tr>
                  <th>Dimensions</th>
                  <td>
                    <template v-if="detailItem.width && detailItem.height">
                      {{ detailItem.width }} × {{ detailItem.height }} px
                      <span class="dev-muted"> — aspect ratio {{ detailItem.aspectRatio?.toFixed(4) }}</span>
                    </template>
                    <span v-else class="dev-muted">not recorded</span>
                  </td>
                </tr>
                <tr>
                  <th>Taken at</th>
                  <td>
                    <template v-if="detailItem.takenAt">
                      {{ new Date(detailItem.takenAt).toLocaleString() }}
                      <code class="dev-muted"> ({{ detailItem.takenAt }})</code>
                    </template>
                    <span v-else class="dev-muted">NULL — not recorded</span>
                  </td>
                </tr>
                <tr>
                  <th>Created at</th>
                  <td>
                    {{ detailItem.createdAt ? new Date(detailItem.createdAt).toLocaleString() : '—' }}
                    <code class="dev-muted"> ({{ detailItem.createdAt ?? 'null' }})</code>
                  </td>
                </tr>
                <tr><th>Uploaded by</th><td>{{ detailItem.uploaderEmail ?? '—' }}</td></tr>
                <tr>
                  <th>Libraries</th>
                  <td>
                    <template v-if="detailItem.libraries.length">
                      <span v-for="lib in detailItem.libraries" :key="lib.id" class="dev-tag dev-tag-lib" style="margin-right:4px">
                        {{ lib.name }} <span class="dev-muted">({{ lib.id }})</span>
                      </span>
                    </template>
                    <span v-else class="dev-muted">none</span>
                  </td>
                </tr>
                <tr>
                  <th>EXIF</th>
                  <td class="dev-muted">Not yet extracted — EXIF parsing is planned for a future milestone.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Reset confirmation dialog -->
    <Transition name="dropdown">
      <div v-if="resetConfirm" class="dev-modal-backdrop" @click.self="resetConfirm = null">
        <div class="dev-modal" role="dialog" aria-modal="true">
          <h3 class="dev-modal-title">Confirm reset</h3>
          <p class="dev-modal-body">
            <strong>{{ RESET_LABELS[resetConfirm].label }}</strong>
            {{ jobLibraryId ? `for library ${jobLibraryId}` : 'for ALL libraries' }}.
            This cannot be undone.
          </p>
          <div class="dev-modal-actions">
            <button class="dev-btn dev-btn-ghost" @click="resetConfirm = null">Cancel</button>
            <button class="dev-btn dev-btn-danger" :disabled="resetPending" @click="confirmReset">
              {{ resetPending ? 'Resetting…' : 'Confirm reset' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.dev-admin {
  min-height: 100vh;
  background: var(--color-bg);
  color: var(--color-text-primary);
  font-size: 13px;
}

/* ── Header ──────────────────────────────────────────────────────────────── */
.dev-admin-header {
  padding: 20px 28px 0;
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 0;
  background: var(--color-bg);
  z-index: 20;
}

.dev-admin-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.dev-admin-badge {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  background: #f59e0b;
  color: #000;
  padding: 2px 7px;
  border-radius: 4px;
}

.dev-admin-title {
  font-size: 18px;
  font-weight: 700;
  flex: 1;
}

.dev-admin-refresh {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 7px;
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 12px;
  transition: background 0.12s, color 0.12s;
}

.dev-admin-refresh:hover { background: var(--color-hover); color: var(--color-text-primary); }

.dev-admin-refresh.is-spinning svg {
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.dev-admin-cleanup {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 7px;
  border: 1px solid color-mix(in srgb, #ef4444 40%, transparent);
  background: transparent; color: #ef4444;
  cursor: pointer; font-size: 12px;
  transition: background 0.12s;
}
.dev-admin-cleanup:hover:not(:disabled) {
  background: color-mix(in srgb, #ef4444 10%, transparent);
}
.dev-admin-cleanup:disabled { opacity: 0.5; cursor: not-allowed; }

.dev-cleanup-result {
  font-size: 12px; color: var(--color-text-muted);
  padding: 4px 8px; background: var(--color-surface);
  border: 1px solid var(--color-border); border-radius: 6px;
}

/* ── Stat pills ──────────────────────────────────────────────────────────── */
.dev-admin-stats {
  display: flex;
  gap: 16px;
  margin-bottom: 14px;
}

.dev-stat {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-secondary);
}

/* ── Tabs ────────────────────────────────────────────────────────────────── */
.dev-admin-tabs {
  display: flex;
  gap: 0;
}

.dev-admin-tab {
  padding: 8px 18px;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 13px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color 0.12s, border-color 0.12s;
  margin-bottom: -1px;
}

.dev-admin-tab:hover { color: var(--color-text-secondary); }
.dev-admin-tab.is-active {
  color: var(--color-accent);
  border-bottom-color: var(--color-accent);
  font-weight: 600;
}

/* ── Content area ────────────────────────────────────────────────────────── */
.dev-admin-content { padding: 20px 28px; }
.dev-admin-loading,
.dev-admin-empty   { padding: 40px 28px; color: var(--color-text-muted); text-align: center; }
.dev-admin-error   { padding: 16px 28px; color: #ef4444; }

/* ── Table ───────────────────────────────────────────────────────────────── */
.dev-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: 8px;
}

.dev-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.dev-table th {
  text-align: left;
  padding: 9px 12px;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-weight: 600;
  white-space: nowrap;
  background: var(--color-surface);
}

.dev-table td {
  padding: 8px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-border) 50%, transparent);
  vertical-align: middle;
}

.dev-table tr:last-child td { border-bottom: none; }
.dev-table tr:hover td { background: var(--color-hover); }

/* ── Cell types ──────────────────────────────────────────────────────────── */
.dev-table-thumb-cell { width: 64px; padding: 6px 8px; }

.dev-thumb-btn {
  display: block;
  width: 52px;
  height: 52px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  overflow: hidden;
  cursor: zoom-in;
  padding: 0;
  background: var(--color-skeleton-base);
}

.dev-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.dev-thumb-placeholder {
  display: block;
  width: 52px;
  height: 52px;
  line-height: 52px;
  text-align: center;
  color: var(--color-text-muted);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 18px;
}

.dev-table-filename {
  max-width: 240px;
}

.dev-table-filename span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dev-object-key,
.dev-object-key-full {
  display: block;
  font-size: 10px;
  color: var(--color-text-muted);
  font-family: 'Geist Mono', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 240px;
}

.dev-object-key-full { max-width: 360px; }

.dev-mono  { font-family: 'Geist Mono', monospace; white-space: nowrap; }
.dev-muted { color: var(--color-text-muted); }
.dev-uuid  { font-family: 'Geist Mono', monospace; font-size: 11px; color: var(--color-text-muted); }

.dev-tag {
  display: inline-block;
  font-family: 'Geist Mono', monospace;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
}

.dev-tag-lib {
  margin-right: 4px;
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  border-color: color-mix(in srgb, var(--color-accent) 30%, transparent);
  color: var(--color-accent);
}

.dev-badge-ok {
  font-family: 'Geist Mono', monospace;
  font-size: 10px;
  color: #22c55e;
}

.dev-badge-warn {
  font-family: 'Geist Mono', monospace;
  font-size: 10px;
  color: #f59e0b;
}

/* ── Lightbox ────────────────────────────────────────────────────────────── */
.dev-lightbox {
  position: fixed;
  inset: 0;
  z-index: 999;
  background: rgba(0, 0, 0, 0.88);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  cursor: zoom-out;
}

.dev-lightbox-img {
  max-width: 90vw;
  max-height: 85vh;
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 8px 48px rgba(0, 0, 0, 0.5);
  cursor: default;
}

.dev-lightbox-hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
}

.dev-lightbox-enter-active,
.dev-lightbox-leave-active  { transition: opacity 0.18s ease; }
.dev-lightbox-enter-from,
.dev-lightbox-leave-to      { opacity: 0; }

/* ── Action buttons ──────────────────────────────────────────────────────── */
.dev-table-action-cell { width: 90px; padding: 4px 6px; }

.dev-action-group {
  display: flex;
  gap: 4px;
  align-items: center;
}

.dev-info-btn,
.dev-edit-btn,
.dev-delete-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: transparent;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
  flex-shrink: 0;
}

.dev-info-btn   { color: var(--color-text-muted); }
.dev-edit-btn   { color: var(--color-text-muted); }
.dev-delete-btn { color: var(--color-text-muted); }

.dev-info-btn:hover   { background: var(--color-hover); color: var(--color-accent); }
.dev-edit-btn:hover   { background: var(--color-hover); color: #3b82f6; }
.dev-delete-btn:hover { background: color-mix(in srgb, #ef4444 12%, transparent); color: #ef4444; border-color: color-mix(in srgb, #ef4444 40%, transparent); }

/* ── Detail panel ────────────────────────────────────────────────────────── */
.dev-detail-panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.3);
  width: min(600px, 92vw);
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  cursor: default;
}

.dev-detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.dev-detail-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.dev-detail-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}

.dev-detail-close:hover {
  background: var(--color-hover);
  color: var(--color-text-primary);
}

.dev-detail-body {
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.dev-detail-thumb-wrap {
  display: flex;
  justify-content: center;
}

.dev-detail-thumb {
  max-width: 100%;
  max-height: 200px;
  object-fit: contain;
  border-radius: 6px;
  border: 1px solid var(--color-border);
}

.dev-detail-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.dev-detail-table th {
  text-align: left;
  width: 120px;
  padding: 6px 10px 6px 0;
  color: var(--color-text-muted);
  font-weight: 600;
  vertical-align: top;
  white-space: nowrap;
  border-bottom: 1px solid color-mix(in srgb, var(--color-border) 50%, transparent);
}

.dev-detail-table td {
  padding: 6px 0;
  color: var(--color-text-primary);
  word-break: break-all;
  border-bottom: 1px solid color-mix(in srgb, var(--color-border) 50%, transparent);
  font-family: 'Geist Mono', monospace;
}

.dev-detail-table tr:last-child th,
.dev-detail-table tr:last-child td {
  border-bottom: none;
}

/* ── Shared dialog ───────────────────────────────────────────────────────── */
.dev-dialog {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.3);
  width: min(420px, 92vw);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  cursor: default;
}

.dev-dialog-wide { width: min(560px, 92vw); }

.dev-dialog-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.dev-dialog-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
  flex: 1;
}

.dev-dialog-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 13px;
  color: var(--color-text-primary);
}

.dev-dialog-check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  color: var(--color-text-secondary);
  cursor: pointer;
  user-select: none;
  padding: 8px 10px;
  border-radius: 7px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-raised, var(--color-surface));
}

.dev-dialog-check input[type="checkbox"] {
  flex-shrink: 0;
  accent-color: var(--color-accent);
  margin-top: 1px;
}

.dev-dialog-check-sub {
  margin-left: 20px;
  border-style: dashed;
  color: var(--color-text-muted);
}

.dev-dialog-error {
  font-size: 12px;
  color: #ef4444;
  padding: 6px 10px;
  background: color-mix(in srgb, #ef4444 10%, transparent);
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, #ef4444 30%, transparent);
}

.dev-dialog-footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 12px 16px;
  border-top: 1px solid var(--color-border);
  background: var(--color-surface-raised, var(--color-surface));
}

/* ── Dialog buttons ──────────────────────────────────────────────────────── */
.dev-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 7px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.12s, opacity 0.12s;
}

.dev-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.dev-btn-ghost {
  border-color: var(--color-border);
  background: transparent;
  color: var(--color-text-secondary);
}
.dev-btn-ghost:hover:not(:disabled) { background: var(--color-hover); }

.dev-btn-primary {
  background: var(--color-accent);
  color: #fff;
  border-color: transparent;
}
.dev-btn-primary:hover:not(:disabled) { filter: brightness(1.1); }

.dev-btn-danger {
  background: #ef4444;
  color: #fff;
  border-color: transparent;
}
.dev-btn-danger:hover:not(:disabled) { background: #dc2626; }

/* ── Edit form ───────────────────────────────────────────────────────────── */
.dev-form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.dev-form-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.dev-form-input {
  padding: 7px 10px;
  border-radius: 7px;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text-primary);
  font-size: 13px;
  font-family: inherit;
  width: 100%;
}

.dev-form-input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 20%, transparent);
}

.dev-form-row {
  display: flex;
  gap: 10px;
}

/* ── Library access dialog ───────────────────────────────────────────────── */
.dev-access-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 7px;
  border: 1px solid var(--color-border);
  font-size: 12px;
}

.dev-access-row-owner {
  background: color-mix(in srgb, var(--color-accent) 6%, transparent);
  border-color: color-mix(in srgb, var(--color-accent) 25%, transparent);
}

.dev-access-email {
  flex: 1;
  font-family: 'Geist Mono', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-primary);
}

.dev-role-select {
  padding: 4px 6px;
  border-radius: 5px;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text-secondary);
  font-size: 11px;
  font-family: 'Geist Mono', monospace;
  cursor: pointer;
}

.dev-access-add-row {
  display: flex;
  gap: 8px;
  align-items: center;
  padding-top: 4px;
  border-top: 1px solid var(--color-border);
  margin-top: 4px;
}

/* ── Jobs tab ─────────────────────────────────────────────────────────────── */
.dev-jobs-header {
  display: flex;
  align-items: flex-end;
  gap: 24px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);
  flex-wrap: wrap;
}

.dev-jobs-controls {
  display: flex;
  align-items: center;
  gap: 20px;
  flex: 1;
  flex-wrap: wrap;
}

.dev-jobs-control-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dev-jobs-label {
  font-size: 11px;
  color: var(--color-text-muted);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.dev-jobs-checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding-top: 18px;
}

.dev-jobs-grid {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dev-job-card {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--color-surface-raised);
  transition: border-color 0.15s;
}

.dev-job-card.is-running {
  border-color: var(--color-accent);
}

.dev-job-card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
}

.dev-job-icon {
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.dev-job-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.dev-job-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.dev-job-desc {
  font-size: 11px;
  color: var(--color-text-muted);
}

.dev-job-status-row {
  padding: 0 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dev-job-progress-wrap {
  height: 4px;
  border-radius: 2px;
  background: var(--color-border);
  overflow: hidden;
  margin-bottom: 4px;
}

.dev-job-progress-bar {
  height: 100%;
  background: var(--color-accent);
  border-radius: 2px;
  transition: width 0.4s ease;
}

.dev-job-stats {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.dev-job-current {
  font-size: 11px;
  color: var(--color-text-muted);
  font-family: 'Geist Mono', monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dev-job-error {
  font-size: 11px;
  color: #f87171;
  font-family: 'Geist Mono', monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@keyframes dev-spin {
  to { transform: rotate(360deg); }
}
.dev-spin {
  animation: dev-spin 1s linear infinite;
  display: inline-block;
}

/* ── Reset section ─────────────────────────────────────────────────────────── */
.dev-reset-section {
  padding: 20px;
  border-top: 1px solid var(--color-border);
  margin-top: 8px;
}

.dev-reset-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0 0 4px;
}

.dev-reset-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dev-reset-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-raised);
}

.dev-reset-card.is-danger {
  border-color: color-mix(in srgb, var(--color-border) 60%, #f87171);
}

.dev-reset-card-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.dev-reset-card-label { font-size: 12px; color: var(--color-text-primary); }

.dev-reset-result {
  margin-top: 12px;
  font-size: 11px;
  color: var(--color-text-muted);
  font-family: monospace;
}

.dev-btn-danger {
  background: rgba(248, 113, 113, 0.12);
  color: #f87171;
  border-color: rgba(248, 113, 113, 0.3);
}

.dev-btn-danger:hover:not(:disabled) {
  background: rgba(248, 113, 113, 0.22);
}

/* ── Modal (reset confirm) ─────────────────────────────────────────────────── */
.dev-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 600;
}

.dev-modal {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 24px 28px;
  width: 340px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.dev-modal-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0 0 10px;
}

.dev-modal-body {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin: 0 0 20px;
  line-height: 1.5;
}

.dev-modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
