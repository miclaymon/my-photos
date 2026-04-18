/**
 * Manages the list of libraries accessible to the current user.
 * Module-level singleton so the list is shared across LibrarySwitcher,
 * the create modal, and the copy modal.
 */

export interface LibraryItem {
  id:        string
  name:      string
  type:      'personal' | 'shared'
  ownerId?:  number | null
  createdAt: Date | null
}

const libraries    = ref<LibraryItem[]>([])
const isLoading    = ref(false)
const createOpen   = ref(false)   // create-library modal open

export function useLibraries() {
  async function fetchLibraries() {
    if (isLoading.value) return
    isLoading.value = true
    try {
      const data = await $fetch<{ libraries: LibraryItem[] }>('/api/v1/library')
      libraries.value = data.libraries
    } catch {
      // Keep whatever we had
    } finally {
      isLoading.value = false
    }
  }

  async function createLibrary(name: string, type: 'personal' | 'shared'): Promise<LibraryItem> {
    const created = await $fetch<{ id: string; name: string; type: string }>('/api/v1/library', {
      method: 'POST',
      body: { name, type },
    })
    const lib: LibraryItem = { id: created.id, name: created.name, type: created.type as 'personal' | 'shared', ownerId: null, createdAt: new Date() }
    libraries.value = [...libraries.value, lib]
    return lib
  }

  return {
    libraries:      readonly(libraries),
    isLoading:      readonly(isLoading),
    createOpen,
    fetchLibraries,
    createLibrary,
  }
}
