import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('ui', () => {
  const toastVisible = ref(false)
  const toastMessage = ref('')
  const toastType = ref('success')
  const toastFading = ref(false)
  const toastPaused = ref(false)
  const toastAction = ref(null)
  const toastSource = ref('')
  let toastTimer = null
  let fadeTimer = null
  let toastDuration = 6000
  const toastHolds = new Set()
  const lastNotices = new Map()

  function clearToastTimers() {
    if (toastTimer) clearTimeout(toastTimer)
    if (fadeTimer) clearTimeout(fadeTimer)
    toastTimer = fadeTimer = null
  }

  function scheduleToast() {
    clearToastTimers()
    if (!toastVisible.value || toastHolds.size) return
    toastTimer = setTimeout(() => {
      toastTimer = null
      toastFading.value = true
      fadeTimer = setTimeout(dismissToast, 700)
    }, toastDuration)
  }

  function holdToast(reason = 'hover') {
    if (!toastVisible.value) return
    toastHolds.add(reason)
    toastPaused.value = true
    clearToastTimers()
    toastFading.value = false
  }

  function releaseToast(reason = 'hover') {
    if (!toastHolds.delete(reason)) return
    toastPaused.value = toastHolds.size > 0
    if (!toastPaused.value) scheduleToast()
  }

  function showToast(message, type, timeoutMs, options = {}) {
    if (type === undefined) type = 'info'
    if (!toastVisible.value) toastHolds.clear()
    toastDuration = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? Math.max(6000, Math.min(timeoutMs, 30000)) : type === 'error' ? 8000 : 6000
    clearToastTimers()
    toastMessage.value = message
    toastType.value = type
    toastSource.value = options.source || ''
    toastAction.value = typeof options.action?.run === 'function' ? options.action : null
    toastFading.value = false
    toastPaused.value = toastHolds.size > 0
    toastVisible.value = true
    scheduleToast()
  }

  function showNotice(key, message, type = 'info') {
    if (!message || lastNotices.get(key) === message) return
    lastNotices.delete(key)
    lastNotices.set(key, message)
    if (lastNotices.size > 100) lastNotices.delete(lastNotices.keys().next().value)
    showToast(message, type)
  }

  function dismissToast() {
    clearToastTimers()
    toastHolds.clear()
    toastPaused.value = false
    toastFading.value = false
    toastVisible.value = false
    toastAction.value = null
    toastSource.value = ''
  }

  function showError(code, detail) {
    var suffix = detail ? '\n' + detail : ''
    showToast('Error [' + code + ']' + suffix, 'error', 8000)
  }

  return { toastVisible, toastMessage, toastType, toastFading, toastPaused, toastAction, toastSource,
    showToast, showError, showNotice, dismissToast, holdToast, releaseToast }
})
