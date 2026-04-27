<script setup lang="ts">
import { MenuIcon, SearchIcon, SettingsIcon, UserCircleIcon, TerminalIcon, BellIcon, LogOutIcon } from 'lucide-vue-next'
import { onClickOutside } from '@vueuse/core'

const { toggleSideNav, openSettings } = useAppShell()
const searchQuery = ref('')
const isDev = import.meta.dev

const notifOpen    = ref(false)
const notifPanelEl = ref<HTMLElement | null>(null)
onClickOutside(notifPanelEl, () => { notifOpen.value = false })

const accountOpen    = ref(false)
const accountBtnEl   = ref<HTMLElement | null>(null)
const accountPanelEl = ref<HTMLElement | null>(null)
onClickOutside(accountPanelEl, (e) => {
  if (accountBtnEl.value?.contains(e.target as Node)) return
  accountOpen.value = false
})

const { user, clear: clearSession } = useUserSession()
const accountEmail = computed(() => (user.value as { email?: string } | null)?.email ?? '')

async function logout() {
  accountOpen.value = false
  await $fetch('/api/v1/auth/logout', { method: 'POST' }).catch(() => {})
  await clearSession()
  await navigateTo('/login')
}
</script>

<template>
  <header class="app-header">
    <!-- Left: hamburger + brand + library switcher -->
    <div class="app-header-left">
      <button class="app-header-btn" aria-label="Toggle navigation" @click="toggleSideNav">
        <MenuIcon :size="20" />
      </button>

      <div class="app-header-brand">
        <span class="app-header-title">My Photos</span>
        <ClientOnly>
          <LibrarySwitcher />
          <template #fallback>
            <div class="library-switcher-skeleton skeleton" />
          </template>
        </ClientOnly>
      </div>
    </div>

    <!-- Centre: search -->
    <div class="app-header-center">
      <label class="app-search" aria-label="Search photos">
        <SearchIcon :size="16" class="app-search-icon" />
        <input
          v-model="searchQuery"
          type="search"
          placeholder="Search photos..."
          autocomplete="off"
        />
      </label>
    </div>

    <!-- Right: dev admin (dev only) + notifications + settings + account -->
    <div class="app-header-right">
      <NuxtLink
        v-if="isDev"
        to="/admin/dev"
        class="app-header-btn app-header-btn-dev"
        aria-label="Dev admin"
        title="Developer overview"
      >
        <TerminalIcon :size="17" />
      </NuxtLink>
      <button class="app-header-btn" aria-label="Notifications" @click="notifOpen = !notifOpen">
        <BellIcon :size="19" />
      </button>
      <button class="app-header-btn" aria-label="Settings" @click="openSettings">
        <SettingsIcon :size="20" />
      </button>
      <button
        ref="accountBtnEl"
        class="app-header-btn"
        aria-label="Account"
        @click="accountOpen = !accountOpen"
      >
        <UserCircleIcon :size="22" />
      </button>
    </div>
  </header>

  <Teleport to="body">
    <Transition name="notif-fade">
      <div v-if="notifOpen" ref="notifPanelEl" class="notif-panel">
        <div class="notif-panel-header">
          <span class="notif-panel-title">Notifications</span>
          <button class="notif-close-btn" @click="notifOpen = false">×</button>
        </div>
        <div class="notif-empty">No new notifications</div>
      </div>
    </Transition>

    <Transition name="notif-fade">
      <div v-if="accountOpen" ref="accountPanelEl" class="account-panel">
        <div class="account-panel-user">
          <UserCircleIcon :size="28" class="account-panel-avatar" />
          <span class="account-panel-email">{{ accountEmail }}</span>
        </div>
        <div class="account-panel-divider" />
        <button class="account-panel-action" @click="logout">
          <LogOutIcon :size="14" />
          Sign out
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.library-switcher-skeleton {
  width: 72px;
  height: 24px;
  border-radius: 6px;
}

.notif-panel {
  position: fixed;
  top: 52px;
  right: 12px;
  z-index: 300;
  width: 300px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.18);
  overflow: hidden;
}
.notif-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
}
.notif-panel-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
}
.notif-close-btn {
  background: none;
  border: none;
  font-size: 18px;
  color: var(--color-text-muted);
  cursor: pointer;
  line-height: 1;
  padding: 0 2px;
}
.notif-empty {
  padding: 24px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--color-text-muted);
}
.notif-fade-enter-active, .notif-fade-leave-active { transition: opacity 0.15s, transform 0.15s; }
.notif-fade-enter-from, .notif-fade-leave-to { opacity: 0; transform: translateY(-6px); }

.account-panel {
  position: fixed;
  top: 52px;
  right: 12px;
  z-index: 300;
  width: 220px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.18);
  overflow: hidden;
}

.account-panel-user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
}

.account-panel-avatar {
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.account-panel-email {
  font-size: 13px;
  color: var(--color-text-primary);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-panel-divider {
  height: 1px;
  background: var(--color-border);
}

.account-panel-action {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 11px 16px;
  background: none;
  border: none;
  font-family: inherit;
  font-size: 13px;
  color: var(--color-text-primary);
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
}

.account-panel-action:hover {
  background: var(--color-surface-raised, var(--color-surface));
}
</style>
