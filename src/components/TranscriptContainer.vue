<template>
  <div v-if="ts.useVueRendering && !chunkModeActive" id="transcript-vue-container" class="reading-area">
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
import { computed } from 'vue'
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
      // Keep legacy current-word behavior available for marking shortcuts.
      if (word.globalIndex != null) {
        ts.currentWordIndex = word.globalIndex
      }
      var start = Number(word && word.start)
      if (Number.isFinite(start)) {
        var audio = document.getElementById('audio-player')
        if (audio) audio.currentTime = start
        if (typeof window.forceUpdateUI === 'function') {
          window.forceUpdateUI(start)
        }
      }
      if (event && event.currentTarget && typeof window.notifyAnnotationBubbleWordClick === 'function') {
        window.notifyAnnotationBubbleWordClick(event.currentTarget)
      }
    }

    function onWordContextMenu(word, event) {
      if (!event || !event.currentTarget || typeof window.notifyAnnotationBubbleWordClick !== 'function') return
      var opened = window.notifyAnnotationBubbleWordClick(event.currentTarget, { forceShow: true })
      if (opened) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    const chunkModeActive = computed(function () {
      return chunk.isChunkMode || false
    })

    return { ts, chunkModeActive, lineClasses, wordClasses, wordText, wordSeparator, onWordClick, onWordContextMenu }
  }
}
</script>
