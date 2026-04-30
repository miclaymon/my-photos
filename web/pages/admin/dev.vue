<script setup lang="ts">
/**
 * Developer admin overview — not available in production.
 * Talks to FastAPI via the BFF catch-all proxy.
 * All API responses are snake_case (FastAPI default).
 */
import {
  RefreshCwIcon, DatabaseIcon, HardDriveIcon, ImageIcon, InfoIcon,
  XIcon, Trash2Icon, PencilIcon, AlertTriangleIcon, UsersIcon, LinkIcon,
  ShieldOffIcon, UserPlusIcon, CpuIcon, CheckCircleIcon, XCircleIcon,
  ClockIcon,
} from 'lucide-vue-next'

definePageMeta({ middleware: 'auth' })

// ── Types ─────────────────────────────────────────────────────────────────────

type LibraryRef = { id: string; name: string; type: string }

interface MediaRow {
  id:               string
  object_key:       string
  original_filename: string
  content_type:     string
  size:             number
  width:            number | null
  height:           number | null
  aspect_ratio:     number | null
  taken_at:         string | null
  created_at:       string | null
  uploader_email:   string | null
  src:              string | null
  thumbnail_src:    string | null
  libraries:        LibraryRef[]
}

interface BucketObject {
  key:           string
  size:          number
  last_modified: string | null
  src:           string | null
}

interface BucketGroup {
  prefix:       string
  mainObject:   BucketObject | null
  thumbObject:  BucketObject | null
  faceObjects:  BucketObject[]
  extras:       BucketObject[]
  totalSize:    number
  lastModified: string | null
  isOrphan:     boolean
}

interface LibraryAccessEntry {
  user_id:  number
  email:    string
  role:     'owner' | 'editor' | 'viewer'
  added_at: string | null
}

interface ShareLinkEntry {
  id:               string
  album_id:         string | null
  media_ids:        string[] | null
  created_by_email: string | null
  expires_at:       string | null
  last_used_at:     string | null
  revoked_at:       string | null
  created_at:       string
}

interface LibraryRow {
  id:          string
  name:        string
  type:        string
  owner_id:    number | null
  owner_email: string | null
  created_at:  string | null
  access:      LibraryAccessEntry[]
  share_links: ShareLinkEntry[]
}

interface OverviewData {
  counts:    { db_media: number; db_libraries: number }
  media:     MediaRow[]
  libraries: LibraryRow[]
}

interface BucketData {
  bucket_objects: BucketObject[]
  count:          number
}

// ── Data fetch ─────────────────────────────────────────────────────────────────

const { data, pending, error, refresh } = await useFetch<OverviewData>('/api/v1/admin/overview', { server: false })

// ── Bucket objects — fetched lazily when the bucket tab is opened ─────────────

const bucketData    = ref<BucketData | null>(null)
const bucketPending = ref(false)
const bucketError   = ref<string | null>(null)

async function fetchBucketObjects() {
  bucketPending.value = true
  bucketError.value   = null
  try {
    bucketData.value = await $fetch<BucketData>('/api/v1/admin/bucket-objects')
  } catch (e: unknown) {
    bucketError.value = e instanceof Error ? e.message : 'Failed to load bucket objects'
    bucketData.value  = null
  } finally {
    bucketPending.value = false
  }
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

const tab = ref<'media' | 'bucket' | 'libraries' | 'jobs' | 'uploads'>('media')

// ── Trash cleanup ──────────────────────────────────────────────────────────────

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

// ── Preview lightbox ───────────────────────────────────────────────────────────

const previewSrc = ref<string | null>(null)
const detailItem = ref<MediaRow | null>(null)

// ── Delete DB record dialog ────────────────────────────────────────────────────

const deleteDbTarget   = ref<MediaRow | null>(null)
const deleteDbObjects  = ref(true)
const deleteDbPending  = ref(false)
const deleteDbError    = ref<string | null>(null)

function openDeleteDb(row: MediaRow) {
  deleteDbTarget.value  = row
  deleteDbObjects.value = true
  deleteDbError.value   = null
}

async function confirmDeleteDb() {
  if (!deleteDbTarget.value) return
  deleteDbPending.value = true
  deleteDbError.value   = null
  try {
    const qs = deleteDbObjects.value ? '?delete_objects=true' : ''
    await $fetch(`/api/v1/admin/media/${deleteDbTarget.value.id}${qs}`, { method: 'DELETE' })
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
  original_filename: string
  taken_at:          string   // datetime-local
  width:             string
  height:            string
  aspect_ratio:      string
}

const editTarget  = ref<MediaRow | null>(null)
const editForm    = ref<EditForm>({ original_filename: '', taken_at: '', width: '', height: '', aspect_ratio: '' })
const editPending = ref(false)
const editError   = ref<string | null>(null)

function openEdit(row: MediaRow) {
  editTarget.value = row
  editError.value  = null
  editForm.value = {
    original_filename: row.original_filename,
    taken_at:          row.taken_at ? row.taken_at.slice(0, 16) : '',
    width:             row.width  != null ? String(row.width)  : '',
    height:            row.height != null ? String(row.height) : '',
    aspect_ratio:      row.aspect_ratio != null ? String(row.aspect_ratio) : '',
  }
}

async function confirmEdit() {
  if (!editTarget.value) return
  editPending.value = true
  editError.value   = null
  try {
    await $fetch(`/api/v1/admin/media/${editTarget.value.id}`, {
      method: 'PATCH',
      body: {
        original_filename: editForm.value.original_filename || editTarget.value.original_filename,
        taken_at:          editForm.value.taken_at ? new Date(editForm.value.taken_at).toISOString() : null,
        width:             editForm.value.width       ? Number(editForm.value.width)       : null,
        height:            editForm.value.height      ? Number(editForm.value.height)      : null,
        aspect_ratio:      editForm.value.aspect_ratio ? Number(editForm.value.aspect_ratio) : null,
      },
    })
    editTarget.value = null
    await refresh()
  } catch (e: unknown) {
    editError.value = e instanceof Error ? e.message : 'Edit failed'
  } finally {
    editPending.value = false
  }
}

// ── Library helpers ────────────────────────────────────────────────────────────

function libraryDisplayName(lib: LibraryRow): string {
  if (lib.type === 'personal' && lib.owner_email) return `Personal (${lib.owner_email})`
  return lib.name
}

function libraryOrphanCount(libraryId: string): number {
  if (!data.value) return 0
  return data.value.media.filter(m =>
    m.libraries.some(l => l.id === libraryId) && m.libraries.length === 1,
  ).length
}

function shareLinkStatus(link: ShareLinkEntry): { label: string; style: string } {
  const now = Date.now()
  if (link.revoked_at) return { label: 'Revoked', style: 'color:#ef4444' }
  if (link.expires_at && new Date(link.expires_at).getTime() < now) {
    return { label: `Expired (${new Date(link.expires_at).toLocaleDateString()})`, style: 'color:#f59e0b' }
  }
  if (link.last_used_at) {
    return { label: `Active (last used ${new Date(link.last_used_at).toLocaleDateString()})`, style: 'color:#22c55e' }
  }
  return { label: 'Active (not yet used)', style: 'color:#22c55e' }
}

// ── Delete library dialog ──────────────────────────────────────────────────────

const deleteLibTarget          = ref<LibraryRow | null>(null)
const deleteLibConfirmText     = ref('')
const deleteLibMarkOrphans     = ref(true)
const deleteLibForceImmediate  = ref(false)
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
        mark_orphans_for_deletion:   deleteLibMarkOrphans.value && !deleteLibForceImmediate.value,
        delete_orphans_immediately:  deleteLibMarkOrphans.value && deleteLibForceImmediate.value,
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

function sortIcon(key: string, currentKey: string, dir: 'asc' | 'desc'): string {
  return key === currentKey ? (dir === 'asc' ? '▲' : '▼') : '⇅'
}

// ── Jobs tab ──────────────────────────────────────────────────────────────────

type JobName = 'object_detection' | 'face_grouping' | 'ocr' | 'location_geocode' | 'barcode'

interface JobQueueStatus {
  pending:    number
  running:    number
  completed:  number
  failed:     number
  last_error: string | null
  batch_id:   string | null
}

const JOB_LABELS: Record<JobName, { label: string; desc: string }> = {
  'object_detection': { label: 'Object Detection',   desc: 'YOLOv8 (ONNX) — detects objects and animals in photos' },
  'face_grouping':    { label: 'Face Grouping',       desc: 'InsightFace — detects and clusters faces into named subjects' },
  'ocr':              { label: 'OCR (Text)',           desc: 'EasyOCR — extracts legible text from images' },
  'location_geocode': { label: 'Location Geocoding',  desc: 'reverse_geocoder — converts GPS coordinates to city/state labels' },
  'barcode':          { label: 'Barcode / QR',         desc: 'zxing-cpp — reads barcodes and QR codes in images' },
}

const jobStatuses      = ref<Record<JobName, JobQueueStatus> | null>(null)
const jobEnqueueing    = ref<Record<JobName, boolean>>({
  object_detection: false, face_grouping: false, ocr: false, location_geocode: false, barcode: false,
})
const jobDeletePending = ref<Record<JobName, boolean>>({
  object_detection: false, face_grouping: false, ocr: false, location_geocode: false, barcode: false,
})
const jobLibraryId  = ref('')
const jobReprocess  = ref(false)
const runJobResult  = ref<string | null>(null)

function jobTotal(st: JobQueueStatus) {
  return st.pending + st.running + st.completed + st.failed
}
function jobPct(n: number, total: number) {
  return total > 0 ? (n / total * 100).toFixed(2) : '0'
}

async function fetchJobStatuses() {
  try {
    const res = await $fetch<{ jobs: Record<JobName, JobQueueStatus> }>('/api/v1/admin/jobs/status')
    jobStatuses.value = res.jobs
  } catch { /* ignore */ }
}

// ── Recent jobs ───────────────────────────────────────────────────────────────

interface RecentJob {
  id:           string
  type:         string
  status:       string
  media_id:     string
  error:        string | null
  batch_id:     string | null
  created_at:   string | null
  started_at:   string | null
  completed_at: string | null
  duration_ms:  number | null
}

const recentJobs        = ref<RecentJob[]>([])
const recentJobsPending = ref(false)
const recentJobsExpanded = ref(false)

async function fetchRecentJobs() {
  recentJobsPending.value = true
  try {
    const query: Record<string, string> = {}
    if (jobLibraryId.value) query.library_id = jobLibraryId.value
    const res = await $fetch<{ jobs: RecentJob[] }>('/api/v1/admin/jobs/recent', { query })
    recentJobs.value = res.jobs
  } catch { /* ignore */ }
  finally { recentJobsPending.value = false }
}

function fmtDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000)   return `${ms}ms`
  if (ms < 60000)  return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

function fmtTimestamp(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

let _jobPoller: ReturnType<typeof setInterval> | null = null

watch(tab, (t) => {
  if (t === 'bucket') fetchBucketObjects()

  if (t === 'jobs') {
    fetchJobStatuses()
    fetchRecentJobs()
    _jobPoller = setInterval(() => {
      const s = jobStatuses.value
      if (s && Object.values(s).some(j => j.pending > 0 || j.running > 0)) {
        fetchJobStatuses()
        fetchRecentJobs()
      }
    }, 3000)
  } else {
    if (_jobPoller) { clearInterval(_jobPoller); _jobPoller = null }
  }

  if (t === 'uploads') {
    refreshSwJobs()
    _swPoller = setInterval(() => {
      const hasActive = swJobs.value.some(
        j => j.status !== 'done' && j.status !== 'error' && j.status !== 'skipped',
      )
      if (hasActive) refreshSwJobs()
    }, 2000)
  } else {
    if (_swPoller) { clearInterval(_swPoller); _swPoller = null }
  }
})

async function runJob(name: JobName) {
  jobEnqueueing.value[name] = true
  runJobResult.value        = null
  try {
    const res = await $fetch<{ enqueued: number }>('/api/v1/admin/jobs/run', {
      method: 'POST',
      body:   { job: name, library_id: jobLibraryId.value || undefined, reprocess: jobReprocess.value },
    })
    runJobResult.value = `Enqueued ${res.enqueued} job${res.enqueued !== 1 ? 's' : ''} for ${JOB_LABELS[name].label}`
    await fetchJobStatuses()
  } catch (e: unknown) {
    runJobResult.value = `Error: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    jobEnqueueing.value[name] = false
  }
}

async function deletePending(name: JobName) {
  jobDeletePending.value[name] = true
  try {
    await $fetch('/api/v1/admin/jobs/pending', {
      method: 'DELETE',
      query:  { job_type: name, library_id: jobLibraryId.value || undefined },
    })
    await fetchJobStatuses()
  } catch (e: unknown) {
    runJobResult.value = `Error deleting pending: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    jobDeletePending.value[name] = false
  }
}

// ── Reset ─────────────────────────────────────────────────────────────────────

type ResetWhat = 'processing' | 'detections' | 'all'
const resetPending = ref(false)
const resetResult  = ref<string | null>(null)
const resetConfirm = ref<ResetWhat | null>(null)

const RESET_LABELS: Record<ResetWhat, { label: string; desc: string; danger: boolean }> = {
  processing: { label: 'Clear processed timestamps',  desc: 'Re-queue all media for re-processing (keeps subject data)', danger: false },
  detections: { label: 'Delete all detection data',   desc: 'Remove subjects, detections, objects, OCR (keeps timestamps)', danger: true },
  all:        { label: 'Full reset',                   desc: 'Delete all detection data AND clear processed timestamps', danger: true },
}

async function confirmReset() {
  if (!resetConfirm.value) return
  resetPending.value = true
  resetResult.value  = null
  try {
    const res = await $fetch<{ ok: boolean; counts: Record<string, number> }>(
      '/api/v1/admin/subjects/reset',
      { method: 'POST', body: { library_id: jobLibraryId.value || undefined, what: resetConfirm.value } },
    )
    resetResult.value = `Done — ${JSON.stringify(res.counts)}`
  } catch (e: unknown) {
    resetResult.value = `Error: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    resetPending.value = false
    resetConfirm.value = null
  }
}

const reclusterPending = ref(false)
const reclusterResult  = ref<string | null>(null)

async function reclusterSubjects() {
  reclusterPending.value = true
  reclusterResult.value  = null
  try {
    const res = await $fetch<{
      ok: boolean
      merged: number
      remaining: number
      total_subjects: number
      usable_for_clustering: number
      no_descriptor: number
      cluster_threshold: number
      pairs_within_threshold: number
      min_distance: number | null
      max_distance: number
    }>(
      `/api/v1/admin/subjects/recluster${jobLibraryId.value ? `?library_id=${jobLibraryId.value}` : ''}`,
      { method: 'POST' },
    )
    const lines = [
      `Merged ${res.merged} subject(s) → ${res.remaining} remaining`,
      `Subjects found: ${res.total_subjects} total, ${res.usable_for_clustering} had embeddings, ${res.no_descriptor} had none`,
      `Threshold: ${res.cluster_threshold} | Pairs within threshold: ${res.pairs_within_threshold}`,
      `Distance range: ${res.min_distance ?? 'n/a'} – ${res.max_distance}`,
    ]
    reclusterResult.value = lines.join(' · ')
  } catch (e: unknown) {
    reclusterResult.value = `Error: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    reclusterPending.value = false
  }
}

// ── Media table controls ───────────────────────────────────────────────────────

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const

const mediaFilter   = ref('')
const mediaSortKey  = ref('created_at')
const mediaSortDir  = ref<'asc' | 'desc'>('desc')
const mediaPageSize = ref(25)
const mediaPage     = ref(1)
const mediaSelected = ref<Set<string>>(new Set())

function toggleMediaSort(key: string) {
  if (mediaSortKey.value === key) mediaSortDir.value = mediaSortDir.value === 'asc' ? 'desc' : 'asc'
  else { mediaSortKey.value = key; mediaSortDir.value = 'desc' }
  mediaPage.value = 1
}

const filteredMedia = computed(() => {
  const q   = mediaFilter.value.toLowerCase().trim()
  const all = data.value?.media ?? []
  if (!q) return all
  return all.filter(m =>
    m.original_filename.toLowerCase().includes(q) ||
    m.id.toLowerCase().includes(q) ||
    m.object_key.toLowerCase().includes(q) ||
    m.content_type.toLowerCase().includes(q) ||
    (m.uploader_email ?? '').toLowerCase().includes(q) ||
    m.libraries.some(l => l.name.toLowerCase().includes(q)),
  )
})

const sortedMedia = computed(() => {
  const items = [...filteredMedia.value]
  const key   = mediaSortKey.value as keyof MediaRow
  items.sort((a, b) => {
    const av = (a as any)[key] ?? ''
    const bv = (b as any)[key] ?? ''
    const cmp = typeof av === 'number' && typeof bv === 'number'
      ? av - bv : String(av).localeCompare(String(bv))
    return mediaSortDir.value === 'asc' ? cmp : -cmp
  })
  return items
})

const mediaPageCount = computed(() => Math.max(1, Math.ceil(sortedMedia.value.length / mediaPageSize.value)))
const pagedMedia     = computed(() => {
  const s = (mediaPage.value - 1) * mediaPageSize.value
  return sortedMedia.value.slice(s, s + mediaPageSize.value)
})

const allPageMediaSelected  = computed(() => pagedMedia.value.length > 0 && pagedMedia.value.every(m => mediaSelected.value.has(m.id)))
const somePageMediaSelected = computed(() => pagedMedia.value.some(m => mediaSelected.value.has(m.id)))

function toggleMediaSelect(id: string) {
  const s = new Set(mediaSelected.value)
  s.has(id) ? s.delete(id) : s.add(id)
  mediaSelected.value = s
}

function toggleSelectAllPageMedia() {
  const s = new Set(mediaSelected.value)
  if (allPageMediaSelected.value) pagedMedia.value.forEach(m => s.delete(m.id))
  else pagedMedia.value.forEach(m => s.add(m.id))
  mediaSelected.value = s
}

// ── Bulk delete media ──────────────────────────────────────────────────────────

const bulkDeleteMediaOpen    = ref(false)
const bulkDeleteMediaObjects = ref(true)
const bulkDeleteMediaPending = ref(false)
const bulkDeleteMediaError   = ref<string | null>(null)

async function confirmBulkDeleteMedia() {
  bulkDeleteMediaPending.value = true
  bulkDeleteMediaError.value   = null
  try {
    const qs = bulkDeleteMediaObjects.value ? '?delete_objects=true' : ''
    await Promise.all([...mediaSelected.value].map(id =>
      $fetch(`/api/v1/admin/media/${id}${qs}`, { method: 'DELETE' }),
    ))
    mediaSelected.value       = new Set()
    bulkDeleteMediaOpen.value = false
    await refresh()
  } catch (e: unknown) {
    bulkDeleteMediaError.value = e instanceof Error ? e.message : 'Bulk delete failed'
  } finally {
    bulkDeleteMediaPending.value = false
  }
}

// ── Bucket grouping ────────────────────────────────────────────────────────────

function isThumbKey(key: string): boolean {
  const name = key.split('/').pop() ?? ''
  return name === 'thumb.jpg' || name.startsWith('thumb.')
}

function isFaceKey(key: string): boolean {
  return key.includes('/faces/')
}

function shortGroupPrefix(prefix: string): string {
  const parts = prefix.split('/')
  if (parts.length >= 3) return `${parts[0]}/${parts[1].slice(0, 8)}…/`
  return prefix
}

function groupMainFilename(group: BucketGroup): string {
  if (!group.mainObject) return group.thumbObject ? '(thumbnail only)' : '—'
  return group.mainObject.key.split('/').pop() ?? group.mainObject.key
}

const bucketGroups = computed((): BucketGroup[] => {
  if (!bucketData.value) return []
  const objects = bucketData.value.bucket_objects
  const dbKeys  = new Set((data.value?.media ?? []).map(m => m.object_key))

  const groupMap = new Map<string, BucketObject[]>()
  for (const obj of objects) {
    const parts  = obj.key.split('/')
    const prefix = parts.length >= 3 ? `${parts[0]}/${parts[1]}/` : `${obj.key}/`
    if (!groupMap.has(prefix)) groupMap.set(prefix, [])
    groupMap.get(prefix)!.push(obj)
  }

  return Array.from(groupMap.entries()).map(([prefix, objs]) => {
    const thumbObject  = objs.find(o => isThumbKey(o.key)) ?? null
    const faceObjects  = objs.filter(o => isFaceKey(o.key))
    const mainObject   = objs.find(o => !isThumbKey(o.key) && !isFaceKey(o.key)) ?? null
    const extras       = objs.filter(o => o !== thumbObject && o !== mainObject && !faceObjects.includes(o))
    const totalSize    = objs.reduce((s, o) => s + o.size, 0)
    const lastModified = objs.reduce<string | null>((latest, o) => {
      if (!o.last_modified) return latest
      return !latest || o.last_modified > latest ? o.last_modified : latest
    }, null)
    return {
      prefix, mainObject, thumbObject, faceObjects, extras, totalSize, lastModified,
      isOrphan: !mainObject || !dbKeys.has(mainObject.key),
    }
  })
})

// ── Bucket table controls ──────────────────────────────────────────────────────

const bucketShowThumbs = ref(false)
const bucketFilter     = ref('')
const bucketSortKey    = ref('lastModified')
const bucketSortDir    = ref<'asc' | 'desc'>('desc')
const bucketPageSize   = ref(25)
const bucketPage       = ref(1)
const bucketSelected   = ref<Set<string>>(new Set())

function toggleBucketSort(key: string) {
  if (bucketSortKey.value === key) bucketSortDir.value = bucketSortDir.value === 'asc' ? 'desc' : 'asc'
  else { bucketSortKey.value = key; bucketSortDir.value = 'desc' }
  bucketPage.value = 1
}

const filteredBucketGroups = computed(() => {
  const q = bucketFilter.value.toLowerCase().trim()
  if (!q) return bucketGroups.value
  return bucketGroups.value.filter(g =>
    g.prefix.toLowerCase().includes(q) ||
    (g.mainObject?.key ?? '').toLowerCase().includes(q),
  )
})

const sortedBucketGroups = computed(() => {
  const groups = [...filteredBucketGroups.value]
  groups.sort((a, b) => {
    let cmp = 0
    switch (bucketSortKey.value) {
      case 'prefix':       cmp = a.prefix.localeCompare(b.prefix); break
      case 'totalSize':    cmp = a.totalSize - b.totalSize; break
      case 'lastModified': cmp = (a.lastModified ?? '').localeCompare(b.lastModified ?? ''); break
      case 'status':       cmp = (a.isOrphan ? 1 : 0) - (b.isOrphan ? 1 : 0); break
    }
    return bucketSortDir.value === 'asc' ? cmp : -cmp
  })
  return groups
})

const bucketPageCount   = computed(() => Math.max(1, Math.ceil(sortedBucketGroups.value.length / bucketPageSize.value)))
const pagedBucketGroups = computed(() => {
  const s = (bucketPage.value - 1) * bucketPageSize.value
  return sortedBucketGroups.value.slice(s, s + bucketPageSize.value)
})

const allPageBucketSelected  = computed(() => pagedBucketGroups.value.length > 0 && pagedBucketGroups.value.every(g => bucketSelected.value.has(g.prefix)))

function toggleBucketSelect(prefix: string) {
  const s = new Set(bucketSelected.value)
  s.has(prefix) ? s.delete(prefix) : s.add(prefix)
  bucketSelected.value = s
}

function toggleSelectAllPageBucket() {
  const s = new Set(bucketSelected.value)
  if (allPageBucketSelected.value) pagedBucketGroups.value.forEach(g => s.delete(g.prefix))
  else pagedBucketGroups.value.forEach(g => s.add(g.prefix))
  bucketSelected.value = s
}

// ── Bucket group delete dialog ─────────────────────────────────────────────────

const deleteBucketGroup = ref<BucketGroup | null>(null)
const deleteBucketThumb = ref(true)
const deleteBucketDbRec = ref(true)
const deleteBucketPend  = ref(false)
const deleteBucketErr   = ref<string | null>(null)

function openDeleteBucketGroup(group: BucketGroup) {
  deleteBucketGroup.value = group
  deleteBucketThumb.value = true
  deleteBucketDbRec.value = !group.isOrphan
  deleteBucketErr.value   = null
}

async function confirmDeleteBucketGroup() {
  const group = deleteBucketGroup.value
  if (!group) return
  deleteBucketPend.value = true
  deleteBucketErr.value  = null
  try {
    if (group.mainObject) {
      await $fetch('/api/v1/admin/bucket/delete', {
        method: 'POST',
        body:   { key: group.mainObject.key, delete_db_record: deleteBucketDbRec.value },
      })
    }
    if (deleteBucketThumb.value && group.thumbObject) {
      await $fetch('/api/v1/admin/bucket/delete', {
        method: 'POST',
        body:   { key: group.thumbObject.key, delete_db_record: false },
      })
    }
    for (const extra of group.extras) {
      await $fetch('/api/v1/admin/bucket/delete', {
        method: 'POST', body: { key: extra.key, delete_db_record: false },
      })
    }
    deleteBucketGroup.value = null
    await fetchBucketObjects()
    if (deleteBucketDbRec.value) await refresh()
  } catch (e: unknown) {
    deleteBucketErr.value = e instanceof Error ? e.message : 'Delete failed'
  } finally {
    deleteBucketPend.value = false
  }
}

// ── Bulk delete bucket ─────────────────────────────────────────────────────────

const bulkDeleteBucketOpen    = ref(false)
const bulkDeleteBucketThumb   = ref(true)
const bulkDeleteBucketDb      = ref(false)
const bulkDeleteBucketPending = ref(false)
const bulkDeleteBucketError   = ref<string | null>(null)

async function confirmBulkDeleteBucket() {
  bulkDeleteBucketPending.value = true
  bulkDeleteBucketError.value   = null
  try {
    for (const prefix of [...bucketSelected.value]) {
      const group = bucketGroups.value.find(g => g.prefix === prefix)
      if (!group) continue
      if (group.mainObject) {
        await $fetch('/api/v1/admin/bucket/delete', {
          method: 'POST',
          body:   { key: group.mainObject.key, delete_db_record: bulkDeleteBucketDb.value },
        })
      }
      if (bulkDeleteBucketThumb.value && group.thumbObject) {
        await $fetch('/api/v1/admin/bucket/delete', {
          method: 'POST',
          body:   { key: group.thumbObject.key, delete_db_record: false },
        })
      }
    }
    bucketSelected.value       = new Set()
    bulkDeleteBucketOpen.value = false
    await fetchBucketObjects()
    if (bulkDeleteBucketDb.value) await refresh()
  } catch (e: unknown) {
    bulkDeleteBucketError.value = e instanceof Error ? e.message : 'Bulk delete failed'
  } finally {
    bulkDeleteBucketPending.value = false
  }
}

// ── SW Upload Jobs ────────────────────────────────────────────────────────────

interface SwJobSummary {
  id:                  string
  filename:            string
  status:              string
  progress:            number
  error?:              string
  objectKey?:          string
  mediaId?:            string
  createdAt:           number
  libraryIds:          string[]
  hash?:               string
  takenAt?:            string | null
  conflictResolution?: string
}

const swJobs        = ref<SwJobSummary[]>([])
const swJobsLoading = ref(false)

let _swChannel: BroadcastChannel | null = null
let _swPoller:  ReturnType<typeof setInterval> | null = null

function getSwChannel(): BroadcastChannel {
  if (!_swChannel && import.meta.client) {
    _swChannel = new BroadcastChannel('upload')
    _swChannel.addEventListener('message', (e: MessageEvent) => {
      const msg = e.data as { type: string; jobs?: SwJobSummary[] }
      if (msg.type === 'STATE_SYNC' && Array.isArray(msg.jobs)) {
        swJobs.value        = (msg.jobs as SwJobSummary[]).slice().sort((a, b) => b.createdAt - a.createdAt)
        swJobsLoading.value = false
      }
    })
  }
  return _swChannel!
}

function refreshSwJobs() {
  if (!import.meta.client) return
  swJobsLoading.value = true
  getSwChannel().postMessage({ type: 'GET_STATE_RAW' })
  setTimeout(() => { swJobsLoading.value = false }, 3000)
}

function clearSwDone() {
  getSwChannel().postMessage({ type: 'CLEAR_DONE' })
  setTimeout(refreshSwJobs, 150)
}

function retrySwJob(id: string) {
  getSwChannel().postMessage({ type: 'RETRY_JOB', id })
  const job = swJobs.value.find(j => j.id === id)
  if (job) { job.status = 'queued'; job.error = undefined; job.progress = 0 }
  setTimeout(refreshSwJobs, 300)
}

function cancelSwJob(id: string) {
  getSwChannel().postMessage({ type: 'CANCEL_JOB', id })
  swJobs.value = swJobs.value.filter(j => j.id !== id)
}

function viewSwJobInBucket(objectKey: string) {
  tab.value          = 'bucket'
  bucketFilter.value = objectKey.split('/').slice(0, 2).join('/')
  if (!bucketData.value) fetchBucketObjects()
}

function swBadgeClass(status: string): string {
  if (status === 'done')                           return 'done'
  if (status === 'error')                          return 'error'
  if (status === 'skipped')                        return 'skipped'
  if (status === 'uploading' || status === 'notifying') return 'active'
  if (status === 'conflict')                       return 'conflict'
  return 'pending'
}

function swRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return new Date(ts).toLocaleDateString()
}

const swHasClearable = computed(() =>
  swJobs.value.some(j => j.status === 'done' || j.status === 'error' || j.status === 'skipped'),
)

// ── Watches ────────────────────────────────────────────────────────────────────

watch(mediaFilter,    () => { mediaPage.value = 1 })
watch(mediaPageSize,  () => { mediaPage.value = 1 })
watch(mediaPageCount, (n) => { if (mediaPage.value > n) mediaPage.value = Math.max(1, n) })

watch(bucketFilter,    () => { bucketPage.value = 1 })
watch(bucketPageSize,  () => { bucketPage.value = 1 })
watch(bucketPageCount, (n) => { if (bucketPage.value > n) bucketPage.value = Math.max(1, n) })
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
          <span>{{ data.counts.db_media }} media in DB</span>
        </div>
        <div class="dev-stat">
          <HardDriveIcon :size="14" />
          <span>{{ bucketData ? bucketGroups.length : '—' }} groups in bucket</span>
        </div>
        <div class="dev-stat">
          <ImageIcon :size="14" />
          <span>{{ data.counts.db_libraries }} libraries</span>
        </div>
      </div>

      <!-- Tabs -->
      <div class="dev-admin-tabs">
        <button
          v-for="t in (['media', 'bucket', 'libraries', 'jobs', 'uploads'] as const)"
          :key="t"
          class="dev-admin-tab"
          :class="{ 'is-active': tab === t }"
          @click="tab = t"
        >
          <template v-if="t === 'media'">DB Media</template>
          <template v-else-if="t === 'bucket'">Bucket Objects</template>
          <template v-else-if="t === 'libraries'">Libraries</template>
          <template v-else-if="t === 'jobs'">Background Jobs</template>
          <template v-else>
            SW Uploads
            <span v-if="t === 'uploads' && swJobs.some(j => j.status !== 'done' && j.status !== 'skipped')" class="dev-tab-badge">
              {{ swJobs.filter(j => j.status !== 'done' && j.status !== 'skipped').length }}
            </span>
          </template>
        </button>
      </div>
    </div>

    <!-- Error / Loading states for the overview (only shown for DB-backed tabs) -->
    <template v-if="tab !== 'bucket' && tab !== 'uploads'">
      <div v-if="error" class="dev-admin-error">
        <strong>Error:</strong> {{ error.message }}
        <span v-if="error.statusCode === 401" style="display:block;margin-top:6px;font-size:12px;color:var(--color-text-muted)">
          Your session pre-dates the FastAPI auth update. Log out and back in to refresh it.
        </span>
      </div>
      <div v-else-if="pending" class="dev-admin-loading">Loading…</div>
    </template>

    <!-- ── DB Media tab ─────────────────────────────────────────────────── -->
    <div v-if="!error && !pending && data && tab === 'media'" class="dev-admin-content">
      <p v-if="!data.media.length" class="dev-admin-empty">No media in the database yet.</p>

      <template v-else>
        <!-- Toolbar -->
        <div class="dev-table-toolbar">
          <input v-model="mediaFilter" class="dev-filter-input" placeholder="Filter by name, type, user…" />
          <select v-model="mediaPageSize" class="dev-page-size-select">
            <option v-for="n in PAGE_SIZE_OPTIONS" :key="n" :value="n">{{ n }} / page</option>
          </select>
          <span class="dev-muted" style="font-size:11px;white-space:nowrap">
            {{ sortedMedia.length }} item{{ sortedMedia.length !== 1 ? 's' : '' }}
          </span>
          <button
            v-if="mediaSelected.size > 0"
            class="dev-btn dev-btn-danger"
            style="font-size:12px;padding:5px 12px;margin-left:auto"
            @click="bulkDeleteMediaOpen = true"
          >
            <Trash2Icon :size="13" />
            Delete {{ mediaSelected.size }} selected
          </button>
        </div>

        <div class="dev-table-wrap">
          <table class="dev-table">
            <thead>
              <tr>
                <th class="dev-th-check">
                  <input
                    type="checkbox"
                    :checked="allPageMediaSelected"
                    :class="{ 'is-indeterminate': !allPageMediaSelected && somePageMediaSelected }"
                    @change="toggleSelectAllPageMedia"
                  />
                </th>
                <th>Preview</th>
                <th class="dev-th-sort" @click="toggleMediaSort('original_filename')">
                  Filename <span class="dev-sort-ind">{{ sortIcon('original_filename', mediaSortKey, mediaSortDir) }}</span>
                </th>
                <th class="dev-th-sort" @click="toggleMediaSort('content_type')">
                  Type <span class="dev-sort-ind">{{ sortIcon('content_type', mediaSortKey, mediaSortDir) }}</span>
                </th>
                <th class="dev-th-sort" @click="toggleMediaSort('size')">
                  Size <span class="dev-sort-ind">{{ sortIcon('size', mediaSortKey, mediaSortDir) }}</span>
                </th>
                <th>Dimensions</th>
                <th>Libraries</th>
                <th class="dev-th-sort" @click="toggleMediaSort('created_at')">
                  Uploaded <span class="dev-sort-ind">{{ sortIcon('created_at', mediaSortKey, mediaSortDir) }}</span>
                </th>
                <th class="dev-th-sort" @click="toggleMediaSort('uploader_email')">
                  By <span class="dev-sort-ind">{{ sortIcon('uploader_email', mediaSortKey, mediaSortDir) }}</span>
                </th>
                <th>ID</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in pagedMedia"
                :key="row.id"
                :class="{ 'is-selected': mediaSelected.has(row.id) }"
              >
                <td class="dev-th-check">
                  <input
                    type="checkbox"
                    :checked="mediaSelected.has(row.id)"
                    @change="toggleMediaSelect(row.id)"
                  />
                </td>

                <td class="dev-table-thumb-cell">
                  <button
                    v-if="row.thumbnail_src || row.src"
                    class="dev-thumb-btn"
                    @click="previewSrc = row.src ?? row.thumbnail_src"
                  >
                    <img
                      :src="row.thumbnail_src ?? row.src ?? undefined"
                      :alt="row.original_filename"
                      class="dev-thumb lazy-img"
                      @load="(e) => (e.target as HTMLImageElement).classList.add('is-loaded')"
                    />
                  </button>
                  <span v-else class="dev-thumb-placeholder">—</span>
                </td>

                <td class="dev-table-filename">
                  <span :title="row.original_filename">{{ row.original_filename }}</span>
                  <code class="dev-object-key" :title="row.object_key">{{ row.object_key }}</code>
                </td>

                <td><code class="dev-tag">{{ row.content_type }}</code></td>
                <td class="dev-mono">{{ formatBytes(row.size) }}</td>

                <td class="dev-mono">
                  <template v-if="row.width && row.height">
                    {{ row.width }}×{{ row.height }}
                    <span class="dev-muted"> ({{ row.aspect_ratio?.toFixed(2) }})</span>
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

                <td class="dev-mono">{{ relativeTime(row.created_at) }}</td>
                <td class="dev-mono dev-muted">{{ row.uploader_email ?? '—' }}</td>
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

        <!-- Pagination -->
        <div class="dev-pagination">
          <button class="dev-page-btn" :disabled="mediaPage === 1" @click="mediaPage = 1">⟪</button>
          <button class="dev-page-btn" :disabled="mediaPage === 1" @click="mediaPage--">‹</button>
          <span class="dev-page-info">
            {{ (mediaPage - 1) * mediaPageSize + 1 }}–{{ Math.min(mediaPage * mediaPageSize, sortedMedia.length) }}
            of {{ sortedMedia.length }}
          </span>
          <button class="dev-page-btn" :disabled="mediaPage >= mediaPageCount" @click="mediaPage++">›</button>
          <button class="dev-page-btn" :disabled="mediaPage >= mediaPageCount" @click="mediaPage = mediaPageCount">⟫</button>
        </div>
      </template>
    </div>

    <!-- ── Bucket tab ──────────────────────────────────────────────────── -->
    <div v-if="tab === 'bucket'" class="dev-admin-content">
      <!-- Toolbar -->
      <div class="dev-table-toolbar">
        <button class="dev-admin-refresh" :class="{ 'is-spinning': bucketPending }" @click="fetchBucketObjects">
          <RefreshCwIcon :size="15" />
          Refresh
        </button>
        <label class="dev-toolbar-check-label">
          <input v-model="bucketShowThumbs" type="checkbox" />
          Show thumbnails
        </label>
        <input v-model="bucketFilter" class="dev-filter-input" placeholder="Filter by key…" />
        <select v-model="bucketPageSize" class="dev-page-size-select">
          <option v-for="n in PAGE_SIZE_OPTIONS" :key="n" :value="n">{{ n }} / page</option>
        </select>
        <span v-if="bucketData" class="dev-muted" style="font-size:11px;white-space:nowrap">
          {{ bucketGroups.length }} group{{ bucketGroups.length !== 1 ? 's' : '' }} ({{ bucketData.count }} files)
        </span>
        <button
          v-if="bucketSelected.size > 0"
          class="dev-btn dev-btn-danger"
          style="font-size:12px;padding:5px 12px;margin-left:auto"
          @click="bulkDeleteBucketOpen = true"
        >
          <Trash2Icon :size="13" />
          Delete {{ bucketSelected.size }} selected
        </button>
      </div>

      <div v-if="bucketPending" class="dev-admin-loading">Loading bucket objects…</div>
      <div v-else-if="bucketError" class="dev-admin-error"><strong>Error:</strong> {{ bucketError }}</div>
      <p v-else-if="!bucketData || !bucketData.bucket_objects.length" class="dev-admin-empty">
        Bucket is empty (or storage unreachable).
      </p>

      <template v-else>
        <div class="dev-table-wrap">
          <table class="dev-table">
            <thead>
              <tr>
                <th class="dev-th-check">
                  <input
                    type="checkbox"
                    :checked="allPageBucketSelected"
                    @change="toggleSelectAllPageBucket"
                  />
                </th>
                <th>Preview</th>
                <th class="dev-th-sort" @click="toggleBucketSort('prefix')">
                  Folder / File <span class="dev-sort-ind">{{ sortIcon('prefix', bucketSortKey, bucketSortDir) }}</span>
                </th>
                <th class="dev-th-sort" @click="toggleBucketSort('totalSize')">
                  Size <span class="dev-sort-ind">{{ sortIcon('totalSize', bucketSortKey, bucketSortDir) }}</span>
                </th>
                <th class="dev-th-sort" @click="toggleBucketSort('lastModified')">
                  Modified <span class="dev-sort-ind">{{ sortIcon('lastModified', bucketSortKey, bucketSortDir) }}</span>
                </th>
                <th class="dev-th-sort" @click="toggleBucketSort('status')">
                  Status <span class="dev-sort-ind">{{ sortIcon('status', bucketSortKey, bucketSortDir) }}</span>
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="group in pagedBucketGroups" :key="group.prefix">
                <!-- Group row -->
                <tr :class="{ 'is-selected': bucketSelected.has(group.prefix) }">
                  <td class="dev-th-check">
                    <input
                      type="checkbox"
                      :checked="bucketSelected.has(group.prefix)"
                      @change="toggleBucketSelect(group.prefix)"
                    />
                  </td>
                  <td class="dev-table-thumb-cell">
                    <button
                      v-if="group.thumbObject?.src || group.mainObject?.src"
                      class="dev-thumb-btn"
                      @click="previewSrc = group.thumbObject?.src ?? group.mainObject?.src ?? null"
                    >
                      <img
                        :src="group.thumbObject?.src ?? group.mainObject?.src ?? undefined"
                        class="dev-thumb lazy-img"
                        @load="(e) => (e.target as HTMLImageElement).classList.add('is-loaded')"
                      />
                    </button>
                    <span v-else class="dev-thumb-placeholder">—</span>
                  </td>
                  <td>
                    <code class="dev-object-key">{{ shortGroupPrefix(group.prefix) }}</code>
                    <span class="dev-bucket-main-filename">{{ groupMainFilename(group) }}</span>
                    <span v-if="group.thumbObject" class="dev-bucket-has-thumb">+ thumb</span>
                    <span v-if="group.faceObjects.length" class="dev-bucket-has-thumb" style="color:#a78bfa">+ {{ group.faceObjects.length }} face{{ group.faceObjects.length === 1 ? '' : 's' }}</span>
                    <span v-if="group.extras.length" class="dev-muted" style="font-size:10px"> +{{ group.extras.length }} more</span>
                  </td>
                  <td class="dev-mono">{{ formatBytes(group.totalSize) }}</td>
                  <td class="dev-mono">{{ relativeTime(group.lastModified) }}</td>
                  <td>
                    <span v-if="!group.isOrphan" class="dev-badge-ok">✓ DB</span>
                    <span v-else class="dev-badge-warn">orphan</span>
                  </td>
                  <td class="dev-table-action-cell">
                    <button class="dev-delete-btn" title="Delete group" @click="openDeleteBucketGroup(group)">
                      <Trash2Icon :size="14" />
                    </button>
                  </td>
                </tr>
                <!-- Thumbnail sub-row -->
                <tr v-if="bucketShowThumbs && group.thumbObject" class="dev-bucket-child-row">
                  <td></td>
                  <td></td>
                  <td>
                    <span class="dev-bucket-child-indent">↳</span>
                    <code class="dev-object-key" style="display:inline">{{ group.thumbObject.key.split('/').pop() }}</code>
                  </td>
                  <td class="dev-mono">{{ formatBytes(group.thumbObject.size) }}</td>
                  <td class="dev-mono">{{ relativeTime(group.thumbObject.last_modified) }}</td>
                  <td><span class="dev-muted" style="font-size:10px">thumbnail</span></td>
                  <td></td>
                </tr>
                <!-- Face crop sub-rows -->
                <tr
                  v-for="face in (bucketShowThumbs ? group.faceObjects : [])"
                  :key="face.key"
                  class="dev-bucket-child-row"
                >
                  <td></td>
                  <td class="dev-table-thumb-cell">
                    <button v-if="face.src" class="dev-thumb-btn" @click="previewSrc = face.src">
                      <img :src="face.src" class="dev-thumb lazy-img" style="border-radius:50%;object-fit:cover" @load="(e) => (e.target as HTMLImageElement).classList.add('is-loaded')" />
                    </button>
                    <span v-else class="dev-thumb-placeholder">—</span>
                  </td>
                  <td>
                    <span class="dev-bucket-child-indent">↳</span>
                    <code class="dev-object-key" style="display:inline">{{ face.key.split('/').pop() }}</code>
                  </td>
                  <td class="dev-mono">{{ formatBytes(face.size) }}</td>
                  <td class="dev-mono">{{ relativeTime(face.last_modified) }}</td>
                  <td><span class="dev-muted" style="font-size:10px;color:#a78bfa">face crop</span></td>
                  <td></td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        <div class="dev-pagination">
          <button class="dev-page-btn" :disabled="bucketPage === 1" @click="bucketPage = 1">⟪</button>
          <button class="dev-page-btn" :disabled="bucketPage === 1" @click="bucketPage--">‹</button>
          <span class="dev-page-info">
            {{ (bucketPage - 1) * bucketPageSize + 1 }}–{{ Math.min(bucketPage * bucketPageSize, sortedBucketGroups.length) }}
            of {{ sortedBucketGroups.length }}
          </span>
          <button class="dev-page-btn" :disabled="bucketPage >= bucketPageCount" @click="bucketPage++">›</button>
          <button class="dev-page-btn" :disabled="bucketPage >= bucketPageCount" @click="bucketPage = bucketPageCount">⟫</button>
        </div>
      </template>
    </div>

    <!-- ── Libraries tab ──────────────────────────────────────────────── -->
    <div v-if="!error && !pending && data && tab === 'libraries'" class="dev-admin-content">
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
              <td class="dev-mono dev-muted">{{ lib.owner_email ?? '—' }}</td>
              <td class="dev-mono">
                {{ data.media.filter(m => m.libraries.some(l => l.id === lib.id)).length }}
                <span v-if="libraryOrphanCount(lib.id)" class="dev-muted"> ({{ libraryOrphanCount(lib.id) }} exclusive)</span>
              </td>
              <td class="dev-mono">
                {{ lib.access.length }} users
                <span class="dev-muted"> · {{ lib.share_links.length }} links</span>
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

    <!-- ── Background Jobs tab ───────────────────────────────────────── -->
    <div v-if="tab === 'jobs'" class="dev-admin-content">
      <div class="dev-jobs-header">
        <div class="dev-jobs-controls">
          <div class="dev-jobs-control-group">
            <label class="dev-jobs-label">Library (optional)</label>
            <select
              v-model="jobLibraryId"
              class="dev-form-input"
              style="width:260px;font-size:12px"
            >
              <option value="">All libraries</option>
              <option
                v-for="lib in (data?.libraries ?? [])"
                :key="lib.id"
                :value="lib.id"
              >{{ libraryDisplayName(lib) }} ({{ lib.id.slice(0, 8) }}…)</option>
            </select>
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

      <p v-if="runJobResult" class="dev-run-job-result">{{ runJobResult }}</p>

      <div class="dev-jobs-grid">
        <template v-if="!jobStatuses">
          <p class="dev-muted" style="padding:16px">Loading job statuses…</p>
        </template>

        <template v-else>
          <div
            v-for="(meta, name) in JOB_LABELS"
            :key="name"
            class="dev-job-card"
            :class="{ 'is-running': (jobStatuses[name as JobName]?.running ?? 0) > 0 }"
          >
            <div class="dev-job-card-header">
              <CpuIcon :size="16" class="dev-job-icon" />
              <div class="dev-job-info">
                <span class="dev-job-name">{{ meta.label }}</span>
                <span class="dev-job-desc">{{ meta.desc }}</span>
              </div>
              <!-- Delete pending -->
              <button
                v-if="(jobStatuses[name as JobName]?.pending ?? 0) > 0"
                class="dev-btn dev-btn-ghost"
                style="padding:5px 10px;font-size:11px;white-space:nowrap;flex-shrink:0;color:#f87171"
                :disabled="jobDeletePending[name as JobName]"
                :title="`Delete ${jobStatuses[name as JobName]?.pending} pending ${meta.label} jobs`"
                @click="deletePending(name as JobName)"
              >
                <Trash2Icon :size="12" />
                {{ jobDeletePending[name as JobName] ? 'Deleting…' : 'Delete pending' }}
              </button>
              <!-- Enqueue & Run -->
              <button
                class="dev-btn dev-btn-primary"
                style="padding:6px 14px;font-size:12px;white-space:nowrap;flex-shrink:0"
                :disabled="jobEnqueueing[name as JobName]"
                @click="runJob(name as JobName)"
              >
                {{ jobEnqueueing[name as JobName] ? 'Enqueueing…' : 'Enqueue & Run' }}
              </button>
            </div>

            <!-- Multi-part progress bar -->
            <template v-if="jobStatuses[name as JobName] as JobQueueStatus | undefined">
              <div
                v-if="jobTotal(jobStatuses[name as JobName] as JobQueueStatus) > 0"
                class="dev-job-bar"
                :title="`${(jobStatuses[name as JobName] as JobQueueStatus).completed} done · ${(jobStatuses[name as JobName] as JobQueueStatus).running} running · ${(jobStatuses[name as JobName] as JobQueueStatus).failed} failed · ${(jobStatuses[name as JobName] as JobQueueStatus).pending} pending`"
              >
                <div class="dev-job-bar-seg dev-job-bar-completed" :style="{ width: jobPct((jobStatuses[name as JobName] as JobQueueStatus).completed, jobTotal(jobStatuses[name as JobName] as JobQueueStatus)) + '%' }" />
                <div class="dev-job-bar-seg dev-job-bar-running"   :style="{ width: jobPct((jobStatuses[name as JobName] as JobQueueStatus).running,   jobTotal(jobStatuses[name as JobName] as JobQueueStatus)) + '%' }" />
                <div class="dev-job-bar-seg dev-job-bar-failed"    :style="{ width: jobPct((jobStatuses[name as JobName] as JobQueueStatus).failed,    jobTotal(jobStatuses[name as JobName] as JobQueueStatus)) + '%' }" />
                <div class="dev-job-bar-seg dev-job-bar-pending"   :style="{ width: jobPct((jobStatuses[name as JobName] as JobQueueStatus).pending,   jobTotal(jobStatuses[name as JobName] as JobQueueStatus)) + '%' }" />
              </div>
            </template>

            <!-- Queue counts -->
            <div class="dev-job-counts" v-if="jobStatuses[name as JobName] as JobQueueStatus | undefined">
              <div class="dev-job-count dev-job-count-pending">
                <ClockIcon :size="11" />
                {{ (jobStatuses[name as JobName] as JobQueueStatus).pending }} pending
              </div>
              <div class="dev-job-count dev-job-count-running">
                <span class="dev-job-dot dev-job-dot-running" />
                {{ (jobStatuses[name as JobName] as JobQueueStatus).running }} running
              </div>
              <div class="dev-job-count dev-job-count-done">
                <CheckCircleIcon :size="11" />
                {{ (jobStatuses[name as JobName] as JobQueueStatus).completed }} done
              </div>
              <div class="dev-job-count dev-job-count-failed">
                <XCircleIcon :size="11" />
                {{ (jobStatuses[name as JobName] as JobQueueStatus).failed }} failed
              </div>
            </div>

            <!-- Error from current batch only (backend now scopes to latest batch_id) -->
            <div
              v-if="(jobStatuses[name as JobName] as JobQueueStatus | undefined)?.last_error"
              class="dev-job-error"
            >
              {{ (jobStatuses[name as JobName] as JobQueueStatus).last_error }}
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

      <!-- ── Re-cluster subjects ──────────────────────────────────────────── -->
      <div class="dev-reset-section">
        <h3 class="dev-reset-title">Re-cluster person subjects</h3>
        <p class="dev-muted" style="font-size:12px;margin-bottom:14px">
          Merges person subjects whose face embeddings are within the current
          <code>cluster_threshold</code>. Run this after adjusting thresholds
          (e.g. switching from dlib to insightface). Scoped to the library selected above,
          or all libraries if none selected.
        </p>
        <button
          class="dev-btn dev-btn-ghost"
          :disabled="reclusterPending"
          @click="reclusterSubjects"
        >
          {{ reclusterPending ? 'Re-clustering…' : 'Re-cluster subjects' }}
        </button>
        <p v-if="reclusterResult" class="dev-reset-result">{{ reclusterResult }}</p>
      </div>

      <!-- ── Recent jobs table ─────────────────────────────────────────────── -->
      <div class="dev-reset-section">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
          <h3 class="dev-reset-title" style="margin-bottom:0">Recent Jobs</h3>
          <button class="dev-btn dev-btn-ghost" style="font-size:11px;padding:4px 10px" :disabled="recentJobsPending" @click="fetchRecentJobs">
            <RefreshCwIcon :size="12" :class="{ 'is-spinning': recentJobsPending }" />
            Refresh
          </button>
          <button class="dev-btn dev-btn-ghost" style="font-size:11px;padding:4px 10px" @click="recentJobsExpanded = !recentJobsExpanded">
            {{ recentJobsExpanded ? 'Collapse' : 'Expand' }}
          </button>
        </div>
        <p v-if="!recentJobs.length && !recentJobsPending" class="dev-muted" style="font-size:12px">No recent jobs found.</p>
        <div v-else-if="recentJobs.length" class="dev-table-wrap">
          <table class="dev-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Status</th>
                <th>Media ID</th>
                <th>Started</th>
                <th>Completed</th>
                <th>Duration</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="job in (recentJobsExpanded ? recentJobs : recentJobs.slice(0, 20))"
                :key="job.id"
                :class="{
                  'dev-job-row-running':   job.status === 'running',
                  'dev-job-row-failed':    job.status === 'failed',
                  'dev-job-row-completed': job.status === 'completed',
                }"
              >
                <td class="dev-mono" style="font-size:11px">{{ job.type }}</td>
                <td>
                  <span
                    class="dev-badge-ok"
                    :class="{
                      'dev-badge-warn':   job.status === 'failed',
                      'dev-badge-muted':  job.status === 'pending',
                      'dev-badge-active': job.status === 'running',
                    }"
                  >{{ job.status }}</span>
                </td>
                <td class="dev-mono" style="font-size:10px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="job.media_id">{{ job.media_id.slice(0, 8) }}…</td>
                <td class="dev-mono" style="font-size:11px">{{ fmtTimestamp(job.started_at) }}</td>
                <td class="dev-mono" style="font-size:11px">{{ fmtTimestamp(job.completed_at) }}</td>
                <td class="dev-mono" style="font-size:11px">{{ fmtDuration(job.duration_ms) }}</td>
                <td style="font-size:10px;color:#f87171;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="job.error ?? ''">{{ job.error ?? '' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="!recentJobsExpanded && recentJobs.length > 20" class="dev-muted" style="font-size:11px;text-align:center;margin-top:6px">
            Showing 20 of {{ recentJobs.length }} — <button class="dev-btn-inline" @click="recentJobsExpanded = true">show all</button>
          </p>
        </div>
      </div>
    </div>

    <!-- ── SW Upload Jobs tab ────────────────────────────────────────────── -->
    <div v-if="tab === 'uploads'" class="dev-admin-content">

      <!-- Toolbar -->
      <div class="dev-sw-toolbar">
        <span class="dev-sw-toolbar-count">
          {{ swJobs.length }} job{{ swJobs.length !== 1 ? 's' : '' }} in SW IndexedDB
        </span>
        <div class="dev-sw-toolbar-actions">
          <button class="dev-btn dev-btn-ghost dev-sw-refresh-btn" :disabled="swJobsLoading" @click="refreshSwJobs">
            <RefreshCwIcon :size="13" :class="{ 'is-spinning': swJobsLoading }" />
            Refresh
          </button>
          <button class="dev-btn dev-btn-ghost" :disabled="!swHasClearable" @click="clearSwDone">
            <Trash2Icon :size="13" />
            Clear done / errors
          </button>
        </div>
      </div>

      <!-- Empty state -->
      <p v-if="!swJobsLoading && !swJobs.length" class="dev-admin-empty">
        No upload jobs in SW storage.
      </p>

      <!-- Jobs table -->
      <div v-else class="dev-sw-table-wrap">
        <table class="dev-sw-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Age</th>
              <th>Object Key</th>
              <th>Media</th>
              <th style="text-align:right">Actions</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="job in swJobs" :key="job.id">
              <tr class="dev-sw-row" :class="`dev-sw-row-${swBadgeClass(job.status)}`">
                <!-- Filename + short ID -->
                <td>
                  <div class="dev-sw-cell-file">
                    <span class="dev-sw-filename">{{ job.filename || '(unnamed)' }}</span>
                    <span class="dev-muted dev-sw-jobid">{{ job.id.slice(0, 8) }}…</span>
                  </div>
                </td>

                <!-- Status badge -->
                <td>
                  <span class="dev-sw-badge" :class="`dev-sw-badge-${swBadgeClass(job.status)}`">
                    {{ job.status }}
                  </span>
                </td>

                <!-- Progress -->
                <td>
                  <div v-if="job.status === 'uploading'" class="dev-sw-progress-wrap">
                    <div class="dev-sw-progress-track">
                      <div class="dev-sw-progress-fill" :style="{ width: job.progress + '%' }" />
                    </div>
                    <span class="dev-muted" style="font-size:10px">{{ job.progress }}%</span>
                  </div>
                  <span v-else class="dev-muted">{{ job.progress > 0 ? job.progress + '%' : '—' }}</span>
                </td>

                <!-- Age -->
                <td class="dev-muted">{{ swRelativeTime(job.createdAt) }}</td>

                <!-- Object key (last two path segments) -->
                <td>
                  <span
                    v-if="job.objectKey"
                    class="dev-sw-key dev-muted"
                    :title="job.objectKey"
                  >
                    …/{{ job.objectKey.split('/').slice(-2).join('/') }}
                  </span>
                  <span v-else class="dev-muted">—</span>
                </td>

                <!-- Media ID / link -->
                <td>
                  <a
                    v-if="job.mediaId"
                    class="dev-sw-media-link"
                    :href="`/#media-${job.mediaId}`"
                    target="_blank"
                    :title="job.mediaId"
                  >
                    {{ job.mediaId.slice(0, 8) }}…
                  </a>
                  <span v-else class="dev-muted">—</span>
                </td>

                <!-- Actions -->
                <td>
                  <div class="dev-sw-row-actions">
                    <button
                      v-if="job.objectKey"
                      class="dev-btn-icon"
                      title="View in bucket tab"
                      @click="viewSwJobInBucket(job.objectKey)"
                    >
                      <HardDriveIcon :size="13" />
                    </button>
                    <button
                      v-if="job.status === 'error'"
                      class="dev-btn-icon"
                      title="Retry upload"
                      @click="retrySwJob(job.id)"
                    >
                      <RefreshCwIcon :size="13" />
                    </button>
                    <button
                      class="dev-btn-icon dev-btn-icon-danger"
                      title="Cancel / remove from queue"
                      @click="cancelSwJob(job.id)"
                    >
                      <XIcon :size="13" />
                    </button>
                  </div>
                </td>
              </tr>

              <!-- Error detail row -->
              <tr v-if="job.error" class="dev-sw-error-row" :key="`${job.id}-err`">
                <td colspan="7" class="dev-sw-error-cell">
                  <AlertTriangleIcon :size="11" style="color:#f87171;flex-shrink:0" />
                  {{ job.error }}
                </td>
              </tr>
            </template>
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
            <span class="dev-dialog-title">Delete media record</span>
            <button class="dev-detail-close" @click="deleteDbTarget = null"><XIcon :size="16" /></button>
          </div>
          <div class="dev-dialog-body">
            <p>Delete <strong>{{ deleteDbTarget.original_filename }}</strong> from the database?</p>
            <p class="dev-muted" style="font-size:11px;margin-top:4px">ID: {{ deleteDbTarget.id }}</p>
            <label class="dev-dialog-check">
              <input v-model="deleteDbObjects" type="checkbox" />
              Also delete from storage <span class="dev-muted">(main file + thumbnail)</span>
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
              <input v-model="editForm.original_filename" type="text" class="dev-form-input" />
            </div>
            <div class="dev-form-field">
              <label class="dev-form-label">Taken at <span class="dev-muted">(local time)</span></label>
              <input v-model="editForm.taken_at" type="datetime-local" class="dev-form-input" />
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
                <input v-model="editForm.aspect_ratio" type="number" step="0.0001" min="0" class="dev-form-input" />
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

    <!-- ── Delete bucket group dialog ────────────────────────────────────── -->
    <Transition name="dev-lightbox">
      <div v-if="deleteBucketGroup" class="dev-lightbox" @click="deleteBucketGroup = null">
        <div class="dev-dialog" @click.stop>
          <div class="dev-dialog-header">
            <AlertTriangleIcon :size="16" style="color:#ef4444" />
            <span class="dev-dialog-title">Delete from storage</span>
            <button class="dev-detail-close" @click="deleteBucketGroup = null"><XIcon :size="16" /></button>
          </div>
          <div class="dev-dialog-body">
            <p>Delete <strong>{{ groupMainFilename(deleteBucketGroup) }}</strong>?</p>
            <code class="dev-object-key-full" style="margin-top:4px;display:block">{{ deleteBucketGroup.prefix }}</code>

            <label class="dev-dialog-check" v-if="deleteBucketGroup.thumbObject">
              <input v-model="deleteBucketThumb" type="checkbox" />
              Also delete thumbnail <span class="dev-muted">({{ deleteBucketGroup.thumbObject.key.split('/').pop() }})</span>
            </label>

            <label class="dev-dialog-check" v-if="!deleteBucketGroup.isOrphan">
              <input v-model="deleteBucketDbRec" type="checkbox" />
              Also delete associated DB record
            </label>
            <p v-if="deleteBucketGroup.isOrphan" class="dev-muted" style="font-size:11px">
              No DB record found for this object — storage only.
            </p>

            <p v-if="deleteBucketErr" class="dev-dialog-error">{{ deleteBucketErr }}</p>
          </div>
          <div class="dev-dialog-footer">
            <button class="dev-btn dev-btn-ghost" :disabled="deleteBucketPend" @click="deleteBucketGroup = null">Cancel</button>
            <button class="dev-btn dev-btn-danger" :disabled="deleteBucketPend" @click="confirmDeleteBucketGroup">
              {{ deleteBucketPend ? 'Deleting…' : 'Delete' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ── Bulk delete media dialog ───────────────────────────────────────── -->
    <Transition name="dev-lightbox">
      <div v-if="bulkDeleteMediaOpen" class="dev-lightbox" @click="bulkDeleteMediaOpen = false">
        <div class="dev-dialog" @click.stop>
          <div class="dev-dialog-header">
            <AlertTriangleIcon :size="16" style="color:#ef4444" />
            <span class="dev-dialog-title">Bulk delete {{ mediaSelected.size }} records</span>
            <button class="dev-detail-close" @click="bulkDeleteMediaOpen = false"><XIcon :size="16" /></button>
          </div>
          <div class="dev-dialog-body">
            <p>Permanently delete <strong>{{ mediaSelected.size }}</strong> selected media record{{ mediaSelected.size !== 1 ? 's' : '' }} from the database?</p>
            <label class="dev-dialog-check">
              <input v-model="bulkDeleteMediaObjects" type="checkbox" />
              Also delete from storage <span class="dev-muted">(main file + thumbnail for each)</span>
            </label>
            <p v-if="bulkDeleteMediaError" class="dev-dialog-error">{{ bulkDeleteMediaError }}</p>
          </div>
          <div class="dev-dialog-footer">
            <button class="dev-btn dev-btn-ghost" :disabled="bulkDeleteMediaPending" @click="bulkDeleteMediaOpen = false">Cancel</button>
            <button class="dev-btn dev-btn-danger" :disabled="bulkDeleteMediaPending" @click="confirmBulkDeleteMedia">
              {{ bulkDeleteMediaPending ? 'Deleting…' : `Delete ${mediaSelected.size} records` }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ── Bulk delete bucket dialog ──────────────────────────────────────── -->
    <Transition name="dev-lightbox">
      <div v-if="bulkDeleteBucketOpen" class="dev-lightbox" @click="bulkDeleteBucketOpen = false">
        <div class="dev-dialog" @click.stop>
          <div class="dev-dialog-header">
            <AlertTriangleIcon :size="16" style="color:#ef4444" />
            <span class="dev-dialog-title">Bulk delete {{ bucketSelected.size }} groups</span>
            <button class="dev-detail-close" @click="bulkDeleteBucketOpen = false"><XIcon :size="16" /></button>
          </div>
          <div class="dev-dialog-body">
            <p>Delete <strong>{{ bucketSelected.size }}</strong> selected group{{ bucketSelected.size !== 1 ? 's' : '' }} from storage?</p>
            <label class="dev-dialog-check">
              <input v-model="bulkDeleteBucketThumb" type="checkbox" />
              Also delete thumbnails <span class="dev-muted">(if present)</span>
            </label>
            <label class="dev-dialog-check">
              <input v-model="bulkDeleteBucketDb" type="checkbox" />
              Also delete associated DB records
            </label>
            <p v-if="bulkDeleteBucketError" class="dev-dialog-error">{{ bulkDeleteBucketError }}</p>
          </div>
          <div class="dev-dialog-footer">
            <button class="dev-btn dev-btn-ghost" :disabled="bulkDeleteBucketPending" @click="bulkDeleteBucketOpen = false">Cancel</button>
            <button class="dev-btn dev-btn-danger" :disabled="bulkDeleteBucketPending" @click="confirmBulkDeleteBucket">
              {{ bulkDeleteBucketPending ? 'Deleting…' : `Delete ${bucketSelected.size} groups` }}
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
            <div v-if="accessLibTarget.owner_email" class="dev-access-row dev-access-row-owner">
              <span class="dev-access-email">{{ accessLibTarget.owner_email }}</span>
              <code class="dev-tag">owner</code>
              <span class="dev-muted" style="font-size:11px;margin-left:auto">library owner</span>
            </div>

            <div
              v-for="entry in accessLibTarget.access"
              :key="entry.user_id"
              class="dev-access-row"
            >
              <span class="dev-access-email">{{ entry.email }}</span>
              <select
                class="dev-role-select"
                :value="entry.role"
                @change="changeAccessRole(entry.user_id, ($event.target as HTMLSelectElement).value as 'owner' | 'editor' | 'viewer')"
              >
                <option value="owner">owner</option>
                <option value="editor">editor</option>
                <option value="viewer">viewer</option>
              </select>
              <button class="dev-delete-btn" title="Remove access" @click="removeAccess(entry.user_id)">
                <XIcon :size="13" />
              </button>
            </div>

            <p v-if="!accessLibTarget.owner_email && !accessLibTarget.access.length" class="dev-muted" style="font-size:12px">
              No access entries. Add a user below.
            </p>

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
            <p v-if="!shareLinksLibTarget.share_links.length" class="dev-admin-empty" style="padding:24px">
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
                <tr v-for="link in shareLinksLibTarget.share_links" :key="link.id">
                  <td class="dev-mono" style="font-size:11px">
                    <span v-if="link.media_ids">{{ link.media_ids.length }} photo(s)</span>
                    <span v-else-if="link.album_id">Album</span>
                    <span v-else>Whole library</span>
                  </td>
                  <td class="dev-mono dev-muted">{{ link.created_by_email ?? '—' }}</td>
                  <td class="dev-mono">{{ relativeTime(link.created_at) }}</td>
                  <td class="dev-mono">{{ link.expires_at ? relativeTime(link.expires_at) : 'Never' }}</td>
                  <td>
                    <span :style="shareLinkStatus(link).style" style="font-size:11px;font-family:monospace">
                      {{ shareLinkStatus(link).label }}
                    </span>
                  </td>
                  <td class="dev-table-action-cell">
                    <button
                      v-if="!link.revoked_at"
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
            <div v-if="detailItem.src && isImage(detailItem.content_type)" class="dev-detail-thumb-wrap">
              <img :src="detailItem.src" class="dev-detail-thumb" :alt="detailItem.original_filename" />
            </div>
            <table class="dev-detail-table">
              <tbody>
                <tr><th>ID</th><td><code>{{ detailItem.id }}</code></td></tr>
                <tr><th>Filename</th><td>{{ detailItem.original_filename }}</td></tr>
                <tr><th>Object key</th><td><code>{{ detailItem.object_key }}</code></td></tr>
                <tr><th>Content type</th><td><code>{{ detailItem.content_type }}</code></td></tr>
                <tr><th>Size</th><td>{{ formatBytes(detailItem.size) }} ({{ detailItem.size.toLocaleString() }} bytes)</td></tr>
                <tr>
                  <th>Dimensions</th>
                  <td>
                    <template v-if="detailItem.width && detailItem.height">
                      {{ detailItem.width }} × {{ detailItem.height }} px
                      <span class="dev-muted"> — ratio {{ detailItem.aspect_ratio?.toFixed(4) }}</span>
                    </template>
                    <span v-else class="dev-muted">not recorded</span>
                  </td>
                </tr>
                <tr>
                  <th>Taken at</th>
                  <td>
                    <template v-if="detailItem.taken_at">
                      {{ new Date(detailItem.taken_at).toLocaleString() }}
                      <code class="dev-muted"> ({{ detailItem.taken_at }})</code>
                    </template>
                    <span v-else class="dev-muted">NULL — not recorded</span>
                  </td>
                </tr>
                <tr>
                  <th>Created at</th>
                  <td>
                    {{ detailItem.created_at ? new Date(detailItem.created_at).toLocaleString() : '—' }}
                    <code class="dev-muted"> ({{ detailItem.created_at ?? 'null' }})</code>
                  </td>
                </tr>
                <tr><th>Uploaded by</th><td>{{ detailItem.uploader_email ?? '—' }}</td></tr>
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
.dev-admin-refresh.is-spinning svg { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.dev-admin-cleanup {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 7px;
  border: 1px solid color-mix(in srgb, #ef4444 40%, transparent);
  background: transparent; color: #ef4444;
  cursor: pointer; font-size: 12px; transition: background 0.12s;
}
.dev-admin-cleanup:hover:not(:disabled) { background: color-mix(in srgb, #ef4444 10%, transparent); }
.dev-admin-cleanup:disabled { opacity: 0.5; cursor: not-allowed; }

.dev-cleanup-result {
  font-size: 12px; color: var(--color-text-muted);
  padding: 4px 8px; background: var(--color-surface);
  border: 1px solid var(--color-border); border-radius: 6px;
}

/* ── Stat pills ──────────────────────────────────────────────────────────── */
.dev-admin-stats { display: flex; gap: 16px; margin-bottom: 14px; }
.dev-stat {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--color-text-secondary);
}

/* ── Tabs ────────────────────────────────────────────────────────────────── */
.dev-admin-tabs { display: flex; gap: 0; }
.dev-admin-tab {
  padding: 8px 18px; border: none; background: transparent;
  color: var(--color-text-muted); font-size: 13px; cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color 0.12s, border-color 0.12s; margin-bottom: -1px;
}
.dev-admin-tab:hover { color: var(--color-text-secondary); }
.dev-admin-tab.is-active { color: var(--color-accent); border-bottom-color: var(--color-accent); font-weight: 600; }

/* ── Content area ────────────────────────────────────────────────────────── */
.dev-admin-content { padding: 20px 28px; }
.dev-admin-loading, .dev-admin-empty { padding: 40px 28px; color: var(--color-text-muted); text-align: center; }
.dev-admin-error { padding: 16px 28px; color: #ef4444; }

/* ── Table toolbar ───────────────────────────────────────────────────────── */
.dev-table-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.dev-filter-input {
  padding: 6px 10px;
  border-radius: 7px;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text-primary);
  font-size: 12px;
  font-family: inherit;
  width: 220px;
  flex-shrink: 0;
}
.dev-filter-input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 20%, transparent);
}

.dev-page-size-select {
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text-secondary);
  font-size: 12px;
  cursor: pointer;
}

.dev-toolbar-check-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-secondary);
  cursor: pointer;
  white-space: nowrap;
}

/* ── Table ───────────────────────────────────────────────────────────────── */
.dev-table-wrap { overflow-x: auto; border: 1px solid var(--color-border); border-radius: 8px; }
.dev-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.dev-table th {
  text-align: left; padding: 9px 12px;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-muted); font-weight: 600;
  white-space: nowrap; background: var(--color-surface);
}
.dev-table td {
  padding: 8px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-border) 50%, transparent);
  vertical-align: middle;
}
.dev-table tr:last-child td { border-bottom: none; }
.dev-table tr:hover td { background: var(--color-hover); }
.dev-table tr.is-selected td { background: color-mix(in srgb, var(--color-accent) 6%, transparent); }

/* ── Sortable headers ────────────────────────────────────────────────────── */
.dev-th-sort {
  cursor: pointer;
  user-select: none;
}
.dev-th-sort:hover { color: var(--color-text-primary); }
.dev-sort-ind {
  font-size: 10px;
  opacity: 0.6;
  margin-left: 3px;
}

/* ── Checkbox column ─────────────────────────────────────────────────────── */
.dev-th-check {
  width: 36px;
  padding: 6px 8px !important;
  text-align: center !important;
}
.dev-th-check input[type="checkbox"] {
  accent-color: var(--color-accent);
  cursor: pointer;
}

/* ── Pagination ──────────────────────────────────────────────────────────── */
.dev-pagination {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  justify-content: center;
}

.dev-page-btn {
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 28px;
  border-radius: 6px; border: 1px solid var(--color-border);
  background: transparent; color: var(--color-text-secondary);
  cursor: pointer; font-size: 13px;
  transition: background 0.1s, color 0.1s;
}
.dev-page-btn:hover:not(:disabled) { background: var(--color-hover); color: var(--color-text-primary); }
.dev-page-btn:disabled { opacity: 0.35; cursor: not-allowed; }

.dev-page-info {
  font-size: 11px;
  color: var(--color-text-muted);
  font-family: 'Geist Mono', monospace;
  padding: 0 8px;
  white-space: nowrap;
}

/* ── Cell types ──────────────────────────────────────────────────────────── */
.dev-table-thumb-cell { width: 64px; padding: 6px 8px; }
.dev-thumb-btn {
  display: block; width: 52px; height: 52px;
  border: 1px solid var(--color-border); border-radius: 4px;
  overflow: hidden; cursor: zoom-in; padding: 0;
  background: var(--color-skeleton-base);
}
.dev-thumb { width: 100%; height: 100%; object-fit: cover; }
.dev-thumb-placeholder {
  display: block; width: 52px; height: 52px; line-height: 52px;
  text-align: center; color: var(--color-text-muted);
  background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 4px; font-size: 18px;
}
.dev-table-filename { max-width: 240px; }
.dev-table-filename span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.dev-object-key, .dev-object-key-full {
  display: block; font-size: 10px; color: var(--color-text-muted);
  font-family: 'Geist Mono', monospace;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px;
}
.dev-object-key-full { max-width: 360px; }

.dev-mono  { font-family: 'Geist Mono', monospace; white-space: nowrap; }
.dev-muted { color: var(--color-text-muted); }
.dev-uuid  { font-family: 'Geist Mono', monospace; font-size: 11px; color: var(--color-text-muted); }

.dev-tag {
  display: inline-block; font-family: 'Geist Mono', monospace; font-size: 10px;
  padding: 1px 6px; border-radius: 4px;
  background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-secondary);
}
.dev-tag-lib {
  margin-right: 4px;
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  border-color: color-mix(in srgb, var(--color-accent) 30%, transparent);
  color: var(--color-accent);
}
.dev-badge-ok     { font-family: 'Geist Mono', monospace; font-size: 10px; color: #22c55e; }
.dev-badge-warn   { font-family: 'Geist Mono', monospace; font-size: 10px; color: #f59e0b; }
.dev-badge-muted  { font-family: 'Geist Mono', monospace; font-size: 10px; color: var(--color-text-muted); }
.dev-badge-active { font-family: 'Geist Mono', monospace; font-size: 10px; color: #60a5fa; }

.dev-job-row-running   td { background: rgba(96, 165, 250, 0.04); }
.dev-job-row-failed    td { background: rgba(248, 113, 113, 0.05); }
.dev-job-row-completed td { background: rgba(34, 197, 94, 0.03); }

.dev-btn-inline {
  background: none;
  border: none;
  padding: 0;
  color: var(--color-accent);
  font-size: inherit;
  cursor: pointer;
  text-decoration: underline;
}

/* ── Bucket tree rows ────────────────────────────────────────────────────── */
.dev-bucket-main-filename {
  display: block;
  font-size: 12px;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 280px;
}

.dev-bucket-has-thumb {
  display: inline-block;
  font-size: 10px;
  color: var(--color-text-muted);
  font-family: 'Geist Mono', monospace;
  margin-left: 4px;
  padding: 0 4px;
  border: 1px solid var(--color-border);
  border-radius: 3px;
}

.dev-bucket-child-row td {
  background: color-mix(in srgb, var(--color-surface) 60%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--color-border) 30%, transparent);
  padding-top: 4px;
  padding-bottom: 4px;
}

.dev-bucket-child-indent {
  color: var(--color-text-muted);
  margin-right: 6px;
  font-size: 12px;
}

/* ── Lightbox ────────────────────────────────────────────────────────────── */
.dev-lightbox {
  position: fixed; inset: 0; z-index: 999;
  background: rgba(0, 0, 0, 0.88);
  display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 12px; cursor: zoom-out;
}
.dev-lightbox-img {
  max-width: 90vw; max-height: 85vh; object-fit: contain;
  border-radius: 4px; box-shadow: 0 8px 48px rgba(0,0,0,0.5); cursor: default;
}
.dev-lightbox-hint { font-size: 12px; color: rgba(255,255,255,0.4); }
.dev-lightbox-enter-active, .dev-lightbox-leave-active { transition: opacity 0.18s ease; }
.dev-lightbox-enter-from, .dev-lightbox-leave-to { opacity: 0; }

/* ── Action buttons ──────────────────────────────────────────────────────── */
.dev-table-action-cell { width: 90px; padding: 4px 6px; }
.dev-action-group { display: flex; gap: 4px; align-items: center; }
.dev-info-btn, .dev-edit-btn, .dev-delete-btn {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 6px;
  border: 1px solid var(--color-border); background: transparent;
  cursor: pointer; transition: background 0.1s, color 0.1s; flex-shrink: 0;
}
.dev-info-btn   { color: var(--color-text-muted); }
.dev-edit-btn   { color: var(--color-text-muted); }
.dev-delete-btn { color: var(--color-text-muted); }
.dev-info-btn:hover   { background: var(--color-hover); color: var(--color-accent); }
.dev-edit-btn:hover   { background: var(--color-hover); color: #3b82f6; }
.dev-delete-btn:hover { background: color-mix(in srgb, #ef4444 12%, transparent); color: #ef4444; border-color: color-mix(in srgb, #ef4444 40%, transparent); }

/* ── Detail panel ────────────────────────────────────────────────────────── */
.dev-detail-panel {
  background: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: 12px; box-shadow: 0 24px 64px rgba(0,0,0,0.3);
  width: min(600px, 92vw); max-height: 85vh;
  display: flex; flex-direction: column; overflow: hidden; cursor: default;
}
.dev-detail-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 1px solid var(--color-border); flex-shrink: 0;
}
.dev-detail-title { font-size: 14px; font-weight: 600; color: var(--color-text-primary); }
.dev-detail-close {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 6px; border: none;
  background: transparent; color: var(--color-text-muted); cursor: pointer;
}
.dev-detail-close:hover { background: var(--color-hover); color: var(--color-text-primary); }
.dev-detail-body { overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.dev-detail-thumb-wrap { display: flex; justify-content: center; }
.dev-detail-thumb { max-width: 100%; max-height: 200px; object-fit: contain; border-radius: 6px; border: 1px solid var(--color-border); }
.dev-detail-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.dev-detail-table th {
  text-align: left; width: 120px; padding: 6px 10px 6px 0;
  color: var(--color-text-muted); font-weight: 600; vertical-align: top;
  white-space: nowrap; border-bottom: 1px solid color-mix(in srgb, var(--color-border) 50%, transparent);
}
.dev-detail-table td {
  padding: 6px 0; color: var(--color-text-primary); word-break: break-all;
  border-bottom: 1px solid color-mix(in srgb, var(--color-border) 50%, transparent);
  font-family: 'Geist Mono', monospace;
}
.dev-detail-table tr:last-child th, .dev-detail-table tr:last-child td { border-bottom: none; }

/* ── Shared dialog ───────────────────────────────────────────────────────── */
.dev-dialog {
  background: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: 12px; box-shadow: 0 24px 64px rgba(0,0,0,0.3);
  width: min(420px, 92vw); display: flex; flex-direction: column; overflow: hidden; cursor: default;
}
.dev-dialog-wide { width: min(560px, 92vw); }
.dev-dialog-header {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 16px; border-bottom: 1px solid var(--color-border); flex-shrink: 0;
}
.dev-dialog-title { font-size: 14px; font-weight: 600; color: var(--color-text-primary); flex: 1; }
.dev-dialog-body { padding: 16px; display: flex; flex-direction: column; gap: 12px; font-size: 13px; color: var(--color-text-primary); }
.dev-dialog-check {
  display: flex; align-items: flex-start; gap: 8px; font-size: 12px;
  color: var(--color-text-secondary); cursor: pointer; user-select: none;
  padding: 8px 10px; border-radius: 7px;
  border: 1px solid var(--color-border); background: var(--color-surface-raised, var(--color-surface));
}
.dev-dialog-check input[type="checkbox"] { flex-shrink: 0; accent-color: var(--color-accent); margin-top: 1px; }
.dev-dialog-check-sub { margin-left: 20px; border-style: dashed; color: var(--color-text-muted); }
.dev-dialog-error {
  font-size: 12px; color: #ef4444;
  padding: 6px 10px; background: color-mix(in srgb, #ef4444 10%, transparent);
  border-radius: 6px; border: 1px solid color-mix(in srgb, #ef4444 30%, transparent);
}
.dev-dialog-footer {
  display: flex; gap: 8px; justify-content: flex-end;
  padding: 12px 16px; border-top: 1px solid var(--color-border);
  background: var(--color-surface-raised, var(--color-surface));
}

/* ── Dialog buttons ──────────────────────────────────────────────────────── */
.dev-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px; border-radius: 7px; font-size: 13px; font-weight: 500;
  cursor: pointer; border: 1px solid transparent; transition: background 0.12s, opacity 0.12s;
}
.dev-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.dev-btn-ghost { border-color: var(--color-border); background: transparent; color: var(--color-text-secondary); }
.dev-btn-ghost:hover:not(:disabled) { background: var(--color-hover); }
.dev-btn-primary { background: var(--color-accent); color: #fff; border-color: transparent; }
.dev-btn-primary:hover:not(:disabled) { filter: brightness(1.1); }
.dev-btn-danger { background: rgba(248,113,113,0.12); color: #f87171; border-color: rgba(248,113,113,0.3); }
.dev-btn-danger:hover:not(:disabled) { background: rgba(248,113,113,0.22); }

/* ── Form ────────────────────────────────────────────────────────────────── */
.dev-form-field { display: flex; flex-direction: column; gap: 4px; flex: 1; }
.dev-form-label { font-size: 11px; font-weight: 600; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.dev-form-input {
  padding: 7px 10px; border-radius: 7px; border: 1px solid var(--color-border);
  background: var(--color-bg); color: var(--color-text-primary); font-size: 13px; font-family: inherit; width: 100%;
}
.dev-form-input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 20%, transparent); }
.dev-form-row { display: flex; gap: 10px; }

/* ── Library access dialog ───────────────────────────────────────────────── */
.dev-access-row {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: 7px; border: 1px solid var(--color-border); font-size: 12px;
}
.dev-access-row-owner {
  background: color-mix(in srgb, var(--color-accent) 6%, transparent);
  border-color: color-mix(in srgb, var(--color-accent) 25%, transparent);
}
.dev-access-email { flex: 1; font-family: 'Geist Mono', monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-text-primary); }
.dev-role-select {
  padding: 4px 6px; border-radius: 5px; border: 1px solid var(--color-border);
  background: var(--color-bg); color: var(--color-text-secondary); font-size: 11px; font-family: 'Geist Mono', monospace; cursor: pointer;
}
.dev-access-add-row { display: flex; gap: 8px; align-items: center; padding-top: 4px; border-top: 1px solid var(--color-border); margin-top: 4px; }

/* ── Jobs tab ─────────────────────────────────────────────────────────────── */
.dev-jobs-header {
  display: flex; align-items: flex-end; gap: 24px;
  padding: 16px 20px; border-bottom: 1px solid var(--color-border); flex-wrap: wrap;
}
.dev-jobs-controls { display: flex; align-items: center; gap: 20px; flex: 1; flex-wrap: wrap; }
.dev-jobs-control-group { display: flex; flex-direction: column; gap: 4px; }
.dev-jobs-label { font-size: 11px; color: var(--color-text-muted); font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em; }
.dev-jobs-checkbox-label { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--color-text-secondary); cursor: pointer; padding-top: 18px; }

.dev-run-job-result {
  margin: 12px 20px 0;
  font-size: 12px; color: var(--color-text-muted); font-family: monospace;
  padding: 6px 10px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 6px;
}

.dev-jobs-grid { padding: 16px 20px; display: flex; flex-direction: column; gap: 10px; }

.dev-job-card {
  border: 1px solid var(--color-border); border-radius: 10px;
  overflow: hidden; background: var(--color-surface-raised);
  transition: border-color 0.15s;
}
.dev-job-card.is-running { border-color: var(--color-accent); }
.dev-job-card-header { display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
.dev-job-icon { color: var(--color-text-muted); flex-shrink: 0; }
.dev-job-info { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.dev-job-name { font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
.dev-job-desc { font-size: 11px; color: var(--color-text-muted); }

/* ── Progress bar ──────────────────────────────────────────────────────────── */
.dev-job-bar {
  height: 5px; margin: 0 16px 10px; border-radius: 3px;
  background: var(--color-surface); overflow: hidden;
  display: flex; cursor: default;
}
.dev-job-bar-seg { height: 100%; transition: width 0.4s ease; min-width: 0; }
.dev-job-bar-completed { background: #22c55e; }
.dev-job-bar-running   { background: var(--color-accent); }
.dev-job-bar-failed    { background: #f87171; }
.dev-job-bar-pending   { background: var(--color-border); }

.dev-job-counts {
  display: flex; gap: 6px; flex-wrap: wrap;
  padding: 0 16px 12px;
}
.dev-job-count {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; font-family: 'Geist Mono', monospace;
  padding: 2px 8px; border-radius: 20px; border: 1px solid;
}
.dev-job-count-pending  { color: #f59e0b; border-color: color-mix(in srgb, #f59e0b 30%, transparent); background: color-mix(in srgb, #f59e0b 8%, transparent); }
.dev-job-count-running  { color: var(--color-accent); border-color: color-mix(in srgb, var(--color-accent) 30%, transparent); background: color-mix(in srgb, var(--color-accent) 8%, transparent); }
.dev-job-count-done     { color: #22c55e; border-color: color-mix(in srgb, #22c55e 30%, transparent); background: color-mix(in srgb, #22c55e 8%, transparent); }
.dev-job-count-failed   { color: #f87171; border-color: color-mix(in srgb, #f87171 30%, transparent); background: color-mix(in srgb, #f87171 8%, transparent); }

.dev-job-dot-running {
  display: inline-block; width: 6px; height: 6px; border-radius: 50%;
  background: var(--color-accent); animation: pulse 1s ease-in-out infinite;
}
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

.dev-job-error {
  padding: 0 16px 12px;
  font-size: 11px; color: #f87171; font-family: 'Geist Mono', monospace;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* ── Reset section ─────────────────────────────────────────────────────────── */
.dev-reset-section { padding: 20px; border-top: 1px solid var(--color-border); margin-top: 8px; }
.dev-reset-title { font-size: 13px; font-weight: 700; color: var(--color-text-primary); margin: 0 0 4px; }
.dev-reset-grid { display: flex; flex-direction: column; gap: 8px; }
.dev-reset-card {
  display: flex; align-items: center; gap: 16px; padding: 10px 14px;
  border-radius: 8px; border: 1px solid var(--color-border); background: var(--color-surface-raised);
}
.dev-reset-card.is-danger { border-color: color-mix(in srgb, var(--color-border) 60%, #f87171); }
.dev-reset-card-body { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dev-reset-card-label { font-size: 12px; color: var(--color-text-primary); }
.dev-reset-result { margin-top: 12px; font-size: 11px; color: var(--color-text-muted); font-family: monospace; }

/* ── Modal (reset confirm) ─────────────────────────────────────────────────── */
.dev-modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.45);
  display: flex; align-items: center; justify-content: center; z-index: 600;
}
.dev-modal {
  background: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: 12px; padding: 24px 28px; width: 340px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);
}
.dev-modal-title { font-size: 15px; font-weight: 700; color: var(--color-text-primary); margin: 0 0 10px; }
.dev-modal-body { font-size: 13px; color: var(--color-text-secondary); margin: 0 0 20px; line-height: 1.5; }
.dev-modal-actions { display: flex; gap: 8px; justify-content: flex-end; }

/* ── Tab badge ──────────────────────────────────────────────────────────────── */
.dev-tab-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 16px; height: 16px; padding: 0 4px;
  font-size: 10px; font-weight: 700; line-height: 1;
  border-radius: 8px; margin-left: 5px;
  background: var(--color-accent); color: #fff;
}

/* ── SW Upload Jobs tab ─────────────────────────────────────────────────────── */
.dev-sw-toolbar {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 14px 20px; border-bottom: 1px solid var(--color-border);
}
.dev-sw-toolbar-count { font-size: 12px; color: var(--color-text-muted); flex: 1; }
.dev-sw-toolbar-actions { display: flex; gap: 8px; }
.dev-sw-refresh-btn svg { transition: transform 0.15s; }
.dev-sw-refresh-btn .is-spinning { animation: spin 0.8s linear infinite; }

.dev-sw-table-wrap { overflow-x: auto; }
.dev-sw-table {
  width: 100%; border-collapse: collapse; font-size: 12px;
  min-width: 700px;
}
.dev-sw-table thead th {
  padding: 8px 12px; text-align: left;
  font-size: 11px; font-weight: 600; color: var(--color-text-muted);
  text-transform: uppercase; letter-spacing: 0.04em;
  border-bottom: 1px solid var(--color-border);
  white-space: nowrap;
}
.dev-sw-row td {
  padding: 8px 12px; border-bottom: 1px solid var(--color-border);
  vertical-align: middle;
}
.dev-sw-row:last-child td { border-bottom: none; }
.dev-sw-row:hover td { background: var(--color-hover); }
.dev-sw-row-done td      { opacity: 0.6; }
.dev-sw-row-skipped td   { opacity: 0.45; }

.dev-sw-cell-file  { display: flex; flex-direction: column; gap: 1px; }
.dev-sw-filename   { font-size: 12px; color: var(--color-text-primary); word-break: break-all; max-width: 220px; }
.dev-sw-jobid      { font-size: 10px; font-family: 'Geist Mono', monospace; }

.dev-sw-badge {
  display: inline-block; padding: 2px 7px; border-radius: 10px;
  font-size: 10px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase;
  border: 1px solid;
}
.dev-sw-badge-done    { color: #22c55e; border-color: color-mix(in srgb, #22c55e 30%, transparent); background: color-mix(in srgb, #22c55e 10%, transparent); }
.dev-sw-badge-error   { color: #f87171; border-color: color-mix(in srgb, #f87171 30%, transparent); background: color-mix(in srgb, #f87171 10%, transparent); }
.dev-sw-badge-active  { color: var(--color-accent); border-color: color-mix(in srgb, var(--color-accent) 30%, transparent); background: color-mix(in srgb, var(--color-accent) 10%, transparent); }
.dev-sw-badge-conflict{ color: #f59e0b; border-color: color-mix(in srgb, #f59e0b 30%, transparent); background: color-mix(in srgb, #f59e0b 10%, transparent); }
.dev-sw-badge-skipped { color: var(--color-text-muted); border-color: var(--color-border); background: var(--color-surface); }
.dev-sw-badge-pending { color: var(--color-text-secondary); border-color: var(--color-border); background: var(--color-surface); }

.dev-sw-progress-wrap  { display: flex; align-items: center; gap: 6px; min-width: 80px; }
.dev-sw-progress-track { flex: 1; height: 4px; background: var(--color-surface); border-radius: 2px; overflow: hidden; }
.dev-sw-progress-fill  { height: 100%; background: var(--color-accent); border-radius: 2px; transition: width 0.3s ease; }

.dev-sw-key {
  font-size: 11px; font-family: 'Geist Mono', monospace;
  max-width: 160px; display: inline-block;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom;
}

.dev-sw-media-link {
  font-size: 11px; font-family: 'Geist Mono', monospace;
  color: var(--color-accent); text-decoration: none;
}
.dev-sw-media-link:hover { text-decoration: underline; }

.dev-sw-row-actions { display: flex; gap: 4px; justify-content: flex-end; }
.dev-btn-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: 6px;
  border: 1px solid var(--color-border); background: transparent;
  color: var(--color-text-secondary); cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.dev-btn-icon:hover { background: var(--color-hover); color: var(--color-text-primary); }
.dev-btn-icon-danger:hover { background: color-mix(in srgb, #ef4444 12%, transparent); border-color: color-mix(in srgb, #ef4444 40%, transparent); color: #ef4444; }

.dev-sw-error-row td { padding: 0; border-bottom: 1px solid var(--color-border); }
.dev-sw-error-cell {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 12px 6px 24px;
  font-size: 11px; color: #f87171; font-family: 'Geist Mono', monospace;
  background: color-mix(in srgb, #f87171 4%, transparent);
}
</style>
