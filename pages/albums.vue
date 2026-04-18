<script setup lang="ts">
// Redirect /albums → /library/<activeLibraryId>/albums
definePageMeta({ middleware: 'auth' })

const { activeLibraryId } = useAppShell()
const { libraries, fetchLibraries } = useLibraries()

onMounted(async () => {
  await fetchLibraries()
  const target = activeLibraryId.value
    ?? libraries.value[0]?.id
  if (target) navigateTo(`/library/${target}/albums`, { replace: true })
})
</script>

<template>
  <!-- Blank while redirect resolves -->
  <div />
</template>
