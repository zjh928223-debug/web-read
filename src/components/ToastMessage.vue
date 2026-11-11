<template>
  <Teleport to="body">
    <aside id="app-toast" role="status" aria-live="polite" aria-atomic="true" v-if="uiStore.toastVisible"
         :class="['reader-notice', uiStore.toastType, { 'is-fading': uiStore.toastFading, 'is-paused': uiStore.toastPaused }]"
         @mouseenter="uiStore.holdToast('hover')" @mouseleave="uiStore.releaseToast('hover')"
         @focusin="uiStore.holdToast('focus')" @focusout="releaseFocus">
      <div class="reader-notice-content">
        <span class="reader-notice-text">{{ uiStore.toastMessage }}</span>
        <div v-if="uiStore.toastAction" class="reader-notice-actions">
          <Button type="button" variant="default" size="default" data-ui-owner="reader" @click="uiStore.toastAction.run()">{{ uiStore.toastAction.label }}</Button>
        </div>
      </div>
      <button type="button" aria-label="关闭提醒" @click="uiStore.dismissToast()">×</button>
    </aside>
  </Teleport>
</template>

<script>
import { useUiStore } from '../pinia-stores/ui.js'
import { onMounted, onBeforeUnmount } from 'vue'
import { Button } from './ui/button/index.js'

export default {
  name: 'ToastMessage',
  components: { Button },
  setup() {
    const uiStore = useUiStore()
    function releaseFocus(event) {
      if (!event.currentTarget.contains(event.relatedTarget)) uiStore.releaseToast('focus')
    }
    function syncSelection() {
      const selection = window.getSelection()
      const toast = document.getElementById('app-toast')
      if (selection && !selection.isCollapsed && toast
        && (toast.contains(selection.anchorNode) || toast.contains(selection.focusNode))) {
        uiStore.holdToast('selection')
      } else uiStore.releaseToast('selection')
    }
    onMounted(() => document.addEventListener('selectionchange', syncSelection))
    onBeforeUnmount(() => document.removeEventListener('selectionchange', syncSelection))

    // Bridge for legacy callers (app.js showToast wrappers)
    window.showToast = function (msg, type, timeoutMs) {
      return uiStore.showToast(msg, type, timeoutMs)
    }
    window.showError = function (code, detail) {
      return uiStore.showError(code, detail)
    }

    return { uiStore, releaseFocus }
  }
}
</script>
