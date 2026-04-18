import { useLocalStorage } from '@vueuse/core'

export type AppTheme = 'light' | 'dark' | 'black' | 'system'

// Module-level singletons
const sideNavOpen     = ref(true)
const settingsOpen    = ref(false)
const theme           = useLocalStorage<AppTheme>('app-theme', 'light')
const activeLibraryId = useLocalStorage<string>('active-library', 'personal')

export function useAppShell() {
  function toggleSideNav() { sideNavOpen.value = !sideNavOpen.value }
  function closeSideNav()  { sideNavOpen.value = false }
  function openSideNav()   { sideNavOpen.value = true  }

  function openSettings()  { settingsOpen.value = true  }
  function closeSettings() { settingsOpen.value = false }

  function setTheme(t: AppTheme) { theme.value = t }

  return {
    sideNavOpen:     readonly(sideNavOpen),
    settingsOpen:    readonly(settingsOpen),
    theme:           readonly(theme),
    activeLibraryId: readonly(activeLibraryId),
    toggleSideNav,
    closeSideNav,
    openSideNav,
    openSettings,
    closeSettings,
    setTheme,
    setActiveLibrary: (id: string) => { activeLibraryId.value = id },
  }
}
