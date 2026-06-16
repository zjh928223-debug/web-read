  // === Chunk-note persistence lifecycle ===
  function initChunkNotes(deps) {
    var ns = deps.state;          // { chunkNotesMap, chunkNoteVisible, activeChunkNoteId, chunkNoteSaveTimer, pendingChunkSelectionCtx }
    var loadFromDB = deps.loadFromDB;
    var saveToDB = deps.saveToDB;
    var getChunkNotesStorageKey = deps.getChunkNotesStorageKey;
    var sanitizeChunkNoteFontSize = deps.sanitizeChunkNoteFontSize;
    var getIsChunkMode = deps.getIsChunkMode;
    var chunkNoteCtxMenuEl = deps.chunkNoteCtxMenuEl;
    var getChunkNoteDraftStorageKey = deps.getChunkNoteDraftStorageKey;
    var mainAppArea = deps.mainAppArea || null;
    var chunkNoteSvgLayer = deps.chunkNoteSvgLayer || null;
    var chunkNoteLayer = deps.chunkNoteLayer || null;
    var getChunkNoteMeasureFont = typeof deps.getChunkNoteMeasureFont === 'function' ? deps.getChunkNoteMeasureFont : function () { return 'sans-serif'; };
    var measureChunkNoteTextBox = typeof deps.measureChunkNoteTextBox === 'function' ? deps.measureChunkNoteTextBox : function () { return { width: 140, height: 44 }; };
    var applyChunkNoteAutoSize = typeof deps.applyChunkNoteAutoSize === 'function' ? deps.applyChunkNoteAutoSize : function () {};
    var buildChunkNoteLayout = typeof deps.buildChunkNoteLayout === 'function' ? deps.buildChunkNoteLayout : function (note, width, height) {
      return {
        fontSize: sanitizeChunkNoteFontSize(note && note.fontSize),
        lineHeight: Math.max(12, sanitizeChunkNoteFontSize(note && note.fontSize) * 1.3),
        lines: [String((note && note.note) || '')],
        padX: 6,
        padY: 4,
        maxTextW: Math.max(1, Number(width) || 1),
        maxTextH: Math.max(1, Number(height) || 1)
      };
    };
    var canChunkNoteTextFitMinReadable = typeof deps.canChunkNoteTextFitMinReadable === 'function' ? deps.canChunkNoteTextFitMinReadable : function () { return true; };
    var makeSelectionNoteBaseId = deps.makeSelectionNoteBaseId;
    var makeSelectionNoteId = deps.makeSelectionNoteId;
    var getHasAiChunkData = typeof deps.getHasAiChunkData === 'function' ? deps.getHasAiChunkData : function () { return true; };
    var saveOpenChunkNotePopover = typeof deps.saveOpenChunkNotePopover === 'function' ? deps.saveOpenChunkNotePopover : function () {};
    var findNearestChunkWord = typeof deps.findNearestChunkWord === 'function' ? deps.findNearestChunkWord : function () { return null; };
    var now = typeof deps.now === 'function' ? deps.now : function () { return Date.now(); };
    var fallbackFileState = { handle: null, audioKey: '', fileName: '' };
    var chunkNoteDraftSaveTimer = null;
    var chunkNoteDeleteDialogEl = null;
    var notePopoverCtx = null;
    var chunkNoteModalEl = null;
    var chunkNoteModalInputEl = null;
    var chunkNoteModalDragging = false;
    var chunkNoteModalResizing = false;
    var chunkNoteConnectorRaf = 0;
    var chunkNoteLayoutRaf = 0;
    var chunkNoteDraftRestoreDone = false;

    function getChunkNotesMap() {
      if (!ns.chunkNotesMap || typeof ns.chunkNotesMap !== 'object') ns.chunkNotesMap = {};
      return ns.chunkNotesMap;
    }

    function replaceChunkNotesMap(nextMap) {
      ns.chunkNotesMap = nextMap && typeof nextMap === 'object' ? nextMap : {};
      return ns.chunkNotesMap;
    }

    function listChunkNotes() {
      return Object.values(getChunkNotesMap()).sort(function (a, b) {
        return (Number(a && a.chunkIdx) - Number(b && b.chunkIdx)) || (Number(a && a.startGlobal) - Number(b && b.startGlobal));
      });
    }

    function getChunkNote(noteId) {
      return getChunkNotesMap()[String(noteId || '')] || null;
    }

    function getChunkNotesForRef(chunkRef) {
      var ref = String(chunkRef || '');
      return Object.values(getChunkNotesMap())
        .filter(function (n) { return n && String(n.chunkRef || '') === ref; })
        .sort(function (a, b) { return (Number(a.startGlobal) - Number(b.startGlobal)) || (Number(a.endGlobal) - Number(b.endGlobal)); });
    }

    function getChunkNotesForBlockRefs(refs) {
      var refSet = new Set((refs || []).map(function (ref) { return String(ref || ''); }).filter(Boolean));
      if (!refSet.size) return [];
      return Object.values(getChunkNotesMap())
        .filter(function (note) { return note && refSet.has(String(note.chunkRef || '')); })
        .sort(function (a, b) { return (Number(a.startGlobal) - Number(b.startGlobal)) || (Number(a.endGlobal) - Number(b.endGlobal)); });
    }

    function getChunkNoteTagById(noteId) {
      return document.getElementById('chunk-note-tag-' + String(noteId || ''));
    }

    function setSelectedChunkNote(noteId) {
      ns.selectedChunkNoteId = String(noteId || '');
      document.querySelectorAll('.chunk-note-tag.selected').forEach(function (el) {
        el.classList.remove('selected');
      });
      if (!ns.selectedChunkNoteId) return '';
      var tag = getChunkNoteTagById(ns.selectedChunkNoteId);
      if (tag) tag.classList.add('selected');
      return ns.selectedChunkNoteId;
    }

    function getSelectedChunkNoteId() {
      return String(ns.selectedChunkNoteId || '');
    }

    function getActiveChunkNoteId() {
      return String(ns.activeChunkNoteId || '');
    }

    function closeChunkNoteDeleteDialog() {
      if (chunkNoteDeleteDialogEl) {
        chunkNoteDeleteDialogEl.remove();
        chunkNoteDeleteDialogEl = null;
      }
    }

    function getChunkNoteDeleteDialogEl() {
      return chunkNoteDeleteDialogEl;
    }

    function openChunkNoteDeleteDialog(noteId) {
      var note = getChunkNote(noteId);
      var tag = getChunkNoteTagById(String(noteId || ''));
      if (!note || !tag) return;
      closeChunkNoteDeleteDialog();
      var dialog = document.createElement('div');
      dialog.className = 'chunk-note-delete-dialog';
      dialog.innerHTML = [
        '<div class="chunk-note-delete-title">确认删除这个备注？</div>',
        '<div class="chunk-note-delete-actions">',
        '<button type="button" class="chunk-note-delete-btn danger">删除</button>',
        '<button type="button" class="chunk-note-delete-btn">取消</button>',
        '</div>'
      ].join('');
      document.body.appendChild(dialog);
      chunkNoteDeleteDialogEl = dialog;
      var rect = tag.getBoundingClientRect();
      dialog.style.left = Math.max(12, Math.min(window.innerWidth - 240, rect.left)) + 'px';
      dialog.style.top = Math.max(12, rect.bottom + 10) + 'px';
      var title = dialog.querySelector('.chunk-note-delete-title');
      if (title) {
        title.addEventListener('mousedown', function (e) {
          e.preventDefault();
          var sx = e.clientX;
          var sy = e.clientY;
          var dl = parseFloat(dialog.style.left) || 0;
          var dt = parseFloat(dialog.style.top) || 0;
          var move = function (ev) {
            dialog.style.left = (dl + ev.clientX - sx) + 'px';
            dialog.style.top = (dt + ev.clientY - sy) + 'px';
          };
          var up = function () {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
          };
          document.addEventListener('mousemove', move);
          document.addEventListener('mouseup', up);
        });
      }
      var buttons = dialog.querySelectorAll('.chunk-note-delete-btn');
      var delBtn = buttons[0];
      var cancelBtn = buttons[1];
      if (delBtn) delBtn.addEventListener('click', function () {
        deleteChunkNote(note.id);
        closeChunkNoteDeleteDialog();
        setSelectedChunkNote('');
        saveChunkNotesDebounced();
        refreshChunkNoteForChunkRef(note.chunkRef);
      });
      if (cancelBtn) cancelBtn.addEventListener('click', function () {
        closeChunkNoteDeleteDialog();
      });
    }

    function deleteChunkNote(noteId) {
      var id = String(noteId || '');
      if (!id || !getChunkNotesMap()[id]) return null;
      var note = getChunkNotesMap()[id];
      delete getChunkNotesMap()[id];
      return note;
    }

    function makeBaseId(chunkRef, startGlobal, endGlobal) {
      if (typeof makeSelectionNoteBaseId === 'function') {
        return makeSelectionNoteBaseId(chunkRef, startGlobal, endGlobal);
      }
      return String(chunkRef || '') + '::' + startGlobal + '-' + endGlobal;
    }

    function makeNoteId(chunkRef, startGlobal, endGlobal) {
      if (typeof makeSelectionNoteId === 'function') {
        return makeSelectionNoteId(chunkRef, startGlobal, endGlobal);
      }
      return makeBaseId(chunkRef, startGlobal, endGlobal) + '::' + now().toString(36);
    }

    function normalizeLoadedChunkNoteRecord(n) {
      if (!n || typeof n !== 'object') return null;
      if (!n.id || !n.chunkRef) return null;
      return Object.assign({}, n, {
        coordSpace: typeof n.coordSpace === 'string' ? n.coordSpace : undefined,
        x: Number.isFinite(Number(n.x)) ? Number(n.x) : undefined,
        y: Number.isFinite(Number(n.y)) ? Number(n.y) : undefined,
        offsetX: Number.isFinite(Number(n.offsetX)) ? Number(n.offsetX) : undefined,
        offsetY: Number.isFinite(Number(n.offsetY)) ? Number(n.offsetY) : undefined,
        w: Number.isFinite(Number(n.w)) ? Number(n.w) : undefined,
        h: Number.isFinite(Number(n.h)) ? Number(n.h) : undefined,
        fontSize: sanitizeChunkNoteFontSize(n.fontSize)
      });
    }

    function normalizeImportedChunkNoteRecord(n) {
      if (!n || typeof n !== 'object') return null;
      var chunkRef = String(n.chunkRef || '');
      var startGlobal = Number(n.startGlobal);
      var endGlobal = Number(n.endGlobal);
      var note = String(n.note || '').trim();
      var selectedText = String(n.selectedText || '').trim();
      if (!chunkRef || !Number.isFinite(startGlobal) || !Number.isFinite(endGlobal) || !note) return null;
      var id = String(n.id || makeBaseId(chunkRef, startGlobal, endGlobal));
      return {
        id: id,
        chunkRef: chunkRef,
        chunkIdx: Number.isFinite(Number(n.chunkIdx)) ? Number(n.chunkIdx) : -1,
        startGlobal: startGlobal,
        endGlobal: endGlobal,
        selectedText: selectedText,
        note: note,
        coordSpace: typeof n.coordSpace === 'string' ? n.coordSpace : undefined,
        x: Number.isFinite(Number(n.x)) ? Number(n.x) : undefined,
        y: Number.isFinite(Number(n.y)) ? Number(n.y) : undefined,
        offsetX: Number.isFinite(Number(n.offsetX)) ? Number(n.offsetX) : undefined,
        offsetY: Number.isFinite(Number(n.offsetY)) ? Number(n.offsetY) : undefined,
        w: Number.isFinite(Number(n.w)) ? Number(n.w) : undefined,
        h: Number.isFinite(Number(n.h)) ? Number(n.h) : undefined,
        autoSize: n.autoSize !== false,
        fontSize: sanitizeChunkNoteFontSize(n.fontSize),
        color: (typeof n.color === 'string' && n.color.trim()) ? n.color.trim() : undefined,
        updatedAt: Number.isFinite(Number(n.updatedAt)) ? Number(n.updatedAt) : now()
      };
    }

    function applyImportedChunkNotes(data) {
      var arr = Array.isArray(data) ? data : (data && Array.isArray(data.notes) ? data.notes : null);
      if (!arr) throw new Error('invalid chunk notes json');
      var next = {};
      arr.forEach(function (n) {
        var normalized = normalizeImportedChunkNoteRecord(n);
        if (normalized) next[normalized.id] = normalized;
      });
      replaceChunkNotesMap(next);
      return next;
    }

    function upsertChunkNote(ctx, noteText, layoutContext) {
      if (!ctx || typeof ctx !== 'object') return '';
      var text = String(noteText || '').trim();
      var noteId = String(ctx.noteId || makeNoteId(ctx.chunkRef, ctx.startGlobal, ctx.endGlobal));
      if (!text) {
        deleteChunkNote(noteId);
        return '';
      }
      var existing = getChunkNote(noteId);
      var next = {
        id: noteId,
        chunkRef: ctx.chunkRef,
        chunkIdx: ctx.chunkIdx,
        startGlobal: ctx.startGlobal,
        endGlobal: ctx.endGlobal,
        selectedText: ctx.selectedText || '',
        note: text,
        autoSize: existing ? existing.autoSize !== false : true,
        updatedAt: now()
      };
      if (existing) {
        next.coordSpace = existing.coordSpace === 'main' ? 'main' : existing.coordSpace;
        if (Number.isFinite(Number(existing.x))) next.x = Number(existing.x);
        if (Number.isFinite(Number(existing.y))) next.y = Number(existing.y);
        if (Number.isFinite(Number(existing.offsetX))) next.offsetX = Number(existing.offsetX);
        if (Number.isFinite(Number(existing.offsetY))) next.offsetY = Number(existing.offsetY);
        if (Number.isFinite(Number(existing.w))) next.w = Number(existing.w);
        if (Number.isFinite(Number(existing.h))) next.h = Number(existing.h);
        if (Number.isFinite(Number(existing.fontSize))) next.fontSize = Number(existing.fontSize);
        if (typeof existing.color === 'string' && existing.color) next.color = existing.color;
      } else if (layoutContext && layoutContext.anchorRect) {
        var minW = Number.isFinite(Number(layoutContext.minW)) ? Number(layoutContext.minW) : 40;
        var minH = Number.isFinite(Number(layoutContext.minH)) ? Number(layoutContext.minH) : 18;
        var margin = Number.isFinite(Number(layoutContext.margin)) ? Number(layoutContext.margin) : 12;
        var areaW = Number.isFinite(Number(layoutContext.areaW)) ? Number(layoutContext.areaW) : (typeof window !== 'undefined' ? window.innerWidth : minW + margin * 2);
        var areaH = Number.isFinite(Number(layoutContext.areaH)) ? Number(layoutContext.areaH) : (typeof window !== 'undefined' ? window.innerHeight : minH + margin * 2);
        var anchorRect = layoutContext.anchorRect;
        next.x = Math.min(areaW - minW - margin, Math.max(margin, Number(anchorRect.right) + 24));
        next.y = Math.min(areaH - minH - margin, Math.max(margin, Number(anchorRect.top) - 6));
        next.offsetX = next.x - Number(anchorRect.left);
        next.offsetY = next.y - Number(anchorRect.top);
        next.coordSpace = 'main';
      }
      var autoSize = layoutContext && typeof layoutContext.autoSize === 'function'
        ? layoutContext.autoSize
        : deps.applyChunkNoteAutoSize;
      if (typeof autoSize === 'function') autoSize(next);
      getChunkNotesMap()[noteId] = next;
      return noteId;
    }

    function getChunkNotesFileState() {
      var source = typeof deps.getChunkNotesFileState === 'function' ? deps.getChunkNotesFileState() : fallbackFileState;
      source = source && typeof source === 'object' ? source : {};
      return {
        handle: source.handle || source.chunkNotesFileHandle || null,
        audioKey: String(source.audioKey || source.chunkNotesFileHandleAudioKey || ''),
        fileName: String(source.fileName || source.chunkNotesFileName || '')
      };
    }

    function setChunkNotesFileState(next) {
      var current = getChunkNotesFileState();
      var merged = {
        handle: Object.prototype.hasOwnProperty.call(next || {}, 'handle') ? next.handle : current.handle,
        audioKey: Object.prototype.hasOwnProperty.call(next || {}, 'audioKey') ? String(next.audioKey || '') : current.audioKey,
        fileName: Object.prototype.hasOwnProperty.call(next || {}, 'fileName') ? String(next.fileName || '') : current.fileName
      };
      if (typeof deps.setChunkNotesFileState === 'function') deps.setChunkNotesFileState(merged);
      else fallbackFileState = merged;
      return merged;
    }

    function clearChunkNotesFileState() {
      return setChunkNotesFileState({ handle: null, audioKey: '', fileName: '' });
    }

    function getDraftStorageKey() {
      return typeof getChunkNoteDraftStorageKey === 'function' ? getChunkNoteDraftStorageKey() : 'chunkNoteDraft';
    }

    function clearChunkNoteDraft() {
      try {
        localStorage.removeItem(getDraftStorageKey());
      } catch (err) {}
    }

    function buildChunkNoteDraftPayload(ctx, text, modalRect) {
      return {
        version: 1,
        audioKey: deps.currentAudioKeyGetter ? deps.currentAudioKeyGetter() : 'default-audio',
        updatedAt: now(),
        ctx: {
          noteId: String(ctx && ctx.noteId || ''),
          chunkRef: String(ctx && ctx.chunkRef || ''),
          chunkIdx: Number(ctx && ctx.chunkIdx || -1),
          startGlobal: Number(ctx && ctx.startGlobal),
          endGlobal: Number(ctx && ctx.endGlobal),
          selectedText: String(ctx && ctx.selectedText || '')
        },
        text: String(text || ''),
        modal: modalRect ? {
          left: Number(modalRect.left),
          top: Number(modalRect.top),
          width: Number(modalRect.width),
          height: Number(modalRect.height)
        } : null
      };
    }

    function persistChunkNoteDraft(ctx, text, modalRect, immediate) {
      var body = String(text || '');
      if (!body.trim()) {
        clearChunkNoteDraft();
        return;
      }
      var payload = buildChunkNoteDraftPayload(ctx, body, modalRect);
      function write() {
        try {
          localStorage.setItem(getDraftStorageKey(), JSON.stringify(payload));
        } catch (err) {}
      }
      if (immediate) write();
      else {
        if (chunkNoteDraftSaveTimer) clearTimeout(chunkNoteDraftSaveTimer);
        chunkNoteDraftSaveTimer = setTimeout(write, 120);
      }
    }

    function cancelChunkNoteDraftSaveTimer() {
      if (chunkNoteDraftSaveTimer) {
        clearTimeout(chunkNoteDraftSaveTimer);
        chunkNoteDraftSaveTimer = null;
      }
    }

    function readChunkNoteDraft() {
      var raw = null;
      try {
        raw = localStorage.getItem(getDraftStorageKey());
      } catch (err) {}
      if (!raw) return null;
      try {
        var parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        return parsed;
      } catch (err) {
        clearChunkNoteDraft();
        return null;
      }
    }

    function buildChunkNotesSnapshot() {
      return {
        version: 1,
        audioKey: deps.currentAudioKeyGetter ? deps.currentAudioKeyGetter() : 'default-audio',
        updatedAt: Date.now(),
        notes: listChunkNotes()
      };
    }

    function saveChunkNotesDebounced() {
      if (ns.chunkNoteSaveTimer) clearTimeout(ns.chunkNoteSaveTimer);
      ns.chunkNoteSaveTimer = setTimeout(function () {
        saveToDB(getChunkNotesStorageKey(), buildChunkNotesSnapshot());
      }, 180);
    }

    function saveChunkNotesNow() {
      if (ns.chunkNoteSaveTimer) {
        clearTimeout(ns.chunkNoteSaveTimer);
        ns.chunkNoteSaveTimer = null;
      }
      return saveToDB(getChunkNotesStorageKey(), buildChunkNotesSnapshot());
    }

    async function loadChunkNotesForCurrentAudio() {
      var data = await loadFromDB(getChunkNotesStorageKey());
      if (data && Array.isArray(data.notes)) {
        var next = {};
        data.notes.forEach(function (n) {
          var normalized = normalizeLoadedChunkNoteRecord(n);
          if (normalized) next[normalized.id] = normalized;
        });
        replaceChunkNotesMap(next);
      } else {
        replaceChunkNotesMap({});
      }
    }

    function setChunkNoteVisible(next, persist) {
      if (persist === undefined) persist = true;
      ns.chunkNoteVisible = !!next;
      document.body.classList.toggle('hide-chunk-note', !ns.chunkNoteVisible);
      if (!ns.chunkNoteVisible) {
        closeChunkNoteContextMenu();
        closeChunkNotePopover();
        clearChunkNoteConnectors();
      } else if (getIsChunkMode()) {
        ensureChunkNoteOverlayLayers();
        if (!document.querySelector('.chunk-note-tag')) {
          renderAllChunkNoteTags();
        }
        scheduleChunkNoteLayoutRefresh();
      }
      if (persist) localStorage.setItem('chunkNoteVisible', ns.chunkNoteVisible ? 'true' : 'false');
      scheduleChunkNoteConnectorRedraw();
    }

    function getChunkBlockByRef(chunkRef) {
      var blocks = document.querySelectorAll('.chunk-block');
      for (var i = 0; i < blocks.length; i++) {
        if ((blocks[i].dataset.chunkRef || '') === chunkRef || (blocks[i].dataset.legacyChunkRef || '') === chunkRef) return blocks[i];
      }
      return null;
    }

    function clearChunkNoteConnectors() {
      if (chunkNoteSvgLayer) chunkNoteSvgLayer.innerHTML = '';
    }

    function getChunkWordSpan(note) {
      if (!note || !note.chunkRef || !Number.isFinite(Number(note.startGlobal))) return null;
      var direct = document.getElementById('word-' + Number(note.startGlobal));
      if (direct && direct.closest && direct.closest('.chunk-block')) return direct;
      var block = getChunkBlockByRef(note.chunkRef);
      if (!block) return null;
      var enDiv = block.querySelector('.chunk-en');
      if (!enDiv) return null;
      return enDiv.querySelector('#word-' + Number(note.startGlobal));
    }

    function ensureChunkNoteOverlayLayers() {
      if (!mainAppArea) return;
      if (chunkNoteSvgLayer && chunkNoteSvgLayer.parentElement !== mainAppArea) {
        mainAppArea.appendChild(chunkNoteSvgLayer);
      }
      if (!chunkNoteLayer) {
        chunkNoteLayer = document.createElement('div');
        chunkNoteLayer.id = 'chunk-note-layer';
      }
      if (chunkNoteLayer.parentElement !== mainAppArea) {
        mainAppArea.appendChild(chunkNoteLayer);
      }
      if (chunkNoteSvgLayer && chunkNoteLayer && chunkNoteSvgLayer.nextSibling !== chunkNoteLayer) {
        mainAppArea.insertBefore(chunkNoteSvgLayer, chunkNoteLayer);
      }
      syncChunkNoteOverlaySize();
    }

    function rectToMainAreaSpace(rect) {
      if (!mainAppArea) {
        return {
          left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
          width: rect.width, height: rect.height
        };
      }
      var mainRect = mainAppArea.getBoundingClientRect();
      return {
        left: rect.left - mainRect.left + mainAppArea.scrollLeft,
        top: rect.top - mainRect.top + mainAppArea.scrollTop,
        right: rect.right - mainRect.left + mainAppArea.scrollLeft,
        bottom: rect.bottom - mainRect.top + mainAppArea.scrollTop,
        width: rect.width,
        height: rect.height
      };
    }

    function pointToMainAreaSpace(clientX, clientY) {
      if (!mainAppArea) return { x: clientX, y: clientY };
      var mainRect = mainAppArea.getBoundingClientRect();
      return {
        x: clientX - mainRect.left + mainAppArea.scrollLeft,
        y: clientY - mainRect.top + mainAppArea.scrollTop
      };
    }

    function syncChunkNoteOverlaySize() {
      if (!mainAppArea) return;
      var w = Math.max(mainAppArea.clientWidth, mainAppArea.scrollWidth);
      var h = Math.max(mainAppArea.clientHeight, mainAppArea.scrollHeight);
      if (chunkNoteLayer) {
        chunkNoteLayer.style.width = w + 'px';
        chunkNoteLayer.style.height = h + 'px';
      }
      if (chunkNoteSvgLayer) {
        chunkNoteSvgLayer.style.width = w + 'px';
        chunkNoteSvgLayer.style.height = h + 'px';
        chunkNoteSvgLayer.setAttribute('width', String(w));
        chunkNoteSvgLayer.setAttribute('height', String(h));
      }
    }

    function persistCurrentChunkNoteDraft(immediate) {
      if (!notePopoverCtx || !chunkNoteModalInputEl) return;
      var modalRect = chunkNoteModalEl ? chunkNoteModalEl.getBoundingClientRect() : null;
      return persistChunkNoteDraft(notePopoverCtx, chunkNoteModalInputEl.value || '', modalRect, immediate);
    }

    function getRangeAnchorRectByGlobals(chunkRef, startGlobal, endGlobal) {
      var startSpan = document.getElementById('word-' + startGlobal);
      var endSpan = document.getElementById('word-' + endGlobal);
      if (!startSpan || !endSpan) return null;
      var a = startSpan.getBoundingClientRect();
      var b = endSpan.getBoundingClientRect();
      var left = Math.min(a.left, b.left);
      var top = Math.min(a.top, b.top);
      var right = Math.max(a.right, b.right);
      var bottom = Math.max(a.bottom, b.bottom);
      return {
        left: left, top: top, right: right, bottom: bottom,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top)
      };
    }

    function setChunkNoteDraftRestoreDone(next) {
      chunkNoteDraftRestoreDone = !!next;
    }

    function tryRestoreChunkNoteDraft() {
      if (chunkNoteDraftRestoreDone) return;
      if (!getIsChunkMode() || !getHasAiChunkData()) return;
      chunkNoteDraftRestoreDone = true;
      var parsed = readChunkNoteDraft();
      if (!parsed || typeof parsed !== 'object' || !parsed.ctx) return;
      var ctxRaw = parsed.ctx || {};
      var chunkRef = String(ctxRaw.chunkRef || '');
      var noteId = String(ctxRaw.noteId || '');
      var startGlobal = Number(ctxRaw.startGlobal);
      var endGlobal = Number(ctxRaw.endGlobal);
      if (!chunkRef || !Number.isFinite(startGlobal) || !Number.isFinite(endGlobal)) {
        clearChunkNoteDraft();
        return;
      }
      var anchorRect = getRangeAnchorRectByGlobals(chunkRef, startGlobal, endGlobal);
      if (!anchorRect) return;
      if (!noteId) noteId = makeBaseId(chunkRef, startGlobal, endGlobal);
      var existing = getChunkNote(noteId);
      var block = getChunkBlockByRef(chunkRef);
      var enDiv = block ? block.querySelector('.chunk-en') : null;
      var selectedText = String(ctxRaw.selectedText || '');
      if (!selectedText && enDiv) {
        var arr = [];
        for (var i = startGlobal; i <= endGlobal; i++) {
          var span = enDiv.querySelector('#word-' + i);
          if (span && span.textContent) arr.push(span.textContent.trim());
        }
        selectedText = arr.join(' ').replace(/\s+/g, ' ').trim();
      }
      var ctx = {
        chunkRef: chunkRef,
        noteId: noteId,
        chunkIdx: Number(block ? (block.dataset.chunkIdx || -1) : (ctxRaw.chunkIdx || -1)),
        startGlobal: startGlobal,
        endGlobal: endGlobal,
        selectedText: selectedText,
        initialNote: String(parsed.text || (existing && existing.note) || ''),
        noteExists: !!existing,
        anchorRect: anchorRect
      };
      openChunkNotePopover(ctx);
      if (chunkNoteModalInputEl) {
        chunkNoteModalInputEl.value = String(parsed.text || '');
        chunkNoteModalInputEl.focus();
        chunkNoteModalInputEl.setSelectionRange(chunkNoteModalInputEl.value.length, chunkNoteModalInputEl.value.length);
      }
      if (chunkNoteModalEl && parsed.modal && typeof parsed.modal === 'object') {
        var left = Number(parsed.modal.left);
        var top = Number(parsed.modal.top);
        var width = Number(parsed.modal.width);
        var height = Number(parsed.modal.height);
        if (Number.isFinite(left) && Number.isFinite(top)) {
          chunkNoteModalEl.style.left = left + 'px';
          chunkNoteModalEl.style.top = top + 'px';
        }
        if (Number.isFinite(width) && width >= 120) chunkNoteModalEl.style.width = width + 'px';
        if (Number.isFinite(height) && height >= 40) chunkNoteModalEl.style.height = height + 'px';
      }
    }

    function getChunkNoteLayoutBase() {
      var minW = 40;
      var preferredW = Math.max(minW, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chunk-note-width')) || 260);
      var minH = Math.max(18, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chunk-note-min-height')) || 18);
      var margin = 12;
      return { minW: minW, preferredW: preferredW, minH: minH, margin: margin };
    }

    function getChunkNoteContentBoxSize(tag) {
      if (!tag) return null;
      var styles = getComputedStyle(tag);
      var width = parseFloat(styles.width);
      var height = parseFloat(styles.height);
      if (Number.isFinite(width) && Number.isFinite(height)) {
        return { width: width, height: height };
      }
      var rect = tag.getBoundingClientRect();
      var paddingX = (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0);
      var paddingY = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
      var borderX = (parseFloat(styles.borderLeftWidth) || 0) + (parseFloat(styles.borderRightWidth) || 0);
      var borderY = (parseFloat(styles.borderTopWidth) || 0) + (parseFloat(styles.borderBottomWidth) || 0);
      return {
        width: Math.max(0, rect.width - paddingX - borderX),
        height: Math.max(0, rect.height - paddingY - borderY)
      };
    }

    function ensureChunkNoteLayout(note, sourceRect, tagRect) {
      var base = getChunkNoteLayoutBase();
      var minW = base.minW;
      var preferredW = base.preferredW;
      var minH = base.minH;
      var margin = base.margin;
      var areaW = mainAppArea ? Math.max(mainAppArea.clientWidth, mainAppArea.scrollWidth) : window.innerWidth;
      var areaH = mainAppArea ? Math.max(mainAppArea.clientHeight, mainAppArea.scrollHeight) : window.innerHeight;
      if (Number.isFinite(Number(note.w)) && Number(note.w) < minW) note.w = minW;
      if (Number.isFinite(Number(note.h)) && (Math.abs(Number(note.h) - 44) < 0.1 || Math.abs(Number(note.h) - 40) < 0.1 || Math.abs(Number(note.h) - 36) < 0.1)) {
        note.h = minH;
      }
      if (Number.isFinite(Number(note.h)) && Number(note.h) < minH) note.h = minH;
      var currentW = tagRect && Number.isFinite(tagRect.width) && tagRect.width > 0
        ? tagRect.width
        : (Number.isFinite(Number(note.w)) ? Number(note.w) : Math.min(preferredW, areaW - margin * 2));
      var currentH = tagRect && Number.isFinite(tagRect.height) && tagRect.height > 0
        ? tagRect.height
        : (Number.isFinite(Number(note.h)) ? Number(note.h) : minH);
      if (!Number.isFinite(Number(note.w))) note.w = currentW;
      if (!Number.isFinite(Number(note.h))) note.h = currentH;
      var defaultX = Math.min(areaW - currentW - margin, Math.max(margin, sourceRect.right + 20));
      var defaultY = Math.min(areaH - currentH - margin, Math.max(margin, sourceRect.top - 4));
      if (!Number.isFinite(Number(note.offsetX)) || !Number.isFinite(Number(note.offsetY))) {
        if (Number.isFinite(Number(note.x)) && Number.isFinite(Number(note.y))) {
          if (note.coordSpace !== 'main') {
            var legacyPos = pointToMainAreaSpace(Number(note.x), Number(note.y));
            note.x = legacyPos.x;
            note.y = legacyPos.y;
          }
          note.offsetX = Number(note.x) - sourceRect.left;
          note.offsetY = Number(note.y) - sourceRect.top;
        } else {
          note.offsetX = defaultX - sourceRect.left;
          note.offsetY = defaultY - sourceRect.top;
        }
      }
      var rawX = sourceRect.left + Number(note.offsetX);
      var rawY = sourceRect.top + Number(note.offsetY);
      var nextX = Math.max(margin, Math.min(rawX, areaW - currentW - margin));
      var nextY = Math.max(margin, Math.min(rawY, areaH - currentH - margin));
      note.x = nextX;
      note.y = nextY;
      note.offsetX = nextX - sourceRect.left;
      note.offsetY = nextY - sourceRect.top;
      note.coordSpace = 'main';
    }

    function syncChunkNoteTagToAnchor(note, tag) {
      if (!note || !tag) return;
      var source = getChunkWordSpan(note);
      if (!source) return;
      var sourceRect = rectToMainAreaSpace(source.getBoundingClientRect());
      var tagRect = rectToMainAreaSpace(tag.getBoundingClientRect());
      ensureChunkNoteLayout(note, sourceRect, tagRect);
      tag.style.left = note.x + 'px';
      tag.style.top = note.y + 'px';
    }

    function refreshChunkNoteTagPositions() {
      if (!getIsChunkMode() || !ns.chunkNoteVisible) return;
      ensureChunkNoteOverlayLayers();
      syncChunkNoteOverlaySize();
      listChunkNotes().forEach(function (note) {
        if (!note || !note.id) return;
        var tag = getChunkNoteTagById(note.id);
        if (!tag) return;
        syncChunkNoteTagToAnchor(note, tag);
      });
    }

    function scheduleChunkNoteLayoutRefresh() {
      if (chunkNoteLayoutRaf) return;
      chunkNoteLayoutRaf = requestAnimationFrame(function () {
        chunkNoteLayoutRaf = 0;
        refreshChunkNoteTagPositions();
        redrawAllChunkNoteConnectors();
      });
    }

    function applyChunkNoteTextStyle(textEl, note) {
      if (!textEl) return;
      var tag = textEl.closest('.chunk-note-tag');
      var color = (note && note.color) || getComputedStyle(document.documentElement).getPropertyValue('--chunk-note-color').trim() || '#4b5563';
      textEl.style.color = color;
      if (!tag) return;
      var layout = buildChunkNoteLayout(
        note || { note: textEl.textContent || '' },
        tag.offsetWidth || parseFloat(tag.style.width) || 0,
        tag.offsetHeight || parseFloat(tag.style.height) || 0
      );
      textEl.style.fontSize = layout.fontSize + 'px';
      textEl.style.lineHeight = layout.lineHeight + 'px';
    }

    function renderChunkNoteImage(tag, note) {
      if (!tag) return;
      var imgEl = tag.querySelector('.chunk-note-image');
      var textEl = tag.querySelector('.chunk-note-text');
      if (!imgEl || !textEl) return;
      if (tag.classList.contains('editing')) {
        tag.classList.remove('image-mode');
        imgEl.removeAttribute('src');
        return;
      }
      var w = Math.max(1, Math.round(tag.clientWidth || parseFloat(tag.style.width) || 1));
      var h = Math.max(1, Math.round(tag.clientHeight || parseFloat(tag.style.height) || 1));
      var text = String((note && note.note) || textEl.textContent || '').trim();
      if (!text) {
        imgEl.removeAttribute('src');
        tag.classList.remove('image-mode');
        return;
      }
      var dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      var ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);
      var color = (note && note.color) || getComputedStyle(document.documentElement).getPropertyValue('--chunk-note-color').trim() || '#4b5563';
      var layout = buildChunkNoteLayout(note || { note: text }, w, h);
      ctx.fillStyle = color;
      ctx.textBaseline = 'top';
      ctx.font = '500 ' + layout.fontSize + 'px ' + getChunkNoteMeasureFont();
      var maxLines = Math.max(1, Math.floor(layout.maxTextH / layout.lineHeight));
      var drawLines = layout.lines.slice(0, maxLines);
      var hasMore = layout.lines.length > maxLines;
      if (hasMore && drawLines.length > 0) {
        var lastLine = drawLines[drawLines.length - 1];
        while (lastLine && ctx.measureText(lastLine + '...').width > layout.maxTextW) {
          lastLine = lastLine.slice(0, -1);
        }
        drawLines[drawLines.length - 1] = lastLine ? lastLine + '...' : '...';
      }
      var usedH = drawLines.length * layout.lineHeight;
      var startY = Math.max(layout.padY, Math.floor((h - usedH) / 2));
      drawLines.forEach(function (ln, idx) {
        ctx.fillText(ln, layout.padX, startY + idx * layout.lineHeight, layout.maxTextW);
      });
      imgEl.src = canvas.toDataURL('image/png');
      tag.classList.add('image-mode');
    }

    function updateChunkNoteTagCompactState(tag) {
      if (!tag) return;
      var w = tag.offsetWidth || parseFloat(tag.style.width) || 0;
      var h = tag.offsetHeight || parseFloat(tag.style.height) || 0;
      tag.classList.toggle('compact', w < 82 || h < 32);
    }

    function makeChunkNoteTagDraggable(tag, note) {
      if (!tag) return;
      tag.addEventListener('mousedown', function (e) {
        if (e.target.closest('.chunk-note-resize-handle')) return;
        if (tag.classList.contains('editing') && !e.target.closest('.chunk-note-drag-handle')) return;
        var sx = e.clientX;
        var sy = e.clientY;
        var sl = parseFloat(tag.style.left) || 0;
        var st = parseFloat(tag.style.top) || 0;
        var dragging = false;
        var lastDx = 0;
        var lastDy = 0;
        var rafId = 0;
        var paintDrag = function () {
          rafId = 0;
          tag.style.transform = 'translate3d(' + lastDx + 'px, ' + lastDy + 'px, 0)';
          scheduleChunkNoteConnectorRedraw();
        };
        var move = function (ev) {
          var dx = ev.clientX - sx;
          var dy = ev.clientY - sy;
          if (!dragging && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
          dragging = true;
          document.body.style.userSelect = 'none';
          tag.classList.add('dragging');
          lastDx = dx;
          lastDy = dy;
          if (!rafId) rafId = requestAnimationFrame(paintDrag);
        };
        var up = function () {
          document.body.style.userSelect = '';
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = 0;
          }
          if (dragging) {
            var nx = sl + lastDx;
            var ny = st + lastDy;
            tag.style.transform = '';
            tag.style.left = nx + 'px';
            tag.style.top = ny + 'px';
            tag.classList.remove('dragging');
            updateChunkNoteTagCompactState(tag);
            note.x = nx;
            note.y = ny;
            note.coordSpace = 'main';
            var source = getChunkWordSpan(note);
            if (source) {
              var sr = rectToMainAreaSpace(source.getBoundingClientRect());
              note.offsetX = nx - sr.left;
              note.offsetY = ny - sr.top;
            }
            scheduleChunkNoteConnectorRedraw();
            saveChunkNotesDebounced();
          } else {
            tag.classList.remove('dragging');
          }
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });
    }

    function makeChunkNoteTagResizable(tag, note) {
      if (!tag) return;
      var handle = tag.querySelector('.chunk-note-resize-handle');
      if (!handle) return;
      handle.addEventListener('mousedown', function (e) {
        e.preventDefault();
        e.stopPropagation();
        document.body.style.userSelect = 'none';
        var sx = e.clientX;
        var sy = e.clientY;
        var rect = tag.getBoundingClientRect();
        var sw = rect.width;
        var sh = rect.height;
        var baseLayout = getChunkNoteLayoutBase();
        var baseMinW = Math.max(44, baseLayout.minW || 40);
        var baseMinH = Math.max(20, baseLayout.minH || 18);
        var lastValidW = sw;
        var lastValidH = sh;
        var pendingW = sw;
        var pendingH = sh;
        var rafId = 0;
        var wasImageMode = tag.classList.contains('image-mode');
        if (wasImageMode) tag.classList.remove('image-mode');
        var paintResize = function () {
          rafId = 0;
          var candidateW = Math.max(baseMinW, pendingW);
          var candidateH = Math.max(baseMinH, pendingH);
          if (canChunkNoteTextFitMinReadable(note, candidateW, candidateH)) {
            lastValidW = candidateW;
            lastValidH = candidateH;
          }
          tag.style.width = lastValidW + 'px';
          tag.style.height = lastValidH + 'px';
          updateChunkNoteTagCompactState(tag);
          var textEl = tag.querySelector('.chunk-note-text');
          if (textEl && !tag.classList.contains('editing')) {
            applyChunkNoteTextStyle(textEl, note);
          }
          scheduleChunkNoteConnectorRedraw();
        };
        var move = function (ev) {
          pendingW = Math.max(baseMinW, sw + ev.clientX - sx);
          pendingH = Math.max(baseMinH, sh + ev.clientY - sy);
          if (!rafId) rafId = requestAnimationFrame(paintResize);
        };
        var up = function () {
          document.body.style.userSelect = '';
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = 0;
          }
          note.w = Math.max(baseMinW, lastValidW);
          note.h = Math.max(baseMinH, lastValidH);
          note.autoSize = false;
          tag.style.width = note.w + 'px';
          tag.style.height = note.h + 'px';
          var textEl = tag.querySelector('.chunk-note-text');
          if (textEl && !tag.classList.contains('editing')) applyChunkNoteTextStyle(textEl, note);
          if (!tag.classList.contains('editing')) {
            if (wasImageMode) tag.classList.add('image-mode');
            renderChunkNoteImage(tag, note);
          }
          scheduleChunkNoteConnectorRedraw();
          saveChunkNotesDebounced();
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });
    }

    function enableChunkNoteInlineEdit(tag, note) {
      if (!tag) return;
      var textEl = tag.querySelector('.chunk-note-text');
      var dragHandle = tag.querySelector('.chunk-note-drag-handle');
      if (!textEl) return;
      tag.addEventListener('dblclick', function (e) {
        if (e.target.closest('.chunk-note-resize-handle')) return;
        var originalText = String(note.note || '').trim();
        var rect = tag.getBoundingClientRect();
        if (!Number.isFinite(Number(note.w))) note.w = Math.max(40, Math.round(rect.width));
        if (!Number.isFinite(Number(note.h))) note.h = Math.max(18, Math.round(rect.height));
        var savedW = Math.max(40, Number(note.w) || Math.round(rect.width));
        var savedH = Math.max(18, Number(note.h) || Math.round(rect.height));
        tag.style.width = savedW + 'px';
        tag.style.height = savedH + 'px';
        updateChunkNoteTagCompactState(tag);
        tag.classList.add('editing');
        tag.classList.remove('image-mode');
        textEl.contentEditable = 'true';
        applyChunkNoteTextStyle(textEl, note);
        textEl.focus();
        var range = document.createRange();
        range.selectNodeContents(textEl);
        var sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
        var finish = function (cancel) {
          if (!tag.classList.contains('editing')) return;
          if (cancel) textEl.textContent = note.note || '';
          else {
            var nextText = (textEl.textContent || '').trim();
            if (!nextText) {
              deleteChunkNote(note.id);
              saveChunkNotesDebounced();
              refreshChunkNoteForChunkRef(note.chunkRef);
              textEl.contentEditable = 'false';
              tag.classList.remove('editing');
              textEl.removeEventListener('input', onInput);
              textEl.removeEventListener('blur', onBlur);
              textEl.removeEventListener('keydown', onKeydown);
              return;
            }
            var textChanged = nextText !== originalText;
            if (textChanged) {
              note.note = nextText;
              if (note.autoSize !== false) applyChunkNoteAutoSize(note);
            }
          }
          textEl.contentEditable = 'false';
          tag.classList.remove('editing');
          tag.classList.add('image-mode');
          tag.style.width = Math.max(40, Number(note.w) || savedW) + 'px';
          tag.style.height = Math.max(18, Number(note.h) || savedH) + 'px';
          updateChunkNoteTagCompactState(tag);
          textEl.scrollTop = 0;
          applyChunkNoteTextStyle(textEl, note);
          renderChunkNoteImage(tag, note);
          saveChunkNotesDebounced();
          scheduleChunkNoteConnectorRedraw();
          textEl.removeEventListener('input', onInput);
          textEl.removeEventListener('blur', onBlur);
          textEl.removeEventListener('keydown', onKeydown);
          tag.__finishChunkNoteEdit = null;
        };
        var onInput = function () {
          if (!tag.classList.contains('editing')) return;
          var nextText = (textEl.textContent || '').trim();
          if (note.autoSize !== false) {
            var base = getChunkNoteLayoutBase();
            var maxW = Math.max(base.minW, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chunk-note-width')) || 260);
            var box = measureChunkNoteTextBox(nextText, base.minW, base.minH, maxW);
            tag.style.width = box.width + 'px';
            tag.style.height = box.height + 'px';
            updateChunkNoteTagCompactState(tag);
          }
          applyChunkNoteTextStyle(textEl, Object.assign({}, note, { note: nextText || note.note }));
          scheduleChunkNoteConnectorRedraw();
        };
        var onBlur = function () { finish(false); };
        var onKeydown = function (ev) {
          if (ev.key === 'Enter' && !ev.shiftKey) {
            ev.preventDefault();
            textEl.blur();
          } else if (ev.key === 'Escape') {
            ev.preventDefault();
            finish(true);
          }
        };
        textEl.addEventListener('input', onInput);
        textEl.addEventListener('blur', onBlur);
        textEl.addEventListener('keydown', onKeydown);
        tag.__finishChunkNoteEdit = finish;
      });
      if (dragHandle) dragHandle.title = '拖拽';
    }

    function spawnChunkNoteTag(note) {
      if (!note || !note.id || !note.note) return;
      ensureChunkNoteOverlayLayers();
      var source = getChunkWordSpan(note);
      var sourceRect = source ? rectToMainAreaSpace(source.getBoundingClientRect()) : {
        left: 12, top: 12, right: 12, bottom: 12, width: 0, height: 0
      };
      if (note.autoSize !== false) applyChunkNoteAutoSize(note);
      ensureChunkNoteLayout(note, sourceRect);
      var tag = document.createElement('div');
      tag.className = 'chunk-note-tag';
      tag.id = 'chunk-note-tag-' + note.id;
      tag.dataset.noteId = note.id;
      tag.style.setProperty('--note-accent', getChunkNoteAccent(note));
      tag.style.left = note.x + 'px';
      tag.style.top = note.y + 'px';
      var base = getChunkNoteLayoutBase();
      tag.style.width = Math.max(base.minW, Number(note.w) || base.minW) + 'px';
      tag.style.height = Math.max(base.minH, Number(note.h) || base.minH) + 'px';
      updateChunkNoteTagCompactState(tag);
      tag.innerHTML = [
        '<img class="chunk-note-image" alt="" aria-hidden="true" />',
        '<span class="chunk-note-drag-handle">&#x283F;</span>',
        '<span class="chunk-note-text"></span>',
        '<div class="chunk-note-resize-handle"></div>'
      ].join('');
      var textEl = tag.querySelector('.chunk-note-text');
      if (textEl) textEl.textContent = note.note || '';
      makeChunkNoteTagDraggable(tag, note);
      makeChunkNoteTagResizable(tag, note);
      enableChunkNoteInlineEdit(tag, note);
      tag.addEventListener('mousedown', function (e) {
        if (e.target.closest('.chunk-note-resize-handle')) return;
        setSelectedChunkNote(note.id);
        closeChunkNoteDeleteDialog();
      });
      tag.addEventListener('mouseenter', function () {
        setChunkNoteHoverTarget(note.id);
        scheduleChunkNoteConnectorRedraw();
      });
      tag.addEventListener('mouseleave', function () {
        setChunkNoteHoverTarget('');
        scheduleChunkNoteConnectorRedraw();
      });
      (chunkNoteLayer || mainAppArea || document.body).appendChild(tag);
      if (source) syncChunkNoteTagToAnchor(note, tag);
      if (textEl) applyChunkNoteTextStyle(textEl, note);
      renderChunkNoteImage(tag, note);
    }

    function renderAllChunkNoteTags() {
      setChunkNoteHoverTarget('');
      setSelectedChunkNote('');
      closeChunkNoteDeleteDialog();
      document.querySelectorAll('.chunk-note-tag').forEach(function (el) { el.remove(); });
      if (!getIsChunkMode() || !ns.chunkNoteVisible) return;
      listChunkNotes()
        .filter(function (n) { return n && n.note && String(n.note).trim(); })
        .sort(function (a, b) { return (a.chunkIdx - b.chunkIdx) || (a.startGlobal - b.startGlobal); })
        .forEach(spawnChunkNoteTag);
      scheduleChunkNoteLayoutRefresh();
    }

    function drawChunkNoteConnector(note) {
      if (!chunkNoteSvgLayer || !note || !note.id || !note.chunkRef) return;
      var activeChunkNoteId = getActiveChunkNoteId();
      if (!activeChunkNoteId || activeChunkNoteId !== note.id) return;
      var source = getChunkWordSpan(note);
      var tag = getChunkNoteTagById(note.id);
      if (!source || !tag) return;
      var s = rectToMainAreaSpace(source.getBoundingClientRect());
      var t = rectToMainAreaSpace(tag.getBoundingClientRect());
      if (s.width <= 0 || t.width <= 0) return;
      var x1 = s.left + (s.width / 2);
      var y1 = s.bottom;
      var x2 = t.left + (t.width / 2);
      var y2 = t.top;
      var midY = (y1 + y2) / 2;
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'chunk-note-connector');
      path.style.opacity = '1';
      path.setAttribute('d', 'M' + x1 + ',' + y1 + ' C' + x1 + ',' + midY + ' ' + x2 + ',' + midY + ' ' + x2 + ',' + y2);
      chunkNoteSvgLayer.appendChild(path);
    }

    function redrawAllChunkNoteConnectors() {
      clearChunkNoteConnectors();
      if (!getIsChunkMode() || !ns.chunkNoteVisible) return;
      ensureChunkNoteOverlayLayers();
      syncChunkNoteOverlaySize();
      listChunkNotes().forEach(drawChunkNoteConnector);
    }

    function scheduleChunkNoteConnectorRedraw() {
      if (chunkNoteConnectorRaf) return;
      chunkNoteConnectorRaf = requestAnimationFrame(function () {
        chunkNoteConnectorRaf = 0;
        redrawAllChunkNoteConnectors();
      });
    }

    function getChunkNoteModalPosition(anchorRect, modalEl) {
      var gap = 12;
      var margin = 8;
      var vw = window.innerWidth;
      var vh = window.innerHeight;
      var rect = modalEl.getBoundingClientRect();
      var left = anchorRect.left;
      var top = anchorRect.bottom + gap;
      if (left + rect.width > vw - margin) left = vw - rect.width - margin;
      if (left < margin) left = margin;
      if (top + rect.height > vh - margin) top = anchorRect.top - rect.height - gap;
      if (top < margin) top = margin;
      return { left: left, top: top };
    }

    function applyTempAnnotationByCtx(ctx) {
      if (!ctx || !ctx.chunkRef) return;
      var block = Number.isFinite(Number(ctx.chunkIdx))
        ? document.querySelector('.chunk-block[data-chunk-idx="' + Number(ctx.chunkIdx) + '"]')
        : getChunkBlockByRef(ctx.chunkRef);
      if (!block) return;
      var enDiv = block.querySelector('.chunk-en');
      if (!enDiv) return;
      var start = Number(ctx.startGlobal);
      var end = Number(ctx.endGlobal);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return;
      var accent = getChunkNoteAccent({ id: ctx.chunkRef + ':' + start + '-' + end });
      for (var i = start; i <= end; i++) {
        var span = enDiv.querySelector('#word-' + i);
        if (!span) continue;
        span.classList.add('annotated');
        span.style.setProperty('--annot-accent', accent);
        if (start === end) span.classList.add('annotated-single');
        else if (i === start) span.classList.add('annotated-start');
        else if (i === end) span.classList.add('annotated-end');
        else span.classList.add('annotated-mid');
      }
    }

    function closeChunkNotePopover() {
      if (chunkNoteModalEl) {
        chunkNoteModalEl.remove();
        chunkNoteModalEl = null;
        chunkNoteModalInputEl = null;
      }
      cancelChunkNoteDraftSaveTimer();
      chunkNoteModalDragging = false;
      chunkNoteModalResizing = false;
      notePopoverCtx = null;
      closeChunkNoteContextMenu();
    }

    function getChunkNoteModalEl() {
      return chunkNoteModalEl;
    }

    function saveChunkNoteFromModal() {
      if (!notePopoverCtx || !chunkNoteModalInputEl) {
        closeChunkNotePopover();
        return;
      }
      var noteText = (chunkNoteModalInputEl.value || '').trim();
      var ctx = notePopoverCtx;
      if (noteText) {
        var savedNoteId = upsertChunkNoteFromModal(ctx, noteText);
        saveChunkNotesDebounced();
        clearChunkNoteDraft();
        if (!ns.chunkNoteVisible) setChunkNoteVisible(true, true);
        refreshChunkNoteForChunkRef(ctx.chunkRef);
        setSelectedChunkNote(savedNoteId);
      } else {
        if (ctx.noteId) deleteChunkNote(ctx.noteId);
        refreshChunkNoteForChunkRef(ctx.chunkRef);
        saveChunkNotesDebounced();
        clearChunkNoteDraft();
      }
      closeChunkNotePopover();
    }

    function cancelChunkNoteModal() {
      clearChunkNoteDraft();
      if (notePopoverCtx && notePopoverCtx.noteId && !notePopoverCtx.noteExists) {
        deleteChunkNote(notePopoverCtx.noteId);
        refreshChunkNoteForChunkRef(notePopoverCtx.chunkRef);
      }
      closeChunkNotePopover();
    }

    function openChunkNotePopover(ctx) {
      closeChunkNoteContextMenu();
      closeChunkNotePopover();
      notePopoverCtx = ctx;
      if (!ns.chunkNoteVisible) setChunkNoteVisible(true, true);
      applyTempAnnotationByCtx(ctx);
      var modal = document.createElement('div');
      modal.className = 'chunk-note-modal-wrap';
      modal.innerHTML = [
        '<span class="chunk-note-modal-handle">&#x283F;</span>',
        '<textarea class="chunk-note-modal-input" rows="1"></textarea>',
        '<div class="chunk-note-modal-resize"></div>'
      ].join('');
      document.body.appendChild(modal);
      chunkNoteModalEl = modal;
      chunkNoteModalInputEl = modal.querySelector('.chunk-note-modal-input');
      chunkNoteModalInputEl.value = ctx.initialNote || '';
      modal.style.left = '16px';
      modal.style.top = '16px';
      var pos = getChunkNoteModalPosition(ctx.anchorRect, modal);
      modal.style.left = pos.left + 'px';
      modal.style.top = pos.top + 'px';
      var dragHandle = modal.querySelector('.chunk-note-modal-handle');
      var resizeHandle = modal.querySelector('.chunk-note-modal-resize');
      if (dragHandle) {
        dragHandle.addEventListener('mousedown', function (e) {
          e.preventDefault();
          e.stopPropagation();
          chunkNoteModalDragging = true;
          var sx = e.clientX;
          var sy = e.clientY;
          var sl = parseFloat(modal.style.left) || 0;
          var st = parseFloat(modal.style.top) || 0;
          var move = function (ev) {
            document.body.style.userSelect = 'none';
            modal.style.left = (sl + ev.clientX - sx) + 'px';
            modal.style.top = (st + ev.clientY - sy) + 'px';
          };
          var up = function () {
            document.body.style.userSelect = '';
            chunkNoteModalDragging = false;
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
          };
          document.addEventListener('mousemove', move);
          document.addEventListener('mouseup', up);
        });
      }
      if (resizeHandle) {
        resizeHandle.addEventListener('mousedown', function (e) {
          e.preventDefault();
          e.stopPropagation();
          chunkNoteModalResizing = true;
          var sx = e.clientX;
          var sy = e.clientY;
          var r = modal.getBoundingClientRect();
          var sw = r.width;
          var sh = r.height;
          var move = function (ev) {
            var nw = Math.max(140, sw + ev.clientX - sx);
            var nh = Math.max(44, sh + ev.clientY - sy);
            modal.style.width = nw + 'px';
            modal.style.height = nh + 'px';
          };
          var up = function () {
            chunkNoteModalResizing = false;
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
          };
          document.addEventListener('mousemove', move);
          document.addEventListener('mouseup', up);
        });
      }
      chunkNoteModalInputEl.addEventListener('blur', function () {
        setTimeout(function () {
          if (!chunkNoteModalEl) return;
          if (chunkNoteModalDragging || chunkNoteModalResizing) return;
          saveChunkNoteFromModal();
        }, 0);
      });
      chunkNoteModalInputEl.addEventListener('input', function () {
        persistCurrentChunkNoteDraft(false);
      });
      chunkNoteModalInputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          saveChunkNoteFromModal();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelChunkNoteModal();
        }
      });
      chunkNoteModalInputEl.focus();
      chunkNoteModalInputEl.setSelectionRange(chunkNoteModalInputEl.value.length, chunkNoteModalInputEl.value.length);
      setTimeout(function () {
        if (!chunkNoteModalInputEl) return;
        chunkNoteModalInputEl.focus();
        chunkNoteModalInputEl.setSelectionRange(chunkNoteModalInputEl.value.length, chunkNoteModalInputEl.value.length);
      }, 0);
      persistCurrentChunkNoteDraft(true);
    }

    function upsertChunkNoteFromModal(ctx, noteText) {
      var layoutContext = null;
      if (ctx && ctx.anchorRect) {
        var base = getChunkNoteLayoutBase();
        var anchorRect = rectToMainAreaSpace(ctx.anchorRect);
        var areaW = mainAppArea ? Math.max(mainAppArea.clientWidth, mainAppArea.scrollWidth) : window.innerWidth;
        var areaH = mainAppArea ? Math.max(mainAppArea.clientHeight, mainAppArea.scrollHeight) : window.innerHeight;
        layoutContext = {
          minW: base.minW,
          minH: base.minH,
          margin: base.margin,
          areaW: areaW,
          areaH: areaH,
          anchorRect: anchorRect,
          autoSize: applyChunkNoteAutoSize
        };
      }
      return upsertChunkNote(ctx, noteText, layoutContext);
    }

    function getChunkBlocksMatchingRef(chunkRef) {
      var ref = String(chunkRef || '');
      return Array.prototype.slice.call(document.querySelectorAll('.chunk-block')).filter(function (block) {
        return String(block.dataset.chunkRef || '') === ref || String(block.dataset.legacyChunkRef || '') === ref;
      });
    }

    function getChunkNotesForBlock(block) {
      if (!block) return [];
      var refs = [
        String(block.dataset.chunkRef || ''),
        String(block.dataset.legacyChunkRef || '')
      ].filter(Boolean);
      return getChunkNotesForBlockRefs(refs);
    }

    function refreshChunkNoteForChunkRef(chunkRef) {
      var blocks = getChunkBlocksMatchingRef(chunkRef);
      if (!blocks.length) {
        renderAllChunkNoteTags();
        scheduleChunkNoteConnectorRedraw();
        return;
      }
      blocks.forEach(function (block) {
        var enDiv = block.querySelector('.chunk-en');
        if (!enDiv) return;
        var notes = getChunkNotesForBlock(block);
        if (!notes.length) clearChunkWordAnnotations(enDiv);
        else markChunkWordsByNotes(enDiv, notes);
      });
      renderAllChunkNoteTags();
      scheduleChunkNoteConnectorRedraw();
    }

    function refreshAllChunkNoteVisuals() {
      if (!getIsChunkMode() || !getHasAiChunkData()) return;
      document.querySelectorAll('.chunk-block').forEach(function (block) {
        var enDiv = block.querySelector('.chunk-en');
        if (!enDiv) return;
        var notes = getChunkNotesForBlock(block);
        if (notes.length > 0) markChunkWordsByNotes(enDiv, notes);
        else clearChunkWordAnnotations(enDiv);
      });
      renderAllChunkNoteTags();
      scheduleChunkNoteConnectorRedraw();
    }

    function closeChunkNoteContextMenu() {
      if (chunkNoteCtxMenuEl) chunkNoteCtxMenuEl.style.display = 'none';
      ns.pendingChunkSelectionCtx = null;
    }

    function getPendingChunkSelectionCtx() {
      return ns.pendingChunkSelectionCtx || null;
    }

    function consumePendingChunkSelectionCtx() {
      var ctx = ns.pendingChunkSelectionCtx || null;
      ns.pendingChunkSelectionCtx = null;
      return ctx;
    }

    function openChunkNoteContextMenu(clientX, clientY, ctx) {
      if (!chunkNoteCtxMenuEl) return;
      ns.pendingChunkSelectionCtx = ctx;
      chunkNoteCtxMenuEl.style.display = 'block';
      var rect = chunkNoteCtxMenuEl.getBoundingClientRect();
      var left = Math.max(8, Math.min(clientX, window.innerWidth - rect.width - 8));
      var top = Math.max(8, Math.min(clientY, window.innerHeight - rect.height - 8));
      chunkNoteCtxMenuEl.style.left = left + 'px';
      chunkNoteCtxMenuEl.style.top = top + 'px';
    }

    function findNearestChunkBlock(clientX, clientY) {
      var blocks = Array.prototype.slice.call(document.querySelectorAll('.chunk-block'));
      if (!blocks.length) return null;
      var best = null;
      var bestScore = Infinity;
      blocks.forEach(function (block) {
        var rect = block.getBoundingClientRect();
        var dx = clientX < rect.left ? rect.left - clientX : (clientX > rect.right ? clientX - rect.right : 0);
        var dy = clientY < rect.top ? rect.top - clientY : (clientY > rect.bottom ? clientY - rect.bottom : 0);
        var score = (dy * dy) + (dx * dx * 0.2);
        if (score < bestScore) {
          bestScore = score;
          best = block;
        }
      });
      return best;
    }

    function handleChunkSelectionContextMenu(event) {
      if (!event || !getIsChunkMode() || !getHasAiChunkData()) return false;
      saveOpenChunkNotePopover();
      var target = event.target || null;
      var chunkBlock = target && target.closest ? target.closest('.chunk-block') : null;
      if (!chunkBlock && target && target.closest && (target.closest('#chunk-vue-container') || target.closest('#transcript-container'))) {
        chunkBlock = findNearestChunkBlock(event.clientX, event.clientY);
      }
      if (!chunkBlock) {
        closeChunkNoteContextMenu();
        return false;
      }
      var enDiv = chunkBlock.querySelector ? chunkBlock.querySelector('.chunk-en') : null;
      if (!enDiv) {
        closeChunkNoteContextMenu();
        return false;
      }
      var selection = window.getSelection ? window.getSelection() : null;
      var startGlobal = NaN;
      var endGlobal = NaN;
      var selectedText = '';
      var anchorRect = null;
      if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
        var range = selection.getRangeAt(0);
        if (range && enDiv.contains(range.commonAncestorContainer)) {
          var selectedSpans = Array.prototype.slice.call(enDiv.querySelectorAll('span[id^="word-"]')).filter(function (span) {
            try { return range.intersectsNode(span); } catch (err) { return false; }
          });
          if (selectedSpans.length) {
            var indices = selectedSpans.map(function (span) {
              return parseInt(String(span.id || '').replace('word-', ''), 10);
            }).filter(Number.isFinite);
            if (indices.length) {
              startGlobal = Math.min.apply(Math, indices);
              endGlobal = Math.max.apply(Math, indices);
              selectedText = selectedSpans.map(function (span) {
                return String(span.textContent || '').trim();
              }).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
              anchorRect = range.getBoundingClientRect();
            }
          }
        }
      }
      if (!Number.isFinite(startGlobal) || !Number.isFinite(endGlobal)) {
        var nearest = findNearestChunkWord(enDiv, event.clientX, event.clientY);
        if (!nearest) {
          closeChunkNoteContextMenu();
          return false;
        }
        var idx = parseInt(String(nearest.id || '').replace('word-', ''), 10);
        if (!Number.isFinite(idx)) {
          closeChunkNoteContextMenu();
          return false;
        }
        startGlobal = idx;
        endGlobal = idx;
        selectedText = String(nearest.textContent || '').trim();
        anchorRect = nearest.getBoundingClientRect();
      }
      if (typeof event.preventDefault === 'function') event.preventDefault();
      var chunkRef = (chunkBlock.dataset && chunkBlock.dataset.chunkRef) || '';
      var chunkIdx = Number((chunkBlock.dataset && chunkBlock.dataset.chunkIdx) || -1);
      openChunkNoteContextMenu(event.clientX, event.clientY, {
        noteId: makeNoteId(chunkRef, startGlobal, endGlobal),
        chunkRef: chunkRef,
        chunkIdx: chunkIdx,
        startGlobal: startGlobal,
        endGlobal: endGlobal,
        selectedText: selectedText,
        initialNote: '',
        noteExists: false,
        anchorRect: anchorRect
      });
      return true;
    }

    function openChunkNoteStyleModal() {
      var backdrop = document.getElementById('modal-backdrop');
      var modal = document.getElementById('chunk-note-style-modal');
      if (backdrop) backdrop.style.display = 'block';
      if (modal) modal.style.display = 'block';
      var styles = getComputedStyle(document.documentElement);
      var sz = (styles.getPropertyValue('--chunk-note-size').trim() || '16px').replace('px', '');
      var width = (styles.getPropertyValue('--chunk-note-width').trim() || '260px').replace('px', '');
      var minH = (styles.getPropertyValue('--chunk-note-min-height').trim() || '18px').replace('px', '');
      var arrow = (styles.getPropertyValue('--chunk-note-arrow-size').trim() || '12px').replace('px', '');
      var color = localStorage.getItem('chunkNoteColor') || styles.getPropertyValue('--chunk-note-color').trim();
      if (!color.startsWith('#') || color.length !== 7) color = '#4b5563';
      var sizeInput = document.getElementById('chunk-note-size-input');
      var colorInput = document.getElementById('chunk-note-color-input');
      var widthInput = document.getElementById('chunk-note-width-input');
      var minHeightInput = document.getElementById('chunk-note-min-height-input');
      var arrowInput = document.getElementById('chunk-note-arrow-size-input');
      if (sizeInput) sizeInput.value = parseInt(sz, 10) || 14;
      if (colorInput) colorInput.value = color;
      if (widthInput) widthInput.value = parseInt(width, 10) || 260;
      if (minHeightInput) minHeightInput.value = parseInt(minH, 10) || 18;
      if (arrowInput) arrowInput.value = parseInt(arrow, 10) || 12;
    }

    function closeChunkNoteStyleModal() {
      var el = document.getElementById('chunk-note-style-modal');
      if (el) el.style.display = 'none';
    }

    function adjustChunkNoteArrowSizeByGap() {
      var styles = getComputedStyle(document.documentElement);
      var gap = parseFloat(styles.getPropertyValue('--chunk-gap')) || 20;
      var desired = parseFloat(styles.getPropertyValue('--chunk-note-arrow-size')) || 12;
      var safeMax = Math.max(6, Math.floor(gap * 0.45));
      var effective = Math.max(6, Math.min(desired, safeMax));
      document.documentElement.style.setProperty('--chunk-note-arrow-size-effective', effective + 'px');
    }

    function updateChunkNoteStyle() {
      var sizeInput = document.getElementById('chunk-note-size-input');
      var colorInput = document.getElementById('chunk-note-color-input');
      var widthInput = document.getElementById('chunk-note-width-input');
      var minHeightInput = document.getElementById('chunk-note-min-height-input');
      var arrowInput = document.getElementById('chunk-note-arrow-size-input');
      if (!sizeInput || !colorInput || !widthInput || !minHeightInput || !arrowInput) return;
      var size = sizeInput.value;
      var color = colorInput.value;
      var width = widthInput.value;
      var minH = minHeightInput.value;
      var arrow = arrowInput.value;
      document.documentElement.style.setProperty('--chunk-note-size', size + 'px');
      document.documentElement.style.setProperty('--chunk-note-color', color);
      document.documentElement.style.setProperty('--chunk-note-width', width + 'px');
      document.documentElement.style.setProperty('--chunk-note-min-height', minH + 'px');
      document.documentElement.style.setProperty('--chunk-note-arrow-size', arrow + 'px');
      localStorage.setItem('chunkNoteSize', size + 'px');
      localStorage.setItem('chunkNoteColor', color);
      localStorage.setItem('chunkNoteWidth', width + 'px');
      localStorage.setItem('chunkNoteMinHeight', minH + 'px');
      localStorage.setItem('chunkNoteArrowSize', arrow + 'px');
      adjustChunkNoteArrowSizeByGap();
      if (getIsChunkMode()) renderAllChunkNoteTags();
      scheduleChunkNoteConnectorRedraw();
    }

    function hashString(input) {
      var h = 0;
      var s = String(input || '');
      for (var i = 0; i < s.length; i++) {
        h = ((h << 5) - h) + s.charCodeAt(i);
        h |= 0;
      }
      return Math.abs(h);
    }

    function getChunkNoteAccent(note, indexHint) {
      var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      var lightPalette = ['#4f7cff', '#8b5cf6', '#14b8a6', '#f59e0b', '#ef4444', '#0ea5e9'];
      var darkPalette = ['#8db4ff', '#b794f6', '#5eead4', '#fbbf24', '#fb7185', '#67e8f9'];
      var palette = isDark ? darkPalette : lightPalette;
      var idx = hashString(note && note.id ? note.id : (indexHint || 0)) % palette.length;
      return palette[idx];
    }

    function clearChunkWordAnnotations(enDiv) {
      if (!enDiv) return;
      enDiv.querySelectorAll('.annotated, .annotated-start, .annotated-mid, .annotated-end, .annotated-single, .annotated-active, .annotated-active-start, .annotated-active-mid, .annotated-active-end, .annotated-active-single').forEach(function (el) {
        el.classList.remove('annotated', 'annotated-start', 'annotated-mid', 'annotated-end', 'annotated-single', 'annotated-active', 'annotated-active-start', 'annotated-active-mid', 'annotated-active-end', 'annotated-active-single');
        el.style.removeProperty('--annot-accent');
        el.removeAttribute('data-note-id');
      });
    }

    function markChunkWordsByNotes(enDiv, notes) {
      if (!enDiv) return;
      clearChunkWordAnnotations(enDiv);
      var sorted = (notes || []).slice()
        .filter(function (n) { return n && Number.isFinite(Number(n.startGlobal)) && Number.isFinite(Number(n.endGlobal)); })
        .sort(function (a, b) { return Number(a.startGlobal) - Number(b.startGlobal); });
      sorted.forEach(function (n, idx) {
        var start = Number(n.startGlobal);
        var end = Number(n.endGlobal);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return;
        var accent = getChunkNoteAccent(n, idx);
        for (var i = start; i <= end; i++) {
          var span = enDiv.querySelector('#word-' + i);
          if (!span) continue;
          span.classList.add('annotated');
          span.style.setProperty('--annot-accent', accent);
          span.dataset.noteId = String(n.id || '');
          if (start === end) span.classList.add('annotated-single');
          else if (i === start) span.classList.add('annotated-start');
          else if (i === end) span.classList.add('annotated-end');
          else span.classList.add('annotated-mid');
        }
      });
    }

    function setChunkNoteHoverTarget(noteId) {
      document.querySelectorAll('.annotated-active, .annotated-active-start, .annotated-active-mid, .annotated-active-end, .annotated-active-single').forEach(function (el) {
        el.classList.remove('annotated-active', 'annotated-active-start', 'annotated-active-mid', 'annotated-active-end', 'annotated-active-single');
        el.style.removeProperty('--annot-accent');
      });
      ns.activeChunkNoteId = noteId || '';
      if (!ns.activeChunkNoteId) return;
      var note = ns.chunkNotesMap[ns.activeChunkNoteId];
      if (!note || !note.chunkRef) return;
      var firstSpan = document.getElementById('word-' + Number(note.startGlobal));
      var enDiv = firstSpan && firstSpan.closest ? firstSpan.closest('.chunk-en') : null;
      if (!enDiv) {
        var block = getChunkBlockByRef(note.chunkRef);
        enDiv = block ? block.querySelector('.chunk-en') : null;
      }
      if (!enDiv) return;
      var start = Number(note.startGlobal);
      var end = Number(note.endGlobal);
      var accent = getChunkNoteAccent(note);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return;
      for (var i = start; i <= end; i++) {
        var span = enDiv.querySelector('#word-' + i);
        if (!span) continue;
        span.classList.add('annotated-active');
        span.style.setProperty('--annot-accent', accent);
        if (start === end) span.classList.add('annotated-active-single');
        else if (i === start) span.classList.add('annotated-active-start');
        else if (i === end) span.classList.add('annotated-active-end');
        else span.classList.add('annotated-active-mid');
      }
    }

    return {
      getChunkNotesMap: getChunkNotesMap,
      replaceChunkNotesMap: replaceChunkNotesMap,
      listChunkNotes: listChunkNotes,
      getChunkNote: getChunkNote,
      getChunkNotesForRef: getChunkNotesForRef,
      getChunkNotesForBlockRefs: getChunkNotesForBlockRefs,
      getChunkNoteTagById: getChunkNoteTagById,
      setSelectedChunkNote: setSelectedChunkNote,
      getSelectedChunkNoteId: getSelectedChunkNoteId,
      getActiveChunkNoteId: getActiveChunkNoteId,
      closeChunkNoteDeleteDialog: closeChunkNoteDeleteDialog,
      getChunkNoteDeleteDialogEl: getChunkNoteDeleteDialogEl,
      openChunkNoteDeleteDialog: openChunkNoteDeleteDialog,
      deleteChunkNote: deleteChunkNote,
      upsertChunkNote: upsertChunkNote,
      applyImportedChunkNotes: applyImportedChunkNotes,
      getChunkNotesFileState: getChunkNotesFileState,
      setChunkNotesFileState: setChunkNotesFileState,
      clearChunkNotesFileState: clearChunkNotesFileState,
      clearChunkNoteDraft: clearChunkNoteDraft,
      persistChunkNoteDraft: persistChunkNoteDraft,
      readChunkNoteDraft: readChunkNoteDraft,
      cancelChunkNoteDraftSaveTimer: cancelChunkNoteDraftSaveTimer,
      buildChunkNotesSnapshot: buildChunkNotesSnapshot,
      saveChunkNotesDebounced: saveChunkNotesDebounced,
      saveChunkNotesNow: saveChunkNotesNow,
      loadChunkNotesForCurrentAudio: loadChunkNotesForCurrentAudio,
      setChunkNoteVisible: setChunkNoteVisible,
      getChunkBlockByRef: getChunkBlockByRef,
      clearChunkNoteConnectors: clearChunkNoteConnectors,
      getChunkWordSpan: getChunkWordSpan,
      ensureChunkNoteOverlayLayers: ensureChunkNoteOverlayLayers,
      rectToMainAreaSpace: rectToMainAreaSpace,
      pointToMainAreaSpace: pointToMainAreaSpace,
      syncChunkNoteOverlaySize: syncChunkNoteOverlaySize,
      persistCurrentChunkNoteDraft: persistCurrentChunkNoteDraft,
      getRangeAnchorRectByGlobals: getRangeAnchorRectByGlobals,
      setChunkNoteDraftRestoreDone: setChunkNoteDraftRestoreDone,
      tryRestoreChunkNoteDraft: tryRestoreChunkNoteDraft,
      getChunkNoteLayoutBase: getChunkNoteLayoutBase,
      getChunkNoteContentBoxSize: getChunkNoteContentBoxSize,
      ensureChunkNoteLayout: ensureChunkNoteLayout,
      syncChunkNoteTagToAnchor: syncChunkNoteTagToAnchor,
      refreshChunkNoteTagPositions: refreshChunkNoteTagPositions,
      scheduleChunkNoteLayoutRefresh: scheduleChunkNoteLayoutRefresh,
      applyChunkNoteTextStyle: applyChunkNoteTextStyle,
      renderChunkNoteImage: renderChunkNoteImage,
      updateChunkNoteTagCompactState: updateChunkNoteTagCompactState,
      makeChunkNoteTagDraggable: makeChunkNoteTagDraggable,
      makeChunkNoteTagResizable: makeChunkNoteTagResizable,
      enableChunkNoteInlineEdit: enableChunkNoteInlineEdit,
      spawnChunkNoteTag: spawnChunkNoteTag,
      renderAllChunkNoteTags: renderAllChunkNoteTags,
      drawChunkNoteConnector: drawChunkNoteConnector,
      redrawAllChunkNoteConnectors: redrawAllChunkNoteConnectors,
      scheduleChunkNoteConnectorRedraw: scheduleChunkNoteConnectorRedraw,
      closeChunkNotePopover: closeChunkNotePopover,
      getChunkNoteModalEl: getChunkNoteModalEl,
      saveChunkNoteFromModal: saveChunkNoteFromModal,
      cancelChunkNoteModal: cancelChunkNoteModal,
      openChunkNotePopover: openChunkNotePopover,
      upsertChunkNoteFromModal: upsertChunkNoteFromModal,
      getChunkBlocksMatchingRef: getChunkBlocksMatchingRef,
      getChunkNotesForBlock: getChunkNotesForBlock,
      refreshChunkNoteForChunkRef: refreshChunkNoteForChunkRef,
      refreshAllChunkNoteVisuals: refreshAllChunkNoteVisuals,
      closeChunkNoteContextMenu: closeChunkNoteContextMenu,
      getPendingChunkSelectionCtx: getPendingChunkSelectionCtx,
      consumePendingChunkSelectionCtx: consumePendingChunkSelectionCtx,
      openChunkNoteContextMenu: openChunkNoteContextMenu,
      handleChunkSelectionContextMenu: handleChunkSelectionContextMenu,
      openChunkNoteStyleModal: openChunkNoteStyleModal,
      closeChunkNoteStyleModal: closeChunkNoteStyleModal,
      updateChunkNoteStyle: updateChunkNoteStyle,
      adjustChunkNoteArrowSizeByGap: adjustChunkNoteArrowSizeByGap,
      getChunkNoteAccent: getChunkNoteAccent,
      clearChunkWordAnnotations: clearChunkWordAnnotations,
      markChunkWordsByNotes: markChunkWordsByNotes,
      setChunkNoteHoverTarget: setChunkNoteHoverTarget
    };
  }

  // === Sentence notebook persistence lifecycle ===
  function initSentenceNotes(deps) {
    var ns = deps.state;          // { sentenceNotesMap, allSentenceNotesByDoc, currentDocId, sentenceNoteDraft, notePreviewEditingItemId, notePreviewSavedItemId, selectedSentence }
    var loadFromDB = deps.loadFromDB;
    var saveToDB = deps.saveToDB;
    var getSentenceNotesStorageKey = deps.getSentenceNotesStorageKey;
    var getLegacySentenceNotesStorageKey = deps.getLegacySentenceNotesStorageKey;
    var buildCurrentSentenceDocId = deps.buildCurrentSentenceDocId;
    var isPlainObjectRecord = deps.isPlainObjectRecord;
    var getIsChunkMode = typeof deps.getIsChunkMode === 'function' ? deps.getIsChunkMode : function () { return false; };
    var getHasAiChunkData = typeof deps.getHasAiChunkData === 'function' ? deps.getHasAiChunkData : function () { return false; };
    var notePreviewSidebar = deps.notePreviewSidebar || null;
    var notePreviewEmpty = deps.notePreviewEmpty || null;
    var notePreviewList = deps.notePreviewList || null;
    var toggleNotePreviewBtn = deps.toggleNotePreviewBtn || null;
    var notePreviewResizeHandle = deps.notePreviewResizeHandle || null;
    var notePreviewResizeHandleY = deps.notePreviewResizeHandleY || null;
    var notePreviewVisible = deps.initialNotePreviewVisible !== undefined ? !!deps.initialNotePreviewVisible : true;
    var notePreviewWidth = Number.isFinite(Number(deps.initialNotePreviewWidth)) ? Number(deps.initialNotePreviewWidth) : 340;
    var notePreviewHeight = Number.isFinite(Number(deps.initialNotePreviewHeight)) ? Number(deps.initialNotePreviewHeight) : 640;
    var notePreviewResizeRaf = 0;
    var notePreviewSavedHintTimer = 0;
    var notePreviewPendingScrollItemId = '';
    var notePreviewListScrollTop = 0;

    // Sentence notebook: data normalization + doc-scoped persistence

    function makeLegacySentenceNoteItemId(sentenceId, updatedAt) {
      return 'legacy_' + String(sentenceId || 'sentence') + '_' + Number(updatedAt || 0).toString(36);
    }

    function makeSentenceNoteItemId(sentenceId) {
      return 'item_' + String(sentenceId || 'sentence').replace(/[^a-z0-9_-]+/gi, '_') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }

    function normalizeSentenceNoteItem(sentenceId, item, fallbackItemId) {
      var source = item && typeof item === 'object' ? item : {};
      var createdAt = Number.isFinite(Number(source.createdAt))
        ? Number(source.createdAt)
        : (Number.isFinite(Number(source.updatedAt)) ? Number(source.updatedAt) : Date.now());
      var updatedAt = Number.isFinite(Number(source.updatedAt)) ? Number(source.updatedAt) : createdAt;
      return {
        itemId: String(source.itemId || (fallbackItemId || '') || makeLegacySentenceNoteItemId(sentenceId, updatedAt)),
        selectedText: typeof source.selectedText === 'string'
          ? source.selectedText
          : (typeof source.focusPhrase === 'string' ? source.focusPhrase : ''),
        noteBody: typeof source.noteBody === 'string'
          ? source.noteBody
          : (typeof source.note === 'string' ? source.note : ''),
        createdAt: createdAt,
        updatedAt: updatedAt
      };
    }

    function normalizeSentenceNoteRecord(sentenceId, note) {
      var safeSentenceId = String(sentenceId || (note && note.sentenceId) || '');
      var source = note && typeof note === 'object' ? note : {};
      if (Array.isArray(source.items)) {
        return {
          sentenceId: safeSentenceId,
          items: source.items
            .map(function (item, idx) { return normalizeSentenceNoteItem(safeSentenceId, item, 'migrated_' + idx); })
            .filter(function (item) { return item.selectedText.trim() || item.noteBody.trim(); })
        };
      }
      var legacySelectedText = typeof source.focusPhrase === 'string' ? source.focusPhrase : '';
      var legacyNoteBody = typeof source.noteBody === 'string' ? source.noteBody : '';
      var legacyUpdatedAt = Number.isFinite(Number(source.updatedAt)) ? Number(source.updatedAt) : Date.now();
      var items = (legacySelectedText.trim() || legacyNoteBody.trim())
        ? [normalizeSentenceNoteItem(safeSentenceId, {
          itemId: makeLegacySentenceNoteItemId(safeSentenceId, legacyUpdatedAt),
          selectedText: legacySelectedText,
          noteBody: legacyNoteBody,
          createdAt: legacyUpdatedAt,
          updatedAt: legacyUpdatedAt
        })]
        : [];
      return {
        sentenceId: safeSentenceId,
        items: items
      };
    }

    function normalizeSentenceNotesScope(scope) {
      if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return {};
      return Object.fromEntries(
        Object.entries(scope).map(function (entry) {
          return [String(entry[0]), normalizeSentenceNoteRecord(entry[0], entry[1])];
        })
      );
    }

    function getSentenceNoteRecord(sentenceId) {
      var safeSentenceId = String(sentenceId || '');
      if (!safeSentenceId) return null;
      var normalized = normalizeSentenceNoteRecord(safeSentenceId, ns.sentenceNotesMap[safeSentenceId]);
      ns.sentenceNotesMap[safeSentenceId] = normalized;
      return normalized;
    }

    function getSortedSentenceNoteItems(sentenceId) {
      var record = getSentenceNoteRecord(sentenceId);
      return record
        ? record.items.slice().sort(function (a, b) { return (a.createdAt - b.createdAt) || (a.updatedAt - b.updatedAt) || String(a.itemId).localeCompare(String(b.itemId)); })
        : [];
    }

    function applyNotePreviewSize() {
      document.documentElement.style.setProperty('--note-preview-width', notePreviewWidth + 'px');
      document.documentElement.style.setProperty('--note-preview-height', notePreviewHeight + 'px');
    }

    function formatSentenceNoteItemMeta(item, itemId, isEditing) {
      if (isEditing) return 'Editing note...';
      if (ns.notePreviewSavedItemId && ns.notePreviewSavedItemId === itemId) return 'Saved just now';
      if (item && item.updatedAt) return 'Last saved ' + new Date(item.updatedAt).toLocaleString();
      return 'Draft item';
    }

    function triggerSentenceNoteSavedFeedback(itemId) {
      ns.notePreviewSavedItemId = String(itemId || '');
      if (notePreviewSavedHintTimer) clearTimeout(notePreviewSavedHintTimer);
      notePreviewSavedHintTimer = setTimeout(function () {
        ns.notePreviewSavedItemId = '';
        renderNotePreviewSidebar();
      }, 1400);
    }

    function findSentenceNoteItem(sentenceId, itemId) {
      var record = getSentenceNoteRecord(sentenceId);
      if (!record) return { record: null, item: null, index: -1 };
      var index = record.items.findIndex(function (item) {
        return String(item.itemId || '') === String(itemId || '');
      });
      return {
        record: record,
        item: index >= 0 ? record.items[index] : null,
        index: index
      };
    }

    function discardSentenceNoteDraft(shouldRender) {
      if (shouldRender === undefined) shouldRender = true;
      if (!ns.sentenceNoteDraft) return;
      if (ns.notePreviewEditingItemId === ns.sentenceNoteDraft.itemId) ns.notePreviewEditingItemId = '';
      ns.sentenceNoteDraft = null;
      if (shouldRender) renderNotePreviewSidebar();
    }

    function commitSentenceNoteDraft(shouldRender) {
      if (shouldRender === undefined) shouldRender = true;
      if (!ns.sentenceNoteDraft) return false;
      var noteBody = String(ns.sentenceNoteDraft.noteBody || '');
      if (!noteBody.trim()) {
        discardSentenceNoteDraft(shouldRender);
        return false;
      }
      var sentenceId = String(ns.sentenceNoteDraft.sentenceId || '');
      var record = getSentenceNoteRecord(sentenceId);
      if (!record) {
        discardSentenceNoteDraft(shouldRender);
        return false;
      }
      var timestamp = Date.now();
      var committed = normalizeSentenceNoteItem(sentenceId, {
        itemId: ns.sentenceNoteDraft.itemId,
        selectedText: ns.sentenceNoteDraft.selectedText,
        noteBody: noteBody,
        createdAt: ns.sentenceNoteDraft.createdAt || timestamp,
        updatedAt: timestamp
      }, ns.sentenceNoteDraft.itemId);
      record.items.push(committed);
      ns.sentenceNotesMap[sentenceId] = record;
      var committedItemId = committed.itemId;
      ns.sentenceNoteDraft = null;
      ns.notePreviewEditingItemId = '';
      saveSentenceNotesDebounced();
      triggerSentenceNoteSavedFeedback(committedItemId);
      if (shouldRender) renderNotePreviewSidebar();
      return true;
    }

    function persistSentenceNoteItem(sentenceId, itemId, shouldRender) {
      if (shouldRender === undefined) shouldRender = true;
      var found = findSentenceNoteItem(sentenceId, itemId);
      var record = found.record;
      var item = found.item;
      var index = found.index;
      if (!record || !item || index < 0) return false;
      var nextBody = String(item.noteBody || '');
      if (!nextBody.trim()) {
        if (notePreviewList) notePreviewListScrollTop = notePreviewList.scrollTop;
        record.items.splice(index, 1);
        if (!record.items.length) delete ns.sentenceNotesMap[sentenceId];
        else ns.sentenceNotesMap[sentenceId] = record;
        ns.notePreviewEditingItemId = '';
        saveSentenceNotesDebounced();
        if (shouldRender) renderNotePreviewSidebar();
        return false;
      }
      item.updatedAt = Date.now();
      ns.sentenceNotesMap[sentenceId] = record;
      ns.notePreviewEditingItemId = '';
      saveSentenceNotesDebounced();
      triggerSentenceNoteSavedFeedback(itemId);
      if (shouldRender) renderNotePreviewSidebar();
      return true;
    }

    function persistSelectedSentenceNote() {
      if (!ns.selectedSentence) return;
      if (ns.sentenceNoteDraft && ns.sentenceNoteDraft.sentenceId === ns.selectedSentence.sentenceId) {
        commitSentenceNoteDraft(false);
      }
      if (ns.notePreviewEditingItemId) {
        persistSentenceNoteItem(String(ns.selectedSentence.sentenceId || ''), ns.notePreviewEditingItemId, false);
      }
      persistSentenceNotesForCurrentDoc();
      renderNotePreviewSidebar();
    }

    function buildSentenceNoteItemElement(sentenceId, item, options) {
      options = options || {};
      var isDraft = !!options.isDraft;
      var wrapper = document.createElement('article');
      wrapper.className = 'sentence-note-item';
      wrapper.dataset.itemId = String(item.itemId || '');
      if (isDraft) wrapper.classList.add('is-draft');
      if (ns.notePreviewEditingItemId && ns.notePreviewEditingItemId === item.itemId) wrapper.classList.add('is-editing');

      var selectedTextEl = document.createElement('p');
      selectedTextEl.className = 'sentence-note-item-text';
      selectedTextEl.textContent = String(item.selectedText || '').trim() || 'Selected text';
      wrapper.appendChild(selectedTextEl);

      var textarea = document.createElement('textarea');
      textarea.className = 'sentence-note-item-body';
      textarea.placeholder = 'Write note for this selected text...';
      textarea.value = String(item.noteBody || '');
      textarea.dataset.itemId = String(item.itemId || '');
      textarea.dataset.sentenceId = String(sentenceId || '');
      textarea.dataset.isDraft = isDraft ? 'true' : 'false';
      wrapper.appendChild(textarea);

      var meta = document.createElement('div');
      meta.className = 'sentence-note-item-meta';
      if (ns.notePreviewEditingItemId && ns.notePreviewEditingItemId === item.itemId) meta.classList.add('is-editing');
      if (ns.notePreviewSavedItemId && ns.notePreviewSavedItemId === item.itemId) meta.classList.add('is-saved');
      meta.textContent = formatSentenceNoteItemMeta(item, item.itemId, ns.notePreviewEditingItemId === item.itemId);
      wrapper.appendChild(meta);

      textarea.addEventListener('focus', function () {
        ns.notePreviewSavedItemId = '';
        ns.notePreviewEditingItemId = String(item.itemId || '');
        if (notePreviewSidebar) notePreviewSidebar.classList.add('note-editing');
        wrapper.classList.add('is-editing');
        meta.classList.remove('is-saved');
        meta.classList.add('is-editing');
        meta.textContent = 'Editing note...';
        textarea.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
      textarea.addEventListener('input', function (event) {
        var value = String(event.target.value || '');
        ns.notePreviewSavedItemId = '';
        ns.notePreviewEditingItemId = String(item.itemId || '');
        if (isDraft && ns.sentenceNoteDraft && ns.sentenceNoteDraft.itemId === item.itemId) {
          ns.sentenceNoteDraft.noteBody = value;
          ns.sentenceNoteDraft.updatedAt = Date.now();
        } else {
          var found = findSentenceNoteItem(sentenceId, item.itemId);
          if (found.item) {
            found.item.noteBody = value;
            ns.sentenceNotesMap[String(sentenceId || '')] = found.record;
          }
        }
        wrapper.classList.add('is-editing');
        meta.classList.remove('is-saved');
        meta.classList.add('is-editing');
        meta.textContent = 'Editing note...';
      });
      textarea.addEventListener('blur', function () {
        if (isDraft) commitSentenceNoteDraft();
        else persistSentenceNoteItem(String(sentenceId || ''), String(item.itemId || ''));
      });
      return wrapper;
    }

    function renderNotePreviewSidebar() {
      if (!notePreviewSidebar || !notePreviewEmpty || !notePreviewList) return;
      var previousScrollTop = notePreviewList.scrollTop;
      applyNotePreviewSize();
      document.body.classList.toggle('note-preview-open', !!notePreviewVisible);
      if (toggleNotePreviewBtn) toggleNotePreviewBtn.classList.toggle('active', !!notePreviewVisible);
      notePreviewSidebar.classList.toggle('note-editing', !!ns.notePreviewEditingItemId);
      notePreviewSidebar.classList.toggle('note-has-selection', !!ns.selectedSentence);
      if (!ns.selectedSentence) {
        showNotePreviewEmptyState('No sentence selected\nClick a sentence to view its note here.');
        return;
      }
      var sentenceId = String(ns.selectedSentence.sentenceId || '');
      var items = getSortedSentenceNoteItems(sentenceId);
      var hasDraft = !!(ns.sentenceNoteDraft && ns.sentenceNoteDraft.sentenceId === sentenceId);
      var renderItems = hasDraft ? items.concat([ns.sentenceNoteDraft]) : items;
      if (!renderItems.length) {
        showNotePreviewEmptyState('No note items yet.\nSelect a word or phrase in this sentence to start a note.');
        return;
      }
      notePreviewEmpty.hidden = true;
      notePreviewList.hidden = false;
      notePreviewList.innerHTML = '';
      var frag = document.createDocumentFragment();
      renderItems.forEach(function (item) {
        frag.appendChild(buildSentenceNoteItemElement(sentenceId, item, {
          isDraft: !!(ns.sentenceNoteDraft && ns.sentenceNoteDraft.itemId === item.itemId)
        }));
      });
      notePreviewList.appendChild(frag);
      if (notePreviewPendingScrollItemId) {
        var escaped = window.CSS && typeof window.CSS.escape === 'function'
          ? window.CSS.escape(notePreviewPendingScrollItemId)
          : String(notePreviewPendingScrollItemId).replace(/"/g, '\\"');
        var target = notePreviewList.querySelector('.sentence-note-item[data-item-id="' + escaped + '"]');
        if (target) {
          requestAnimationFrame(function () {
            target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          });
        }
        notePreviewPendingScrollItemId = '';
        notePreviewListScrollTop = notePreviewList.scrollTop;
        return;
      }
      notePreviewList.scrollTop = Number.isFinite(notePreviewListScrollTop) ? notePreviewListScrollTop : previousScrollTop;
      notePreviewListScrollTop = notePreviewList.scrollTop;
    }

    function showNotePreviewEmptyState(message) {
      if (!notePreviewEmpty || !notePreviewList) return;
      notePreviewEmpty.hidden = false;
      notePreviewEmpty.textContent = message;
      notePreviewList.hidden = true;
      notePreviewList.innerHTML = '';
      notePreviewListScrollTop = 0;
    }

    function toggleNotePreviewSidebar(forceState) {
      notePreviewVisible = forceState === null || forceState === undefined ? !notePreviewVisible : !!forceState;
      try { localStorage.setItem('notePreviewVisible', notePreviewVisible ? 'true' : 'false'); } catch (err) {}
      renderNotePreviewSidebar();
      setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 50);
    }

    function setSelectedSentence(nextSentence) {
      persistSelectedSentenceNote();
      ns.notePreviewSavedItemId = '';
      ns.notePreviewEditingItemId = '';
      ns.selectedSentence = nextSentence ? Object.assign({}, nextSentence) : null;
      renderNotePreviewSidebar();
    }

    function getSelectedSentence() {
      return ns.selectedSentence ? Object.assign({}, ns.selectedSentence) : null;
    }

    function updateSentenceFocusPhrase(sentence, focusPhrase) {
      if (!sentence) return;
      var sentenceId = String(sentence.sentenceId || '');
      var nextSelectedText = String(focusPhrase || '').replace(/\s+/g, ' ').trim();
      if (!sentenceId || !nextSelectedText) return;
      persistSelectedSentenceNote();
      ns.notePreviewSavedItemId = '';
      ns.notePreviewEditingItemId = '';
      ns.selectedSentence = Object.assign({}, sentence);
      ns.sentenceNoteDraft = {
        sentenceId: sentenceId,
        itemId: makeSentenceNoteItemId(sentenceId),
        selectedText: nextSelectedText,
        noteBody: '',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      ns.notePreviewEditingItemId = ns.sentenceNoteDraft.itemId;
      notePreviewPendingScrollItemId = ns.sentenceNoteDraft.itemId;
      renderNotePreviewSidebar();
    }

    function selectSentenceFromChunkTarget(target) {
      if (!getIsChunkMode() || !getHasAiChunkData()) return false;
      var chunkBlock = target && target.closest ? target.closest('.chunk-block') : null;
      if (!chunkBlock) return false;
      var chunkRef = String(chunkBlock.dataset.chunkRef || '');
      var idx = Number(chunkBlock.dataset.chunkIdx || '-1');
      if (!chunkRef || idx < 0) return false;
      var enDiv = chunkBlock.querySelector('.chunk-en');
      var text = ((enDiv && enDiv.textContent) || '').replace(/\s+/g, ' ').trim();
      setSelectedSentence({
        index: idx,
        sentenceId: chunkRef,
        chunkRef: chunkRef,
        text: text
      });
      return true;
    }

    function hasActiveTextSelectionWithinChunk() {
      var selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
      var text = selection.toString().replace(/\s+/g, ' ').trim();
      if (!text) return false;
      var range = selection.getRangeAt(0);
      var element = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
      return !!(element && element.closest && element.closest('.chunk-en'));
    }

    function getSelectionChunkSentence() {
      if (!getIsChunkMode() || !getHasAiChunkData()) return null;
      var selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
      var selectedText = selection.toString().replace(/\s+/g, ' ').trim();
      if (!selectedText) return null;
      var range = selection.getRangeAt(0);
      var startElement = range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer
        : range.startContainer.parentElement;
      var endElement = range.endContainer.nodeType === Node.ELEMENT_NODE
        ? range.endContainer
        : range.endContainer.parentElement;
      var startBlock = startElement && startElement.closest ? startElement.closest('.chunk-block') : null;
      var endBlock = endElement && endElement.closest ? endElement.closest('.chunk-block') : null;
      if (!startBlock || !endBlock || startBlock !== endBlock) return null;
      var enDiv = startBlock.querySelector('.chunk-en');
      if (!enDiv || !enDiv.contains(range.commonAncestorContainer)) return null;
      var sentenceId = String(startBlock.dataset.chunkRef || '');
      var index = Number(startBlock.dataset.chunkIdx || '-1');
      var fullText = (enDiv.textContent || '').replace(/\s+/g, ' ').trim();
      if (!sentenceId || index < 0) return null;
      return {
        sentenceId: sentenceId,
        chunkRef: sentenceId,
        index: index,
        text: fullText,
        focusPhrase: selectedText
      };
    }

    function maybeCaptureSentenceFocusPhrase() {
      var selected = getSelectionChunkSentence();
      if (!selected) return false;
      updateSentenceFocusPhrase(selected, selected.focusPhrase);
      return true;
    }

    function applyImportedSentenceNotesSnapshot(data) {
      if (!isPlainObjectRecord(data)) {
        throw new Error('invalid sentence notebook json');
      }
      var importDocId = String(data.docId || '');
      if (!importDocId) {
        throw new Error('missing docId');
      }
      if (importDocId !== ns.currentDocId) {
        throw new Error('docId mismatch');
      }
      if (!isPlainObjectRecord(data.notes)) {
        throw new Error('missing notes payload');
      }
      ns.sentenceNotesMap = normalizeSentenceNotesScope(data.notes);
      ns.allSentenceNotesByDoc[ns.currentDocId] = normalizeSentenceNotesScope(ns.sentenceNotesMap);
      ns.sentenceNoteDraft = null;
      ns.notePreviewEditingItemId = '';
      ns.notePreviewSavedItemId = '';
      saveToDB(getSentenceNotesStorageKey(), ns.allSentenceNotesByDoc);
      renderNotePreviewSidebar();
    }

    function initNotePreviewResize() {
      if (notePreviewResizeHandle && notePreviewSidebar) {
        notePreviewResizeHandle.addEventListener('mousedown', function (e) {
          e.preventDefault();
          e.stopPropagation();
          var startX = e.clientX;
          var startWidth = notePreviewWidth;
          var move = function (ev) {
            var delta = startX - ev.clientX;
            notePreviewWidth = Math.max(280, Math.min(520, startWidth + delta));
            if (!notePreviewResizeRaf) {
              notePreviewResizeRaf = requestAnimationFrame(function () {
                notePreviewResizeRaf = 0;
                applyNotePreviewSize();
              });
            }
          };
          var up = function () {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            document.body.classList.remove('note-preview-resizing');
            if (notePreviewResizeRaf) {
              cancelAnimationFrame(notePreviewResizeRaf);
              notePreviewResizeRaf = 0;
            }
            applyNotePreviewSize();
            try { localStorage.setItem('notePreviewWidth', String(notePreviewWidth)); } catch (err) {}
          };
          document.body.classList.add('note-preview-resizing');
          document.addEventListener('mousemove', move);
          document.addEventListener('mouseup', up);
        });
      }
      if (notePreviewResizeHandleY && notePreviewSidebar) {
        notePreviewResizeHandleY.addEventListener('mousedown', function (e) {
          e.preventDefault();
          e.stopPropagation();
          var startY = e.clientY;
          var startHeight = notePreviewHeight;
          var move = function (ev) {
            var delta = ev.clientY - startY;
            notePreviewHeight = Math.max(420, Math.min(window.innerHeight - 28, startHeight + delta));
            if (!notePreviewResizeRaf) {
              notePreviewResizeRaf = requestAnimationFrame(function () {
                notePreviewResizeRaf = 0;
                applyNotePreviewSize();
              });
            }
          };
          var up = function () {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            document.body.classList.remove('note-preview-resizing-y');
            if (notePreviewResizeRaf) {
              cancelAnimationFrame(notePreviewResizeRaf);
              notePreviewResizeRaf = 0;
            }
            applyNotePreviewSize();
            try { localStorage.setItem('notePreviewHeight', String(notePreviewHeight)); } catch (err) {}
          };
          document.body.classList.add('note-preview-resizing-y');
          document.addEventListener('mousemove', move);
          document.addEventListener('mouseup', up);
        });
      }
    }

    var ensureLegacySentenceNotesForDoc = function (docId) {
      return window.SentenceNotesPersistenceUtils.ensureLegacySentenceNotesForDoc(docId, {
        allSentenceNotesByDoc: ns.allSentenceNotesByDoc,
        loadFromDB: loadFromDB,
        getLegacySentenceNotesStorageKey: getLegacySentenceNotesStorageKey,
        isPlainObjectRecord: isPlainObjectRecord,
        normalizeSentenceNotesScope: normalizeSentenceNotesScope,
        setAllSentenceNotesByDocEntry: function (key, value) { ns.allSentenceNotesByDoc[key] = value; }
      });
    };

    async function loadSentenceNotesForCurrentAudio() {
      var data = await loadFromDB(getSentenceNotesStorageKey());
      if (isPlainObjectRecord(data)) {
        ns.allSentenceNotesByDoc = Object.fromEntries(
          Object.entries(data).map(function (entry) {
            return [String(entry[0]), normalizeSentenceNotesScope(entry[1])];
          })
        );
      } else {
        ns.allSentenceNotesByDoc = {};
      }
      ns.currentDocId = buildCurrentSentenceDocId();
      await ensureLegacySentenceNotesForDoc(ns.currentDocId);
      ns.sentenceNotesMap = normalizeSentenceNotesScope(ns.allSentenceNotesByDoc[ns.currentDocId] || {});
    }

    function saveSentenceNotesDebounced() {
      persistSentenceNotesForCurrentDoc();
    }

    function persistSentenceNotebookNow() {
      persistSelectedSentenceNote();
      persistSentenceNotesForCurrentDoc();
    }

    function persistSentenceNotesForCurrentDoc() {
      if (!ns.currentDocId) return;
      var cleaned = {};
      Object.entries(ns.sentenceNotesMap || {}).forEach(function (entry) {
        var sentenceId = entry[0];
        var note = entry[1];
        var normalized = normalizeSentenceNoteRecord(sentenceId, note);
        if (!normalized.items.length) return;
        cleaned[String(sentenceId)] = normalized;
      });
      if (Object.keys(cleaned).length > 0) {
        ns.allSentenceNotesByDoc[ns.currentDocId] = cleaned;
      } else {
        delete ns.allSentenceNotesByDoc[ns.currentDocId];
      }
      saveToDB(getSentenceNotesStorageKey(), ns.allSentenceNotesByDoc);
    }

    async function switchSentenceNotesDoc(transcriptSource) {
      persistSentenceNotebookNow();
      ns.currentDocId = buildCurrentSentenceDocId(transcriptSource !== undefined ? transcriptSource : null);
      await ensureLegacySentenceNotesForDoc(ns.currentDocId);
      ns.sentenceNotesMap = normalizeSentenceNotesScope(ns.allSentenceNotesByDoc[ns.currentDocId] || {});
      ns.sentenceNoteDraft = null;
      ns.notePreviewEditingItemId = '';
      ns.notePreviewSavedItemId = '';
      ns.selectedSentence = null;
      renderNotePreviewSidebar();
    }

    var getCurrentSentenceDocIdForExport = function () {
      return window.SentenceNotesPersistenceUtils.getCurrentSentenceDocIdForExport(
        ns.currentDocId,
        buildCurrentSentenceDocId
      );
    };

    function buildSentenceNotesExportSnapshot() {
      persistSentenceNotebookNow();
      return {
        docId: getCurrentSentenceDocIdForExport(),
        exportedAt: Date.now(),
        notes: normalizeSentenceNotesScope(ns.sentenceNotesMap)
      };
    }

    function triggerSentenceNotesDownload(snapshot, filename) {
      var blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    return {
      loadSentenceNotesForCurrentAudio: loadSentenceNotesForCurrentAudio,
      saveSentenceNotesDebounced: saveSentenceNotesDebounced,
      persistSentenceNotebookNow: persistSentenceNotebookNow,
      persistSentenceNotesForCurrentDoc: persistSentenceNotesForCurrentDoc,
      switchSentenceNotesDoc: switchSentenceNotesDoc,
      getSentenceNoteRecord: getSentenceNoteRecord,
      getSortedSentenceNoteItems: getSortedSentenceNoteItems,
      applyNotePreviewSize: applyNotePreviewSize,
      formatSentenceNoteItemMeta: formatSentenceNoteItemMeta,
      triggerSentenceNoteSavedFeedback: triggerSentenceNoteSavedFeedback,
      findSentenceNoteItem: findSentenceNoteItem,
      discardSentenceNoteDraft: discardSentenceNoteDraft,
      commitSentenceNoteDraft: commitSentenceNoteDraft,
      persistSentenceNoteItem: persistSentenceNoteItem,
      persistSelectedSentenceNote: persistSelectedSentenceNote,
      buildSentenceNoteItemElement: buildSentenceNoteItemElement,
      renderNotePreviewSidebar: renderNotePreviewSidebar,
      showNotePreviewEmptyState: showNotePreviewEmptyState,
      toggleNotePreviewSidebar: toggleNotePreviewSidebar,
      setSelectedSentence: setSelectedSentence,
      getSelectedSentence: getSelectedSentence,
      updateSentenceFocusPhrase: updateSentenceFocusPhrase,
      selectSentenceFromChunkTarget: selectSentenceFromChunkTarget,
      hasActiveTextSelectionWithinChunk: hasActiveTextSelectionWithinChunk,
      getSelectionChunkSentence: getSelectionChunkSentence,
      maybeCaptureSentenceFocusPhrase: maybeCaptureSentenceFocusPhrase,
      applyImportedSentenceNotesSnapshot: applyImportedSentenceNotesSnapshot,
      initNotePreviewResize: initNotePreviewResize,
      normalizeSentenceNotesScope: normalizeSentenceNotesScope,
      normalizeSentenceNoteRecord: normalizeSentenceNoteRecord,
      buildSentenceNotesExportSnapshot: buildSentenceNotesExportSnapshot,
      triggerSentenceNotesDownload: triggerSentenceNotesDownload,
      ensureLegacySentenceNotesForDoc: ensureLegacySentenceNotesForDoc,
      getCurrentSentenceDocIdForExport: getCurrentSentenceDocIdForExport
    };
  }

  window.__notesModule = {
    initChunkNotes: initChunkNotes,
    initSentenceNotes: initSentenceNotes
  };
