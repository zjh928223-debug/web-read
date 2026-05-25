import { defineStore } from 'pinia'

export const useMarksStore = defineStore('marks', () => {
  function syncVisual(globalIndex, isMarked) {
    if (!Number.isFinite(globalIndex) || globalIndex < 0) return
    var selector = '[data-word-index="' + globalIndex + '"]'
    document.querySelectorAll(selector).forEach(function (el) {
      el.classList.toggle('marked', !!isMarked)
    })
  }

  function toggle(markedMap, currentWordIndex, words, saveToDB, syncAnnotationFn) {
    if (currentWordIndex === -1) return
    var w = words[currentWordIndex]
    if (!w) return
    var isMarked = false
    if (markedMap.has(currentWordIndex)) {
      markedMap.delete(currentWordIndex)
    } else {
      markedMap.set(currentWordIndex, {
        word: w.word, start: w.start, globalIndex: currentWordIndex, sourceType: 'manual-mark'
      })
      isMarked = true
    }
    syncVisual(currentWordIndex, isMarked)
    var arr = []
    markedMap.forEach(function (v) { arr.push(v) })
    saveToDB('marks', arr)
    if (typeof syncAnnotationFn === 'function') syncAnnotationFn()
  }

  function exportToArray(markedMap) {
    var arr = []
    markedMap.forEach(function (v) { arr.push(v) })
    return arr
  }

  return { syncVisual, toggle, exportToArray }
})
