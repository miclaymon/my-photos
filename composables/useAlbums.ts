/**
 * useAlbums — manages the album list for a given library.
 *
 * Keeps the list reactive so AlbumCard grids re-render when albums are added
 * or removed. Each call returns a fresh instance (not a module-level singleton)
 * since different pages may manage different libraries simultaneously.
 */

export interface AlbumSummary {
  id:        string
  name:      string
  libraryId: string
  ownerId:   number
  itemCount: number
  canEdit:   boolean
  coverUrls: string[]
  createdAt: string
  updatedAt: string
}

export function useAlbums(libraryId: MaybeRefOrGetter<string | null>) {
  const albums    = ref<AlbumSummary[]>([])
  const isLoading = ref(false)
  const error     = ref<string | null>(null)

  async function fetchAlbums() {
    const id = toValue(libraryId)
    if (!id) return
    isLoading.value = true
    error.value     = null
    try {
      const data = await $fetch<{ albums: AlbumSummary[] }>(`/api/v1/library/${id}/albums`)
      albums.value = data.albums
    } catch {
      error.value = 'Could not load albums.'
    } finally {
      isLoading.value = false
    }
  }

  async function createAlbum(name: string): Promise<AlbumSummary | null> {
    const id = toValue(libraryId)
    if (!id) return null
    try {
      const data = await $fetch<AlbumSummary>(`/api/v1/library/${id}/albums`, {
        method: 'POST',
        body:   { name },
      })
      await fetchAlbums()
      return data
    } catch {
      return null
    }
  }

  async function deleteAlbum(albumId: string) {
    await $fetch(`/api/v1/albums/${albumId}`, { method: 'DELETE' }).catch(() => {})
    albums.value = albums.value.filter(a => a.id !== albumId)
  }

  async function renameAlbum(albumId: string, name: string) {
    await $fetch(`/api/v1/albums/${albumId}`, { method: 'PATCH', body: { name } }).catch(() => {})
    const idx = albums.value.findIndex(a => a.id === albumId)
    if (idx >= 0) albums.value[idx] = { ...albums.value[idx]!, name }
  }

  // Reload when libraryId changes
  watch(() => toValue(libraryId), fetchAlbums, { immediate: true })

  return {
    albums,
    isLoading:   readonly(isLoading),
    error:       readonly(error),
    fetchAlbums,
    createAlbum,
    deleteAlbum,
    renameAlbum,
  }
}

// ── Global albums (across all libraries) ─────────────────────────────────────

export function useAllAlbums() {
  const albums    = ref<AlbumSummary[]>([])
  const isLoading = ref(false)
  const error     = ref<string | null>(null)

  async function fetchAlbums() {
    isLoading.value = true
    error.value     = null
    try {
      const data   = await $fetch<{ albums: AlbumSummary[] }>('/api/v1/albums')
      albums.value = data.albums
    } catch {
      error.value = 'Could not load albums.'
    } finally {
      isLoading.value = false
    }
  }

  onMounted(fetchAlbums)

  return {
    albums,
    isLoading:   readonly(isLoading),
    error:       readonly(error),
    fetchAlbums,
  }
}
