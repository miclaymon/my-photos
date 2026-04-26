<script setup lang="ts">
// Legacy redirect: /photos/:id → /library/:id
const route = useRoute()
await navigateTo(`/library/${route.params.library}`, { replace: true, redirectCode: 301 })
</script>
<template><div /></template>
