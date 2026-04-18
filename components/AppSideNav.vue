<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import {
  ImagesIcon,
  BookMarkedIcon,
  HeartIcon,
  ArchiveIcon,
  Trash2Icon,
  SmileIcon as PeopleIcon,
  MapPinIcon,
  TagIcon,
} from 'lucide-vue-next'

const { sideNavOpen, closeSideNav, activeLibraryId } = useAppShell()
const isMobile = useMediaQuery('(max-width: 767px)')
const route    = useRoute()

// All nav items are library-scoped. `href` is null for items not yet implemented.
const navItems = computed(() => {
  const lib  = activeLibraryId.value
  const base = lib ? `/library/${lib}` : null

  return [
    { label: 'Photos & Videos', href: base,                              icon: ImagesIcon,     disabled: false },
    { label: 'Favorites',       href: base ? `${base}/favorites` : null, icon: HeartIcon,      disabled: false },
    { label: 'Albums',          href: base ? `${base}/albums` : null,    icon: BookMarkedIcon, disabled: false },
    { label: 'People & Pets',   href: base ? `${base}/people-and-pets` : null, icon: PeopleIcon, disabled: false },
    { label: 'Places',          href: base ? `${base}/places` : null,          icon: MapPinIcon, disabled: false },
    { label: 'Tags',            href: base ? `${base}/tags` : null,          icon: TagIcon,    disabled: false },
    { label: 'Archive',         href: base ? `${base}/archive` : null,  icon: ArchiveIcon,    disabled: false },
    { label: 'Trash',           href: base ? `${base}/trash` : null,    icon: Trash2Icon,     disabled: false },
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
          <NuxtLink
            v-if="item.href && !item.disabled"
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
</template>
