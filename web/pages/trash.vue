<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: false })

const { activeLibraryId } = useAppShell()
const router = useRouter()

onMounted(() => {
  router.replace(`/library/${activeLibraryId.value}/trash`)
})
</script>

<template>
  <div />
</template>
