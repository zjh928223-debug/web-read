import { defineStore } from 'pinia'

export const useMarksStore = defineStore('marks', () => {
  function syncVisual(globalIndex, isMarked) {
    if (!Number.isFinite(globalIndex) || globalIndex < 0) return
    var selector = '[data-word-index="' + globalIndex + '"]'
    document.querySelectorAll(selector).forEach(function (el) {
      el.classList.toggle('marked', !!isMarked)
    })
  }

  async function toggle(markedMap, currentWordIndex, words, saveToDB, syncAnnotationFn) {
    if (currentWordIndex === -1) return false
    var w = words[currentWordIndex]
    if (!w) return false
    var isMarked = false
    var operation
    if (markedMap.has(currentWordIndex)) {
      markedMap.delete(currentWordIndex)
      operation = { type: 'remove', globalIndex: currentWordIndex }
    } else {
      var mark = {
        word: w.word, start: w.start, globalIndex: currentWordIndex, sourceType: 'manual-mark'
      }
      markedMap.set(currentWordIndex, mark)
      isMarked = true
      operation = { type: 'add', mark: mark }
    }
    syncVisual(currentWordIndex, isMarked)
    var arr = []
    markedMap.forEach(function (v) { arr.push(v) })
    await saveToDB('marks', arr)
    if (typeof syncAnnotationFn === 'function') await syncAnnotationFn({ source: 'edit', operation: operation })
    return true
  }

  function exportToArray(markedMap) {
    var arr = []
    markedMap.forEach(function (v) { arr.push(v) })
    return arr
  }

  return { syncVisual, toggle, exportToArray }
})
