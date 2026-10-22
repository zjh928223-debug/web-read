<template>
  <section class="learning-page-load-notice" data-ui-theme="light" role="dialog" :aria-label="`打开${pageName}`" aria-modal="true">
    <div class="learning-page-load-notice-card">
      <p role="status" aria-live="polite">
        {{ failed
          ? (retryFailed ? `${pageName}仍无法打开。请返回阅读器，网络恢复后手动刷新页面再试。` : `${pageName}暂时无法打开，请重试。`)
          : `正在打开${pageName}…` }}
      </p>
      <Button v-if="failed" variant="outline" size="default" data-ui-owner="learning" class="learning-page-load-notice-action" type="button" @click="$emit('retry')">重试</Button>
      <Button variant="default" size="default" data-ui-owner="learning" class="learning-page-load-notice-action" type="button" @click="$emit('close')">返回阅读器</Button>
    </div>
  </section>
</template>

<script setup>
import { Button } from './ui/button/index.js'

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
  border: 1px solid var(--learning-border);
  background: var(--learning-background);
  color: var(--learning-foreground);
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.16);
}
.learning-page-load-notice-action + .learning-page-load-notice-action { margin-left: 12px; }
</style>
