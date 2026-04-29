<script setup lang="ts">
/**
 * /library/:library/favorites — The current user's favorited items in this library.
 *
 * Favorites are personal: in shared libraries each member has their own independent
 * set of favorites. This view only shows the signed-in user's favorites.
 * Favorited items remain visible in the main gallery; this is just a curated view.
 */
import { HeartIcon, RefreshCwIcon } from 'lucide-vue-next'
import type { MediaItem } from '~/composables/useGalleryData'

definePageMeta({ middleware: 'auth' })

const route     = useRoute()
const libraryId = computed(() => route.params.library as string)

interface FavoriteApiItem {
  id:               string
  originalFilename: string
  contentType:      string
  width:            number
  height:           number
  aspectRatio:      number
  isVideo:          boolean
  takenAt:          string
  src?:             string
  thumbnailSrc?:    string
}

const { data, pending, error, refresh } = await useFetch<{ items: FavoriteApiItem[] }>(
  () => `/api/v1/library/${libraryId.value}/favorites`,
)

const items = computed<MediaItem[]>(() =>
  (data.value?.items ?? [])
    .slice()
    .sort((a, b) => new Date(b.takenAt).getTime() - new Date(a.takenAt).getTime())
    .map(item => ({
      id:               item.id,
      originalFilename: item.originalFilename,
      aspectRatio:      item.aspectRatio || 1.5,
      width:            item.width  || 0,
      height:           item.height || 0,
      takenAt:          item.takenAt,
      isVideo:          item.isVideo,
      src:              item.src,
      thumbnailSrc:     item.thumbnailSrc,
    })),
)
</script>

<template>
  <div class="favorites-page">

    <div class="favorites-page-header">
      <div class="favorites-page-title-row">
        <HeartIcon :size="18" class="favorites-page-icon" />
        <h1 class="favorites-page-title">Favorites</h1>
        <button
          class="favorites-page-refresh"
          :class="{ 'is-spinning': pending }"
          title="Refresh"
          @click="refresh()"
        >
          <RefreshCwIcon :size="14" />
        </button>
      </div>
      <p class="favorites-page-subtitle">Your favorited items in this library. Favorites are personal — only you see yours.</p>
      <p v-if="error" class="favorites-page-error">{{ error.message }}</p>
    </div>

    <SimpleGallery :items="items" :loading="pending && !data?.items.length" gallery-id="favorites">
      <template #empty>
        <HeartIcon :size="48" class="gallery-empty-icon" />
        <p class="gallery-empty-title">{{ pending ? 'Loading…' : 'No favorites yet' }}</p>
        <p class="gallery-empty-body">Tap the heart on any photo or video to add it here.</p>
      </template>
    </SimpleGallery>

  </div>
</template>

<style scoped>
.favorites-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.favorites-page-header {
  padding: 24px 28px 0;
  flex-shrink: 0;
}

.favorites-page-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}

.favorites-page-icon { color: #e11d48; flex-shrink: 0; }

.favorites-page-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0;
  flex: 1;
}

.favorites-page-refresh {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 7px;
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: background 0.12s;
}
.favorites-page-refresh:hover { background: var(--color-hover); }
.favorites-page-refresh.is-spinning svg { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.favorites-page-subtitle {
  font-size: 13px;
  color: var(--color-text-muted);
  margin: 0 0 4px;
}

.favorites-page-error {
  font-size: 12px;
  color: #ef4444;
  margin: 4px 0 0;
}
</style>
