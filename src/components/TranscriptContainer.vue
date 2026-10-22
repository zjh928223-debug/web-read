<template>
  <div
    ref="rootElement"
    id="transcript-vue-container"
    class="reading-area"
  >
    <div
      v-for="(seg, idx) in ts.segments"
      :key="idx"
      :id="'segment-' + idx"
      class="transcript-line"
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
import { nextTick, onBeforeUnmount, onMounted, onUpdated, ref, watch } from 'vue'
import { useTranscriptStore } from '../pinia-stores/transcript.js'
import { useChunkStore } from '../pinia-stores/chunk.js'
import { runtimeState } from '../composables/runtime-state-facade.js'
import { handleTranscriptWordClick, handleTranscriptWordContextMenu } from '../composables/transcript-interactions.js'

export default {
  name: 'TranscriptContainer',
  setup() {
    const ts = useTranscriptStore()
    const chunk = useChunkStore()
    const rootElement = ref(null)
    let activeWordElement = null
    let activeSentenceElement = null

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

    function syncTranscriptVisibility() {
      if (!rootElement.value) return
      rootElement.value.classList.toggle('reader-view-hidden', chunk.isChunkMode)
    }

    watch(
      () => ts.activeWordIdx,
      () => nextTick(syncActiveWordClass)
    )
    watch(
      () => chunk.isChunkMode,
      () => nextTick(syncTranscriptVisibility)
    )

    function syncActiveSentenceClass() {
      const index = ts.activeSegIdx
      const nextElement = ts.highlightMode === 2
        && Number.isInteger(index)
        && index >= 0
        && rootElement.value
        ? rootElement.value.querySelector('#segment-' + index)
        : null
      if (activeSentenceElement && activeSentenceElement !== nextElement) {
        activeSentenceElement.classList.remove('sentence-active')
      }
      if (nextElement && !nextElement.classList.contains('sentence-active')) {
        nextElement.classList.add('sentence-active')
      }
      activeSentenceElement = nextElement
    }

    watch(
      () => [ts.highlightMode, ts.activeSegIdx],
      () => nextTick(syncActiveSentenceClass)
    )
    onMounted(syncActiveWordClass)
    onMounted(syncActiveSentenceClass)
    onMounted(syncTranscriptVisibility)
    onUpdated(syncActiveWordClass)
    onUpdated(syncActiveSentenceClass)
    onUpdated(syncTranscriptVisibility)
    onBeforeUnmount(() => {
      if (activeWordElement) activeWordElement.classList.remove('word-highlight')
      activeWordElement = null
      if (activeSentenceElement) activeSentenceElement.classList.remove('sentence-active')
      activeSentenceElement = null
    })

    function isMarkedWord(idx) {
      return !!(
        idx != null
        && runtimeState.markedMap
        && typeof runtimeState.markedMap.has === 'function'
        && runtimeState.markedMap.has(idx)
      )
    }

    function wordClasses(word) {
      var idx = word.globalIndex
      var classes = {}
      classes['annotation-word-selected'] = idx === ts.selectedAnnotationWordIndex
      if (isMarkedWord(idx)) {
        classes.marked = true
      }
      return classes
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

    return { ts, rootElement, wordClasses, wordText, wordSeparator, onWordClick, onWordContextMenu }
  }
}
</script>
