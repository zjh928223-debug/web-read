  function init(deps) {
    var audioPlayer = deps.audioPlayer;
    var isInputLikeTarget = deps.isInputLikeTarget;
    var isChunkMode = deps.isChunkMode;
    var chunkCnHoldMode = deps.chunkCnHoldMode;
    var chunkNoteVisible = deps.chunkNoteVisible;
    var markKey = deps.markKey;
    var notesKey = deps.notesKey;
    var annotationBubbleKey = deps.annotationBubbleKey;
    var chunkCnKey = deps.chunkCnKey;
    var chunkShadowKey = deps.chunkShadowKey;
    var chunkNoteKey = deps.chunkNoteKey;
    var backwardKey = deps.backwardKey;
    var forwardKey = deps.forwardKey;
    var toggleMarkCurrent = deps.toggleMarkCurrent;
    var toggleCurrentNote = deps.toggleCurrentNote;
    var toggleAnnotationBubble = deps.toggleAnnotationBubble;
    var beginHoldChunkCn = deps.beginHoldChunkCn;
    var endHoldChunkCn = deps.endHoldChunkCn;
    var toggleChunkCn = deps.toggleChunkCn;
    var toggleChunkShadow = deps.toggleChunkShadow;
    var setChunkNoteVisible = deps.setChunkNoteVisible;
    var handleBackwardClick = deps.handleBackwardClick;
    var handleForwardClick = deps.handleForwardClick;
    var closeCustomThemePanel = deps.closeCustomThemePanel;
    var cancelChunkNoteModal = deps.cancelChunkNoteModal;
    var closeChunkNoteContextMenu = deps.closeChunkNoteContextMenu;
    var closeChunkNoteDeleteDialog = deps.closeChunkNoteDeleteDialog;
    var closeChunkNoteExportDialog = deps.closeChunkNoteExportDialog;
    var setSelectedChunkNote = deps.setSelectedChunkNote;
    var openChunkNoteDeleteDialog = deps.openChunkNoteDeleteDialog;
    var selectedChunkNoteId = deps.selectedChunkNoteId;
    var handleChunkSelectionContextMenu = deps.handleChunkSelectionContextMenu;
    var chunkNoteCtxAddBtn = deps.chunkNoteCtxAddBtn;
    var pendingChunkSelectionCtx = deps.pendingChunkSelectionCtx;
    var openChunkNotePopover = deps.openChunkNotePopover;
    var hotkeyInput = deps.hotkeyInput;
    var hotkeyNotesInput = deps.hotkeyNotesInput;
    var hotkeyAnnotationBubbleInput = deps.hotkeyAnnotationBubbleInput;
    var hotkeyBackwardInput = deps.hotkeyBackwardInput;
    var hotkeyForwardInput = deps.hotkeyForwardInput;
    var hotkeyChunkCnInput = deps.hotkeyChunkCnInput;
    var hotkeyChunkShadowInput = deps.hotkeyChunkShadowInput;
    var hotkeyChunkNoteInput = deps.hotkeyChunkNoteInput;
    var highlightColorInput = deps.highlightColorInput;
    var sentenceColorInput = deps.sentenceColorInput;
    var themeCustomPanel = deps.themeCustomPanel;
    var themeControlsEl = deps.themeControlsEl;
    var closeAnnotationPromptPanel = deps.closeAnnotationPromptPanel;

    // === Main keyboard handler ===
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
        toggleCurrentNote();
      }
      else if (lowerKey === annotationBubbleKey) {
        e.preventDefault();
        toggleAnnotationBubble();
      }
      else if (lowerKey === chunkCnKey && isChunkMode()) {
        e.preventDefault();
        if (chunkCnHoldMode()) {
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
        setChunkNoteVisible(!chunkNoteVisible(), true);
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

    // === Keyup (chunk hold mode) ===
    addEventListener('keyup', function (e) {
      if (isInputLikeTarget(e.target)) return;
      if (!isChunkMode()) return;
      var key = e.key;
      var lowerKey = key.toLowerCase();
      if (lowerKey === chunkCnKey && chunkCnHoldMode()) {
        endHoldChunkCn();
      }
    });

    // === Blur (chunk hold mode) ===
    window.addEventListener('blur', function () {
      if (chunkCnHoldMode()) endHoldChunkCn();
    });

    // === Context menu handler ===
    document.addEventListener('contextmenu', handleChunkSelectionContextMenu);
    if (chunkNoteCtxAddBtn) {
      chunkNoteCtxAddBtn.addEventListener('mousedown', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (!pendingChunkSelectionCtx()) return;
        var ctx = pendingChunkSelectionCtx();
        closeChunkNoteContextMenu();
        openChunkNotePopover(ctx);
        var sel = window.getSelection();
        if (sel) {
          try { sel.removeAllRanges(); } catch (err) {}
        }
      });
    }

    // === Escape / Delete handler ===
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeCustomThemePanel();
        cancelChunkNoteModal();
        closeChunkNoteContextMenu();
        closeChunkNoteDeleteDialog();
        closeChunkNoteExportDialog();
        setSelectedChunkNote('');
        if (typeof closeAnnotationPromptPanel === 'function') closeAnnotationPromptPanel();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedChunkNoteId()) {
        var tgt = e.target;
        if (isInputLikeTarget(tgt) || (tgt && tgt.isContentEditable)) return;
        e.preventDefault();
        openChunkNoteDeleteDialog(selectedChunkNoteId());
      }
    });

    // === Mousedown (close panels on outside click) ===
    document.addEventListener('mousedown', function (e) {
      if (themeCustomPanel && !themeCustomPanel.hidden && themeControlsEl && !themeControlsEl.contains(e.target)) {
        closeCustomThemePanel();
      }
      var tags = document.querySelectorAll('.chunk-note-tag.editing');
      for (var i = 0; i < tags.length; i++) {
        var tag = tags[i];
        if (tag.contains(e.target)) continue;
        var finish = tag.__finishChunkNoteEdit;
        if (typeof finish === 'function') finish(false);
      }
      var ctxMenu = deps.chunkNoteCtxMenu;
      if (ctxMenu && ctxMenu.style.display === 'block') {
        if (!ctxMenu.contains(e.target)) closeChunkNoteContextMenu();
      }
      var deleteDlg = deps.chunkNoteDeleteDialogEl;
      if (deleteDlg && !deleteDlg.contains(e.target) && !e.target.closest('.chunk-note-tag')) {
        closeChunkNoteDeleteDialog();
        setSelectedChunkNote('');
      }
      var exportDlg = deps.chunkNoteExportDialogEl;
      if (exportDlg && !exportDlg.contains(e.target)) {
        closeChunkNoteExportDialog();
      }
      var modalEl = deps.chunkNoteModalEl;
      if (!modalEl) return;
      if (modalEl.contains(e.target)) return;
      deps.saveChunkNoteFromModal();
    }, true);

    // === Highlight color inputs ===
    if (highlightColorInput) {
      highlightColorInput.addEventListener('input', function (e) {
        document.documentElement.style.setProperty('--word-highlight-bg', e.target.value);
        localStorage.setItem('highlightColor', e.target.value);
      });
    }
    if (sentenceColorInput) {
      sentenceColorInput.addEventListener('input', function (e) {
        document.documentElement.style.setProperty('--sentence-highlight-bg', e.target.value);
        localStorage.setItem('sentenceColor', e.target.value);
      });
    }

    // === Hotkey input bindings ===
    var hotkeyRefs = {
      hotkeyInput: hotkeyInput, hotkeyNotesInput: hotkeyNotesInput,
      hotkeyAnnotationBubbleInput: hotkeyAnnotationBubbleInput,
      hotkeyBackwardInput: hotkeyBackwardInput, hotkeyForwardInput: hotkeyForwardInput,
      hotkeyChunkCnInput: hotkeyChunkCnInput, hotkeyChunkShadowInput: hotkeyChunkShadowInput,
      hotkeyChunkNoteInput: hotkeyChunkNoteInput
    };

    var setMarkKey = deps.setMarkKey, setNotesKey = deps.setNotesKey;
    var setAnnotationBubbleKey = deps.setAnnotationBubbleKey;
    var setChunkCnKey = deps.setChunkCnKey, setChunkShadowKey = deps.setChunkShadowKey;
    var setChunkNoteKey = deps.setChunkNoteKey;
    var setBackwardKey = deps.setBackwardKey, setForwardKey = deps.setForwardKey;

    [hotkeyInput, hotkeyNotesInput, hotkeyAnnotationBubbleInput, hotkeyBackwardInput, hotkeyForwardInput, hotkeyChunkCnInput, hotkeyChunkShadowInput, hotkeyChunkNoteInput].filter(function (el) { return !!el; }).forEach(function (inp) {
      inp.addEventListener('keydown', function (e) {
        e.preventDefault();
        var validKey = (e.key.length === 1) ? e.key.toLowerCase() : e.key;
        inp.value = validKey;

        if (inp === hotkeyInput) { setMarkKey(validKey); localStorage.setItem('markKey', validKey); }
        if (inp === hotkeyNotesInput) { setNotesKey(validKey); localStorage.setItem('notesKey', validKey); }
        if (inp === hotkeyAnnotationBubbleInput) { setAnnotationBubbleKey(validKey); localStorage.setItem('annotationBubbleKey', validKey); }
        if (inp === hotkeyChunkCnInput) { setChunkCnKey(validKey); localStorage.setItem('chunkCnKey', validKey); }
        if (inp === hotkeyChunkShadowInput) { setChunkShadowKey(validKey); localStorage.setItem('chunkShadowKey', validKey); }
        if (inp === hotkeyChunkNoteInput) { setChunkNoteKey(validKey); localStorage.setItem('chunkNoteKey', validKey); }
        if (inp === hotkeyBackwardInput) { setBackwardKey(validKey); localStorage.setItem('backwardKey', validKey); }
        if (inp === hotkeyForwardInput) { setForwardKey(validKey); localStorage.setItem('forwardKey', validKey); }
      });
    });
  }

  window.__keyboardModule = { init: init };
