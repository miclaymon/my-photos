<script setup lang="ts">
import { onClickOutside } from '@vueuse/core'
import { CheckIcon, ChevronRightIcon, FolderPlusIcon } from 'lucide-vue-next'

const router = useRouter()
const { activeLibraryId, setActiveLibrary }   = useAppShell()
const { libraries, fetchLibraries, createOpen } = useLibraries()

const open   = ref(false)
const rootEl = ref<HTMLElement | null>(null)

const activeLibrary = computed(
  () => libraries.value.find(l => l.id === activeLibraryId.value) ?? libraries.value[0],
)

onClickOutside(rootEl, () => { open.value = false })

// Fetch the live list whenever the dropdown opens
watch(open, (isOpen) => { if (isOpen) fetchLibraries() })

// Also fetch on mount so the active library label is available immediately
onMounted(() => fetchLibraries())

function select(lib: { id: string; name: string }) {
  setActiveLibrary(lib.id)
  open.value = false
  router.push(`/library/${lib.id}`)
}

function openCreate() {
  open.value       = false
  createOpen.value = true
}
</script>

<template>
  <div ref="rootEl" class="library-switcher">
    <button
      class="library-switcher-trigger"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="open = !open"
    >
      <ChevronRightIcon
        :size="13"
        class="library-switcher-chevron"
        :class="{ 'is-open': open }"
      />
      <span class="library-switcher-name">{{ activeLibrary?.name ?? '…' }}</span>
    </button>

    <Transition name="dropdown">
      <div v-if="open" class="library-dropdown" role="listbox">
        <button
          v-for="lib in libraries"
          :key="lib.id"
          class="library-dropdown-item"
          :class="{ 'is-active': lib.id === activeLibraryId }"
          role="option"
          :aria-selected="lib.id === activeLibraryId"
          @click="select(lib)"
        >
          <CheckIcon
            v-if="lib.id === activeLibraryId"
            :size="14"
            class="library-dropdown-item-check"
          />
          <span v-else class="library-dropdown-item-spacer" />
          {{ lib.name }}
        </button>

        <div class="library-dropdown-divider" />

        <button class="library-dropdown-item library-dropdown-action" @click="openCreate">
          <FolderPlusIcon :size="13" class="library-dropdown-item-check" style="opacity: 0.6" />
          Create new library…
        </button>
      </div>
    </Transition>
  </div>
</template>
