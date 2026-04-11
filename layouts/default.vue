<script setup lang="ts">
const { user, clear } = useUserSession()

async function logout() {
  await clear()
  await navigateTo('/login')
}
</script>

<template>
  <div class="min-h-screen bg-gray-50 flex flex-col">
    <header v-if="user" class="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
      <NuxtLink to="/" class="text-lg font-semibold text-gray-900">
        My Photos
      </NuxtLink>
      <nav class="flex items-center gap-4">
        <span class="text-sm text-gray-500">{{ user.email }}</span>
        <button
          class="text-sm text-gray-600 hover:text-gray-900 transition-colors"
          @click="logout"
        >
          Sign out
        </button>
      </nav>
    </header>

    <main class="flex-1">
      <slot />
    </main>
  </div>
</template>
