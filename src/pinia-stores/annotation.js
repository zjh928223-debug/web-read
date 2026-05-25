import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useAnnotationStore = defineStore('annotation', () => {
  const isGenerating = ref(false)
  const status = ref('idle')
  const scopeKey = ref('')
  const lastError = ref('')

  return { isGenerating, status, scopeKey, lastError }
})
