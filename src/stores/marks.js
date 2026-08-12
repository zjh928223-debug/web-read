  function syncMarkedWordVisual(globalIndex, isMarked) {
    if (!Number.isFinite(globalIndex) || globalIndex < 0) return;
    var selector = '[data-word-index="' + globalIndex + '"]';
    document.querySelectorAll(selector).forEach(function (el) {
      el.classList.toggle('marked', !!isMarked);
    });
  }

  async function toggleMark(markedMap, currentWordIndex, words, saveToDB, syncAnnotationGenerationEntryStatus) {
    if (currentWordIndex === -1) return false;
    var w = words[currentWordIndex];
    if (!w) return false;
    var isMarked = false;

    if (markedMap.has(currentWordIndex)) {
      markedMap.delete(currentWordIndex);
    } else {
      markedMap.set(currentWordIndex, {
        word: w.word,
        start: w.start,
        globalIndex: currentWordIndex,
        sourceType: 'manual-mark'
      });
      isMarked = true;
    }
    syncMarkedWordVisual(currentWordIndex, isMarked);
    var arr = [];
    markedMap.forEach(function (v) { arr.push(v); });
    await saveToDB('marks', arr);
    await syncAnnotationGenerationEntryStatus();
    return true;
  }

  function exportMarksToArray(markedMap) {
    var arr = [];
    markedMap.forEach(function (v) { arr.push(v); });
    return arr;
  }

  window.__marksStore = {
    toggleMark: toggleMark,
    syncMarkedWordVisual: syncMarkedWordVisual,
    exportMarksToArray: exportMarksToArray
  };
