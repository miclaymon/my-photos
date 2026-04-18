<script setup lang="ts">
/**
 * Legacy redirect: /preview/:id → /library/:activeLibrary/preview/:id
 *
 * Keeps old bookmarks and in-flight links working by forwarding to the
 * library-scoped preview URL.
 */
definePageMeta({ middleware: 'auth', layout: false })

const route  = useRoute()
const router = useRouter()
const { activeLibraryId } = useAppShell()

const id = computed(() => route.params.id as string)

onMounted(() => {
  router.replace(`/library/${activeLibraryId.value}/preview/${id.value}`)
})
</script>

<template>
  <div />
</template>
