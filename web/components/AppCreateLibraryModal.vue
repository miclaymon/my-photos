<script setup lang="ts">
import { FolderPlusIcon, XIcon } from 'lucide-vue-next'
import { onClickOutside } from '@vueuse/core'

const { createOpen, createLibrary } = useLibraries()
const { setActiveLibrary }          = useAppShell()
const router = useRouter()

const name   = ref('')
const type   = ref<'personal' | 'shared'>('shared')
const saving = ref(false)
const error  = ref('')
const panelEl = ref<HTMLElement | null>(null)

onClickOutside(panelEl, () => { createOpen.value = false })

watch(createOpen, (open) => {
  if (open) {
    name.value  = ''
    type.value  = 'shared'
    error.value = ''
    nextTick(() => {
      panelEl.value?.querySelector<HTMLInputElement>('input')?.focus()
    })
  }
})

async function submit() {
  if (!name.value.trim()) { error.value = 'Name is required'; return }
  saving.value = true
  error.value  = ''
  try {
    const lib = await createLibrary(name.value.trim(), type.value)
    createOpen.value = false
    setActiveLibrary(lib.id)
    router.push(`/library/${lib.id}`)
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Failed to create library'
  } finally {
    saving.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') createOpen.value = false
  if (e.key === 'Enter' && !saving.value) submit()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="createOpen" class="modal-backdrop" @keydown="onKeydown">
        <div ref="panelEl" class="modal-panel create-library-panel" role="dialog" aria-modal="true" aria-label="Create new library">
          <div class="modal-header">
            <FolderPlusIcon :size="18" class="modal-header-icon" />
            <h2 class="modal-title">New library</h2>
            <button class="modal-close-btn" aria-label="Close" @click="createOpen = false">
              <XIcon :size="16" />
            </button>
          </div>

          <div class="modal-body">
            <label class="form-label" for="lib-name">Name</label>
            <input
              id="lib-name"
              v-model="name"
              class="form-input"
              type="text"
              placeholder="e.g. Summer 2026"
              maxlength="80"
              autocomplete="off"
            />

            <div class="form-radio-group">
              <label class="form-radio-label">
                <input v-model="type" type="radio" value="shared" />
                <span>Shared</span>
                <span class="form-radio-hint">Visible to all members</span>
              </label>
              <label class="form-radio-label">
                <input v-model="type" type="radio" value="personal" />
                <span>Personal</span>
                <span class="form-radio-hint">Only you can see this</span>
              </label>
            </div>

            <p v-if="error" class="form-error">{{ error }}</p>
          </div>

          <div class="modal-footer">
            <button class="btn btn-ghost" :disabled="saving" @click="createOpen = false">
              Cancel
            </button>
            <button class="btn btn-primary" :disabled="saving || !name.trim()" @click="submit">
              {{ saving ? 'Creating…' : 'Create library' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.create-library-panel {
  width: 400px;
}

.form-label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary);
  margin-bottom: 6px;
}

.form-input {
  width: 100%;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1.5px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-primary);
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s;
  box-sizing: border-box;
}

.form-input:focus {
  border-color: var(--color-accent);
}

.form-radio-group {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-radio-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 14px;
  color: var(--color-text-primary);
}

.form-radio-hint {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-left: 2px;
}

.form-error {
  margin-top: 10px;
  font-size: 13px;
  color: var(--color-error, #ef4444);
}
</style>
