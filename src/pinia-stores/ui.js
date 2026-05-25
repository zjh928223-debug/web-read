import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('ui', () => {
  const toastVisible = ref(false)
  const toastMessage = ref('')
  const toastType = ref('success')
  let toastTimer = null

  function showToast(message, type, timeoutMs) {
    if (type === undefined) type = 'info'
    if (timeoutMs === undefined) timeoutMs = 2600
    toastMessage.value = message
    toastType.value = type
    toastVisible.value = true
    if (toastTimer) clearTimeout(toastTimer)
    if (timeoutMs > 0) {
      toastTimer = setTimeout(function () { toastVisible.value = false }, timeoutMs)
    }
  }

  function showError(code, detail) {
    var suffix = detail ? '\n' + detail : ''
    showToast('Error [' + code + ']' + suffix, 'error', 3800)
  }

  return { toastVisible, toastMessage, toastType, showToast, showError }
})
