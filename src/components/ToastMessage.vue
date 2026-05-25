<template>
  <div id="app-toast" role="status" aria-live="polite" v-if="uiStore.toastVisible"
       :class="['glass-panel', uiStore.toastType, 'show']">
    {{ uiStore.toastMessage }}
  </div>
</template>

<script>
import { useUiStore } from '../pinia-stores/ui.js'

export default {
  name: 'ToastMessage',
  setup() {
    const uiStore = useUiStore()

    // Bridge for legacy callers (app.js showToast wrappers)
    window.showToast = function (msg, type, timeoutMs) {
      return uiStore.showToast(msg, type, timeoutMs)
    }
    window.showError = function (code, detail) {
      return uiStore.showError(code, detail)
    }

    return { uiStore }
  }
}
</script>
