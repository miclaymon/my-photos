<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const { activeLibraryId } = useAppShell()
await navigateTo(`/library/${activeLibraryId.value}`, { replace: true })
</script>

<template>
  <!-- Redirects immediately to the last active library gallery -->
  <div />
</template>
