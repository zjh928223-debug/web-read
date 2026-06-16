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
    initExports: initExports,
    initMarksImport: initMarksImport
  };
