import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useTranscriptStore = defineStore('transcript', () => {
  const words = ref([])
  const segments = ref([])
  const wordStarts = ref([])
  const currentWordIndex = ref(-1)
  const highlightMode = ref(2)
  const activeWordIdx = ref(-1)
  const activeSegIdx = ref(-1)
  const useVueRendering = ref(false)

  return { words, segments, wordStarts, currentWordIndex, highlightMode, activeWordIdx, activeSegIdx, useVueRendering }
})
