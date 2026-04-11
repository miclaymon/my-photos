<script setup lang="ts">
definePageMeta({
  middleware: 'auth',
})

const { user } = useUserSession()
</script>

<template>
  <div class="p-8">
    <h1 class="text-2xl font-bold text-gray-900 mb-2">
      Welcome back{{ user?.email ? `, ${user.email}` : '' }}
    </h1>
    <p class="text-gray-500">Your photo library is empty. Upload some photos to get started.</p>
  </div>
</template>
