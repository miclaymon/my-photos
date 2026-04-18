<script setup lang="ts">
import { PlusIcon, LayoutGridIcon } from 'lucide-vue-next'

definePageMeta({ middleware: 'auth' })

const route     = useRoute()
const libraryId = computed(() => route.params.library as string)

const { setActiveLibrary } = useAppShell()
watch(libraryId, id => setActiveLibrary(id), { immediate: true })

const { albums, isLoading, fetchAlbums, createAlbum, deleteAlbum, renameAlbum } = useAlbums(libraryId)

const createOpen = ref(false)

async function handleCreate(name: string) {
  await createAlbum(name)
}

async function handleDelete(albumId: string) {
  await deleteAlbum(albumId)
}

async function handleRename(albumId: string, name: string) {
  await renameAlbum(albumId, name)
}
</script>

<template>
  <div class="albums-page">

    <div class="albums-page-header">
      <h1 class="albums-page-title">Albums</h1>
      <button class="albums-new-btn" @click="createOpen = true">
        <PlusIcon :size="14" />
        New album
      </button>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="albums-loading" />

    <!-- Empty -->
    <div v-else-if="!albums.length" class="albums-empty">
      <LayoutGridIcon :size="48" class="albums-empty-icon" />
      <p class="albums-empty-title">No albums yet</p>
      <p class="albums-empty-body">Create an album to organise your favourite photos.</p>
      <button class="albums-empty-create" @click="createOpen = true">
        <PlusIcon :size="14" />
        Create album
      </button>
    </div>

    <!-- Grid -->
    <div v-else class="albums-grid">
      <AlbumCard
        v-for="album in albums"
        :key="album.id"
        :album="album"
        :library-id="libraryId"
        @delete="handleDelete"
        @rename="handleRename"
      />
    </div>

  </div>

  <AppAlbumCreateModal
    v-model:open="createOpen"
    @create="handleCreate"
  />
</template>

<style scoped>
.albums-page {
  padding: 0 24px 48px;
}

/* ── Header ────────────────────────────────────────────────────────────────── */
.albums-page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0 20px;
}

.albums-page-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--color-text-primary);
  letter-spacing: -0.02em;
  margin: 0;
}

.albums-new-btn {
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

.albums-new-btn:hover {
  background: var(--color-hover);
  color: var(--color-text-primary);
}

/* ── Loading ──────────────────────────────────────────────────────────────── */
.albums-loading {
  min-height: 200px;
}

/* ── Empty ────────────────────────────────────────────────────────────────── */
.albums-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 64px 24px;
  text-align: center;
}

.albums-empty-icon {
  color: var(--color-text-muted);
  margin-bottom: 8px;
}

.albums-empty-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.albums-empty-body {
  font-size: 13px;
  color: var(--color-text-muted);
  margin: 0 0 8px;
}

.albums-empty-create {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  border-radius: 8px;
  border: none;
  background: var(--color-accent);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  transition: opacity 0.12s;
}

.albums-empty-create:hover { opacity: 0.88; }

/* ── Grid ─────────────────────────────────────────────────────────────────── */
.albums-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 20px;
}

@media (min-width: 768px) {
  .albums-grid {
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  }
}
</style>
