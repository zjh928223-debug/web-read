<template>
  <div id="app-toast" role="status" aria-live="polite" v-if="toastVisible"
       :class="'glass-panel ' + toastType + ' show'">
    {{ toastText }}
  </div>
</template>

<script>
import { ref } from 'vue'

export default {
  name: 'ToastMessage',
  setup() {
    const toastVisible = ref(false)
    const toastText = ref('')
    const toastType = ref('success')
    let timer = null

    function showToastFn(msgText, msgType) {
      if (msgType === undefined) msgType = 'success'
      toastText.value = msgText
      toastType.value = msgType
      toastVisible.value = true
      if (timer) clearTimeout(timer)
      timer = setTimeout(function () { toastVisible.value = false }, 2600)
    }

    window.showToast = showToastFn
    window.showError = function (code, detail) {
      showToastFn('Error [' + code + ']' + (detail ? '\n' + detail : ''), 'error')
    }

    return { toastVisible, toastText, toastType }
  }
}
</script>
