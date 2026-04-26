<script setup lang="ts">
import { XIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-vue-next'
const { allItems } = useGalleryData()
const { previewId, closePreview, openPreview } = useGallery()

const currentIndex = computed(() =>
  previewId.value ? allItems.value.findIndex(i => i.id === previewId.value) : -1,
)
const currentItem = computed(() =>
  currentIndex.value >= 0 ? allItems.value[currentIndex.value] : null,
)
const prevItem = computed(() =>
  currentIndex.value > 0 ? allItems.value[currentIndex.value - 1] : null,
)
const nextItem = computed(() =>
  currentIndex.value >= 0 && currentIndex.value < allItems.value.length - 1
    ? allItems.value[currentIndex.value + 1]
    : null,
)

const lightboxSrc = computed(() => currentItem.value?.src ?? '')

function goPrev() { if (prevItem.value) openPreview(prevItem.value.id) }
function goNext() { if (nextItem.value) openPreview(nextItem.value.id) }

// Keyboard navigation
function onKey(e: KeyboardEvent) {
  if (!previewId.value) return
  if (e.key === 'ArrowLeft')  { e.preventDefault(); goPrev() }
  if (e.key === 'ArrowRight') { e.preventDefault(); goNext() }
}

onMounted(()   => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition name="lightbox-fade">
      <div
        v-if="previewId && currentItem"
        class="lightbox"
        aria-modal="true"
        role="dialog"
        :aria-label="currentItem.originalFilename"
        @click.self="closePreview"
      >
        <!-- Close -->
        <button class="lightbox-close" aria-label="Close preview" @click="closePreview">
          <XIcon :size="22" />
        </button>

        <!-- Previous -->
        <button
          v-if="prevItem"
          class="lightbox-nav lightbox-nav-prev"
          aria-label="Previous photo"
          @click="goPrev"
        >
          <ChevronLeftIcon :size="28" />
        </button>

        <!-- Image -->
        <div class="lightbox-content" @click.self="closePreview">
          <img
            :key="currentItem.id"
            :src="lightboxSrc"
            :alt="currentItem.originalFilename"
            class="lightbox-img"
            style="view-transition-name: photo-preview"
            draggable="false"
          />
        </div>

        <!-- Next -->
        <button
          v-if="nextItem"
          class="lightbox-nav lightbox-nav-next"
          aria-label="Next photo"
          @click="goNext"
        >
          <ChevronRightIcon :size="28" />
        </button>

        <!-- Caption -->
        <div class="lightbox-caption">
          <span class="lightbox-filename">{{ currentItem.originalFilename }}</span>
          <span class="lightbox-counter">{{ currentIndex + 1 }} / {{ allItems.length }}</span>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
