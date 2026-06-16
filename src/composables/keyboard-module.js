  function isInputLikeTarget(target) {
    var tagName = target && target.tagName ? target.tagName : '';
    if (tagName === 'TEXTAREA') return true;
    if (tagName !== 'INPUT') return false;
    var inputType = String(target.type || '').toLowerCase();
    return !['file', 'color', 'button', 'checkbox', 'radio', 'range'].includes(inputType);
  }

  function init(deps) {
    var audioPlayer = deps.audioPlayer;
    var isInputLikeTargetFn = typeof deps.isInputLikeTarget === 'function' ? deps.isInputLikeTarget : isInputLikeTarget;
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
    var getChunkNoteDeleteDialogEl = deps.getChunkNoteDeleteDialogEl || function () { return deps.chunkNoteDeleteDialogEl; };
    var selectedChunkNoteId = deps.selectedChunkNoteId;
    var handleChunkSelectionContextMenu = deps.handleChunkSelectionContextMenu;
    var chunkNoteCtxAddBtn = deps.chunkNoteCtxAddBtn;
    var pendingChunkSelectionCtx = deps.pendingChunkSelectionCtx;
    var consumePendingChunkSelectionCtx = deps.consumePendingChunkSelectionCtx || pendingChunkSelectionCtx;
    var openChunkNotePopover = deps.openChunkNotePopover;
    var getChunkNoteModalEl = deps.getChunkNoteModalEl || function () { return deps.chunkNoteModalEl; };
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

    // === Main keyboard handler ===
    document.addEventListener('keydown', function (e) {
      if (isInputLikeTargetFn(e.target)) return;
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
      else if (key === backwardKey || lowerKey === backwardKey) {
        e.preventDefault();
        handleBackwardClick();
      }
      else if (key === forwardKey || lowerKey === forwardKey) {
        e.preventDefault();
        handleForwardClick();
      }
    });

    // === Keyup (chunk hold mode) ===
    addEventListener('keyup', function (e) {
      if (isInputLikeTargetFn(e.target)) return;
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
        var ctx = consumePendingChunkSelectionCtx();
        if (!ctx) return;
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
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedChunkNoteId()) {
        var tgt = e.target;
        if (isInputLikeTargetFn(tgt) || (tgt && tgt.isContentEditable)) return;
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
      var deleteDlg = getChunkNoteDeleteDialogEl();
      if (deleteDlg && !deleteDlg.contains(e.target) && !e.target.closest('.chunk-note-tag')) {
        closeChunkNoteDeleteDialog();
        setSelectedChunkNote('');
      }
      var exportDlg = deps.chunkNoteExportDialogEl;
      if (exportDlg && !exportDlg.contains(e.target)) {
        closeChunkNoteExportDialog();
      }
      var modalEl = getChunkNoteModalEl();
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
    var setMarkKey = deps.setMarkKey, setNotesKey = deps.setNotesKey;
    var setAnnotationBubbleKey = deps.setAnnotationBubbleKey;
    var setChunkCnKey = deps.setChunkCnKey, setChunkShadowKey = deps.setChunkShadowKey;
    var setChunkNoteKey = deps.setChunkNoteKey;
    var setBackwardKey = deps.setBackwardKey, setForwardKey = deps.setForwardKey;

    function persistHotkey(storageKey, value) {
      try { localStorage.setItem(storageKey, value); } catch (err) {}
    }

    function returnFocusToReader(inputEl) {
      if (inputEl && typeof inputEl.blur === 'function') inputEl.blur();
      var focusTarget = document.getElementById('main-app-area') || document.body;
      if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus();
    }

    function normalizeHotkeyEvent(e) {
      if (!e) return '';
      if (e.key === 'Escape') return '__escape__';
      if (['CapsLock', 'Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key)) return '';
      var code = String(e.code || '');
      if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
      if (/^Digit[0-9]$/.test(code)) return code.slice(5);
      if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
      var key = String(e.key || '');
      if (key.length === 1) return key.toLowerCase();
      return key;
    }

    function normalizeStoredHotkeyValue(value) {
      var raw = String(value || '').trim();
      if (!raw) return '';
      if (raw.length === 1) return raw.toLowerCase();
      var lower = raw.toLowerCase();
      if (/^([a-z0-9])\1+$/.test(lower)) return lower.charAt(0);
      return raw;
    }

    var activeHotkeyInput = null;

    function applyHotkeyValue(inputEl, validKey) {
      if (inputEl === hotkeyInput) {
        markKey = validKey;
        if (typeof setMarkKey === 'function') setMarkKey(validKey);
        persistHotkey('st.markKey', validKey);
      }
      if (inputEl === hotkeyNotesInput) {
        notesKey = validKey;
        if (typeof setNotesKey === 'function') setNotesKey(validKey);
        persistHotkey('st.notesKey', validKey);
      }
      if (inputEl === hotkeyAnnotationBubbleInput) {
        annotationBubbleKey = validKey;
        if (typeof setAnnotationBubbleKey === 'function') setAnnotationBubbleKey(validKey);
        persistHotkey('st.annotationBubbleKey', validKey);
      }
      if (inputEl === hotkeyChunkCnInput) {
        chunkCnKey = validKey;
        if (typeof setChunkCnKey === 'function') setChunkCnKey(validKey);
        persistHotkey('st.chunkCnKey', validKey);
      }
      if (inputEl === hotkeyChunkShadowInput) {
        chunkShadowKey = validKey;
        if (typeof setChunkShadowKey === 'function') setChunkShadowKey(validKey);
        persistHotkey('st.chunkShadowKey', validKey);
      }
      if (inputEl === hotkeyChunkNoteInput) {
        chunkNoteKey = validKey;
        if (typeof setChunkNoteKey === 'function') setChunkNoteKey(validKey);
        persistHotkey('st.chunkNoteKey', validKey);
      }
      if (inputEl === hotkeyBackwardInput) {
        backwardKey = validKey;
        if (typeof setBackwardKey === 'function') setBackwardKey(validKey);
        persistHotkey('st.backwardKey', validKey);
      }
      if (inputEl === hotkeyForwardInput) {
        forwardKey = validKey;
        if (typeof setForwardKey === 'function') setForwardKey(validKey);
        persistHotkey('st.forwardKey', validKey);
      }
    }

    function setHotkeyDisplay(inputEl, value) {
      inputEl.dataset.hotkeyValue = value;
      inputEl.value = value;
    }

    function clearHotkeyWaiting(inputEl) {
      if (!inputEl) return;
      inputEl.classList.remove('is-hotkey-waiting');
      inputEl.removeAttribute('aria-busy');
      inputEl.value = inputEl.dataset.hotkeyValue || '';
      if (activeHotkeyInput === inputEl) activeHotkeyInput = null;
    }

    function armHotkeyInput(inputEl) {
      if (!inputEl) return;
      if (activeHotkeyInput && activeHotkeyInput !== inputEl) {
        clearHotkeyWaiting(activeHotkeyInput);
      }
      activeHotkeyInput = inputEl;
      inputEl.classList.add('is-hotkey-waiting');
      inputEl.setAttribute('aria-busy', 'true');
      inputEl.value = '按键';
      if (typeof inputEl.select === 'function') inputEl.select();
    }

    function commitHotkeyInput(inputEl, validKey) {
      setHotkeyDisplay(inputEl, validKey);
      applyHotkeyValue(inputEl, validKey);
      clearHotkeyWaiting(inputEl);
      returnFocusToReader(inputEl);
    }

    var hotkeyInputs = [hotkeyInput, hotkeyNotesInput, hotkeyAnnotationBubbleInput, hotkeyBackwardInput, hotkeyForwardInput, hotkeyChunkCnInput, hotkeyChunkShadowInput, hotkeyChunkNoteInput].filter(function (el) { return !!el; });

    document.addEventListener('keydown', function (e) {
      if (!activeHotkeyInput) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

      var validKey = normalizeHotkeyEvent(e);
      if (validKey === '__escape__') {
        clearHotkeyWaiting(activeHotkeyInput);
        returnFocusToReader(activeHotkeyInput);
        return;
      }
      if (!validKey) return;
      commitHotkeyInput(activeHotkeyInput, validKey);
    }, true);

    hotkeyInputs.forEach(function (inp) {
      inp.setAttribute('lang', 'en');
      inp.setAttribute('autocomplete', 'off');
      inp.setAttribute('autocapitalize', 'off');
      inp.setAttribute('spellcheck', 'false');
      inp.setAttribute('readonly', 'readonly');
      inp.setAttribute('role', 'button');
      inp.setAttribute('aria-label', '点击后按键设置快捷键');
      var rawInitialValue = inp.value || '';
      var initialValue = normalizeStoredHotkeyValue(rawInitialValue);
      setHotkeyDisplay(inp, initialValue);
      if (initialValue && initialValue !== rawInitialValue) {
        applyHotkeyValue(inp, initialValue);
      }
      inp.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        armHotkeyInput(inp);
      });
      inp.addEventListener('focus', function () {
        armHotkeyInput(inp);
      });
      inp.addEventListener('keydown', function (e) {
        e.preventDefault();
        e.stopPropagation();
      });
      inp.addEventListener('beforeinput', function (e) {
        e.preventDefault();
      });
      inp.addEventListener('input', function () {
        inp.value = activeHotkeyInput === inp ? '按键' : (inp.dataset.hotkeyValue || '');
      });
      inp.addEventListener('blur', function () {
        setTimeout(function () {
          if (activeHotkeyInput === inp && document.activeElement !== inp) {
            clearHotkeyWaiting(inp);
          }
        }, 0);
      });
    });
  }

  window.__keyboardModule = {
    init: init,
    isInputLikeTarget: isInputLikeTarget
  };
