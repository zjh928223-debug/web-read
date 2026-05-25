import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useClozeStore = defineStore('cloze', () => {
  const items = ref([])
  const answerState = ref([])
  const hasData = ref(false)

  function setData(newItems) {
    items.value = Array.isArray(newItems) ? newItems : []
    hasData.value = items.value.length > 0
    answerState.value = []
  }

  function resetState() {
    items.value = []
    answerState.value = []
    hasData.value = false
  }

  return { items, answerState, hasData, setData, resetState }
})
