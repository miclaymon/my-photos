<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'

const { theme } = useAppShell()
const prefersDark    = useMediaQuery('(prefers-color-scheme: dark)')
const effectiveTheme = computed(() => {
  if (theme.value === 'system') return prefersDark.value ? 'dark' : 'light'
  return theme.value
})

// Apply to <html> so CSS variables cascade to Teleport-to-body elements
// (modals, selection pill, toasts, floating toggles, etc.)
useHead(computed(() => ({
  htmlAttrs: { 'data-theme': effectiveTheme.value },
})))
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
