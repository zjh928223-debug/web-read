(function () {
  'use strict';

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

    function buildChunkNotesSnapshot() {
      return {
        version: 1,
        audioKey: deps.currentAudioKeyGetter ? deps.currentAudioKeyGetter() : 'default-audio',
        updatedAt: Date.now(),
        notes: Object.values(ns.chunkNotesMap).sort(function (a, b) {
          return (a.chunkIdx - b.chunkIdx) || (a.startGlobal - b.startGlobal);
        })
      };
    }

    function saveChunkNotesDebounced() {
      if (ns.chunkNoteSaveTimer) clearTimeout(ns.chunkNoteSaveTimer);
      ns.chunkNoteSaveTimer = setTimeout(function () {
        saveToDB(getChunkNotesStorageKey(), buildChunkNotesSnapshot());
      }, 180);
    }

    async function loadChunkNotesForCurrentAudio() {
      var data = await loadFromDB(getChunkNotesStorageKey());
      if (data && Array.isArray(data.notes)) {
        var next = {};
        data.notes.forEach(function (n) {
          if (!n || typeof n !== 'object') return;
          if (!n.id || !n.chunkRef) return;
          next[n.id] = Object.assign({}, n, {
            coordSpace: typeof n.coordSpace === 'string' ? n.coordSpace : undefined,
            x: Number.isFinite(Number(n.x)) ? Number(n.x) : undefined,
            y: Number.isFinite(Number(n.y)) ? Number(n.y) : undefined,
            offsetX: Number.isFinite(Number(n.offsetX)) ? Number(n.offsetX) : undefined,
            offsetY: Number.isFinite(Number(n.offsetY)) ? Number(n.offsetY) : undefined,
            w: Number.isFinite(Number(n.w)) ? Number(n.w) : undefined,
            h: Number.isFinite(Number(n.h)) ? Number(n.h) : undefined,
            fontSize: sanitizeChunkNoteFontSize(n.fontSize)
          });
        });
        ns.chunkNotesMap = next;
      } else {
        ns.chunkNotesMap = {};
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
        if ((blocks[i].dataset.chunkRef || '') === chunkRef) return blocks[i];
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
      var block = getChunkBlockByRef(note.chunkRef);
      var enDiv = block ? block.querySelector('.chunk-en') : null;
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
      buildChunkNotesSnapshot: buildChunkNotesSnapshot,
      saveChunkNotesDebounced: saveChunkNotesDebounced,
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
})();
