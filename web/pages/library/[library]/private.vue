<script setup lang="ts">
/**
 * /library/:library/private
 *
 * Lock screen → password re-entry → SimpleGallery of private items.
 * Unlock state is kept in sessionStorage so it persists across navigations
 * within the same tab session but clears when the browser is closed.
 */
import { LockIcon, EyeIcon, EyeOffIcon } from 'lucide-vue-next'
import type { MediaItem } from '~/composables/useGalleryData'

definePageMeta({ middleware: 'auth' })

const route     = useRoute()
const libraryId = computed(() => route.params.library as string)

// ── Lock / unlock state ───────────────────────────────────────────────────

const SESSION_KEY = 'private-unlocked'

const unlocked  = ref(false)
const password  = ref('')
const showPwd   = ref(false)
const verifying = ref(false)
const error     = ref<string | null>(null)
const pwdInput  = ref<HTMLInputElement | null>(null)

onMounted(() => {
  if (sessionStorage.getItem(SESSION_KEY) === '1') {
    unlocked.value = true
    loadPrivate()
  } else {
    nextTick(() => pwdInput.value?.focus())
  }
})

async function verify() {
  if (!password.value || verifying.value) return
  verifying.value = true
  error.value     = null
  try {
    await $fetch('/api/v1/auth/verify', {
      method: 'POST',
      body:   { password: password.value },
    })
    sessionStorage.setItem(SESSION_KEY, '1')
    unlocked.value = true
    loadPrivate()
  } catch {
    error.value = 'Incorrect password. Please try again.'
    password.value = ''
    nextTick(() => pwdInput.value?.focus())
  } finally {
    verifying.value = false
  }
}

function lock() {
  sessionStorage.removeItem(SESSION_KEY)
  unlocked.value = false
  password.value = ''
  error.value    = null
  items.value    = []
  nextTick(() => pwdInput.value?.focus())
}

// ── Private items ─────────────────────────────────────────────────────────

interface PrivateItem {
  id:               string
  originalFilename: string
  contentType:      string
  width:            number
  height:           number
  aspectRatio:      number
  isVideo:          boolean
  takenAt:          string
  thumbnailSrc?:    string
  src?:             string
}

const items      = ref<MediaItem[]>([])
const loading    = ref(false)
const fetchError = ref<string | null>(null)

async function loadPrivate() {
  loading.value    = true
  fetchError.value = null
  try {
    const data = await $fetch<{ items: PrivateItem[] }>(
      `/api/v1/library/${libraryId.value}/private`,
    )
    items.value = data.items.map(i => ({
      id:               i.id,
      originalFilename: i.originalFilename,
      aspectRatio:      i.aspectRatio || 1.5,
      width:            i.width  || 0,
      height:           i.height || 0,
      takenAt:          i.takenAt,
      isVideo:          i.isVideo,
      thumbnailSrc:     i.thumbnailSrc,
      src:              i.src,
    }))
  } catch {
    fetchError.value = 'Failed to load private items.'
  } finally {
    loading.value = false
  }
}

watch(libraryId, () => {
  if (unlocked.value) loadPrivate()
})
</script>

<template>
  <!-- ── Lock screen ──────────────────────────────────────────────────────── -->
  <div v-if="!unlocked" class="priv-lock-page">
    <div class="priv-lock-card">
      <div class="priv-lock-icon-wrap">
        <LockIcon :size="24" class="priv-lock-icon" />
      </div>
      <h1 class="priv-lock-title">Private</h1>
      <p class="priv-lock-body">Enter your password to access your private photos and videos.</p>

      <form class="priv-lock-form" @submit.prevent="verify">
        <div class="priv-lock-input-wrap">
          <input
            ref="pwdInput"
            v-model="password"
            class="priv-lock-input"
            :type="showPwd ? 'text' : 'password'"
            placeholder="Password"
            autocomplete="current-password"
            :disabled="verifying"
          />
          <button
            type="button"
            class="priv-lock-eye"
            tabindex="-1"
            @click="showPwd = !showPwd"
          >
            <EyeOffIcon v-if="showPwd" :size="15" />
            <EyeIcon v-else :size="15" />
          </button>
        </div>

        <p v-if="error" class="priv-lock-error">{{ error }}</p>

        <button
          type="submit"
          class="priv-lock-submit"
          :disabled="!password || verifying"
        >
          {{ verifying ? 'Verifying…' : 'Unlock' }}
        </button>
      </form>
    </div>
  </div>

  <!-- ── Gallery ─────────────────────────────────────────────────────────── -->
  <div v-else class="priv-gallery-page">
    <div class="priv-gallery-header">
      <div class="priv-gallery-title-row">
        <LockIcon :size="16" class="priv-gallery-icon" />
        <h1 class="priv-gallery-title">Private</h1>
      </div>
      <p class="priv-gallery-subtitle">
        {{ items.length }} {{ items.length === 1 ? 'item' : 'items' }}
      </p>
      <button class="priv-lock-btn" title="Lock" @click="lock">
        <LockIcon :size="13" />
        Lock
      </button>
    </div>

    <p v-if="fetchError" class="priv-fetch-error">{{ fetchError }}</p>

    <SimpleGallery
      :items="items"
      :loading="loading"
      gallery-id="private"
      forced-mode="grid"
    >
      <template #empty>
        <LockIcon :size="48" class="gallery-empty-icon" />
        <p class="gallery-empty-title">No private items</p>
        <p class="gallery-empty-body">Select items in your gallery and use the lock button to move them here.</p>
      </template>
    </SimpleGallery>
  </div>
</template>

<style scoped>
/* ── Lock screen ──────────────────────────────────────────────────────────── */
.priv-lock-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: 40px 24px;
}

.priv-lock-card {
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: 16px;
  padding: 32px 28px;
  width: 100%;
  max-width: 340px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.2);
}

.priv-lock-icon-wrap {
  width: 52px;
  height: 52px;
  border-radius: 13px;
  background: color-mix(in srgb, var(--color-accent) 14%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 4px;
}

.priv-lock-icon { color: var(--color-accent); }

.priv-lock-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0;
}

.priv-lock-body {
  font-size: 13px;
  color: var(--color-text-muted);
  text-align: center;
  margin: 0;
  line-height: 1.5;
}

.priv-lock-form {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 4px;
}

.priv-lock-input-wrap {
  position: relative;
}

.priv-lock-input {
  width: 100%;
  padding: 9px 36px 9px 12px;
  font-size: 14px;
  font-family: inherit;
  border: 1px solid var(--color-border);
  border-radius: 9px;
  background: var(--color-surface);
  color: var(--color-text-primary);
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s;
}
.priv-lock-input:focus { border-color: var(--color-accent); }
.priv-lock-input:disabled { opacity: 0.6; }

.priv-lock-eye {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  padding: 2px;
}
.priv-lock-eye:hover { color: var(--color-text-primary); }

.priv-lock-error {
  font-size: 12px;
  color: #ef4444;
  margin: 0;
  text-align: center;
}

.priv-lock-submit {
  width: 100%;
  padding: 9px;
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  border: none;
  border-radius: 9px;
  background: var(--color-accent);
  color: #fff;
  cursor: pointer;
  transition: opacity 0.12s;
}
.priv-lock-submit:disabled { opacity: 0.45; cursor: not-allowed; }

/* ── Gallery page ─────────────────────────────────────────────────────────── */
.priv-gallery-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.priv-gallery-header {
  padding: 20px 28px 0;
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
}

.priv-gallery-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.priv-gallery-icon { color: var(--color-text-muted); flex-shrink: 0; }

.priv-gallery-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0;
}

.priv-gallery-subtitle {
  font-size: 13px;
  color: var(--color-text-muted);
  margin: 0;
  width: 100%;
}

.priv-lock-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  font-size: 12px;
  font-family: inherit;
  border: 1px solid var(--color-border);
  border-radius: 7px;
  background: var(--color-surface-raised);
  color: var(--color-text-secondary);
  cursor: pointer;
  margin-left: auto;
  transition: background 0.1s, color 0.1s;
  flex-shrink: 0;
}
.priv-lock-btn:hover {
  background: var(--color-hover);
  color: var(--color-text-primary);
}

.priv-fetch-error {
  font-size: 12px;
  color: #ef4444;
  padding: 8px 28px 0;
  margin: 0;
}
</style>
