<template>
  <section v-if="__USE_VUE_RENDERING" class="note-preview-sidebar" id="note-preview-sidebar">
    <div class="note-preview-header">
      <span>句子笔记</span>
      <button @click="onClose">×</button>
    </div>
    <div v-if="items.length === 0" class="note-preview-empty">
      选择一个句子以查看笔记。
    </div>
    <div v-else class="note-preview-list" id="note-preview-list">
      <div
        v-for="item in items"
        :key="item.id"
        class="note-preview-item"
        @click="onSelect(item)"
      >
        <span class="note-preview-text">{{ item.text }}</span>
      </div>
    </div>
  </section>
</template>

<script>
export default {
  name: 'SentenceNoteSidebar',
  computed: {
    __USE_VUE_RENDERING() { return window.__USE_VUE_RENDERING || false },
    items() { return []; /* populated from store in Phase 6 */ }
  },
  methods: {
    onClose() { /* Phase 6 */ },
    onSelect(item) { /* Phase 6 */ }
  }
}
</script>
