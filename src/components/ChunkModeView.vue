<template>
  <div
    v-if="ts.useVueRendering && chunkState.isChunkMode"
    id="chunk-vue-container"
    class="reading-area chunk-mode"
    :class="{ 'cn-mode-focus': chunkState.chunkFocusMode }"
  >
    <div
      v-for="(chunk, idx) in chunkState.chunkItems"
      :key="idx"
      :id="'chunk-' + idx"
      :class="chunkClasses(idx)"
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
              :id="'word-' + (word.globalIndex != null ? word.globalIndex : widx)"
              :data-word-index="word.globalIndex != null ? word.globalIndex : widx"
              :data-word-start="word.start"
              :data-word-end="word.end"
              :class="wordClasses(word)"
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
      if (idx != null && ts.highlightMode === 1 && idx === ts.activeWordIdx) {
        classes['word-highlight'] = true
      }
      return classes
    }

    function chunkClasses(index) {
      return {
        'chunk-block': true,
        'chunk-active': index === chunkState.activeChunkIdx
      }
    }

    function chunkRef(chunk, index) {
      if (window.__chunkNoteLayout && typeof window.__chunkNoteLayout.getChunkRef === 'function') {
        return window.__chunkNoteLayout.getChunkRef(chunk, index)
      }
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
      var selection = window.getSelection && window.getSelection()
      if (selection && !selection.isCollapsed) return

      var idx = word && word.globalIndex
      if (idx != null) {
        ts.currentWordIndex = idx
      }

      var start = Number(word && word.start)
      if (Number.isFinite(start)) {
        var audio = document.getElementById('audio-player')
        if (audio) audio.currentTime = start
        if (typeof window.forceUpdateUI === 'function') {
          window.forceUpdateUI(start)
        }
      }

      if (event && event.currentTarget && typeof window.selectSentenceFromChunkTarget === 'function') {
        window.selectSentenceFromChunkTarget(event.currentTarget)
      }
      if (event && event.currentTarget && typeof window.notifyAnnotationBubbleWordClick === 'function') {
        window.notifyAnnotationBubbleWordClick(event.currentTarget)
      }
    }

    function onWordContextMenu(word, event) {
      if (!event) return
      if (typeof window.openChunkNoteContextFromEvent === 'function') {
        var noteOpened = window.openChunkNoteContextFromEvent(event)
        if (noteOpened) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
      }
      if (!event.currentTarget || typeof window.notifyAnnotationBubbleWordClick !== 'function') return
      var opened = window.notifyAnnotationBubbleWordClick(event.currentTarget, { forceShow: true })
      if (opened) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    function onChunkContextMenu(event) {
      if (!event || typeof window.openChunkNoteContextFromEvent !== 'function') return
      var opened = window.openChunkNoteContextFromEvent(event)
      if (opened) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    function onChunkClick(chunk, idx, event) {
      if (event && event.target && event.target.closest('.chunk-note-tag')) return
      var selection = window.getSelection && window.getSelection()
      if (selection && !selection.isCollapsed) return

      var start = Number(chunk && chunk.start)
      if (!Number.isFinite(start)) return

      var audio = document.getElementById('audio-player')
      if (audio) audio.currentTime = start
      chunkState.activeChunkIdx = idx

      if (typeof window.forceUpdateUI === 'function') {
        window.forceUpdateUI(start)
      }
      if (event && event.currentTarget && typeof window.selectSentenceFromChunkTarget === 'function') {
        window.selectSentenceFromChunkTarget(event.currentTarget)
      }
    }

    return { ts, chunkState, chunkRef, chunkClasses, cnClasses, wordClasses, wordText, wordSeparator, onWordClick, onWordContextMenu, onChunkContextMenu, onChunkClick }
  }
}
</script>
