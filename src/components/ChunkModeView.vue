<template>
  <div v-if="vueActive" id="chunk-vue-container" class="reading-area chunk-mode">
    <div
      v-for="chunk in chunks"
      :key="chunk.idx || chunk.segId"
      class="chunk-block"
      :data-chunk-idx="chunk.idx"
      :data-chunk-ref="chunk.segId"
      @click="onChunkClick(chunk.idx)"
    >
      <div class="chunk-en">
        <span v-if="chunk.words" v-for="word in chunk.words" :key="word.globalIndex"
          :id="'word-' + word.globalIndex" :data-word-index="word.globalIndex">
          {{ word.word || word.text }}
        </span>
      </div>
      <div v-if="cnVisible && chunk.ch" class="chunk-cn">{{ chunk.ch }}</div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'ChunkModeView',
  computed: {
    vueActive() { return window.__USE_VUE_RENDERING === true },
    chunks() { return [] },
    cnVisible() { return true }
  },
  methods: {
    onChunkClick(idx) {}
  }
}
</script>
