/**
 * Lightweight module-level toast system.
 * Usage: const { showToast } = useToast()
 *        showToast('Added to album', 'success')
 */

export type ToastType = 'success' | 'error' | 'info'

interface Toast {
  id:      number
  message: string
  type:    ToastType
}

const toasts  = ref<Toast[]>([])
let   nextId  = 0

export function useToast() {
  function showToast(message: string, type: ToastType = 'success', duration = 3000) {
    const id = ++nextId
    toasts.value = [...toasts.value, { id, message, type }]
    setTimeout(() => {
      toasts.value = toasts.value.filter(t => t.id !== id)
    }, duration)
  }

  function dismiss(id: number) {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }

  return {
    toasts:    readonly(toasts),
    showToast,
    dismiss,
  }
}
