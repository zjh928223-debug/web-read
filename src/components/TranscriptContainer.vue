<template>
  <div v-if="ts.useVueRendering && !chunkModeActive" id="transcript-vue-container" class="reading-area">
    <div
      v-for="(seg, idx) in ts.segments"
      :key="idx"
      :id="'segment-' + idx"
      class="transcript-line"
    >
      <span
        v-for="(word, widx) in seg.words"
        :key="word.globalIndex != null ? word.globalIndex : widx"
        :id="'word-' + (word.globalIndex != null ? word.globalIndex : widx)"
        :data-word-index="word.globalIndex != null ? word.globalIndex : widx"
        :class="wordClasses(word)"
        @click="onWordClick(word)"
      >{{ word.word || word.text }}</span>
      <details v-if="seg.translation" class="grok-box has-content" :id="'note-' + idx">
        <summary class="grok-summary"></summary>
        <div class="grok-content">{{ seg.translation }}</div>
      </details>
    </div>
  </div>
</template>

<script>
import { useTranscriptStore } from '../pinia-stores/transcript.js'
import { useChunkStore } from '../pinia-stores/chunk.js'

export default {
  name: 'TranscriptContainer',
  setup() {
    const ts = useTranscriptStore()
    const chunk = useChunkStore()

    function wordClasses(word) {
      var idx = word.globalIndex
      var classes = {}
      if (idx != null && ts.highlightMode === 1 && idx === ts.activeWordIdx) {
        classes['word-highlight'] = true
      }
      return classes
    }

    function onWordClick(word) {
      // Handle word click — set as current word for marking etc.
      if (word.globalIndex != null) {
        ts.currentWordIndex = word.globalIndex
      }
    }

    const chunkModeActive = chunk.isChunkMode || false

    return { ts, chunkModeActive, wordClasses, onWordClick }
  }
}
</script>
