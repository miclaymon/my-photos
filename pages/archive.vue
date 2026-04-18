<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: false })

const { activeLibraryId } = useAppShell()
const router = useRouter()

onMounted(() => {
  router.replace(`/library/${activeLibraryId.value}/archive`)
})
</script>

<template>
  <div />
</template>
