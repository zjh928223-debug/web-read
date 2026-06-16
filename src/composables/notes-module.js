  // === Chunk-note persistence lifecycle ===
  function initChunkNotes(deps) {
    var ns = deps.state;          // { chunkNotesMap, chunkNoteVisible, activeChunkNoteId, chunkNoteSaveTimer, pendingChunkSelectionCtx }
    var loadFromDB = deps.loadFromDB;
    var saveToDB = deps.saveToDB;
    var getChunkNotesStorageKey = deps.getChunkNotesStorageKey;
    var sanitizeChunkNoteFontSize = deps.sanitizeChunkNoteFontSize;
    var getIsChunkMode = deps.getIsChunkMode;
    var chunkNoteCtxMenuEl = deps.chunkNoteCtxMenuEl;
    var closeChunkNotePopover = deps.closeChunkNotePopover;
    var clearChunkNoteConnectors = deps.clearChunkNoteConnectors;
    var ensureChunkNoteOverlayLayers = deps.ensureChunkNoteOverlayLayers;
    var renderAllChunkNoteTags = deps.renderAllChunkNoteTags;
    var scheduleChunkNoteLayoutRefresh = deps.scheduleChunkNoteLayoutRefresh;
    var scheduleChunkNoteConnectorRedraw = deps.scheduleChunkNoteConnectorRedraw;
    var makeSelectionNoteBaseId = deps.makeSelectionNoteBaseId;
    var makeSelectionNoteId = deps.makeSelectionNoteId;
    var now = typeof deps.now === 'function' ? deps.now : function () { return Date.now(); };
    var fallbackFileState = { handle: null, audioKey: '', fileName: '' };

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

    function closeChunkNoteContextMenu() {
      if (chunkNoteCtxMenuEl) chunkNoteCtxMenuEl.style.display = 'none';
      ns.pendingChunkSelectionCtx = null;
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
      deleteChunkNote: deleteChunkNote,
      upsertChunkNote: upsertChunkNote,
      applyImportedChunkNotes: applyImportedChunkNotes,
      getChunkNotesFileState: getChunkNotesFileState,
      setChunkNotesFileState: setChunkNotesFileState,
      clearChunkNotesFileState: clearChunkNotesFileState,
      buildChunkNotesSnapshot: buildChunkNotesSnapshot,
      saveChunkNotesDebounced: saveChunkNotesDebounced,
      saveChunkNotesNow: saveChunkNotesNow,
      loadChunkNotesForCurrentAudio: loadChunkNotesForCurrentAudio,
      setChunkNoteVisible: setChunkNoteVisible,
      getChunkBlockByRef: getChunkBlockByRef,
      closeChunkNoteContextMenu: closeChunkNoteContextMenu,
      openChunkNoteContextMenu: openChunkNoteContextMenu,
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
    var persistSelectedSentenceNote = deps.persistSelectedSentenceNote;
    var renderNotePreviewSidebar = deps.renderNotePreviewSidebar;

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
