<script setup lang="ts">
import { PencilIcon, CheckIcon, XIcon, Trash2Icon, ImageIcon, GripVerticalIcon } from 'lucide-vue-next'

definePageMeta({ middleware: 'auth', keepalive: false })

// ── Route ─────────────────────────────────────────────────────────────────────

const route    = useRoute()
const router   = useRouter()
const libraryId = computed(() => route.params.library as string)
const albumId   = computed(() => route.params.albumId  as string)

// ── Data ──────────────────────────────────────────────────────────────────────

interface AlbumItem {
  id:               number
  mediaId:          string
  sortOrder:        number
  caption:          string | null
  originalFilename: string
  contentType:      string
  width:            number
  height:           number
  aspectRatio:      number
  isVideo:          boolean
  durationSeconds?: number
  takenAt:          string
  src:              string | null
  thumbnailSrc:     string | null
  previewSrc:       string | null
}

interface AlbumDetail {
  id:        string
  name:      string
  libraryId: string
  ownerId:   number
  coverId:   string | null
  coverUrl:  string | null
  canEdit:   boolean
  createdAt: string
  updatedAt: string
  items:     AlbumItem[]
}

const album     = ref<AlbumDetail | null>(null)
const loading   = ref(true)
const loadError = ref<string | null>(null)

function mapAlbumItem(raw: Record<string, unknown>): AlbumItem {
  const contentType = (raw.content_type as string) ?? ''
  return {
    id:               raw.id               as number,
    mediaId:          raw.media_id         as string,
    sortOrder:        raw.sort_order       as number,
    caption:          raw.caption          as string | null,
    originalFilename: raw.original_filename as string,
    contentType,
    width:            (raw.width           as number) ?? 0,
    height:           (raw.height          as number) ?? 0,
    aspectRatio:      (raw.aspect_ratio    as number) ?? 1,
    isVideo:          contentType.startsWith('video/'),
    durationSeconds:  raw.duration_seconds as number | undefined,
    takenAt:          raw.taken_at         as string,
    src:              raw.image_url        as string | null,
    thumbnailSrc:     raw.thumbnail_url    as string | null,
    previewSrc:       null,
  }
}

function mapAlbumDetail(raw: Record<string, unknown>): AlbumDetail {
  return {
    id:        raw.id         as string,
    name:      raw.name       as string,
    libraryId: raw.library_id as string,
    ownerId:   raw.owner_id   as number,
    coverId:   raw.cover_id   as string | null,
    coverUrl:  raw.cover_url  as string | null,
    canEdit:   (raw.can_edit  as boolean) ?? false,
    createdAt: raw.created_at as string,
    updatedAt: raw.updated_at as string,
    items:     ((raw.items ?? []) as Record<string, unknown>[]).map(mapAlbumItem),
  }
}

async function loadAlbum() {
  loading.value   = true
  loadError.value = null
  try {
    const raw    = await $fetch<Record<string, unknown>>(`/api/v1/albums/${albumId.value}`)
    album.value  = mapAlbumDetail(raw)
    // Initialise local items copy for drag-and-drop
    localItems.value = [...(album.value?.items ?? [])]
  } catch {
    loadError.value = 'Could not load album.'
  } finally {
    loading.value = false
  }
}

watch(albumId, loadAlbum, { immediate: true })

// ── Edit mode ─────────────────────────────────────────────────────────────────

const editMode    = ref(false)
const renaming    = ref(false)
const newName     = ref('')
const nameInputEl = ref<HTMLInputElement | null>(null)
const saving      = ref(false)

function enterEdit() {
  editMode.value = true
}

function exitEdit() {
  editMode.value = false
  dragState.value = null
}

async function saveEdits() {
  if (!album.value) return
  saving.value = true

  // Save reorder if order changed
  const orderChanged = localItems.value.some((item, i) => item.id !== (album.value!.items[i]?.id))
  if (orderChanged) {
    await $fetch(`/api/v1/albums/${albumId.value}/reorder`, {
      method: 'POST',
      body:   { order: localItems.value.map(i => i.id) },
    }).catch(() => {})
  }

  saving.value   = false
  editMode.value = false
  await loadAlbum()
}

// Rename
function startRename() {
  newName.value  = album.value?.name ?? ''
  renaming.value = true
  nextTick(() => { nameInputEl.value?.focus(); nameInputEl.value?.select() })
}

async function commitRename() {
  renaming.value = false
  const name = newName.value.trim()
  if (!name || name === album.value?.name) return
  await $fetch(`/api/v1/albums/${albumId.value}`, { method: 'PATCH', body: { name } }).catch(() => {})
  if (album.value) album.value.name = name
}

function cancelRename() {
  renaming.value = false
}

// ── Caption editing ───────────────────────────────────────────────────────────

const editingCaptionId   = ref<number | null>(null)
const captionDraft       = ref('')

function startCaptionEdit(item: AlbumItem) {
  editingCaptionId.value = item.id
  captionDraft.value     = item.caption ?? ''
}

async function commitCaption(item: AlbumItem) {
  editingCaptionId.value = null
  const caption = captionDraft.value.trim() || null
  if (caption === item.caption) return
  item.caption = caption
  await $fetch(`/api/v1/albums/${albumId.value}/items/${item.mediaId}`, {
    method: 'PATCH',
    body:   { caption },
  }).catch(() => {})
}

function cancelCaption() {
  editingCaptionId.value = null
}

// ── Remove item ───────────────────────────────────────────────────────────────

async function removeItem(item: AlbumItem) {
  localItems.value = localItems.value.filter(i => i.id !== item.id)
  await $fetch(`/api/v1/albums/${albumId.value}/items/${item.mediaId}`, {
    method: 'DELETE',
  }).catch(() => {})
}

// ── Cover selection ───────────────────────────────────────────────────────────

async function setCover(item: AlbumItem) {
  await $fetch(`/api/v1/albums/${albumId.value}`, {
    method: 'PATCH',
    body:   { cover_id: item.mediaId },
  }).catch(() => {})
  await loadAlbum()
}

// ── Drag-and-drop reorder ─────────────────────────────────────────────────────

const localItems = ref<AlbumItem[]>([])

interface DragState {
  sourceIndex: number
  overIndex:   number | null
}

const dragState = ref<DragState | null>(null)

function onDragStart(e: DragEvent, index: number) {
  if (!e.dataTransfer) return
  dragState.value = { sourceIndex: index, overIndex: null }
  e.dataTransfer.effectAllowed = 'move'

  // Use the item's thumbnail as drag image
  const img = (e.currentTarget as HTMLElement).querySelector<HTMLImageElement>('.album-item-thumb')
  if (img) {
    e.dataTransfer.setDragImage(img, img.offsetWidth / 2, img.offsetHeight / 2)
  }
}

function onDragEnter(e: DragEvent, index: number) {
  e.preventDefault()
  if (!dragState.value) return
  dragState.value = { ...dragState.value, overIndex: index }
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
}

function onDrop(e: DragEvent, targetIndex: number) {
  e.preventDefault()
  if (!dragState.value) return
  const { sourceIndex } = dragState.value
  if (sourceIndex === targetIndex) { dragState.value = null; return }

  const items = [...localItems.value]
  const [moved] = items.splice(sourceIndex, 1)
  items.splice(targetIndex, 0, moved!)
  localItems.value = items
  dragState.value  = null
}

function onDragEnd() {
  dragState.value = null
}

function isDragging(index: number)  { return dragState.value?.sourceIndex === index }
function isDropTarget(index: number) { return dragState.value?.overIndex === index && dragState.value?.sourceIndex !== index }

// ── Cover hero ────────────────────────────────────────────────────────────────

const coverUrl = computed(() =>
  album.value?.coverUrl ?? localItems.value[0]?.thumbnailSrc ?? localItems.value[0]?.src ?? null,
)

// View transition name must match the AlbumCard's name for the animation to work
const coverTransitionName = computed(() => `album-cover-${albumId.value}`)
</script>

<template>
  <div class="album-detail">

    <!-- Loading -->
    <div v-if="loading" class="album-loading">
      <div class="album-loading-hero" />
    </div>

    <!-- Error -->
    <div v-else-if="loadError" class="album-error">
      {{ loadError }}
      <button @click="loadAlbum">Retry</button>
    </div>

    <template v-else-if="album">

      <!-- ── Hero cover ─────────────────────────────────────────────────── -->
      <div
        class="album-hero"
        :style="{ viewTransitionName: coverTransitionName }"
      >
        <img
          v-if="coverUrl"
          :src="coverUrl"
          :alt="album.name"
          class="album-hero-img"
        />
        <div v-else class="album-hero-empty">
          <ImageIcon :size="40" />
        </div>
        <div class="album-hero-overlay" />
      </div>

      <!-- ── Title bar ──────────────────────────────────────────────────── -->
      <div class="album-title-bar">
        <div class="album-title-wrap">
          <template v-if="renaming">
            <input
              ref="nameInputEl"
              v-model="newName"
              class="album-name-input"
              @keydown.enter="commitRename"
              @keydown.escape="cancelRename"
              @blur="commitRename"
            />
          </template>
          <h1 v-else class="album-title" @dblclick="album.canEdit && startRename()">
            {{ album.name }}
          </h1>
          <span class="album-subtitle">{{ album.items.length }} {{ album.items.length === 1 ? 'item' : 'items' }}</span>
        </div>

        <!-- Action bar -->
        <div class="album-actions">
          <template v-if="editMode">
            <button class="album-action-btn album-action-save" :disabled="saving" @click="saveEdits">
              <CheckIcon :size="14" />
              {{ saving ? 'Saving…' : 'Done' }}
            </button>
            <button class="album-action-btn" @click="exitEdit">
              <XIcon :size="14" />
              Cancel
            </button>
          </template>
          <template v-else-if="album.canEdit">
            <button class="album-action-btn" @click="startRename">
              <PencilIcon :size="13" />
              Rename
            </button>
            <button class="album-action-btn" @click="enterEdit">
              <GripVerticalIcon :size="13" />
              Edit
            </button>
          </template>
        </div>
      </div>

      <!-- ── Empty album ────────────────────────────────────────────────── -->
      <div v-if="!localItems.length" class="album-empty">
        <ImageIcon :size="40" class="album-empty-icon" />
        <p class="album-empty-title">This album is empty</p>
        <p class="album-empty-body">Add photos from your library to get started.</p>
      </div>

      <!-- ── Item grid ──────────────────────────────────────────────────── -->
      <div v-else class="album-grid" :class="{ 'is-edit': editMode }">
        <div
          v-for="(item, index) in localItems"
          :key="item.id"
          class="album-item"
          :class="{
            'is-dragging':    isDragging(index),
            'is-drop-target': isDropTarget(index),
          }"
          :draggable="editMode"
          @dragstart="editMode && onDragStart($event, index)"
          @dragenter="editMode && onDragEnter($event, index)"
          @dragover="editMode && onDragOver($event)"
          @drop="editMode && onDrop($event, index)"
          @dragend="onDragEnd"
        >
          <!-- Photo / thumbnail -->
          <div
            class="album-item-cover"
            :class="{ 'is-clickable': !editMode }"
            @click="!editMode && router.push(`/library/${libraryId}/preview/${item.mediaId}`)"
          >
            <img
              v-if="item.thumbnailSrc || item.src"
              :src="(item.isVideo ? item.thumbnailSrc : item.src) ?? item.src ?? ''"
              :alt="item.originalFilename"
              class="album-item-thumb"
              loading="lazy"
              draggable="false"
            />
            <div v-else class="album-item-placeholder">
              <ImageIcon :size="24" />
            </div>

            <!-- Video badge -->
            <span v-if="item.isVideo" class="album-item-video-badge">▶</span>

            <!-- Edit-mode overlays -->
            <template v-if="editMode">
              <!-- Drag handle indicator (top-left) -->
              <div class="album-item-drag-handle">
                <GripVerticalIcon :size="14" />
              </div>

              <!-- Remove button -->
              <button
                class="album-item-remove"
                title="Remove from album"
                @click.stop="removeItem(item)"
              >
                <XIcon :size="12" />
              </button>

              <!-- Set as cover -->
              <button
                class="album-item-set-cover"
                title="Set as album cover"
                @click.stop="setCover(item)"
              >
                <ImageIcon :size="12" />
              </button>
            </template>
          </div>

          <!-- Caption -->
          <div class="album-item-caption-wrap">
            <template v-if="editMode && editingCaptionId === item.id">
              <textarea
                v-model="captionDraft"
                class="album-item-caption-input"
                rows="2"
                placeholder="Add a caption…"
                @keydown.escape="cancelCaption"
                @blur="commitCaption(item)"
                @keydown.enter.prevent="commitCaption(item)"
              />
            </template>
            <template v-else>
              <p
                v-if="item.caption || editMode"
                class="album-item-caption"
                :class="{ 'is-placeholder': !item.caption }"
                @click="editMode && startCaptionEdit(item)"
              >
                {{ item.caption ?? (editMode ? 'Add a caption…' : '') }}
              </p>
            </template>
          </div>
        </div>
      </div>

    </template>

  </div>
</template>

<style scoped>
.album-detail {
  display: flex;
  flex-direction: column;
}

/* ── Loading ──────────────────────────────────────────────────────────────── */
.album-loading {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.album-loading-hero {
  height: 260px;
  background: var(--color-surface-raised);
  animation: hero-pulse 1.6s ease-in-out infinite;
}

@keyframes hero-pulse {
  0%, 100% { opacity: 0.5; }
  50%       { opacity: 1; }
}

/* ── Error ────────────────────────────────────────────────────────────────── */
.album-error {
  padding: 40px 24px;
  text-align: center;
  color: #ef4444;
  font-size: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
}

/* ── Hero ─────────────────────────────────────────────────────────────────── */
.album-hero {
  position: relative;
  width: 100%;
  height: 280px;
  overflow: hidden;
  background: var(--color-surface-raised);
  contain: layout paint;
}

.album-hero-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.album-hero-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--color-text-muted);
}

/* Subtle gradient overlay so title text is readable above the image */
.album-hero-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.55) 100%);
  pointer-events: none;
}

/* ── Title bar ────────────────────────────────────────────────────────────── */
.album-title-bar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px 12px;
  flex-wrap: wrap;
}

.album-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.album-title {
  font-size: 26px;
  font-weight: 700;
  color: var(--color-text-primary);
  letter-spacing: -0.03em;
  margin: 0;
  cursor: default;
}

.album-title:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-color: var(--color-border);
}

.album-name-input {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.03em;
  font-family: inherit;
  color: var(--color-text-primary);
  background: transparent;
  border: none;
  border-bottom: 2px solid var(--color-accent);
  outline: none;
  width: 320px;
  max-width: 100%;
  padding: 0;
}

.album-subtitle {
  font-size: 13px;
  color: var(--color-text-muted);
}

.album-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.album-action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-raised);
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.12s, color 0.12s;
}

.album-action-btn:hover {
  background: var(--color-hover);
  color: var(--color-text-primary);
}

.album-action-save {
  background: var(--color-accent);
  color: #fff;
  border-color: transparent;
}

.album-action-save:hover:not(:disabled) {
  opacity: 0.88;
  background: var(--color-accent);
  color: #fff;
}

.album-action-save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* ── Empty ────────────────────────────────────────────────────────────────── */
.album-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 64px 24px;
  text-align: center;
}

.album-empty-icon { color: var(--color-text-muted); margin-bottom: 8px; }
.album-empty-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}
.album-empty-body {
  font-size: 13px;
  color: var(--color-text-muted);
  margin: 0;
}

/* ── Item grid ────────────────────────────────────────────────────────────── */
.album-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 4px;
  padding: 8px 24px 48px;
}

@media (min-width: 768px) {
  .album-grid {
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 6px;
  }
}

.album-grid.is-edit {
  gap: 10px;
}

/* ── Item ─────────────────────────────────────────────────────────────────── */
.album-item {
  display: flex;
  flex-direction: column;
  gap: 0;
  position: relative;
  border-radius: 6px;
  overflow: visible;
  transition: opacity 0.15s, transform 0.15s;
}

/* Drag states */
.album-item.is-dragging {
  opacity: 0.35;
  transform: scale(0.97);
}

.album-item.is-drop-target > .album-item-cover {
  outline: 2.5px solid var(--color-accent);
  outline-offset: 2px;
  border-radius: 6px;
}

/* In edit mode, show cursor affordance */
.album-grid.is-edit .album-item {
  cursor: grab;
}

.album-grid.is-edit .album-item:active {
  cursor: grabbing;
}

/* ── Item cover ───────────────────────────────────────────────────────────── */
.album-item-cover {
  position: relative;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  border-radius: 6px;
  background: var(--color-surface-raised);
}

.album-item-cover.is-clickable { cursor: pointer; }

.album-item-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.18s ease;
}

.album-item:not(.is-dragging):hover .album-item-thumb {
  transform: scale(1.025);
}

.album-item-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--color-text-muted);
}

/* Video badge */
.album-item-video-badge {
  position: absolute;
  bottom: 6px;
  left: 6px;
  background: rgba(0,0,0,0.55);
  color: #fff;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  backdrop-filter: blur(4px);
}

/* ── Edit overlays ────────────────────────────────────────────────────────── */
.album-item-drag-handle {
  position: absolute;
  top: 5px;
  left: 5px;
  width: 24px;
  height: 24px;
  background: rgba(0,0,0,0.45);
  backdrop-filter: blur(4px);
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  opacity: 0;
  transition: opacity 0.15s;
  pointer-events: none;
}

.album-grid.is-edit .album-item:hover .album-item-drag-handle {
  opacity: 1;
}

.album-item-remove,
.album-item-set-cover {
  position: absolute;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: none;
  background: rgba(0,0,0,0.5);
  backdrop-filter: blur(4px);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s, background 0.1s;
}

.album-item-remove    { top: 5px; right: 5px; }
.album-item-set-cover { bottom: 5px; right: 5px; }

.album-grid.is-edit .album-item:hover .album-item-remove,
.album-grid.is-edit .album-item:hover .album-item-set-cover {
  opacity: 1;
}

.album-item-remove:hover { background: rgba(220,38,38,0.7); }
.album-item-set-cover:hover { background: rgba(59,130,246,0.65); }

/* ── Caption ──────────────────────────────────────────────────────────────── */
.album-item-caption-wrap {
  padding: 5px 2px 2px;
  min-height: 0;
}

.album-item-caption {
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.4;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.album-item-caption.is-placeholder {
  color: var(--color-text-muted);
  font-style: italic;
  cursor: text;
}

.album-item-caption-input {
  width: 100%;
  font-size: 12px;
  font-family: inherit;
  color: var(--color-text-primary);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-accent);
  border-radius: 5px;
  padding: 4px 7px;
  resize: none;
  outline: none;
  box-sizing: border-box;
  line-height: 1.4;
}
</style>
