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

  return { isChunkMode, chunkItems, hasAiChunkData, activeChunkIdx, chunkCNVisible, chunkCNHoldMode, chunkFocusMode, chunkShadowVisible, chunkNoteVisible }
})
