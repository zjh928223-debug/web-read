<template>
  <div v-if="vueActive" id="transcript-vue-container" class="reading-area">
    <div v-if="!chunkMode">
      <div
        v-for="seg in segments"
        :key="seg.idx || seg.segIndex"
        :id="'segment-' + (seg.segIndex || seg.idx)"
        class="transcript-line"
      >
        <span
          v-for="word in seg.words"
          :key="word.globalIndex"
          :id="'word-' + word.globalIndex"
          :data-word-index="word.globalIndex"
          :class="wordClass(word)"
          @click="onWordClick(word)"
        >{{ word.word || word.text }}</span>
        <details v-if="seg.translation" class="grok-box has-content" :id="'note-' + (seg.segIndex || seg.idx)">
          <summary class="grok-summary"></summary>
          <div class="grok-content">{{ seg.translation }}</div>
        </details>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'TranscriptContainer',
  computed: {
    vueActive() { return window.__USE_VUE_RENDERING === true },
    chunkMode() { return false },
    segments() { return [] }
  },
  methods: {
    wordClass(word) { return {} },
    onWordClick(word) {}
  }
}
</script>
