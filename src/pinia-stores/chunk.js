import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useChunkStore = defineStore('chunk', () => {
  const isChunkMode = ref(false)
  const chunkItems = ref([])
  const hasAiChunkData = ref(false)
  const activeChunkIdx = ref(-1)
  const chunkCNVisible = ref(false)
  const chunkCNHoldMode = ref(true)
  const chunkFocusMode = ref(true)
  const chunkShadowVisible = ref(true)
  const chunkNoteVisible = ref(true)
  const manualChunkStates = ref({})
  const isHoldingChunkCn = ref(false)
  const holdPrevChunkCnVisible = ref(null)
  const lastAiPrevTapChunkIndex = ref(-1)
  const lastAiPrevTapAt = ref(0)

  return {
    isChunkMode,
    chunkItems,
    hasAiChunkData,
    activeChunkIdx,
    chunkCNVisible,
    chunkCNHoldMode,
    chunkFocusMode,
    chunkShadowVisible,
    chunkNoteVisible,
    manualChunkStates,
    isHoldingChunkCn,
    holdPrevChunkCnVisible,
    lastAiPrevTapChunkIndex,
    lastAiPrevTapAt
  }
})
