import { wrapChunkNoteTextForCanvas } from '../utils/chunk-note-layout-helpers.js';

  // === Pure utility functions (no app.js state dependency) ===

  function findNearestChunkWord(enDiv, clientX, clientY) {
    if (!enDiv) return null;
    var spans = Array.from(enDiv.querySelectorAll('span[id^="word-"]'));
    if (!spans.length) return null;
    var best = null;
    var bestScore = Infinity;
    spans.forEach(function (span) {
      var rect = span.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      var dx = cx - clientX;
      var dy = cy - clientY;
      var score = (dx * dx) + (dy * dy);
      if (score < bestScore) { bestScore = score; best = span; }
    });
    return best;
  }

  function getChunkNoteMeasureFont() {
    return "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
  }

  function measureChunkNoteTextBox(text, minW, minH, maxW) {
    var t = String(text || '').trim();
    var baseFs = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chunk-note-size')) || 16;
    var probe = document.getElementById('chunk-note-probe');
    if (!probe || !t) { return { width: minW, height: minH, fontSize: baseFs }; }
    var widthCap = Math.max(minW, maxW || minW);
    probe.style.position = 'fixed'; probe.style.left = '-9999px'; probe.style.top = '-9999px';
    probe.style.width = 'auto'; probe.style.maxWidth = widthCap + 'px';
    probe.style.fontFamily = getChunkNoteMeasureFont(); probe.style.fontSize = baseFs + 'px';
    probe.style.lineHeight = '1.28'; probe.style.whiteSpace = 'pre-wrap'; probe.style.wordBreak = 'break-word';
    probe.textContent = t;
    var width = Math.max(minW, Math.min(widthCap, Math.ceil(probe.scrollWidth) + 14));
    probe.style.width = Math.max(8, width - 12) + 'px';
    var height = Math.max(minH, Math.ceil(probe.scrollHeight) + 8);
    return { width: width, height: height, fontSize: baseFs };
  }

  function applyChunkNoteAutoSize(note) {
    if (!note || note.autoSize === false) return;
    var baseWnd = document.defaultView || window;
    var minDim = { minW: 40, minH: 18 };
    var minW = minDim.minW; var minH = minDim.minH;
    var maxW = Math.max(minW, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chunk-note-width')) || 260);
    var box = measureChunkNoteTextBox(note.note || '', minW, minH, maxW);
    note.w = box.width; note.h = box.height; note.fontSize = box.fontSize;
  }

  function getChunkRef(chunk, idx) {
    if (chunk && chunk.noteId) return chunk.noteId;
    var segId = (chunk && Number.isFinite(chunk.segId)) ? chunk.segId : -1;
    var st = Math.round(((chunk && chunk.start) || 0) * 1000);
    var ed = Math.round(((chunk && chunk.end) || 0) * 1000);
    return 'seg-' + segId + '-t-' + st + '-' + ed + '-i-' + idx;
  }

  function getChunkNoteBaseFontSize() {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chunk-note-size')) || 16;
  }

  function getChunkNoteMinReadableFontSize() {
    return Math.max(12, Math.round(getChunkNoteBaseFontSize() * 0.75));
  }

  function sanitizeChunkNoteFontSize(rawSize) {
    var base = getChunkNoteBaseFontSize();
    var n = Number(rawSize);
    if (!Number.isFinite(n)) return base;
    if (n < 1 || n > Math.max(22, base * 1.6)) return base;
    return n;
  }

  function getChunkNoteLayoutContext() {
    if (!getChunkNoteLayoutContext.canvas) {
      getChunkNoteLayoutContext.canvas = document.createElement('canvas');
      getChunkNoteLayoutContext.ctx = getChunkNoteLayoutContext.canvas.getContext('2d');
    }
    return getChunkNoteLayoutContext.ctx;
  }

  function buildChunkNoteLayout(note, width, height) {
    var text = String((note && note.note) || '').trim();
    var w = Math.max(1, Math.round(Number(width) || 1));
    var h = Math.max(1, Math.round(Number(height) || 1));
    var padX = Math.max(3, Math.min(8, Math.round(w * 0.08)));
    var padY = Math.max(2, Math.min(6, Math.round(h * 0.08)));
    var maxTextW = Math.max(8, w - padX * 2);
    var maxTextH = Math.max(8, h - padY * 2);
    var preferredFs = sanitizeChunkNoteFontSize(note && note.fontSize);
    var minFs = Math.min(getChunkNoteMinReadableFontSize(), preferredFs);
    var ctx = getChunkNoteLayoutContext();
    var ChunkLC = window.ChunkNoteLayoutCore;

    function makeLayout(fontSize) {
      var fs = Math.max(1, Math.floor(fontSize));
      var lineHeight = Math.max(12, Math.round(fs * 1.24));
      ctx.font = fs + 'px ' + getChunkNoteMeasureFont();
      var lines = wrapChunkNoteTextForCanvas(ctx, text, maxTextW);
      var totalH = lines.length * lineHeight;
      return { fontSize: fs, lineHeight: lineHeight, lines: lines, fits: totalH <= maxTextH, totalH: totalH };
    }

    if (!text) {
      return ChunkLC ? ChunkLC.buildEmptyChunkNoteLayoutResult(preferredFs, { padX: padX, padY: padY, maxTextW: maxTextW, maxTextH: maxTextH }) : { fontSize: preferredFs, lineHeight: Math.round(preferredFs * 1.24), lines: [''], fits: true, valid: true, padX: padX, padY: padY, maxTextW: maxTextW, maxTextH: maxTextH };
    }

    var best = makeLayout(preferredFs);
    if (!best.fits) {
      var lo = minFs; var hi = preferredFs; var lastFit = null;
      for (var i = 0; i < 14; i++) {
        var mid = Math.floor((lo + hi) / 2);
        var current = makeLayout(mid);
        if (current.fits) { lastFit = current; lo = mid + 1; }
        else { hi = mid - 1; }
      }
      best = lastFit || makeLayout(minFs);
    }
    return ChunkLC ? ChunkLC.buildChunkNoteLayoutResult(best, { padX: padX, padY: padY, maxTextW: maxTextW, maxTextH: maxTextH }) : { fontSize: best.fontSize, lineHeight: best.lineHeight, lines: best.lines, fits: best.fits, valid: best.fits, padX: padX, padY: padY, maxTextW: maxTextW, maxTextH: maxTextH };
  }

  function canChunkNoteTextFitMinReadable(note, width, height) {
    var result = buildChunkNoteLayout(note, width, height);
    return result.valid;
  }

  function makeSelectionNoteBaseId(chunkRef, startGlobal, endGlobal) {
    return chunkRef + '::' + startGlobal + '-' + endGlobal;
  }

  function makeSelectionNoteId(chunkRef, startGlobal, endGlobal) {
    return makeSelectionNoteBaseId(chunkRef, startGlobal, endGlobal) + '::' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  // === App.js state-dependent functions (accept state as params) ===

  function buildChunkNotesSnapshot(currentAudioKey, chunkNotesMap) {
    var notes = Object.values(chunkNotesMap).sort(function (a, b) { return (a.chunkIdx - b.chunkIdx) || (a.startGlobal - b.startGlobal); });
    return { version: 1, audioKey: currentAudioKey || 'default-audio', updatedAt: Date.now(), notes: notes };
  }

  function saveChunkNotesDebounced(timerObj, saveToDB, storageKeyFn, currentAudioKey, chunkNotesMap) {
    if (timerObj.timer) clearTimeout(timerObj.timer);
    timerObj.timer = setTimeout(function () {
      saveToDB(storageKeyFn ? storageKeyFn() : 'chunkNotes', buildChunkNotesSnapshot(currentAudioKey, chunkNotesMap));
    }, 180);
  }

  window.__chunkNoteLayout = {
    findNearestChunkWord: findNearestChunkWord,
    getChunkNoteMeasureFont: getChunkNoteMeasureFont,
    measureChunkNoteTextBox: measureChunkNoteTextBox,
    applyChunkNoteAutoSize: applyChunkNoteAutoSize,
    getChunkRef: getChunkRef,
    getChunkNoteBaseFontSize: getChunkNoteBaseFontSize,
    getChunkNoteMinReadableFontSize: getChunkNoteMinReadableFontSize,
    sanitizeChunkNoteFontSize: sanitizeChunkNoteFontSize,
    getChunkNoteLayoutContext: getChunkNoteLayoutContext,
    buildChunkNoteLayout: buildChunkNoteLayout,
    canChunkNoteTextFitMinReadable: canChunkNoteTextFitMinReadable,
    makeSelectionNoteBaseId: makeSelectionNoteBaseId,
    makeSelectionNoteId: makeSelectionNoteId,
    buildChunkNotesSnapshot: buildChunkNotesSnapshot,
    saveChunkNotesDebounced: saveChunkNotesDebounced
  };
