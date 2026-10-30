<template>
  <div
    ref="rootElement"
    id="chunk-vue-container"
    class="reading-area chunk-mode"
    :class="{ 'cn-mode-focus': chunkState.chunkFocusMode }"
  >
    <div
      v-for="(chunk, idx) in chunkState.chunkItems"
      :key="idx"
      :id="'chunk-' + idx"
      class="chunk-block"
      :data-chunk-idx="idx"
      :data-chunk-ref="chunkRef(chunk, idx)"
      :data-legacy-chunk-ref="chunk.segId"
      @click="onChunkClick(chunk, idx, $event)"
      @contextmenu="onChunkContextMenu($event)"
    >
      <div class="chunk-en">
        <template v-if="chunk.words">
          <template
            v-for="(word, widx) in chunk.words"
            :key="word.globalIndex != null ? word.globalIndex : widx"
          >
            <span
              :id="'chunk-word-' + (word.globalIndex != null ? word.globalIndex : widx)"
              :data-word-index="word.globalIndex != null ? word.globalIndex : widx"
              :data-word-start="word.start"
              :data-word-end="word.end"
              :class="wordClasses(word)"
              @pointerenter="prepareReaderWordHover"
              @click.stop="onWordClick(word, $event)"
              @contextmenu="onWordContextMenu(word, $event)"
            >{{ wordText(word) }}</span>{{ wordSeparator(word, widx, chunk.words) }}
          </template>
        </template>
      </div>
      <div v-if="chunk.ch" :class="cnClasses(idx)">{{ chunk.ch }}</div>
    </div>
  </div>
</template>

<script>
import { nextTick, onBeforeUnmount, onMounted, onUpdated, ref, watch } from 'vue'
import { useTranscriptStore } from '../pinia-stores/transcript.js'
import { useChunkStore } from '../pinia-stores/chunk.js'
import { runtimeState } from '../composables/runtime-state-facade.js'
import { prepareReaderWordHover } from '../composables/reader-word-hover.js'
import {
  handleChunkClick,
  handleChunkContextMenu,
  handleChunkWordClick,
  handleChunkWordContextMenu
} from '../composables/chunk-interactions.js'

export default {
  name: 'ChunkModeView',
  setup() {
    const ts = useTranscriptStore()
    const chunkState = useChunkStore()
    const rootElement = ref(null)
    let activeChunkElement = null

    function syncActiveChunkClass() {
      const index = Number(chunkState.activeChunkIdx)
      const nextElement = Number.isInteger(index) && index >= 0 && rootElement.value
        ? rootElement.value.querySelector('#chunk-' + index)
        : null
      if (activeChunkElement && activeChunkElement !== nextElement) {
        activeChunkElement.classList.remove('chunk-active')
      }
      if (nextElement && nextElement !== activeChunkElement) {
        nextElement.classList.add('chunk-active')
      }
      activeChunkElement = nextElement
    }

    function syncChunkVisibility() {
      if (!rootElement.value) return
      rootElement.value.classList.toggle('reader-view-hidden', !chunkState.isChunkMode)
    }

    watch(
      () => chunkState.activeChunkIdx,
      () => nextTick(syncActiveChunkClass)
    )
    watch(
      () => chunkState.isChunkMode,
      () => nextTick(syncChunkVisibility)
    )
    onMounted(syncActiveChunkClass)
    onMounted(syncChunkVisibility)
    onUpdated(syncActiveChunkClass)
    onUpdated(syncChunkVisibility)
    onBeforeUnmount(() => {
      if (activeChunkElement) activeChunkElement.classList.remove('chunk-active')
      activeChunkElement = null
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

    function chunkRef(chunk, index) {
      if (chunk && chunk.noteId) return chunk.noteId
      var segId = chunk && Number.isFinite(Number(chunk.segId)) ? Number(chunk.segId) : -1
      var start = Math.round((Number(chunk && chunk.start) || 0) * 1000)
      var end = Math.round((Number(chunk && chunk.end) || 0) * 1000)
      return 'seg-' + segId + '-t-' + start + '-' + end + '-i-' + index
    }

    function cnClasses() {
      return {
        'chunk-cn': true,
        'hidden-cn': !chunkState.chunkCNVisible
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
      handleChunkWordClick({ word: word, event: event, transcriptStore: ts })
    }

    function onWordContextMenu(word, event) {
      handleChunkWordContextMenu({ word: word, event: event })
    }

    function onChunkContextMenu(event) {
      handleChunkContextMenu({ event: event })
    }

    function onChunkClick(chunk, idx, event) {
      handleChunkClick({ chunk: chunk, index: idx, event: event, chunkStore: chunkState })
    }

    return { ts, chunkState, rootElement, chunkRef, cnClasses, wordClasses, wordText, wordSeparator, prepareReaderWordHover, onWordClick, onWordContextMenu, onChunkContextMenu, onChunkClick }
  }
}
</script>
