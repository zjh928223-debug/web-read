(function () {
  'use strict';

  // === Keyboard handler init ===
  function initKeyboard(config) {
    var audioPlayer = config.audioPlayer;
    var isInputLikeTarget = config.isInputLikeTarget;
    var markKey = config.markKey, notesKey = config.notesKey;
    var annotationBubbleKey = config.annotationBubbleKey;
    var chunkCnKey = config.chunkCnKey, chunkShadowKey = config.chunkShadowKey;
    var chunkNoteKey = config.chunkNoteKey, backwardKey = config.backwardKey;
    var forwardKey = config.forwardKey;
    var toggleMarkCurrent = config.toggleMarkCurrent;
    var toggleCurrentNote = config.toggleCurrentNote;
    var toggleAnnotationBubble = config.toggleAnnotationBubble;
    var isChunkMode = config.isChunkMode;
    var handleBackwardClick = config.handleBackwardClick;
    var handleForwardClick = config.handleForwardClick;
    var toggleChunkCn = config.toggleChunkCn;
    var toggleChunkShadow = config.toggleChunkShadow;
    var chunkCNHoldMode = config.chunkCNHoldMode;
    var beginHoldChunkCn = config.beginHoldChunkCn;
    var endHoldChunkCn = config.endHoldChunkCn;
    var chunkNoteVisible = config.chunkNoteVisible;
    var setChunkNoteVisible = config.setChunkNoteVisible;

    document.addEventListener('keydown', function (e) {
      if (isInputLikeTarget(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var key = e.key;
      var lowerKey = key.toLowerCase();

      if (key === ' ') {
        e.preventDefault();
        audioPlayer.paused ? audioPlayer.play() : audioPlayer.pause();
      }
      else if (lowerKey === markKey) {
        e.preventDefault();
        toggleMarkCurrent();
      }
      else if (lowerKey === notesKey) {
        e.preventDefault();
        if (typeof toggleCurrentNote === 'function') toggleCurrentNote();
      }
      else if (lowerKey === annotationBubbleKey) {
        e.preventDefault();
        toggleAnnotationBubble();
      }
      else if (lowerKey === chunkCnKey && isChunkMode()) {
        e.preventDefault();
        if (typeof chunkCNHoldMode === 'function' && chunkCNHoldMode() && typeof beginHoldChunkCn === 'function') {
          if (!e.repeat) beginHoldChunkCn();
        } else {
          toggleChunkCn();
        }
      }
      else if (lowerKey === chunkShadowKey && isChunkMode()) {
        e.preventDefault();
        toggleChunkShadow();
      }
      else if (lowerKey === chunkNoteKey && isChunkMode()) {
        e.preventDefault();
        setChunkNoteVisible(!chunkNoteVisible, true);
      }
      else if (key === backwardKey) {
        e.preventDefault();
        handleBackwardClick();
      }
      else if (key === forwardKey) {
        e.preventDefault();
        handleForwardClick();
      }
    });

    addEventListener('keyup', function (e) {
      if (isInputLikeTarget(e.target)) return;
      if (!isChunkMode()) return;
      var key = e.key;
      var lowerKey = key.toLowerCase();
      if (lowerKey === chunkCnKey && (typeof chunkCNHoldMode === 'function' && chunkCNHoldMode())) {
        if (typeof endHoldChunkCn === 'function') endHoldChunkCn();
      }
    });

    window.addEventListener('blur', function () {
      if ((typeof chunkCNHoldMode === 'function' && chunkCNHoldMode()) && typeof endHoldChunkCn === 'function') endHoldChunkCn();
    });
  }

  // === Export handlers ===
  function initExports(config) {
    var exportJsonBtn = config.exportJsonBtn;
    var exportMdAllBtn = config.exportMdAllBtn;
    var markedMap = config.markedMap;
    var segments = config.segments;
    var showError = config.showError;
    var showToast = config.showToast;

    if (exportJsonBtn) {
      exportJsonBtn.addEventListener('click', function () {
        if (markedMap.size === 0) { showError('MARKS_EMPTY', 'No marks to export'); return; }
        var arr = [];
        markedMap.forEach(function (v) { arr.push(v); });
        var blob = new Blob([JSON.stringify(arr, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'marks.json';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
      });
    }

    if (exportMdAllBtn) {
      exportMdAllBtn.addEventListener('click', function () {
        if (!segments.length) { showError('TRANSCRIPT_EMPTY', 'No transcript to export'); return; }
        var lines = segments.map(function (seg) {
          if (!seg.words) return '';
          return seg.words.map(function (w) {
            var txt = w.word || w.text || '';
            if (markedMap.has(w.globalIndex)) return '**' + txt.trim() + '**';
            return txt.trim();
          }).join(' ');
        }).join('\n\n');
        var blob = new Blob([lines], { type: 'text/plain' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'transcript_full.txt';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
      });
    }
  }

  // === Import handlers (marks import as example — other imports too integrated) ===
  function initMarksImport(config) {
    var importMarksBtn = config.importMarksBtn;
    var importMarksInput = config.importMarksInput;
    var getFirstFileFromEvent = config.getFirstFileFromEvent;
    var readFileAsText = config.readFileAsText;
    var validateMarksArray = config.validateMarksArray;
    var words = config.words;
    var markedMap = config.markedMap;
    var saveToDB = config.saveToDB;
    var isChunkModeFn = config.isChunkModeFn;
    var renderTranscript = config.renderTranscript;
    var renderChunkMode = config.renderChunkMode;
    var forceUpdateUI = config.forceUpdateUI;
    var audioPlayer = config.audioPlayer;
    var syncAnnotationGenerationEntryStatus = config.syncAnnotationGenerationEntryStatus;
    var showToast = config.showToast;
    var showError = config.showError;

    if (importMarksBtn && importMarksInput) {
      importMarksBtn.addEventListener('click', function () { importMarksInput.click(); });
      importMarksInput.addEventListener('change', function (e) {
        var f = getFirstFileFromEvent(e);
        if (!f) return;
        readFileAsText(f, function (rawText) {
          try {
            var arr = validateMarksArray(JSON.parse(rawText), words.length);
            markedMap.clear();
            arr.forEach(function (mark) {
              if (mark.globalIndex < words.length) {
                markedMap.set(mark.globalIndex, {
                  globalIndex: mark.globalIndex,
                  word: mark.word,
                  start: mark.start,
                  sourceType: String(mark.sourceType || mark.source || 'marks-json')
                });
              }
            });
            saveToDB('marks', (function () { var out = []; markedMap.forEach(function (v) { out.push(v); }); return out; })());
            if (isChunkModeFn()) renderChunkMode(); else renderTranscript();
            forceUpdateUI(audioPlayer.currentTime);
            syncAnnotationGenerationEntryStatus();
            showToast('Marks imported', 'success');
          } catch (x) { showError('MARKS_IMPORT', x && x.message ? x.message : 'Invalid marks file'); }
        });
      });
    }
  }

  window.__appHandlers = {
    initKeyboard: initKeyboard,
    initExports: initExports,
    initMarksImport: initMarksImport
  };
})();
