<template>
  <section class="learning-page-load-notice" role="dialog" :aria-label="`打开${pageName}`" aria-modal="true">
    <div class="learning-page-load-notice-card">
      <p role="status" aria-live="polite">
        {{ failed
          ? (retryFailed ? `${pageName}仍无法打开。请返回阅读器，网络恢复后手动刷新页面再试。` : `${pageName}暂时无法打开，请重试。`)
          : `正在打开${pageName}…` }}
      </p>
      <button v-if="failed" class="small-btn" type="button" @click="$emit('retry')">重试</button>
      <button class="small-btn" type="button" @click="$emit('close')">返回阅读器</button>
    </div>
  </section>
</template>

<script setup>
defineProps({ pageName: { type: String, required: true }, failed: Boolean, retryFailed: Boolean })
defineEmits(['retry', 'close'])
</script>

<style scoped>
.learning-page-load-notice {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.35);
}
.learning-page-load-notice-card {
  max-width: 420px;
  padding: 24px;
  border-radius: 12px;
  background: var(--bg-color, #fff);
  color: var(--text-color, #222);
}
.small-btn + .small-btn { margin-left: 12px; }
</style>
