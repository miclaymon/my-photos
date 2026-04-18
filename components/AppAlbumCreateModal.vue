<script setup lang="ts">
const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  create: [name: string]
}>()

const name    = ref('')
const inputEl = ref<HTMLInputElement | null>(null)

watch(() => props.open, (v) => {
  if (v) {
    name.value = ''
    nextTick(() => inputEl.value?.focus())
  }
})

function submit() {
  const trimmed = name.value.trim()
  if (!trimmed) return
  emit('create', trimmed)
  emit('update:open', false)
}

function close() {
  emit('update:open', false)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="open" class="album-modal-backdrop" @click.self="close">
        <div class="album-modal" role="dialog" aria-modal="true" aria-label="Create album">
          <h2 class="album-modal-title">New Album</h2>

          <input
            ref="inputEl"
            v-model="name"
            class="album-modal-input"
            placeholder="Album name"
            maxlength="120"
            @keydown.enter="submit"
            @keydown.escape="close"
          />

          <div class="album-modal-actions">
            <button class="album-modal-cancel" @click="close">Cancel</button>
            <button class="album-modal-create" :disabled="!name.trim()" @click="submit">Create</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.album-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 500;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.album-modal {
  background: var(--color-surface-overlay);
  border: 1px solid var(--color-border);
  border-radius: 14px;
  padding: 24px;
  width: 100%;
  max-width: 360px;
  box-shadow: 0 24px 64px rgba(0,0,0,0.3);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.album-modal-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.album-modal-input {
  width: 100%;
  padding: 9px 12px;
  font-size: 14px;
  font-family: inherit;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface-raised);
  color: var(--color-text-primary);
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s;
}

.album-modal-input:focus {
  border-color: var(--color-accent);
}

.album-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.album-modal-cancel,
.album-modal-create {
  padding: 8px 18px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  font-family: inherit;
  transition: background 0.12s, opacity 0.12s;
}

.album-modal-cancel {
  background: var(--color-surface-raised);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
}

.album-modal-cancel:hover {
  background: var(--color-hover);
}

.album-modal-create {
  background: var(--color-accent);
  color: #fff;
}

.album-modal-create:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.album-modal-create:not(:disabled):hover {
  opacity: 0.88;
}

/* Transition */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.18s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
</style>
