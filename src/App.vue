<template>
  <div>
    <ToastMessage />
    <span style="display:none" data-vue-mounted>1</span>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import ToastMessage from './components/ToastMessage.vue'

onMounted(() => {
  console.log('[vue] shell mounted — ToastMessage active')
})
</script>
