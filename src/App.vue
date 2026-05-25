<template>
  <div>
    <span style="display:none" data-vue-mounted>1</span>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'

onMounted(() => {
  console.log('[vue] shell mounted — app.js handles all existing logic')
})
</script>
