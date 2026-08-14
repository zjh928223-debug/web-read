<template>
  <div
    ref="rootElement"
    id="transcript-vue-container"
    class="reading-area"
    :class="{ 'reader-view-hidden': chunkModeActive }"
  >
    <div
      v-for="(seg, idx) in ts.segments"
      :key="idx"
      :id="'segment-' + idx"
      :class="lineClasses(idx)"
    >
      <template
        v-for="(word, widx) in seg.words"
        :key="word.globalIndex != null ? word.globalIndex : widx"
      >
        <span
          :id="'word-' + (word.globalIndex != null ? word.globalIndex : widx)"
          :data-word-index="word.globalIndex != null ? word.globalIndex : widx"
          :data-word-start="word.start"
          :data-word-end="word.end"
          :class="wordClasses(word)"
          @click.stop="onWordClick(word, $event)"
          @contextmenu="onWordContextMenu(word, $event)"
        >{{ wordText(word) }}</span>{{ wordSeparator(word, widx, seg.words) }}
      </template>
      <details v-if="seg.translation" class="grok-box has-content" :id="'note-' + idx">
        <summary class="grok-summary"></summary>
        <div class="grok-content">{{ seg.translation }}</div>
      </details>
    </div>
  </div>
</template>

<script>
import { computed, nextTick, onBeforeUnmount, onMounted, onUpdated, ref, watch } from 'vue'
import { useTranscriptStore } from '../pinia-stores/transcript.js'
import { useChunkStore } from '../pinia-stores/chunk.js'
import { handleTranscriptWordClick, handleTranscriptWordContextMenu } from '../composables/transcript-interactions.js'

export default {
  name: 'TranscriptContainer',
  setup() {
    const ts = useTranscriptStore()
    const chunk = useChunkStore()
    const rootElement = ref(null)
    let activeWordElement = null

    function syncActiveWordClass() {
      const index = Number(ts.activeWordIdx)
      const nextElement = Number.isInteger(index) && index >= 0 && rootElement.value
        ? rootElement.value.querySelector('#word-' + index)
        : null
      if (activeWordElement && activeWordElement !== nextElement) {
        activeWordElement.classList.remove('word-highlight')
      }
      if (nextElement && nextElement !== activeWordElement) {
        nextElement.classList.add('word-highlight')
      }
      activeWordElement = nextElement
    }

    watch(
      () => ts.activeWordIdx,
      () => nextTick(syncActiveWordClass)
    )
    onMounted(syncActiveWordClass)
    onUpdated(syncActiveWordClass)
    onBeforeUnmount(() => {
      if (activeWordElement) activeWordElement.classList.remove('word-highlight')
      activeWordElement = null
    })

    function isMarkedWord(idx) {
      if (idx == null || typeof window === 'undefined') return false
      var state = window.__state
      return !!(
        state
        && state.markedMap
        && typeof state.markedMap.has === 'function'
        && state.markedMap.has(idx)
      )
    }

    function wordClasses(word) {
      var idx = word.globalIndex
      var classes = {}
      if (isMarkedWord(idx)) {
        classes.marked = true
      }
      if (idx != null && Array.isArray(ts.previewVocabularyWordIndexes) && ts.previewVocabularyWordIndexes.includes(idx)) {
        classes['preview-vocabulary-word'] = true
      }
      return classes
    }

    function lineClasses(index) {
      return {
        'transcript-line': true,
        'sentence-active': ts.highlightMode === 2 && index === ts.activeSegIdx
      }
    }

    function wordText(word) {
      return word.word || word.text || ''
    }

    function wordSeparator(word, index, words) {
      if (!words || index >= words.length - 1) return ''
      var current = wordText(word)
      var next = wordText(words[index + 1])
      if (!current || !next) return ''
      if (/^[.,!?;:%)\]}]/.test(next)) return ''
      if (/^(?:n't|'s|'re|'ve|'ll|'d|'m)$/i.test(next)) return ''
      if (/[([{]$/.test(current)) return ''
      return ' '
    }

    function onWordClick(word, event) {
      handleTranscriptWordClick({ word: word, event: event, transcriptStore: ts })
    }

    function onWordContextMenu(word, event) {
      handleTranscriptWordContextMenu({ word: word, event: event })
    }

    const chunkModeActive = computed(function () {
      return chunk.isChunkMode || false
    })

    return { ts, rootElement, chunkModeActive, lineClasses, wordClasses, wordText, wordSeparator, onWordClick, onWordContextMenu }
  }
}
</script>
