<script setup lang="ts">
import { useMediaQuery, onClickOutside, useEventListener } from '@vueuse/core'
import {
  ImagesIcon,
  BookMarkedIcon,
  HeartIcon,
  ArchiveIcon,
  Trash2Icon,
  SmileIcon as PeopleIcon,
  MapPinIcon,
  TagIcon,
  LockIcon,
  ChevronRightIcon,
} from 'lucide-vue-next'

const { sideNavOpen, closeSideNav, activeLibraryId } = useAppShell()
const isMobile = useMediaQuery('(max-width: 767px)')
const route    = useRoute()

// All nav items are library-scoped. `href` is null for items not yet implemented.
const navItems = computed(() => {
  const lib  = activeLibraryId.value
  const base = lib ? `/library/${lib}` : null

  return [
    { label: 'Photos & Videos', href: base,                                    icon: ImagesIcon,     disabled: false, hasSubmenu: false },
    { label: 'Favorites',       href: base ? `${base}/favorites` : null,       icon: HeartIcon,      disabled: false, hasSubmenu: false },
    { label: 'Albums',          href: base ? `${base}/albums` : null,          icon: BookMarkedIcon, disabled: false, hasSubmenu: true  },
    { label: 'People & Pets',   href: base ? `${base}/people-and-pets` : null, icon: PeopleIcon,     disabled: false, hasSubmenu: false },
    { label: 'Places',          href: base ? `${base}/places` : null,          icon: MapPinIcon,     disabled: false, hasSubmenu: false },
    { label: 'Tags',            href: base ? `${base}/tags` : null,            icon: TagIcon,        disabled: false, hasSubmenu: false },
    { label: 'Private',         href: base ? `${base}/private` : null,         icon: LockIcon,       disabled: true,  hasSubmenu: false },
    { label: 'Archive',         href: base ? `${base}/archive` : null,         icon: ArchiveIcon,    disabled: false, hasSubmenu: false },
    { label: 'Trash',           href: base ? `${base}/trash` : null,           icon: Trash2Icon,     disabled: false, hasSubmenu: false },
  ]
})

function isActive(href: string | null): boolean {
  if (!href) return false
  const path = route.path
  const lib  = activeLibraryId.value

  // Photos & Videos: exact library base, or preview pages under it
  if (lib && href === `/library/${lib}`) {
    return path === href || path.startsWith(`${href}/preview/`)
  }
  // Albums: also match individual album detail pages (/library/:id/album/:albumId)
  if (href.endsWith('/albums')) {
    return path.startsWith(href) || path.includes('/album/')
  }
  return path.startsWith(href)
}

// ── Albums submenu ─────────────────────────────────────────────────────────────
interface AlbumEntry { id: string; name: string }

const albumMenuOpen  = ref(false)
const albumMenuPos   = ref({ top: 0, left: 0 })
const albumCaretRef  = ref<HTMLElement | null>(null)
const albumMenuRef   = ref<HTMLElement | null>(null)
const recentAlbums   = ref<AlbumEntry[]>([])
const albumsLoaded   = ref(false)

onClickOutside(albumMenuRef, (e) => {
  if (albumCaretRef.value?.contains(e.target as Node)) return
  albumMenuOpen.value = false
})

useEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') albumMenuOpen.value = false
})

// Reset cached album list when the active library changes
watch(activeLibraryId, () => {
  albumsLoaded.value  = false
  albumMenuOpen.value = false
})

async function toggleAlbumMenu(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()

  if (albumMenuOpen.value) {
    albumMenuOpen.value = false
    return
  }

  // Position relative to the caret button
  if (albumCaretRef.value) {
    const rect = albumCaretRef.value.getBoundingClientRect()
    albumMenuPos.value = { top: rect.top, left: rect.right + 6 }
  }

  // Lazy-fetch the album list on first open
  if (!albumsLoaded.value && activeLibraryId.value) {
    try {
      const data = await $fetch<{ albums: Array<Record<string, unknown>> }>(
        `/api/v1/library/${activeLibraryId.value}/albums`
      )
      recentAlbums.value = [...data.albums]
        .sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
        .slice(0, 5)
        .map(a => ({ id: a.id as string, name: a.name as string }))
      albumsLoaded.value = true
    } catch {
      recentAlbums.value = []
    }
  }

  albumMenuOpen.value = true
}

function selectAlbum(albumId: string) {
  albumMenuOpen.value = false
  navigateTo(`/library/${activeLibraryId.value}/albums/${albumId}`)
  if (isMobile.value) closeSideNav()
}
</script>

<template>
  <!-- Mobile backdrop -->
  <Transition name="dropdown">
    <div
      v-if="isMobile && sideNavOpen"
      class="sidenav-backdrop is-visible"
      aria-hidden="true"
      @click="closeSideNav"
    />
  </Transition>

  <nav
    class="app-sidenav"
    :class="{ 'is-collapsed': !sideNavOpen }"
    aria-label="Main navigation"
  >
    <div class="sidenav-scroll">
      <ul role="list" style="list-style:none;margin:0;padding:0;">
        <li v-for="item in navItems" :key="item.label">

          <!-- Split item: main NuxtLink + submenu caret button -->
          <div
            v-if="item.href && !item.disabled && item.hasSubmenu"
            class="sidenav-item-wrap"
            :class="{ 'is-active': isActive(item.href) }"
          >
            <NuxtLink
              :to="item.href"
              class="sidenav-item-link"
              :aria-current="isActive(item.href) ? 'page' : undefined"
              @click="isMobile && closeSideNav()"
            >
              <component :is="item.icon" :size="20" class="sidenav-item-icon" />
              <span class="sidenav-item-label">{{ item.label }}</span>
            </NuxtLink>
            <button
              v-show="sideNavOpen"
              ref="albumCaretRef"
              class="sidenav-item-caret"
              :class="{ 'is-open': albumMenuOpen }"
              :aria-label="`Recent ${item.label}`"
              @click.prevent.stop="toggleAlbumMenu"
            >
              <ChevronRightIcon :size="13" />
            </button>
          </div>

          <!-- Standard navigable item -->
          <NuxtLink
            v-else-if="item.href && !item.disabled"
            :to="item.href"
            class="sidenav-item"
            :class="{ 'is-active': isActive(item.href) }"
            :aria-current="isActive(item.href) ? 'page' : undefined"
            @click="isMobile && closeSideNav()"
          >
            <component :is="item.icon" :size="20" class="sidenav-item-icon" />
            <span class="sidenav-item-label">{{ item.label }}</span>
          </NuxtLink>

          <!-- Disabled / not-yet-implemented items -->
          <span
            v-else
            class="sidenav-item is-disabled"
            :aria-disabled="true"
          >
            <component :is="item.icon" :size="20" class="sidenav-item-icon" />
            <span class="sidenav-item-label">{{ item.label }}</span>
          </span>

        </li>
      </ul>
    </div>
  </nav>

  <!-- Albums submenu flyout -->
  <Teleport to="body">
    <Transition name="dropdown">
      <div
        v-if="albumMenuOpen"
        ref="albumMenuRef"
        class="sidenav-submenu"
        :style="{ top: albumMenuPos.top + 'px', left: albumMenuPos.left + 'px' }"
      >
        <p v-if="!recentAlbums.length" class="sidenav-submenu-empty">No albums yet</p>
        <button
          v-for="album in recentAlbums"
          :key="album.id"
          class="sidenav-submenu-item"
          @click="selectAlbum(album.id)"
        >
          {{ album.name }}
        </button>
        <div v-if="recentAlbums.length" class="sidenav-submenu-divider" />
        <NuxtLink
          :to="`/library/${activeLibraryId}/albums`"
          class="sidenav-submenu-item sidenav-submenu-all"
          @click="albumMenuOpen = false"
        >
          View all albums →
        </NuxtLink>
      </div>
    </Transition>
  </Teleport>
</template>
