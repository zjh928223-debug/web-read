import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useTranscriptStore = defineStore('transcript', () => {
  const words = ref([])
  const segments = ref([])
  const wordStarts = ref([])
  const currentWordIndex = ref(-1)
  const highlightMode = ref(1)
  const activeWordIdx = ref(-1)
  const activeChunkIdx = ref(-1)
  const useVueRendering = ref(false)

  return { words, segments, wordStarts, currentWordIndex, highlightMode, activeWordIdx, activeChunkIdx, useVueRendering }
})
