<script setup lang="ts">
import { XIcon, ChevronLeftIcon, ChevronRightIcon, InfoIcon, UserIcon, PawPrintIcon, TagIcon, ChevronDownIcon, BookmarkPlusIcon, BarcodeIcon, ExternalLinkIcon, ScanEyeIcon } from 'lucide-vue-next'
import { useElementBounding, useLocalStorage } from '@vueuse/core'
import type { MediaItem } from '~/composables/useGalleryData'

// ── Object detection box colors (deterministic per class name) ────────────────
const OBJECT_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b',
]
function classColor(cls: string): string {
  let h = 0
  for (let i = 0; i < cls.length; i++) h = (h * 31 + cls.charCodeAt(i)) >>> 0
  return OBJECT_COLORS[h % OBJECT_COLORS.length]!
}

definePageMeta({ middleware: 'auth', layout: false })

const route      = useRoute()
const router     = useRouter()
const libraryId  = computed(() => route.params.library as string)
const { allItems } = useGalleryData()
const { setTransitioning } = useGallery()

const id = computed(() => route.params.id as string)

// ── Item resolution ───────────────────────────────────────────────────────────
// Try the gallery's allItems first (available when navigating from the main
// gallery). If the item is not there (P&P, archive, trash, album contexts),
// fall back to a direct API fetch that returns presigned URLs.

const currentIndex = computed(() => allItems.value.findIndex(i => i.id === id.value))
const galleryItem  = computed(() => currentIndex.value >= 0 ? allItems.value[currentIndex.value] : null)

const prevItem = computed(() =>
  currentIndex.value > 0 ? allItems.value[currentIndex.value - 1] : null)
const nextItem = computed(() =>
  currentIndex.value >= 0 && currentIndex.value < allItems.value.length - 1
    ? allItems.value[currentIndex.value + 1]
    : null)

interface MediaDetail {
  id:               string
  originalFilename: string
  contentType:      string
  size:             number | null
  width:            number | null
  height:           number | null
  aspectRatio:      number
  durationSeconds:  number | null
  takenAt:          string | null
  createdAt:        string | null
  isVideo:          boolean
  imageUrl:         string | null
  thumbnailUrl:     string | null
  exif:             Record<string, unknown> | null
  locationLabel:    string | null
}

// Fetched when the item is not in the gallery, or when it is but has no full-res
// src (the gallery list endpoint intentionally omits src for images to reduce
// initial load — we fetch it here on demand the first time the lightbox opens).
const fetchedDetail = ref<MediaDetail | null>(null)
const fetchLoading  = ref(false)
const fetchError    = ref(false)

function _needsFetch(): boolean {
  if (!galleryItem.value) return true          // not in gallery at all
  if (!galleryItem.value.src) return true      // in gallery but src stripped (images)
  return false
}

async function fetchItem() {
  if (!_needsFetch()) return
  fetchLoading.value = true
  fetchError.value   = false
  try {
    fetchedDetail.value = await _fetchMappedDetail(id.value)
  } catch {
    fetchError.value = true
  } finally {
    fetchLoading.value = false
  }
}

/** Fetch /api/v1/media/:id and map the snake_case API response to MediaDetail. */
async function _fetchMappedDetail(mediaId: string): Promise<MediaDetail> {
  const r = await $fetch<{
    id:                string
    original_filename: string
    content_type:      string
    size:              number | null
    width:             number | null
    height:            number | null
    aspect_ratio:      number | null
    duration_seconds:  number | null
    taken_at:          string | null
    created_at:        string | null
    image_url:         string | null
    thumbnail_url:     string | null
    exif_data:         Record<string, unknown> | null
    location_label:    string | null
  }>(`/api/v1/media/${mediaId}`)
  return {
    id:               r.id,
    originalFilename: r.original_filename,
    contentType:      r.content_type,
    size:             r.size,
    width:            r.width,
    height:           r.height,
    aspectRatio:      r.aspect_ratio ?? 1.5,
    durationSeconds:  r.duration_seconds,
    takenAt:          r.taken_at,
    createdAt:        r.created_at,
    isVideo:          r.content_type?.startsWith('video/') ?? false,
    imageUrl:         r.image_url,
    thumbnailUrl:     r.thumbnail_url,
    exif:             r.exif_data,
    locationLabel:    r.location_label,
  }
}

// Combined item: prefers fetchedDetail (has full URL) once available, but
// surfaces galleryItem immediately so metadata/thumbnail are visible while the
// full-res URL is being fetched.
const item = computed((): MediaItem | null => {
  // Once we have the fetched detail, use it (has image_url / full src)
  if (fetchedDetail.value) {
    const d = fetchedDetail.value
    return {
      id:               d.id,
      aspectRatio:      d.aspectRatio,
      width:            d.width  ?? 0,
      height:           d.height ?? 0,
      takenAt:          d.takenAt ?? '',
      isVideo:          d.isVideo,
      originalFilename: d.originalFilename,
      src:              d.imageUrl     ?? undefined,
      thumbnailSrc:     d.thumbnailUrl ?? undefined,
    }
  }
  // Fallback: use gallery item while the detail is loading (shows thumbnail)
  if (galleryItem.value) return galleryItem.value
  return null
})

// Trigger fetch on id change and whenever the gallery item changes
watch(id, () => {
  fetchedDetail.value = null
  fetchItem()
}, { immediate: true })

// If the gallery item arrives late (e.g. gallery loads after direct navigation),
// re-evaluate whether we still need the detail fetch
watch(galleryItem, () => {
  if (_needsFetch() && !fetchedDetail.value && !fetchLoading.value) fetchItem()
})

// ── Image sizing ──────────────────────────────────────────────────────────────
const previewSize = computed(() => {
  if (!item.value) return { w: 1200, h: 800 }
  const ar  = item.value.aspectRatio
  const vw  = typeof window !== 'undefined' ? window.innerWidth  : 1440
  const vh  = typeof window !== 'undefined' ? window.innerHeight : 900
  const maxW = Math.round(vw * 0.92)
  const maxH = Math.round(vh * 0.88)
  let w = maxW, h = Math.round(maxW / ar)
  if (h > maxH) { h = maxH; w = Math.round(maxH * ar) }
  return { w, h }
})

const mediaSrc = computed(() => item.value?.src ?? '')
const thumbSrc = computed(() =>
  (item.value && !item.value.isVideo)
    ? (item.value.thumbnailSrc ?? item.value.src ?? '')
    : '',
)

const fullLoaded = ref(false)
function onImageLoad() { fullLoaded.value = true }

// Ref on the full-res image element — used for face box positioning
const fullImgRef = ref<HTMLImageElement | null>(null)
const imgBounds  = useElementBounding(fullImgRef)

// Preload adjacent full-res images
watch(fullLoaded, (loaded) => {
  if (!loaded || item.value?.isVideo) return
  for (const adjacent of [prevItem.value, nextItem.value]) {
    if (!adjacent || adjacent.isVideo) continue
    if (adjacent.src) { const img = new Image(); img.src = adjacent.src }
  }
})

watch(id, () => {
  fullLoaded.value            = false
  mediaSubjects.value         = []
  mediaObjectDetections.value = []
  mediaBarcodes.value         = []
  mediaTags_.value            = []
  mediaAlbums.value           = []
  tagInput.value              = ''
  fetchedDetail.value         = null
  if (infoOpen.value) {
    loadInfo()
    loadMediaTags()
    loadMediaAlbums()
  }
})

// ── Navigation ────────────────────────────────────────────────────────────────
function previewUrl(mediaId: string) {
  return `/library/${libraryId.value}/preview/${mediaId}`
}

function goPrev() { if (prevItem.value) router.replace(previewUrl(prevItem.value.id)) }
function goNext() { if (nextItem.value) router.replace(previewUrl(nextItem.value.id)) }

function closePreview() {
  const closingId = id.value
  if (typeof document !== 'undefined' && 'startViewTransition' in document) {
    ;(document as Document & { startViewTransition: (cb: () => Promise<void>) => { finished: Promise<void> } })
      .startViewTransition(async () => {
        setTransitioning(closingId)
        await router.back()
        await nextTick()
      })
      .finished.finally(() => setTransitioning(null))
  } else {
    router.back()
  }
}

// ── People & Pets — subject detection overlay ─────────────────────────────────
interface MediaSubject {
  subjectId:    string
  name:         string | null
  type:         'person' | 'pet'
  thumbnailUrl: string | null
  boundingBox:  { x: number; y: number; w: number; h: number }
}

const mediaSubjects   = ref<MediaSubject[]>([])

// ── X-Ray mode ──────────────────────────────────���─────────────────────────
// When enabled, all detection overlays (faces, objects, barcodes) are always
// visible. When off, they only appear on image hover.
const xrayMode = useLocalStorage('preview-xray-mode', false)
function toggleXray() { xrayMode.value = !xrayMode.value }

// Hover-based show/hide (used when X-Ray is off)
const imageHovered  = ref(false)
let _hideBoxesTimer: ReturnType<typeof setTimeout> | null = null
function onImgMouseEnter() {
  if (_hideBoxesTimer) { clearTimeout(_hideBoxesTimer); _hideBoxesTimer = null }
  imageHovered.value = true
}
function onImgMouseLeave() {
  _hideBoxesTimer = setTimeout(() => { imageHovered.value = false }, 150)
}

// Boxes are visible when X-Ray is on OR the user is hovering over the image.
const boxesVisible = computed(() => xrayMode.value || imageHovered.value)

async function loadSubjects() {
  if (!item.value || item.value.isVideo) { mediaSubjects.value = []; return }
  try {
    const data = await $fetch<{ subjects: Array<{
      subject_id:    string
      name:          string | null
      type:          'person' | 'pet'
      thumbnail_url: string | null
      bounding_box:  { x: number; y: number; w: number; h: number }
    }> }>(`/api/v1/media/${id.value}/subjects`)
    mediaSubjects.value = data.subjects.map(s => ({
      subjectId:    s.subject_id,
      name:         s.name,
      type:         s.type,
      thumbnailUrl: s.thumbnail_url,
      boundingBox:  s.bounding_box,
    }))
  } catch {
    mediaSubjects.value = []
  }
}

// Load subjects + barcodes once the full-res image has loaded
watch(fullLoaded, (loaded) => { if (loaded) { loadSubjects(); loadBarcodes() } })

// ── Face chip interactions ────────────────────────────────────────────────────

// Name modal (opens when an unnamed subject chip is clicked)
const namingSubject = ref<MediaSubject | null>(null)
const newNameInput  = ref('')
const nameSaving    = ref(false)
const nameError     = ref<string | null>(null)
const nameInputRef  = ref<HTMLInputElement | null>(null)

function onChipClick(subj: MediaSubject) {
  if (subj.name) {
    router.push(`/library/${libraryId.value}/people-and-pets/${subj.subjectId}`)
  } else {
    namingSubject.value = subj
    newNameInput.value  = ''
    nameError.value     = null
    nextTick(() => nameInputRef.value?.focus())
  }
}

function closeNameModal() {
  namingSubject.value = null
  newNameInput.value  = ''
  nameError.value     = null
}

async function saveName() {
  if (!namingSubject.value || !newNameInput.value.trim()) return
  nameSaving.value = true
  nameError.value  = null
  try {
    await $fetch(`/api/v1/subjects/${namingSubject.value.subjectId}`, {
      method: 'PATCH',
      body:   { name: newNameInput.value.trim() },
    })
    const idx = mediaSubjects.value.findIndex(s => s.subjectId === namingSubject.value!.subjectId)
    if (idx >= 0) mediaSubjects.value[idx]!.name = newNameInput.value.trim()
    closeNameModal()
  } catch (e: unknown) {
    const data = (e as { data?: { conflict?: boolean; existingName?: string } }).data
    nameError.value = data?.conflict
      ? `"${data.existingName}" already exists — use a different name.`
      : 'Failed to save. Please try again.'
  } finally {
    nameSaving.value = false
  }
}

// ── Tags ──────────────────────────────────────────────────────────────────────
interface TagItem { id: string; name: string; color: string | null }

const mediaTags_      = ref<TagItem[]>([])
const libraryTags_    = ref<TagItem[]>([])
const tagInput        = ref('')
const tagInputFocused = ref(false)
const tagInputRef     = ref<HTMLInputElement | null>(null)

const tagSuggestions = computed(() => {
  const q = tagInput.value.toLowerCase().trim()
  if (!q) return []
  const usedIds = new Set(mediaTags_.value.map(t => t.id))
  return libraryTags_.value
    .filter(t => !usedIds.has(t.id) && t.name.toLowerCase().includes(q))
    .slice(0, 8)
})

const canCreateTag = computed(() => {
  const q = tagInput.value.trim()
  if (!q) return false
  return !libraryTags_.value.some(t => t.name.toLowerCase() === q.toLowerCase())
})

const showTagDropdown = computed(() =>
  tagInputFocused.value && tagInput.value.trim().length > 0 &&
  (tagSuggestions.value.length > 0 || canCreateTag.value),
)

async function loadMediaTags() {
  try {
    const data = await $fetch<{ tags: TagItem[] }>(`/api/v1/media/${id.value}/tags`)
    mediaTags_.value = data.tags
  } catch {
    mediaTags_.value = []
  }
}

async function loadLibraryTags() {
  try {
    const data = await $fetch<{ tags: TagItem[] }>(`/api/v1/library/${libraryId.value}/tags`)
    libraryTags_.value = data.tags
  } catch {
    libraryTags_.value = []
  }
}

async function applyTag(tag: TagItem) {
  if (mediaTags_.value.find(t => t.id === tag.id)) { tagInput.value = ''; return }
  await $fetch(`/api/v1/library/${libraryId.value}/tags/${tag.id}/items`, {
    method: 'POST',
    body:   { mediaIds: [id.value] },
  })
  mediaTags_.value = [...mediaTags_.value, tag]
  tagInput.value   = ''
}

async function createAndApplyTag() {
  const name = tagInput.value.trim()
  if (!name) return
  const newTag = await $fetch<TagItem>(`/api/v1/library/${libraryId.value}/tags`, {
    method: 'POST',
    body:   { name },
  })
  libraryTags_.value = [...libraryTags_.value, newTag].sort((a, b) => a.name.localeCompare(b.name))
  await applyTag(newTag)
}

async function removeTag(tagId: string) {
  await $fetch(`/api/v1/library/${libraryId.value}/tags/${tagId}/items/${id.value}`, {
    method: 'DELETE',
  })
  mediaTags_.value = mediaTags_.value.filter(t => t.id !== tagId)
}

async function onTagEnter() {
  const q = tagInput.value.trim()
  if (!q) return
  const exact = libraryTags_.value.find(t => t.name.toLowerCase() === q.toLowerCase())
  if (exact) {
    await applyTag(exact)
  } else {
    await createAndApplyTag()
  }
  tagInputRef.value?.focus()
}

// ── Albums in info panel ──────────────────────────────────────────────────────
interface AlbumRef { id: string; name: string; libraryId: string }

const mediaAlbums       = ref<AlbumRef[]>([])
const addToAlbumOpen_   = ref(false)

async function loadMediaAlbums() {
  try {
    const data = await $fetch<{ albums: Array<{ id: string; name: string; library_id: string }> }>(
      `/api/v1/media/${id.value}/albums`,
    )
    mediaAlbums.value = data.albums.map(a => ({ id: a.id, name: a.name, libraryId: a.library_id }))
  } catch {
    mediaAlbums.value = []
  }
}

function handleAlbumAdded() {
  addToAlbumOpen_.value = false
  loadMediaAlbums()
}

// ── Barcodes ──────────────────────────────────────────────────────────────────
interface BarcodeItem {
  format: string
  data: string
  boundingBox: { x: number; y: number; w: number; h: number } | null
}

const mediaBarcodes = ref<BarcodeItem[]>([])
const externalLinkTarget   = ref<string | null>(null)
const suppressExternalWarn = useLocalStorage('suppress-external-link-warning', false)

function isUrl(str: string): boolean {
  try { const u = new URL(str); return u.protocol === 'http:' || u.protocol === 'https:' }
  catch { return false }
}
function faviconUrl(url: string): string {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=16` }
  catch { return '' }
}
function handleBarcodeClick(data: string) {
  if (!isUrl(data)) return
  if (suppressExternalWarn.value) { window.open(data, '_blank', 'noopener,noreferrer'); return }
  externalLinkTarget.value = data
}
function confirmExternalLink() {
  if (externalLinkTarget.value) window.open(externalLinkTarget.value, '_blank', 'noopener,noreferrer')
  externalLinkTarget.value = null
}

async function loadBarcodes() {
  if (!item.value || item.value.isVideo) { mediaBarcodes.value = []; return }
  try {
    const data = await $fetch<{ barcodes: Array<{
      format: string
      data: string
      bounding_box: { x: number; y: number; w: number; h: number } | null
    }> }>(`/api/v1/media/${id.value}/barcodes`)
    mediaBarcodes.value = data.barcodes.map(b => ({
      format: b.format,
      data: b.data,
      boundingBox: b.bounding_box ?? null,
    }))
  } catch {
    mediaBarcodes.value = []
  }
}

// ── EXIF Advanced section ─────────────────────────────────────────────────────
const exifExpanded = useLocalStorage('preview-exif-expanded', false)

// ── Object detection overlay (admin setting) ──────────────────────────────────
interface MediaObjectDetection {
  id:         number
  class:      string
  confidence: number
  boundingBox: { x: number; y: number; w: number; h: number }
}

// Objects load whenever X-Ray mode is active (available to all users).
const objectBoxesActive = computed(() => xrayMode.value)

const mediaObjectDetections = ref<MediaObjectDetection[]>([])

async function loadObjects() {
  if (!item.value || item.value.isVideo || !objectBoxesActive.value) {
    mediaObjectDetections.value = []
    return
  }
  try {
    const data = await $fetch<{ objects: Array<{
      id:           number
      class_name:   string
      confidence:   number
      bounding_box: { x: number; y: number; w: number; h: number }
    }> }>(`/api/v1/media/${id.value}/objects`)
    mediaObjectDetections.value = data.objects.map(o => ({
      id:          o.id,
      class:       o.class_name,
      confidence:  o.confidence,
      boundingBox: o.bounding_box,
    }))
  } catch {
    mediaObjectDetections.value = []
  }
}

watch(fullLoaded, (loaded) => { if (loaded && objectBoxesActive.value) loadObjects() })
watch(objectBoxesActive, (active) => { if (active && fullLoaded.value) loadObjects() })

// ── Info panel ────────────────────────────────────────────────────────────────
// Always start closed so the view transition (gallery → preview) never sees
// an open panel during its DOM-capture phase. The user's preference is persisted
// in useState and restored in onMounted after the transition has fired.
const _persistedInfoOpen = useState('preview-info-open', () => false)
const infoOpen           = ref(false)
const infoDetail         = ref<MediaDetail | null>(null)
const infoLoading        = ref(false)

// Keep persistence in sync with every toggle
watch(infoOpen, v => { _persistedInfoOpen.value = v })

// After the view-transition callback has already resolved (nextTick ensures the
// browser has captured its "after" snapshot), restore the panel if it was open.
// Also re-fetch info data since infoDetail is always null on fresh mount.
onMounted(() => {
  nextTick(() => {
    if (_persistedInfoOpen.value) {
      infoOpen.value = true
      loadInfo()
    }
  })
})

// Update face-box positions after the panel's CSS transition settles (0.22s)
// Also load tags and albums when the panel first opens.
watch(infoOpen, (open) => {
  setTimeout(() => imgBounds.update(), 250)
  if (open) {
    loadMediaTags()
    loadMediaAlbums()
    if (!mediaBarcodes.value.length) loadBarcodes()
    if (!libraryTags_.value.length) loadLibraryTags()
  }
})

async function loadInfo() {
  if (!item.value) return
  infoLoading.value = true
  try {
    // Reuse fetchedDetail if already available (avoids double-fetch)
    if (fetchedDetail.value) {
      infoDetail.value = fetchedDetail.value
    } else {
      infoDetail.value = await _fetchMappedDetail(id.value)
    }
  } finally {
    infoLoading.value = false
  }
}

function toggleInfo() {
  infoOpen.value = !infoOpen.value
  if (infoOpen.value && !infoDetail.value) loadInfo()
}

// Restore tags, albums, and barcodes on remount if panel was already open
onMounted(() => {
  nextTick(() => {
    if (_persistedInfoOpen.value) {
      loadMediaTags()
      loadLibraryTags()
      loadMediaAlbums()
      loadBarcodes()
    }
  })
})

watch(id, () => {
  infoDetail.value = null
  if (infoOpen.value) loadInfo()
})

function formatBytes(b: number): string {
  if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(1)} MB`
  if (b >= 1_000)     return `${(b / 1_000).toFixed(0)} KB`
  return `${b} B`
}

function formatDuration(s: number): string {
  const m   = Math.floor(s / 60)
  const sec = Math.round(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

// Keyboard navigation
function onKey(e: KeyboardEvent) {
  // Name modal intercepts all keys
  if (namingSubject.value) {
    if (e.key === 'Escape') { e.preventDefault(); closeNameModal() }
    if (e.key === 'Enter')  { e.preventDefault(); saveName()       }
    return
  }
  // Don't fire nav shortcuts when the tag input is focused
  if (tagInputFocused.value) return
  if (e.key === 'ArrowLeft')  { e.preventDefault(); goPrev()       }
  if (e.key === 'ArrowRight') { e.preventDefault(); goNext()       }
  if (e.key === 'Escape')     { e.preventDefault(); closePreview() }
  if (e.key === 'i')          { e.preventDefault(); toggleInfo()   }
  if (e.key === 'x')          { e.preventDefault(); toggleXray()   }
}

onMounted(()   => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div v-if="item" class="preview-page">

    <!-- ── Main viewing area (shrinks when panel opens) ─────────────────── -->
    <div
      class="preview-main"
      @click.self="closePreview"
    >

      <!-- Top-right controls: x-ray + info + close -->
      <div class="preview-controls">
        <button
          class="preview-ctrl-btn"
          :class="{ 'is-active': xrayMode }"
          aria-label="X-Ray mode"
          title="X-Ray (X)"
          @click="toggleXray"
        >
          <ScanEyeIcon :size="18" />
        </button>
        <button
          class="preview-ctrl-btn"
          :class="{ 'is-active': infoOpen }"
          aria-label="File info"
          title="Info (I)"
          @click="toggleInfo"
        >
          <InfoIcon :size="18" />
        </button>
        <button class="preview-ctrl-btn" aria-label="Close preview" @click="closePreview">
          <XIcon :size="18" />
        </button>
      </div>

      <!-- Prev -->
      <button
        v-if="prevItem"
        class="preview-nav preview-nav-prev"
        aria-label="Previous"
        @click="goPrev"
      >
        <ChevronLeftIcon :size="26" />
      </button>

      <!-- Media area -->
      <div class="preview-image-area" @click.self="closePreview">

        <!-- ── VIDEO ──────────────────────────────────────────────────── -->
        <template v-if="item.isVideo">
          <!-- Wait until the full src is available (fetched on demand for videos
               with server thumbnails — src is omitted from the gallery list). -->
          <video
            v-if="mediaSrc"
            :key="item.id + '-' + mediaSrc"
            :src="mediaSrc"
            class="preview-video"
            :width="previewSize.w"
            :height="previewSize.h"
            controls
            autoplay
            playsinline
            style="view-transition-name: photo-preview"
            @click.stop
          />
          <div v-else class="preview-video-loading" :style="{ width: previewSize.w + 'px', height: previewSize.h + 'px' }" />
        </template>

        <!-- ── IMAGE ──────────────────────────────────────────────────── -->
        <template v-else>
          <!-- Thumbnail shown immediately (from gallery data or fetched detail) -->
          <img
            :src="thumbSrc"
            :alt="item.originalFilename"
            class="preview-img preview-img-thumb"
            :class="{ 'is-replaced': fullLoaded }"
            :width="previewSize.w"
            :height="previewSize.h"
            :style="!fullLoaded ? { viewTransitionName: 'photo-preview' } : {}"
            draggable="false"
          />
          <!-- Full-res image: only rendered once the URL is available.
               mediaSrc is empty while the detail fetch is in-flight; rendering
               an <img src=""> would fire a spurious request to the current page. -->
          <img
            v-if="mediaSrc"
            ref="fullImgRef"
            :key="item.id + '-' + mediaSrc"
            :src="mediaSrc"
            :alt="item.originalFilename"
            class="preview-img"
            :class="{ 'is-loaded': fullLoaded }"
            :width="previewSize.w"
            :height="previewSize.h"
            :style="fullLoaded ? { viewTransitionName: 'photo-preview' } : {}"
            draggable="false"
            @load="onImageLoad"
            @mouseenter="onImgMouseEnter"
            @mouseleave="onImgMouseLeave"
          />
        </template>

      </div>

      <!-- Next -->
      <button
        v-if="nextItem"
        class="preview-nav preview-nav-next"
        aria-label="Next"
        @click="goNext"
      >
        <ChevronRightIcon :size="26" />
      </button>

      <!-- Caption -->
      <div class="preview-caption">
        <span class="preview-filename">{{ item.originalFilename }}</span>
        <span v-if="currentIndex >= 0" class="preview-counter">
          {{ currentIndex + 1 }} / {{ allItems.length }}
        </span>
      </div>

    </div><!-- /.preview-main -->

    <!-- ── Info panel (flex sibling — pushes image area narrower) ────────── -->
    <aside class="preview-info-panel" :class="{ 'is-open': infoOpen }" @click.stop>
      <div class="preview-info-inner">

        <div class="info-section">
          <h3 class="info-heading">File</h3>
          <dl class="info-dl">
            <div class="info-row">
              <dt>Name</dt>
              <dd class="info-mono">{{ item.originalFilename }}</dd>
            </div>
            <div v-if="infoDetail" class="info-row">
              <dt>Type</dt>
              <dd>{{ infoDetail.contentType }}</dd>
            </div>
            <div v-if="infoDetail?.size" class="info-row">
              <dt>Size</dt>
              <dd>{{ formatBytes(infoDetail.size) }}</dd>
            </div>
            <div v-if="infoDetail?.width && infoDetail?.height" class="info-row">
              <dt>Dimensions</dt>
              <dd>{{ infoDetail.width }} × {{ infoDetail.height }}</dd>
            </div>
            <div v-if="infoDetail?.durationSeconds" class="info-row">
              <dt>Duration</dt>
              <dd>{{ formatDuration(infoDetail.durationSeconds) }}</dd>
            </div>
            <div class="info-row">
              <dt>Taken</dt>
              <dd>{{ infoDetail?.takenAt ? new Date(infoDetail.takenAt).toLocaleString() : item.takenAt ? new Date(item.takenAt).toLocaleString() : '—' }}</dd>
            </div>
            <div v-if="infoDetail?.locationLabel" class="info-row">
              <dt>Location</dt>
              <dd>{{ infoDetail.locationLabel }}</dd>
            </div>
            <div v-if="infoDetail?.createdAt" class="info-row">
              <dt>Uploaded</dt>
              <dd>{{ new Date(infoDetail.createdAt).toLocaleString() }}</dd>
            </div>
          </dl>
        </div>

        <div v-if="infoLoading" class="info-loading">Loading…</div>

        <!-- ── People & Pets section ────────────────────────────────── -->
        <div v-if="mediaSubjects.length" class="info-section">
          <h3 class="info-heading">People &amp; Pets</h3>
          <div class="info-subjects">
            <NuxtLink
              v-for="subj in mediaSubjects"
              :key="subj.subjectId"
              class="info-subject-chip"
              :to="`/library/${libraryId}/people-and-pets/${subj.subjectId}`"
              @click.stop
            >
              <div class="info-subject-avatar">
                <img
                  v-if="subj.thumbnailUrl"
                  :src="subj.thumbnailUrl"
                  :alt="subj.name ?? ''"
                  class="info-subject-avatar-img"
                />
                <component
                  :is="subj.type === 'person' ? UserIcon : PawPrintIcon"
                  v-else
                  :size="14"
                  class="info-subject-avatar-icon"
                />
              </div>
              <span class="info-subject-name">{{ subj.name ?? (subj.type === 'person' ? 'Unknown person' : 'Unknown pet') }}</span>
            </NuxtLink>
          </div>
        </div>

        <!-- ── Tags ─────────────────────────────────────────────────── -->
        <div class="info-section info-tags-section">
          <h3 class="info-heading">Tags</h3>

          <!-- Applied tag chips -->
          <div v-if="mediaTags_.length" class="info-tags-chips">
            <span
              v-for="tag in mediaTags_"
              :key="tag.id"
              class="info-tag-chip"
              :style="tag.color ? { background: tag.color + '22', borderColor: tag.color + '55', color: tag.color } : {}"
            >
              {{ tag.name }}
              <button
                class="info-tag-chip-remove"
                aria-label="Remove tag"
                @click.stop="removeTag(tag.id)"
              >×</button>
            </span>
          </div>

          <!-- Tag input with autocomplete -->
          <div class="info-tag-input-wrap">
            <TagIcon :size="12" class="info-tag-input-icon" />
            <input
              ref="tagInputRef"
              v-model="tagInput"
              class="info-tag-input"
              placeholder="Add a tag…"
              autocomplete="off"
              @focus="tagInputFocused = true"
              @blur="tagInputFocused = false"
              @keydown.enter.prevent="onTagEnter"
              @keydown.escape.stop="tagInput = ''; tagInputFocused = false"
              @keydown.stop
            />

            <!-- Dropdown suggestions -->
            <div v-if="showTagDropdown" class="info-tag-dropdown">
              <button
                v-for="suggestion in tagSuggestions"
                :key="suggestion.id"
                class="info-tag-suggestion"
                @mousedown.prevent="applyTag(suggestion)"
              >
                <span
                  v-if="suggestion.color"
                  class="info-tag-dot"
                  :style="{ background: suggestion.color }"
                />
                {{ suggestion.name }}
              </button>
              <button
                v-if="canCreateTag"
                class="info-tag-suggestion info-tag-create"
                @mousedown.prevent="createAndApplyTag"
              >
                Create "{{ tagInput.trim() }}"
              </button>
            </div>
          </div>
        </div>

        <!-- ── Albums ────────────────────────────────────────────── -->
        <div class="info-section">
          <div class="info-heading-row">
            <h3 class="info-heading">Albums</h3>
            <button class="info-add-btn" title="Add to album" @click.stop="addToAlbumOpen_ = true">
              <BookmarkPlusIcon :size="12" />
            </button>
          </div>
          <div v-if="mediaAlbums.length" class="info-albums">
            <NuxtLink
              v-for="album in mediaAlbums"
              :key="album.id"
              class="info-album-chip"
              :to="`/library/${album.libraryId}/album/${album.id}`"
              @click.stop
            >
              {{ album.name }}
            </NuxtLink>
          </div>
          <p v-else class="info-albums-empty">Not in any albums</p>
        </div>

        <!-- ── Barcodes ──────────────────────────────────────────── -->
        <div v-if="mediaBarcodes.length" class="info-section">
          <h3 class="info-heading">Barcodes</h3>
          <div class="info-subjects">
            <template v-for="bc in mediaBarcodes" :key="bc.format + ':' + bc.data">
              <component
                :is="isUrl(bc.data) ? 'button' : 'div'"
                class="info-subject-chip"
                :class="{ 'info-barcode-link': isUrl(bc.data) }"
                @click.stop="handleBarcodeClick(bc.data)"
              >
                <div class="info-subject-avatar">
                  <img
                    v-if="isUrl(bc.data)"
                    :src="faviconUrl(bc.data)"
                    class="info-barcode-favicon"
                    alt=""
                  />
                  <BarcodeIcon v-else :size="14" class="info-subject-avatar-icon" />
                </div>
                <span class="info-subject-name info-barcode-value">{{ bc.data }}</span>
                <ExternalLinkIcon v-if="isUrl(bc.data)" :size="11" class="info-barcode-ext-icon" />
              </component>
            </template>
          </div>
        </div>

        <!-- ── Advanced (EXIF / Metadata) ───────────────────────── -->
        <div v-if="infoDetail?.exif && Object.keys(infoDetail.exif).length" class="info-section info-advanced-section">
          <button
            class="info-advanced-toggle"
            :aria-expanded="exifExpanded"
            @click.stop="exifExpanded = !exifExpanded"
          >
            <ChevronDownIcon
              :size="13"
              class="info-advanced-chevron"
              :class="{ 'is-open': exifExpanded }"
            />
            <span class="info-heading">Advanced</span>
          </button>
          <div v-if="exifExpanded" class="info-advanced-body">
            <p class="info-advanced-subsection">Metadata ({{ item.isVideo ? 'XMP / QuickTime' : 'EXIF' }})</p>
            <table class="info-exif-table">
              <tbody>
                <tr
                  v-for="(val, key) in infoDetail.exif"
                  :key="key"
                >
                  <th>{{ key }}</th>
                  <td>{{ Array.isArray(val) ? val.join(', ') : val }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </aside>

  </div><!-- /.preview-page -->

  <!-- Loading state (fetching non-gallery item) -->
  <div v-else-if="fetchLoading" class="preview-page preview-not-found">
    <p>Loading…</p>
  </div>

  <!-- Item not found / error -->
  <div v-else class="preview-page preview-not-found">
    <p>{{ fetchError ? 'Photo not found.' : 'Loading…' }}</p>
    <button @click="closePreview">Go back</button>
  </div>

  <!-- ── Add-to-album modal ────────────────────────────────────────────────── -->
  <AppAddToAlbumModal
    :open="addToAlbumOpen_"
    :media-ids="[id]"
    @update:open="addToAlbumOpen_ = $event"
    @added="handleAlbumAdded"
  />

  <!-- ── Face / pet detection boxes ─────────────────────────────────────────
       Teleported to body so they layer above the fixed preview-page backdrop.
       Positioned in viewport coordinates using the measured image element bounds. -->
  <Teleport to="body">
    <template v-if="boxesVisible && fullLoaded && mediaSubjects.length">
      <div
        v-for="subj in mediaSubjects"
        :key="subj.subjectId"
        class="preview-face-box"
        :style="{
          left:   (imgBounds.left.value + subj.boundingBox.x * imgBounds.width.value)  + 'px',
          top:    (imgBounds.top.value  + subj.boundingBox.y * imgBounds.height.value) + 'px',
          width:  (subj.boundingBox.w  * imgBounds.width.value)  + 'px',
          height: (subj.boundingBox.h  * imgBounds.height.value) + 'px',
        }"
      >
        <!-- Name chip anchored to bottom of box — clickable -->
        <button
          class="preview-face-chip"
          :class="{ 'is-unnamed': !subj.name }"
          @mouseenter="onImgMouseEnter"
          @mouseleave="onImgMouseLeave"
          @click.stop="onChipClick(subj)"
        >
          <div class="preview-face-chip-avatar">
            <img
              v-if="subj.thumbnailUrl"
              :src="subj.thumbnailUrl"
              class="preview-face-chip-img"
              :alt="subj.name ?? ''"
            />
            <component
              :is="subj.type === 'person' ? UserIcon : PawPrintIcon"
              v-else
              :size="12"
              class="preview-face-chip-icon"
            />
          </div>
          <span class="preview-face-chip-name">{{ subj.name ?? 'Add a name' }}</span>
        </button>
      </div>
    </template>

    <!-- ── Name-a-person modal ────────────────────────────────────────────── -->
    <Transition name="modal">
      <div v-if="namingSubject" class="name-modal-backdrop" @click.self="closeNameModal">
        <div class="name-modal" role="dialog" aria-modal="true" aria-label="Name this person">
          <div class="name-modal-avatar">
            <img
              v-if="namingSubject.thumbnailUrl"
              :src="namingSubject.thumbnailUrl"
              class="name-modal-avatar-img"
              alt=""
            />
            <component
              :is="namingSubject.type === 'person' ? UserIcon : PawPrintIcon"
              v-else
              :size="24"
              class="name-modal-avatar-icon"
            />
          </div>
          <p class="name-modal-label">Who is this?</p>
          <input
            ref="nameInputRef"
            v-model="newNameInput"
            class="name-modal-input"
            placeholder="Enter a name…"
            autocomplete="off"
            @keydown.enter.prevent="saveName"
            @keydown.escape.prevent="closeNameModal"
            @keydown.stop
          />
          <p v-if="nameError" class="name-modal-error">{{ nameError }}</p>
          <div class="name-modal-actions">
            <button class="name-modal-cancel" @click="closeNameModal">Cancel</button>
            <button
              class="name-modal-save"
              :disabled="!newNameInput.trim() || nameSaving"
              @click="saveName"
            >{{ nameSaving ? 'Saving…' : 'Save' }}</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ── Object detection boxes (X-Ray mode) ─────────────────────────────
         Box border and label use a class-deterministic color. -->
    <template v-if="boxesVisible && fullLoaded && objectBoxesActive && mediaObjectDetections.length">
      <div
        v-for="obj in mediaObjectDetections"
        :key="obj.id"
        class="preview-object-box"
        :style="{
          left:        (imgBounds.left.value  + obj.boundingBox.x * imgBounds.width.value)  + 'px',
          top:         (imgBounds.top.value   + obj.boundingBox.y * imgBounds.height.value) + 'px',
          width:       (obj.boundingBox.w     * imgBounds.width.value)  + 'px',
          height:      (obj.boundingBox.h     * imgBounds.height.value) + 'px',
          borderColor: classColor(obj.class),
        }"
      >
        <span
          class="preview-object-label"
          :style="{ background: classColor(obj.class) }"
        >{{ obj.class }}</span>
      </div>
    </template>

    <!-- ── Barcode hover boxes ──────────────────────────────────────────────── -->
    <template v-if="boxesVisible && fullLoaded">
      <div
        v-for="(bc, i) in mediaBarcodes.filter(b => b.boundingBox)"
        :key="'bc-' + i"
        class="preview-barcode-box"
        :style="{
          left:   (imgBounds.left.value  + bc.boundingBox!.x * imgBounds.width.value)  + 'px',
          top:    (imgBounds.top.value   + bc.boundingBox!.y * imgBounds.height.value) + 'px',
          width:  (bc.boundingBox!.w     * imgBounds.width.value)  + 'px',
          height: (bc.boundingBox!.h     * imgBounds.height.value) + 'px',
        }"
      >
        <button
          class="preview-barcode-chip"
          :class="{ 'is-link': isUrl(bc.data) }"
          @mouseenter="onImgMouseEnter"
          @mouseleave="onImgMouseLeave"
          @click.stop="handleBarcodeClick(bc.data)"
        >
          <img
            v-if="isUrl(bc.data)"
            :src="faviconUrl(bc.data)"
            class="preview-barcode-favicon"
            alt=""
          />
          <BarcodeIcon v-else :size="12" class="preview-barcode-icon" />
          <span class="preview-barcode-value">{{ bc.data }}</span>
          <ExternalLinkIcon v-if="isUrl(bc.data)" :size="10" class="preview-barcode-ext" />
        </button>
      </div>
    </template>

    <!-- ── External link warning modal ─────────────────────────────────────── -->
    <Transition name="modal">
      <div v-if="externalLinkTarget" class="name-modal-backdrop" @click.self="externalLinkTarget = null">
        <div class="name-modal ext-link-modal" role="dialog" aria-modal="true" aria-label="External link warning">
          <ExternalLinkIcon :size="28" class="ext-link-icon" />
          <p class="name-modal-label">Opening External Link</p>
          <p class="ext-link-url">{{ externalLinkTarget }}</p>
          <label class="ext-link-suppress">
            <input type="checkbox" v-model="suppressExternalWarn" />
            Don't show this again
          </label>
          <div class="name-modal-actions">
            <button class="name-modal-cancel" @click="externalLinkTarget = null">Cancel</button>
            <button class="name-modal-save" @click="confirmExternalLink">Open</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.preview-page {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: #000;
  display: flex;
  flex-direction: row;
  align-items: stretch;
}

/* ── Main viewing column (shrinks when info panel opens) ──────────────────── */
.preview-main {
  flex: 1;
  min-width: 0;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.94);
}

.preview-image-area {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 56px 80px 64px;
  position: relative;
}

.preview-img {
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 3px;
  user-select: none;
  -webkit-user-drag: none;
  position: absolute;
}

.preview-img-thumb {
  opacity: 1;
  transition: opacity 0.2s ease;
}

.preview-img-thumb.is-replaced {
  opacity: 0;
}

.preview-img:not(.preview-img-thumb) {
  opacity: 0;
  transition: opacity 0.25s ease;
}

.preview-img.is-loaded {
  opacity: 1;
}

.preview-video {
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 3px;
  position: absolute;
  outline: none;
  background: #000;
}

.preview-video-loading {
  border-radius: 3px;
  background: #111;
  max-width: 100%;
  max-height: 100%;
}

.preview-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.9);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  backdrop-filter: blur(8px);
}

.preview-nav:hover {
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
}

.preview-nav-prev { left: 16px; }
.preview-nav-next { right: 16px; }

.preview-caption {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.65) 0%, transparent 100%);
}

.preview-filename {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
  font-family: 'Geist Mono', monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 60%;
}

.preview-counter {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
  font-family: 'Geist Mono', monospace;
  flex-shrink: 0;
}

.preview-not-found {
  color: rgba(255, 255, 255, 0.7);
  flex-direction: column;
  gap: 16px;
  font-size: 15px;
}

/* ── Top-right controls ─────────────────────────────────────────────────── */

.preview-controls {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 6px;
}

.preview-ctrl-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 9px;
  border: none;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  backdrop-filter: blur(8px);
}

.preview-ctrl-btn:hover    { background: rgba(255, 255, 255, 0.2);  color: #fff; }
.preview-ctrl-btn.is-active { background: rgba(255, 255, 255, 0.22); color: #fff; }

/* ── Info panel ─────────────────────────────────────────────────────────── */

.preview-info-panel {
  flex-shrink: 0;
  width: 0;
  overflow: hidden;
  background: rgba(18, 18, 18, 0.96);
  border-left: 0 solid rgba(255, 255, 255, 0.08);
  transition: width 0.22s ease, border-left-width 0s 0.22s;
}

.preview-info-panel.is-open {
  width: 280px;
  border-left-width: 1px;
  transition: width 0.22s ease, border-left-width 0s 0s;
}

.preview-info-inner {
  width: 280px;
  height: 100%;
  overflow-y: auto;
  padding: 56px 0 80px;
  display: flex;
  flex-direction: column;
}

.info-section {
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}

.info-heading {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.35);
  margin: 0 0 10px;
}

.info-dl {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.info-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.info-row dt {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.38);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.info-row dd {
  margin: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.82);
  line-height: 1.4;
  word-break: break-all;
}

.info-mono {
  font-family: 'Geist Mono', monospace;
  font-size: 11px !important;
}

.info-loading {
  padding: 16px 20px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.35);
}

/* ── People & Pets chips in info panel ──────────────────────────────────── */

.info-subjects {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.info-subject-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.06);
  text-decoration: none;
  transition: background 0.12s;
  cursor: pointer;
}

.info-subject-chip:hover { background: rgba(255, 255, 255, 0.12); }

.info-subject-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.info-subject-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.info-subject-avatar-icon { color: rgba(255, 255, 255, 0.5); }

.info-subject-name {
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.82);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Face / pet detection boxes (Teleported, position: fixed) ──────────── */

.preview-face-box {
  position: fixed;
  border: 2px solid rgba(255, 255, 255, 0.75);
  border-radius: 4px;
  pointer-events: none;
  z-index: 350;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
}

/* Name chip anchored at the bottom of the box */
.preview-face-chip {
  position: absolute;
  bottom: -1px;
  left: 50%;
  transform: translate(-50%, 100%);
  display: flex;
  align-items: center;
  gap: 5px;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 20px;
  padding: 3px 10px 3px 4px;
  white-space: nowrap;
  pointer-events: auto;
  cursor: pointer;
  max-width: 180px;
  transition: background 0.12s, border-color 0.12s;
}

.preview-face-chip:hover {
  background: rgba(30, 30, 30, 0.9);
  border-color: rgba(255, 255, 255, 0.3);
}

.preview-face-chip.is-unnamed {
  border-style: dashed;
  border-color: rgba(255, 255, 255, 0.25);
}

.preview-face-chip.is-unnamed:hover {
  border-style: dashed;
  border-color: rgba(255, 255, 255, 0.5);
}

.preview-face-chip-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.preview-face-chip-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.preview-face-chip-icon { color: rgba(255, 255, 255, 0.6); }

.preview-face-chip-name {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Name-a-person modal ────────────────────────────────────────────────── */

.name-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 500;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.name-modal {
  background: var(--color-surface-raised, #1a1a1a);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  padding: 28px 24px 24px;
  width: 280px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
}

.name-modal-avatar {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
  border: 2px solid rgba(255, 255, 255, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.name-modal-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.name-modal-avatar-icon { color: rgba(255, 255, 255, 0.4); }

.name-modal-label {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  margin: 0;
}

.name-modal-input {
  width: 100%;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  padding: 9px 12px;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
  outline: none;
  transition: border-color 0.12s;
  box-sizing: border-box;
}

.name-modal-input::placeholder { color: rgba(255, 255, 255, 0.3); }
.name-modal-input:focus { border-color: rgba(255, 255, 255, 0.35); }

.name-modal-error {
  font-size: 12px;
  color: #ef4444;
  margin: -6px 0 0;
  text-align: center;
}

.name-modal-actions {
  display: flex;
  gap: 8px;
  width: 100%;
}

.name-modal-cancel,
.name-modal-save {
  flex: 1;
  padding: 9px 0;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: background 0.12s, opacity 0.12s;
}

.name-modal-cancel {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.7);
}
.name-modal-cancel:hover { background: rgba(255, 255, 255, 0.14); }

.name-modal-save {
  background: rgba(255, 255, 255, 0.9);
  color: #111;
}
.name-modal-save:hover:not(:disabled) { background: #fff; }
.name-modal-save:disabled { opacity: 0.4; cursor: default; }

/* Fade transition (reuses the modal Transition name) */
.modal-enter-active, .modal-leave-active { transition: opacity 0.15s ease; }
.modal-enter-from, .modal-leave-to       { opacity: 0; }

/* ── Barcode hover boxes (Teleported, position: fixed) ──────────────────── */

.preview-barcode-box {
  position: fixed;
  border: 2px solid rgba(251, 191, 36, 0.8);
  border-radius: 4px;
  pointer-events: none;
  z-index: 350;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
}

.preview-barcode-chip {
  position: absolute;
  bottom: -1px;
  left: 50%;
  transform: translate(-50%, 100%);
  display: flex;
  align-items: center;
  gap: 5px;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(251, 191, 36, 0.3);
  border-radius: 20px;
  padding: 3px 10px 3px 6px;
  white-space: nowrap;
  pointer-events: auto;
  cursor: default;
  max-width: 220px;
  transition: background 0.12s, border-color 0.12s;
}

.preview-barcode-chip.is-link { cursor: pointer; }
.preview-barcode-chip.is-link:hover {
  background: rgba(30, 30, 30, 0.9);
  border-color: rgba(251, 191, 36, 0.6);
}

.preview-barcode-favicon {
  width: 16px;
  height: 16px;
  object-fit: contain;
  border-radius: 3px;
  flex-shrink: 0;
}

.preview-barcode-icon { color: rgba(251, 191, 36, 0.8); flex-shrink: 0; }

.preview-barcode-value {
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.88);
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: 'Geist Mono', monospace;
}

.preview-barcode-ext {
  color: rgba(255, 255, 255, 0.4);
  flex-shrink: 0;
}

/* ── External link warning modal ────────────────────────────────────────── */

.ext-link-modal {
  gap: 12px;
}

.ext-link-icon {
  color: #f59e0b;
}

.ext-link-url {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  margin: 0;
  font-family: 'Geist Mono', monospace;
  word-break: break-all;
  text-align: center;
  max-width: 100%;
}

.ext-link-suppress {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  cursor: pointer;
  user-select: none;
}

.ext-link-suppress input[type="checkbox"] {
  accent-color: rgba(255, 255, 255, 0.7);
  width: 14px;
  height: 14px;
  cursor: pointer;
}

/* ── Info heading row (heading + action button) ─────────────────────────── */

.info-heading-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.info-heading-row .info-heading { margin-bottom: 0; }

.info-add-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.35);
  cursor: pointer;
  transition: color 0.12s, background 0.12s;
  flex-shrink: 0;
}

.info-add-btn:hover { color: rgba(255, 255, 255, 0.8); background: rgba(255, 255, 255, 0.08); }

/* ── Albums in info panel ────────────────────────────────────────────────── */

.info-albums {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-album-chip {
  display: block;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.75);
  background: rgba(255, 255, 255, 0.06);
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background 0.12s, color 0.12s;
}

.info-album-chip:hover { background: rgba(255, 255, 255, 0.12); color: rgba(255, 255, 255, 0.92); }

.info-albums-empty {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.28);
  margin: 0;
}

/* ── Barcode rows in info panel ─────────────────────────────────────────── */

.info-barcode-link {
  border: none;
  text-align: left;
  width: 100%;
  cursor: pointer;
}

.info-barcode-value {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: 'Geist Mono', monospace;
  font-size: 11px !important;
}

.info-barcode-favicon {
  width: 16px;
  height: 16px;
  object-fit: contain;
  border-radius: 3px;
}

.info-barcode-ext-icon {
  color: rgba(255, 255, 255, 0.3);
  flex-shrink: 0;
}

/* ── Advanced (EXIF) collapsible ─────────────────────────────────────────── */

.info-advanced-section { padding-bottom: 0; }

.info-advanced-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  background: transparent;
  border: none;
  padding: 0 0 12px;
  cursor: pointer;
  text-align: left;
}

.info-advanced-chevron {
  color: rgba(255, 255, 255, 0.3);
  flex-shrink: 0;
  transition: transform 0.18s ease;
}

.info-advanced-chevron.is-open { transform: rotate(180deg); }

.info-advanced-body {
  padding-bottom: 12px;
}

.info-advanced-subsection {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.22);
  margin: 0 0 8px;
}

.info-exif-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  margin-bottom: 12px;
}

.info-exif-table th,
.info-exif-table td {
  padding: 3px 0;
  vertical-align: top;
  line-height: 1.4;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.info-exif-table th {
  width: 42%;
  padding-right: 8px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.35);
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 0;
}

.info-exif-table td {
  color: rgba(255, 255, 255, 0.72);
  word-break: break-all;
}

/* ── Tags section in info panel ─────────────────────────────────────────── */

.info-tags-section { position: relative; }

.info-tags-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 8px;
}

.info-tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px 2px 8px;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 500;
  background: rgba(255, 255, 255, 0.09);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.75);
}

.info-tag-chip-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 3px;
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.4);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  transition: color 0.1s, background 0.1s;
}
.info-tag-chip-remove:hover { color: #ef4444; background: rgba(239, 68, 68, 0.12); }

.info-tag-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 7px;
  padding: 6px 10px;
  transition: border-color 0.12s;
}

.info-tag-input-wrap:focus-within {
  border-color: rgba(255, 255, 255, 0.25);
}

.info-tag-input-icon { color: rgba(255, 255, 255, 0.3); flex-shrink: 0; }

.info-tag-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.82);
  min-width: 0;
}
.info-tag-input::placeholder { color: rgba(255, 255, 255, 0.28); }

.info-tag-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 10;
  background: #1c1c1c;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}

.info-tag-suggestion {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 7px 12px;
  background: transparent;
  border: none;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.78);
  text-align: left;
  cursor: pointer;
  transition: background 0.1s;
}
.info-tag-suggestion:hover { background: rgba(255, 255, 255, 0.08); }

.info-tag-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.info-tag-create {
  color: rgba(255, 255, 255, 0.5);
  font-style: italic;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}
.info-tag-create:hover { background: rgba(255, 255, 255, 0.06); color: rgba(255, 255, 255, 0.75); }

/* ── Object detection boxes (Teleported, position: fixed) ───────────────── */

.preview-object-box {
  position: fixed;
  border: 2px solid;        /* color set inline via classColor() */
  border-radius: 3px;
  pointer-events: none;
  z-index: 350;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
}

/* Class label in top-left corner of the box */
.preview-object-label {
  position: absolute;
  top: -1px;
  left: -1px;
  padding: 1px 6px 2px;
  border-radius: 2px 0 4px 0;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.02em;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  white-space: nowrap;
  pointer-events: none;
}
</style>
