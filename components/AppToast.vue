<script setup lang="ts">
import { CheckCircleIcon, XCircleIcon, InfoIcon, XIcon } from 'lucide-vue-next'
const { toasts, dismiss } = useToast()
</script>

<template>
  <Teleport to="body">
    <div class="toast-stack" aria-live="polite" aria-atomic="false">
      <TransitionGroup name="toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="toast"
          :class="`toast-${toast.type}`"
          role="status"
        >
          <CheckCircleIcon v-if="toast.type === 'success'" :size="15" class="toast-icon" />
          <XCircleIcon     v-else-if="toast.type === 'error'"   :size="15" class="toast-icon" />
          <InfoIcon        v-else                                :size="15" class="toast-icon" />
          <span class="toast-message">{{ toast.message }}</span>
          <button class="toast-close" aria-label="Dismiss" @click="dismiss(toast.id)">
            <XIcon :size="12" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-stack {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 600;
  display: flex;
  flex-direction: column-reverse;
  gap: 8px;
  pointer-events: none;
  align-items: center;
}

.toast {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 500;
  box-shadow: 0 4px 20px rgba(0,0,0,0.22), 0 1px 4px rgba(0,0,0,0.12);
  pointer-events: all;
  white-space: nowrap;
  max-width: 380px;
}

.toast-success {
  background: #18181b;
  color: #f4f4f5;
  border: 1px solid #3f3f46;
}

[data-theme="light"] .toast-success {
  background: #18181b;
  color: #fafafa;
}

.toast-error {
  background: #450a0a;
  color: #fca5a5;
  border: 1px solid #7f1d1d;
}

.toast-info {
  background: #18181b;
  color: #f4f4f5;
  border: 1px solid #3f3f46;
}

.toast-icon {
  flex-shrink: 0;
}

.toast-success .toast-icon { color: #4ade80; }
.toast-error   .toast-icon { color: #f87171; }
.toast-info    .toast-icon { color: #60a5fa; }

.toast-message {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.toast-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: inherit;
  opacity: 0.6;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
  transition: opacity 0.1s;
}

.toast-close:hover { opacity: 1; }

/* Transitions */
.toast-enter-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.toast-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.toast-enter-from   { opacity: 0; transform: translateY(10px) scale(0.96); }
.toast-leave-to     { opacity: 0; transform: translateY(6px) scale(0.97); }
.toast-move         { transition: transform 0.2s ease; }
</style>
