<script setup lang="ts">
import type { AlbumSummary } from '~/composables/useAlbums'

const props = defineProps<{
  album:     AlbumSummary
  /** Library slug used to build the route (e.g. the library UUID) */
  libraryId: string
}>()

const emit = defineEmits<{
  delete: [id: string]
  rename: [id: string, name: string]
}>()

const router   = useRouter()
const menuOpen = ref(false)
const renaming = ref(false)
const newName  = ref('')

// ── Cover layout ──────────────────────────────────────────────────────────────

// 1 URL → single cover; 2-4 URLs → collage
const isSingle = computed(() => props.album.coverUrls.length <= 1)
// For collage: fill up to 4 slots so the grid is always 2×2
const collageUrls = computed(() => {
  const urls = props.album.coverUrls.slice(0, 4)
  while (urls.length < 4) urls.push('')
  return urls
})

// ── Navigation (with View Transition) ────────────────────────────────────────

function open() {
  const url = `/library/${props.libraryId}/album/${props.album.id}`
  if (!('startViewTransition' in document)) {
    router.push(url)
    return
  }
  ;(document as any).startViewTransition(() => router.push(url))
}

// ── Context menu ──────────────────────────────────────────────────────────────

function startRename() {
  newName.value = props.album.name
  menuOpen.value = false
  renaming.value = true
  nextTick(() => {
    const el = document.getElementById(`album-rename-${props.album.id}`) as HTMLInputElement | null
    el?.focus()
    el?.select()
  })
}

function commitRename() {
  const name = newName.value.trim()
  if (name && name !== props.album.name) emit('rename', props.album.id, name)
  renaming.value = false
}

function cancelRename() {
  renaming.value = false
}
</script>

<template>
  <div
    class="album-card"
    :style="{ viewTransitionName: `album-cover-${album.id}` }"
    @click="open"
  >
    <!-- Cover image area -->
    <div class="album-cover">
      <!-- Single cover -->
      <template v-if="isSingle">
        <img
          v-if="album.coverUrls[0]"
          :src="album.coverUrls[0]"
          :alt="album.name"
          class="album-cover-img"
          draggable="false"
        />
        <div v-else class="album-cover-empty">
          <span class="album-cover-empty-icon">📷</span>
        </div>
      </template>

      <!-- Collage (2×2) -->
      <template v-else>
        <div class="album-cover-collage">
          <div
            v-for="(url, i) in collageUrls"
            :key="i"
            class="album-cover-cell"
          >
            <img
              v-if="url"
              :src="url"
              :alt="`${album.name} photo ${i + 1}`"
              class="album-cover-cell-img"
              draggable="false"
            />
          </div>
        </div>
      </template>

      <!-- Edit menu trigger (editors only) -->
      <button
        v-if="album.canEdit"
        class="album-menu-btn"
        aria-label="Album options"
        @click.stop="menuOpen = !menuOpen"
      >
        ···
      </button>

      <!-- Context menu -->
      <div v-if="menuOpen" class="album-menu" @click.stop>
        <button class="album-menu-item" @click="startRename">Rename</button>
        <button class="album-menu-item album-menu-item-danger" @click="emit('delete', album.id); menuOpen = false">Delete</button>
      </div>
    </div>

    <!-- Name (inline-editable on rename) -->
    <div class="album-meta">
      <input
        v-if="renaming"
        :id="`album-rename-${album.id}`"
        v-model="newName"
        class="album-rename-input"
        @click.stop
        @keydown.enter="commitRename"
        @keydown.escape="cancelRename"
        @blur="commitRename"
      />
      <span v-else class="album-name">{{ album.name }}</span>
      <span class="album-count">{{ album.itemCount }} {{ album.itemCount === 1 ? 'item' : 'items' }}</span>
    </div>
  </div>

  <!-- Close menu on outside click -->
  <Teleport v-if="menuOpen" to="body">
    <div class="album-menu-backdrop" @click="menuOpen = false" />
  </Teleport>
</template>

<style scoped>
.album-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

/* ── Cover ────────────────────────────────────────────────────────────────── */
.album-cover {
  position: relative;
  aspect-ratio: 1 / 1;
  border-radius: 10px;
  overflow: hidden;
  background: var(--color-surface);
}

.album-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.2s ease;
  display: block;
}

.album-card:hover .album-cover-img {
  transform: scale(1.03);
}

/* Collage */
.album-cover-collage {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows:    1fr 1fr;
  width: 100%;
  height: 100%;
  gap: 2px;
}

.album-cover-cell {
  overflow: hidden;
  background: var(--color-surface-raised);
}

.album-cover-cell-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.2s ease;
}

.album-card:hover .album-cover-cell-img {
  transform: scale(1.04);
}

/* Empty state */
.album-cover-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: var(--color-surface-raised);
}

.album-cover-empty-icon {
  font-size: 32px;
  opacity: 0.4;
}

/* ── Menu button ────────────────────────────────────────────────────────── */
.album-menu-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: rgba(0,0,0,0.45);
  color: #fff;
  font-size: 16px;
  line-height: 1;
  letter-spacing: 1px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.album-cover:hover .album-menu-btn {
  opacity: 1;
}

/* ── Context menu ──────────────────────────────────────────────────────── */
.album-menu {
  position: absolute;
  top: 38px;
  right: 6px;
  background: var(--color-surface-overlay);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.18);
  min-width: 130px;
  z-index: 100;
  overflow: hidden;
}

.album-menu-item {
  display: block;
  width: 100%;
  padding: 9px 14px;
  text-align: left;
  font-size: 13px;
  border: none;
  background: transparent;
  color: var(--color-text-primary);
  cursor: pointer;
}

.album-menu-item:hover {
  background: var(--color-hover);
}

.album-menu-item-danger {
  color: #ef4444;
}

.album-menu-item-danger:hover {
  background: rgba(239,68,68,0.08);
}

/* Invisible backdrop to detect outside clicks */
.album-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 99;
}

/* ── Meta ──────────────────────────────────────────────────────────────── */
.album-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 2px;
}

.album-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}

.album-count {
  font-size: 11px;
  color: var(--color-text-muted);
}

/* Rename input */
.album-rename-input {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-accent);
  border-radius: 4px;
  padding: 2px 6px;
  width: 100%;
  outline: none;
  font-family: inherit;
}
</style>
