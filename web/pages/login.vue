<script setup lang="ts">
definePageMeta({ layout: false })

const { loggedIn, fetch: fetchSession } = useUserSession()
if (loggedIn.value) await navigateTo('/')

const email    = ref('')
const password = ref('')
const error    = ref<string | null>(null)
const loading  = ref(false)

async function submit() {
  error.value = null
  loading.value = true
  try {
    await $fetch('/api/v1/auth/login', {
      method: 'POST',
      body: { email: email.value, password: password.value },
    })
    // Sync the client-side session state before navigating — without this,
    // loggedIn is still false and the auth middleware on '/' redirects back here.
    await fetchSession()
    await navigateTo('/')
  } catch (e: unknown) {
    error.value = (e as { data?: { message?: string } })?.data?.message ?? 'Invalid credentials'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-brand">
        <div class="login-logo" aria-hidden="true">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="var(--color-accent)" />
            <path d="M6 22L12 13l4 5.5 3-4L26 22H6Z" fill="white" opacity="0.9" />
            <circle cx="21" cy="11" r="3" fill="white" opacity="0.7" />
          </svg>
        </div>
        <h1 class="login-title">My Photos</h1>
        <p class="login-subtitle">Sign in to your library</p>
      </div>

      <form class="login-form" @submit.prevent="submit">
        <div class="login-field">
          <label for="email">Email</label>
          <input
            id="email"
            v-model="email"
            type="email"
            required
            autocomplete="email"
            placeholder="you@example.com"
          />
        </div>

        <div class="login-field">
          <label for="password">Password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            required
            autocomplete="current-password"
            placeholder="••••••••"
          />
        </div>

        <p v-if="error" class="login-error" role="alert">{{ error }}</p>

        <button type="submit" class="login-submit" :disabled="loading">
          <span v-if="!loading">Sign in</span>
          <span v-else class="login-spinner" aria-label="Signing in…" />
        </button>
      </form>

      <p class="login-footer">
        Need access? Contact your administrator for an invite link.
      </p>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg);
  padding: 24px;
  font-family: 'Instrument Sans', system-ui, sans-serif;
}

.login-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 16px;
  padding: 40px 36px;
  width: 100%;
  max-width: 380px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.07);
}

.login-brand {
  text-align: center;
  margin-bottom: 32px;
}

.login-logo {
  display: inline-flex;
  margin-bottom: 12px;
}

.login-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0 0 4px;
  letter-spacing: -0.025em;
}

.login-subtitle {
  font-size: 14px;
  color: var(--color-text-muted);
  margin: 0;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.login-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.login-field label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.login-field input {
  height: 40px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.login-field input:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 15%, transparent);
}

.login-error {
  font-size: 13px;
  color: #dc2626;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  padding: 8px 12px;
  margin: 0;
}

.login-submit {
  height: 40px;
  background: var(--color-accent);
  color: #fff;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 4px;
}

.login-submit:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.login-submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.login-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.login-footer {
  text-align: center;
  font-size: 12px;
  color: var(--color-text-muted);
  margin: 20px 0 0;
  line-height: 1.5;
}
</style>
