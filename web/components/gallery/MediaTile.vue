<script setup lang="ts">
import { VideoIcon, CheckIcon, ImageIcon } from 'lucide-vue-next'
import type { MediaItem } from '~/composables/useGalleryData'
import type { DragSourceItem } from '~/composables/useTileDrag'

const props = defineProps<{
  item:      MediaItem
  width:     number
  height:    number
  gridMode?: boolean
}>()

const {
  selectionMode,
  isSelected,
  toggleItem,
  transitioningId,
  setTransitioning,
} = useGallery()

const { allItems } = useGalleryData()
const allIds = computed(() => allItems.value.map(i => i.id))

const selected = computed(() => isSelected(props.item.id))

// Prefer thumbnailSrc (server-resized, ~800px JPEG) when available for any media type.
// For video tiles without a thumbnailSrc: skip the img entirely and render a <video> element instead.
const imgSrc = computed<string | undefined>(() => {
  if (props.item.thumbnailSrc) return props.item.thumbnailSrc
  if (props.item.isVideo) return undefined   // <video> fallback renders instead
  return props.item.src ?? undefined
})

// Hover preview: video items auto-play their preview clip (or the raw src) on tile hover
const isHovered        = ref(false)
const thumbnailVideoRef = ref<HTMLVideoElement | null>(null)  // raw video shown as thumbnail
const previewVideoRef   = ref<HTMLVideoElement | null>(null)  // separate low-res overlay
let hoverTimer          = 0

function onTileMouseEnter() {
  if (!props.item.isVideo) return
  isHovered.value = true
  hoverTimer = window.setTimeout(() => {
    // Prefer the dedicated low-res preview overlay; fall back to the thumbnail video element
    if (previewVideoRef.value) {
      previewVideoRef.value.play().catch(() => {})
    } else {
      thumbnailVideoRef.value?.play().catch(() => {})
    }
  }, 200)
}

function onTileMouseLeave() {
  clearTimeout(hoverTimer)
  if (previewVideoRef.value) {
    previewVideoRef.value.pause()
    previewVideoRef.value.currentTime = 0
  }
  if (thumbnailVideoRef.value) {
    thumbnailVideoRef.value.pause()
    thumbnailVideoRef.value.currentTime = 0
  }
  isHovered.value = false
}

onUnmounted(() => clearTimeout(hoverTimer))

// View Transitions: this tile's img gets view-transition-name while transitioning
const isVTNActive = computed(() => transitioningId.value === props.item.id)

const tileImgLoaded = ref(false)

// Deletion expiry badge (shown on trash items)
const expiryLabel = computed(() => {
  if (!props.item.deletionDate) return null
  const days = Math.ceil((new Date(props.item.deletionDate).getTime() - Date.now()) / 86_400_000)
  if (days <= 0) return 'Today'
  return `${days}d`
})
const expirySoon = computed(() =>
  !!props.item.deletionDate &&
  Math.ceil((new Date(props.item.deletionDate).getTime() - Date.now()) / 86_400_000) <= 3,
)

// Grid hover expansion: expand to natural aspect ratio at ~1.35× dominant dimension
const hoverCssVars = computed(() => {
  if (!props.gridMode) return {}
  const ar = props.item.aspectRatio
  const S  = props.width  // square tile size

  let W: number, H: number
  if (ar >= 1) {
    W = Math.round(S * 1.35)
    H = Math.round(W / ar)
  } else {
    H = Math.round(S * 1.35)
    W = Math.round(H * ar)
  }
  // Ensure both dimensions are at least the tile size
  W = Math.max(W, S)
  H = Math.max(H, S)

  return {
    '--hover-w':        W + 'px',
    '--hover-h':        H + 'px',
    '--hover-offset-x': `-${Math.round((W - S) / 2)}px`,
    '--hover-offset-y': `-${Math.round((H - S) / 2)}px`
  }
})

const router = useRouter()
const route  = useRoute()
const { activeLibraryId } = useAppShell()
// Prefer the route param (all library-scoped pages expose it); fall back to the
// active library as a safety net for any non-library-scoped context.
const libraryId = computed(() =>
  (route.params.library as string | undefined) ?? activeLibraryId.value,
)
const tileRef = ref<HTMLElement | null>(null)

const { startDrag, wasDragConsumed, isDragging, draggedIds } = useTileDrag()

// Reduce opacity when this specific tile is being dragged
const isDragSource = computed(() => isDragging.value && draggedIds.value.has(props.item.id))

/** Best available image URL for a media item — used in the drag ghost. */
function dragSrcFor(i: MediaItem): string {
  if (i.isVideo) return i.thumbnailSrc ?? i.src ?? ''
  return i.src ?? ''
}

function onMouseDown(e: MouseEvent) {
  if (e.button !== 0) return
  if (!tileRef.value) return

  // Collect items to drag: if in selection mode and this tile is selected,
  // drag the whole selected set; otherwise drag just this tile.
  const dragSet: DragSourceItem[] = (selectionMode.value && isSelected(props.item.id))
    ? allItems.value
        .filter(i => isSelected(i.id))
        .map(i => ({ item: i, src: dragSrcFor(i) }))
    : [{ item: props.item, src: dragSrcFor(props.item) }]

  startDrag(dragSet, e, tileRef.value)
}

function handleClick(e: MouseEvent | KeyboardEvent) {
  // If mouse was dragged past the threshold, don't also fire click logic
  if (wasDragConsumed()) return
  // Shift+click: range-select (works even when NOT in selection mode)
  if (e.shiftKey) {
    e.preventDefault()
    toggleItem(props.item.id, allIds.value, true)
    return
  }
  // Ctrl/Cmd+click: single-toggle selection, never open preview
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault()
    toggleItem(props.item.id, allIds.value, false)
    return
  }
  // In selection mode: toggle
  if (selectionMode.value) {
    e.preventDefault()
    toggleItem(props.item.id, allIds.value, false)
    return
  }
  // Normal click: navigate to preview page with View Transition
  navigateToPreview(props.item.id)
}

function handleCheckboxClick(e: MouseEvent) {
  e.stopPropagation()
  toggleItem(props.item.id, allIds.value, e.shiftKey)
}

function navigateToPreview(id: string) {
  const url = `/library/${libraryId.value}/preview/${id}`
  if (typeof document !== 'undefined' && 'startViewTransition' in document) {
    setTransitioning(id)
    nextTick(() => {
      ;(document as Document & { startViewTransition: (cb: () => Promise<void>) => void })
        .startViewTransition(async () => {
          await router.push(url)
          setTransitioning(null)
          await nextTick()
        })
    })
  } else {
    router.push(url)
  }
}
</script>

<template>
  <div
    ref="tileRef"
    class="media-tile"
    :class="{
      'is-selected':    selected,
      'is-grid-tile':   gridMode,
      'is-provisional': item.isProvisional,
      'is-drag-source': isDragSource,
      'selection-mode': selectionMode,
    }"
    :style="{
      width:  width  + 'px',
      height: height + 'px',
      ...hoverCssVars,
    }"
    :aria-label="item.originalFilename"
    role="button"
    :tabindex="0"
    draggable="false"
    @mousedown="onMouseDown"
    @click="handleClick"
    @keydown.enter="handleClick"
    @dragstart.prevent
    @mouseenter="onTileMouseEnter"
    @mouseleave="onTileMouseLeave"
  >
    <!-- Inner container: handles hover expansion (grid) or subtle scale (masonry) -->
    <div class="tile-inner">
      <!-- Fallback icon: shows when the real thumbnail hasn't loaded or fails -->
      <div class="tile-fallback" aria-hidden="true">
        <VideoIcon v-if="item.isVideo" class="tile-fallback-video-icon" />
        <ImageIcon v-else class="tile-fallback-icon" />
      </div>

      <!-- Image tiles (or video tiles with a server-extracted thumbnail) -->
      <img
        v-if="imgSrc"
        :src="imgSrc"
        :alt="item.originalFilename"
        :width="width"
        :height="height"
        loading="lazy"
        decoding="async"
        draggable="false"
        class="tile-img"
        :class="{ 'is-loaded': tileImgLoaded }"
        :style="isVTNActive ? { viewTransitionName: 'photo-preview' } : {}"
        @load="tileImgLoaded = true"
        @error="(e) => (e.currentTarget as HTMLImageElement).classList.add('has-error')"
      />

      <!-- Video tiles without a server thumbnail: show first frame via the <video> element itself -->
      <video
        v-else-if="item.isVideo && item.src"
        ref="thumbnailVideoRef"
        :src="item.src"
        class="tile-img"
        :style="isVTNActive ? { viewTransitionName: 'photo-preview' } : {}"
        muted
        playsinline
        preload="metadata"
        draggable="false"
        tabindex="-1"
        aria-hidden="true"
        @loadedmetadata="(e) => { (e.target as HTMLVideoElement).currentTime = 0 }"
      />

      <!-- Low-res hover-preview overlay: fades in when hovered (used when previewSrc is ready) -->
      <video
        v-if="item.isVideo && item.previewSrc"
        ref="previewVideoRef"
        :src="item.previewSrc"
        class="tile-video-preview"
        :class="{ 'is-playing': isHovered }"
        muted
        loop
        playsinline
        preload="none"
        draggable="false"
        tabindex="-1"
        aria-hidden="true"
      />

      <!-- Provisional overlay: pulsing shimmer + spinner while upload is processing -->
      <div v-if="item.isProvisional" class="media-tile-provisional" aria-hidden="true">
        <svg class="media-tile-provisional-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
        </svg>
      </div>

      <!-- Selection checkbox -->
      <div
        class="media-tile-checkbox"
        :aria-label="selected ? 'Deselect' : 'Select'"
        role="checkbox"
        :aria-checked="selected"
        @click="handleCheckboxClick"
      >
        <CheckIcon v-if="selected" :size="13" color="white" />
      </div>

      <!-- Video badge -->
      <div v-if="item.isVideo" class="media-tile-video-badge" aria-label="Video">
        <VideoIcon :size="11" />
        <span>{{ item.duration }}</span>
      </div>

      <!-- Expiry badge (trash items) -->
      <div
        v-if="expiryLabel"
        class="media-tile-expiry-badge"
        :class="{ 'is-soon': expirySoon }"
        aria-label="`Expires in ${expiryLabel}`"
      >
        {{ expiryLabel }}
      </div>
    </div>
  </div>
</template>
