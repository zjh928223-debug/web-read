import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useChunkStore = defineStore('chunk', () => {
  const isChunkMode = ref(false)
  const chunkItems = ref([])
  const hasAiChunkData = ref(false)
  const chunkCNVisible = ref(true)
  const chunkCNHoldMode = ref(false)
  const chunkFocusMode = ref(false)
  const chunkShadowVisible = ref(true)
  const chunkNoteVisible = ref(true)

  return { isChunkMode, chunkItems, hasAiChunkData, chunkCNVisible, chunkCNHoldMode, chunkFocusMode, chunkShadowVisible, chunkNoteVisible }
})
