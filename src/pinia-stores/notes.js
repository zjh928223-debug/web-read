import { defineStore } from 'pinia'
import { ref, reactive } from 'vue'

export const useNotesStore = defineStore('notes', () => {
  const chunkNotesMap = reactive({})
  const sentenceNotesMap = reactive({})
  const currentDocId = ref('')
  const selectedSentence = ref(null)

  return { chunkNotesMap, sentenceNotesMap, currentDocId, selectedSentence }
})
