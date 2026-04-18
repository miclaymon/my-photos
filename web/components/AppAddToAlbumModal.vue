<script setup lang="ts">
import { SearchIcon, PlusIcon, LayoutGridIcon } from 'lucide-vue-next'
import type { AlbumSummary } from '~/composables/useAlbums'

const props = defineProps<{
  open:     boolean
  mediaIds: string[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  added: [albumName: string]
}>()

// ── State ─────────────────────────────────────────────────────────────────────

const allAlbums    = ref<AlbumSummary[]>([])
const loading      = ref(false)
const search       = ref('')
const searchEl     = ref<HTMLInputElement | null>(null)
const creatingNew  = ref(false)
const newAlbumName = ref('')
const newNameEl    = ref<HTMLInputElement | null>(null)
const working      = ref(false)

async function fetchAlbums() {
  loading.value = true
  try {
    const data  = await $fetch<{ albums: AlbumSummary[] }>('/api/v1/albums')
    allAlbums.value = data.albums
  } catch { /* ignore */ } finally {
    loading.value = false
  }
}

watch(() => props.open, (v) => {
  if (!v) return
  search.value       = ''
  creatingNew.value  = false
  newAlbumName.value = ''
  fetchAlbums()
  nextTick(() => searchEl.value?.focus())
})

// ── Filtered list ─────────────────────────────────────────────────────────────

const filtered = computed(() => {
  const q        = search.value.trim().toLowerCase()
  const editable = allAlbums.value.filter(a => a.canEdit)
  return q ? editable.filter(a => a.name.toLowerCase().includes(q)) : editable
})

// ── Actions ───────────────────────────────────────────────────────────────────

async function addToAlbum(album: AlbumSummary) {
  if (working.value) return
  working.value = true
  try {
    await $fetch(`/api/v1/albums/${album.id}/items`, {
      method: 'POST',
      body:   { mediaIds: props.mediaIds },
    })
    emit('added', album.name)
    emit('update:open', false)
  } catch { /* ignore */ } finally {
    working.value = false
  }
}

function showCreate() {
  creatingNew.value  = true
  newAlbumName.value = search.value
  nextTick(() => { newNameEl.value?.focus(); newNameEl.value?.select() })
}

async function submitCreate() {
  const name = newAlbumName.value.trim()
  if (!name || working.value) return
  working.value = true
  try {
    const existingLib              = allAlbums.value.find(a => a.canEdit)?.libraryId
    const { activeLibraryId }      = useAppShell()
    const libraryId                = existingLib ?? activeLibraryId.value
    if (!libraryId) return

    const newAlbum = await $fetch<{ id: string }>(`/api/v1/library/${libraryId}/albums`, {
      method: 'POST',
      body:   { name },
    })
    await $fetch(`/api/v1/albums/${newAlbum.id}/items`, {
      method: 'POST',
      body:   { mediaIds: props.mediaIds },
    })
    emit('added', name)
    emit('update:open', false)
  } catch { /* ignore */ } finally {
    working.value = false
  }
}

function close() { emit('update:open', false) }
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="open" class="ata-backdrop" @click.self="close">
        <div class="ata-modal" role="dialog" aria-modal="true" aria-label="Add to album">

          <!-- Header -->
          <div class="ata-header">
            <h2 class="ata-title">Add to album</h2>
            <span class="ata-count">{{ mediaIds.length }} {{ mediaIds.length === 1 ? 'item' : 'items' }}</span>
          </div>

          <!-- Search -->
          <div class="ata-search-wrap">
            <SearchIcon :size="14" class="ata-search-icon" />
            <input
              ref="searchEl"
              v-model="search"
              class="ata-search"
              placeholder="Search albums…"
              @keydown.escape="close"
            />
          </div>

          <!-- Unified list -->
          <div class="ata-list">

            <!-- "New album" row -->
            <div class="ata-row ata-row-create" @click="!creatingNew && showCreate()">
              <div class="ata-thumb ata-thumb-new">
                <PlusIcon :size="16" />
              </div>

              <template v-if="creatingNew">
                <input
                  ref="newNameEl"
                  v-model="newAlbumName"
                  class="ata-new-input"
                  placeholder="Album name"
                  :disabled="working"
                  @click.stop
                  @keydown.enter="submitCreate"
                  @keydown.escape="creatingNew = false"
                />
                <button
                  class="ata-new-submit"
                  :disabled="!newAlbumName.trim() || working"
                  @click.stop="submitCreate"
                >
                  {{ working ? '…' : 'Create' }}
                </button>
              </template>

              <div v-else class="ata-row-info">
                <span class="ata-row-name ata-row-name-accent">
                  New album{{ search ? ` "${search}"` : '' }}
                </span>
              </div>
            </div>

            <!-- Divider -->
            <div v-if="filtered.length" class="ata-divider" />

            <!-- Loading -->
            <div v-if="loading" class="ata-status">Loading…</div>

            <!-- No results -->
            <div v-else-if="!filtered.length && search" class="ata-status">
              No albums match "{{ search }}"
            </div>

            <!-- Album rows -->
            <button
              v-for="album in filtered"
              :key="album.id"
              class="ata-row"
              :disabled="working"
              @click="addToAlbum(album)"
            >
              <div class="ata-thumb">
                <img
                  v-if="album.coverUrls[0]"
                  :src="album.coverUrls[0]"
                  :alt="album.name"
                  class="ata-thumb-img"
                />
                <LayoutGridIcon v-else :size="16" class="ata-thumb-placeholder-icon" />
              </div>
              <div class="ata-row-info">
                <span class="ata-row-name">{{ album.name }}</span>
                <span class="ata-row-sub">{{ album.itemCount }} {{ album.itemCount === 1 ? 'item' : 'items' }}</span>
              </div>
            </button>

          </div>

        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ata-backdrop {
  position: fixed;
  inset: 0;
  z-index: 500;
  background: rgba(0,0,0,0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.ata-modal {
  background: var(--color-surface-overlay);
  border: 1px solid var(--color-border);
  border-radius: 14px;
  width: 100%;
  max-width: 320px;
  box-shadow: 0 24px 64px rgba(0,0,0,0.28);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  max-height: 72vh;
}

/* ── Header ──────────────────────────────────────────────────────────────── */
.ata-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 14px 16px 0;
}

.ata-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
  flex: 1;
}

.ata-count {
  font-size: 11px;
  color: var(--color-text-muted);
}

/* ── Search ──────────────────────────────────────────────────────────────── */
.ata-search-wrap {
  position: relative;
  padding: 10px 10px 6px;
}

.ata-search-icon {
  position: absolute;
  left: 21px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-muted);
  pointer-events: none;
}

.ata-search {
  width: 100%;
  padding: 7px 10px 7px 28px;
  font-size: 13px;
  font-family: inherit;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface-raised);
  color: var(--color-text-primary);
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s;
}

.ata-search:focus { border-color: var(--color-accent); }

/* ── List ────────────────────────────────────────────────────────────────── */
.ata-list {
  overflow-y: auto;
  padding: 4px 0 6px;
  display: flex;
  flex-direction: column;
}

.ata-divider {
  height: 1px;
  background: var(--color-border);
  margin: 3px 0;
  opacity: 0.6;
}

.ata-status {
  font-size: 12px;
  color: var(--color-text-muted);
  padding: 10px 16px;
  text-align: center;
}

/* ── Shared row ──────────────────────────────────────────────────────────── */
.ata-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  width: 100%;
  font-family: inherit;
  border-radius: 8px;
  margin: 0 4px;
  width: calc(100% - 8px);
  box-sizing: border-box;
  transition: background 0.1s;
}

.ata-row:hover:not(:disabled) { background: var(--color-hover); }
.ata-row:disabled              { opacity: 0.5; cursor: not-allowed; }

.ata-row-create { cursor: default; }
.ata-row-create:hover { background: var(--color-hover); }

/* ── Thumbnail ───────────────────────────────────────────────────────────── */
.ata-thumb {
  width: 40px;
  height: 40px;
  border-radius: 7px;
  overflow: hidden;
  flex-shrink: 0;
  background: var(--color-surface-raised);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
}

.ata-thumb-new {
  background: color-mix(in srgb, var(--color-accent) 14%, transparent);
  color: var(--color-accent);
}

.ata-thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.ata-thumb-placeholder-icon {
  color: var(--color-text-muted);
}

/* ── Row text ────────────────────────────────────────────────────────────── */
.ata-row-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.ata-row-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ata-row-name-accent { color: var(--color-accent); }

.ata-row-sub {
  font-size: 11px;
  color: var(--color-text-muted);
}

/* ── Inline create input ─────────────────────────────────────────────────── */
.ata-new-input {
  flex: 1;
  padding: 5px 8px;
  font-size: 13px;
  font-family: inherit;
  border: 1px solid var(--color-accent);
  border-radius: 6px;
  background: var(--color-surface-raised);
  color: var(--color-text-primary);
  outline: none;
  min-width: 0;
}

.ata-new-submit {
  padding: 5px 11px;
  border-radius: 6px;
  border: none;
  background: var(--color-accent);
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  flex-shrink: 0;
  transition: opacity 0.12s;
}

.ata-new-submit:disabled { opacity: 0.45; cursor: not-allowed; }

/* ── Transition ──────────────────────────────────────────────────────────── */
.modal-fade-enter-active,
.modal-fade-leave-active { transition: opacity 0.16s ease, transform 0.16s ease; }
.modal-fade-enter-from,
.modal-fade-leave-to     { opacity: 0; transform: scale(0.97); }
</style>
