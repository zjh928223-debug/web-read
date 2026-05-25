<template>
  <div v-if="ts.useVueRendering && chunkState.isChunkMode" id="chunk-vue-container" class="reading-area chunk-mode">
    <div
      v-for="(chunk, idx) in chunkState.chunkItems"
      :key="idx"
      class="chunk-block"
      :data-chunk-idx="idx"
      :data-chunk-ref="chunk.segId"
      @click="onChunkClick(idx)"
    >
      <div class="chunk-en">
        <span v-if="chunk.words" v-for="(word, widx) in chunk.words" :key="word.globalIndex != null ? word.globalIndex : widx"
          :id="'word-' + (word.globalIndex != null ? word.globalIndex : widx)"
          :data-word-index="word.globalIndex != null ? word.globalIndex : widx"
          :class="wordClasses(word)">
          {{ word.word || word.text }}
        </span>
      </div>
      <div v-if="chunk.ch" class="chunk-cn">{{ chunk.ch }}</div>
    </div>
  </div>
</template>

<script>
import { useTranscriptStore } from '../pinia-stores/transcript.js'
import { useChunkStore } from '../pinia-stores/chunk.js'

export default {
  name: 'ChunkModeView',
  setup() {
    const ts = useTranscriptStore()
    const chunkState = useChunkStore()

    function wordClasses(word) {
      var idx = word.globalIndex
      var classes = {}
      if (idx != null && idx === ts.activeChunkIdx) {
        classes['word-highlight'] = true
      }
      return classes
    }

    function onChunkClick(idx) {
      // Handle chunk click
    }

    return { ts, chunkState, wordClasses, onChunkClick }
  }
}
</script>
