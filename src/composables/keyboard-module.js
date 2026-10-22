  var activeKeyboardController = null;
  function isInputLikeTarget(target) {
    var tagName = target && target.tagName ? target.tagName : '';
    if (tagName === 'TEXTAREA') return true;
    if (tagName !== 'INPUT') return false;
    var inputType = String(target.type || '').toLowerCase();
    return !['file', 'color', 'button', 'checkbox', 'radio', 'range'].includes(inputType);
  }

  function init(deps) {
    if (activeKeyboardController) activeKeyboardController.dispose();
    var cleanups = [];
    var disposed = false;
    function listen(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      cleanups.push(function () { target.removeEventListener(type, handler, options); });
    }
    var audioPlayer = (window.__mediaSource && typeof window.__mediaSource.createActiveMediaProxy === 'function')
      ? window.__mediaSource.createActiveMediaProxy(deps.audioPlayer)
      : deps.audioPlayer;
    var isInputLikeTargetFn = typeof deps.isInputLikeTarget === 'function' ? deps.isInputLikeTarget : isInputLikeTarget;
    var isChunkMode = deps.isChunkMode;
    var chunkCnHoldMode = deps.chunkCnHoldMode;
    var markKey = deps.markKey;
    var annotationBubbleKey = deps.annotationBubbleKey;
    var chunkCnKey = deps.chunkCnKey;
    var chunkShadowKey = deps.chunkShadowKey;
    var backwardKey = deps.backwardKey;
    var forwardKey = deps.forwardKey;
    var getMarkKey = typeof deps.getMarkKey === 'function' ? deps.getMarkKey : function () { return markKey; };
    var getAnnotationBubbleKey = typeof deps.getAnnotationBubbleKey === 'function' ? deps.getAnnotationBubbleKey : function () { return annotationBubbleKey; };
    var getChunkCnKey = typeof deps.getChunkCnKey === 'function' ? deps.getChunkCnKey : function () { return chunkCnKey; };
    var getChunkShadowKey = typeof deps.getChunkShadowKey === 'function' ? deps.getChunkShadowKey : function () { return chunkShadowKey; };
    var getBackwardKey = typeof deps.getBackwardKey === 'function' ? deps.getBackwardKey : function () { return backwardKey; };
    var getForwardKey = typeof deps.getForwardKey === 'function' ? deps.getForwardKey : function () { return forwardKey; };
    var getPrevAnnotationWordKey = deps.getPrevAnnotationWordKey || function () { return '['; };
    var getNextAnnotationWordKey = deps.getNextAnnotationWordKey || function () { return ']'; };
    var toggleMarkCurrent = deps.toggleMarkCurrent;
    var toggleAnnotationBubble = deps.toggleAnnotationBubble;
    var beginHoldChunkCn = deps.beginHoldChunkCn;
    var endHoldChunkCn = deps.endHoldChunkCn;
    var toggleChunkCn = deps.toggleChunkCn;
    var toggleChunkShadow = deps.toggleChunkShadow;
    var handleBackwardClick = deps.handleBackwardClick;
    var handleForwardClick = deps.handleForwardClick;
    var closeCustomThemePanel = deps.closeCustomThemePanel;
    var hotkeyInput = deps.hotkeyInput;
    var hotkeyAnnotationBubbleInput = deps.hotkeyAnnotationBubbleInput;
    var hotkeyBackwardInput = deps.hotkeyBackwardInput;
    var hotkeyForwardInput = deps.hotkeyForwardInput;
    var hotkeyPrevAnnotationWordInput = deps.hotkeyPrevAnnotationWordInput;
    var hotkeyNextAnnotationWordInput = deps.hotkeyNextAnnotationWordInput;
    var hotkeyChunkCnInput = deps.hotkeyChunkCnInput;
    var hotkeyChunkShadowInput = deps.hotkeyChunkShadowInput;
    var highlightColorInput = deps.highlightColorInput;
    var sentenceColorInput = deps.sentenceColorInput;
    var themeCustomPanel = deps.themeCustomPanel;
    var themeControlsEl = deps.themeControlsEl;

    // === Main keyboard handler ===
    listen(document, 'keydown', function (e) {
      if (isInputLikeTargetFn(e.target)) return;
      if (activeHotkeyInput || (deps.isReaderShortcutEventAllowed && !deps.isReaderShortcutEventAllowed(e, document))) return;
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var key = e.key;
      var lowerKey = key.toLowerCase();

      if (key === ' ') {
        e.preventDefault();
        audioPlayer.paused ? audioPlayer.play() : audioPlayer.pause();
      }
      else if (lowerKey === getMarkKey()) {
        e.preventDefault();
        Promise.resolve(toggleMarkCurrent(audioPlayer)).catch(function (error) {
          if (typeof deps.onMarkError === 'function') deps.onMarkError(error);
        });
      }
      else if (lowerKey === getAnnotationBubbleKey()) {
        e.preventDefault();
        toggleAnnotationBubble();
      }
      else if (lowerKey === getChunkCnKey() && isChunkMode()) {
        e.preventDefault();
        if (chunkCnHoldMode()) {
          if (!e.repeat) beginHoldChunkCn();
        } else {
          toggleChunkCn();
        }
      }
      else if (lowerKey === getChunkShadowKey() && isChunkMode()) {
        e.preventDefault();
        toggleChunkShadow();
      }
      else if (key === getBackwardKey() || lowerKey === getBackwardKey()) {
        e.preventDefault();
        handleBackwardClick();
      }
      else if (key === getForwardKey() || lowerKey === getForwardKey()) {
        e.preventDefault();
        handleForwardClick();
      }
      else if (key === getPrevAnnotationWordKey() || lowerKey === getPrevAnnotationWordKey()) {
        e.preventDefault();
        if (deps.navigateAnnotationWord) deps.navigateAnnotationWord(-1);
      }
      else if (key === getNextAnnotationWordKey() || lowerKey === getNextAnnotationWordKey()) {
        e.preventDefault();
        if (deps.navigateAnnotationWord) deps.navigateAnnotationWord(1);
      }
      else if (key === 'Escape' && deps.closeAnnotationNavigation) {
        deps.closeAnnotationNavigation();
      }
    });

    // === Keyup (chunk hold mode) ===
    listen(window, 'keyup', function (e) {
      if (isInputLikeTargetFn(e.target)) return;
      if (!isChunkMode()) return;
      var key = e.key;
      var lowerKey = key.toLowerCase();
      if (lowerKey === getChunkCnKey() && chunkCnHoldMode()) {
        endHoldChunkCn();
      }
    });

    // === Blur (chunk hold mode) ===
    listen(window, 'blur', function () {
      if (chunkCnHoldMode()) endHoldChunkCn();
    });

    // === Escape handler ===
    listen(document, 'keydown', function (e) {
      if (e.key === 'Escape') {
        closeCustomThemePanel();
      }
    });

    // === Mousedown (close panels on outside click) ===
    listen(document, 'mousedown', function (e) {
      if (themeCustomPanel && !themeCustomPanel.hidden && themeControlsEl && !themeControlsEl.contains(e.target)) {
        closeCustomThemePanel();
      }
    }, true);

    // === Highlight color inputs ===
    if (highlightColorInput) {
      listen(highlightColorInput, 'input', function (e) {
        document.documentElement.style.setProperty('--word-highlight-bg', e.target.value);
        localStorage.setItem('highlightColor', e.target.value);
      });
    }
    if (sentenceColorInput) {
      listen(sentenceColorInput, 'input', function (e) {
        document.documentElement.style.setProperty('--sentence-highlight-bg', e.target.value);
        localStorage.setItem('sentenceColor', e.target.value);
      });
    }

    // === Hotkey input bindings ===
    var setMarkKey = deps.setMarkKey;
    var setAnnotationBubbleKey = deps.setAnnotationBubbleKey;
    var setChunkCnKey = deps.setChunkCnKey, setChunkShadowKey = deps.setChunkShadowKey;
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
      if (inputEl === hotkeyPrevAnnotationWordInput) {
        if (deps.setPrevAnnotationWordKey) deps.setPrevAnnotationWordKey(validKey);
        persistHotkey('st.prevAnnotationWordKey', validKey);
      }
      if (inputEl === hotkeyNextAnnotationWordInput) {
        if (deps.setNextAnnotationWordKey) deps.setNextAnnotationWordKey(validKey);
        persistHotkey('st.nextAnnotationWordKey', validKey);
      }
      if (inputEl === hotkeyInput) {
        markKey = validKey;
        if (typeof setMarkKey === 'function') setMarkKey(validKey);
        persistHotkey('st.markKey', validKey);
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
      if (inputEl === hotkeyPrevAnnotationWordInput || inputEl === hotkeyNextAnnotationWordInput) {
        var otherNavigationKey = inputEl === hotkeyPrevAnnotationWordInput ? getNextAnnotationWordKey() : getPrevAnnotationWordKey();
        var reserved = [getMarkKey(), getAnnotationBubbleKey(), getChunkCnKey(), getChunkShadowKey(), getBackwardKey(), getForwardKey(), otherNavigationKey, ' ', 'Escape', 'Enter'];
        if (reserved.some(function (key) { return String(key).toLowerCase() === validKey.toLowerCase(); })) {
          var status = document.getElementById('annotation-navigation-status');
          if (status) status.textContent = '快捷键与现有操作冲突，请换一个按键';
          return;
        }
      }
      setHotkeyDisplay(inputEl, validKey);
      applyHotkeyValue(inputEl, validKey);
      clearHotkeyWaiting(inputEl);
      returnFocusToReader(inputEl);
    }

    var hotkeyInputs = [hotkeyInput, hotkeyAnnotationBubbleInput, hotkeyBackwardInput, hotkeyForwardInput, hotkeyChunkCnInput, hotkeyChunkShadowInput, hotkeyPrevAnnotationWordInput, hotkeyNextAnnotationWordInput].filter(function (el) { return !!el; });

    listen(document, 'keydown', function (e) {
      if (!activeHotkeyInput) return;
      if (e.isComposing || e.keyCode === 229) return;
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
      listen(inp, 'click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        armHotkeyInput(inp);
      });
      listen(inp, 'focus', function () {
        armHotkeyInput(inp);
      });
      listen(inp, 'keydown', function (e) {
        e.preventDefault();
        e.stopPropagation();
      });
      listen(inp, 'beforeinput', function (e) {
        e.preventDefault();
      });
      listen(inp, 'input', function () {
        inp.value = activeHotkeyInput === inp ? '按键' : (inp.dataset.hotkeyValue || '');
      });
      listen(inp, 'blur', function () {
        setTimeout(function () {
          if (disposed) return;
          if (activeHotkeyInput === inp && document.activeElement !== inp) {
            clearHotkeyWaiting(inp);
          }
        }, 0);
      });
    });
    activeKeyboardController = {
      dispose: function () {
        if (disposed) return;
        disposed = true;
        clearHotkeyWaiting(activeHotkeyInput);
        cleanups.splice(0).forEach(function (cleanup) { cleanup(); });
        if (chunkCnHoldMode()) endHoldChunkCn();
      }
    };
    return activeKeyboardController;
  }

  window.__keyboardModule = {
    init: init,
    isInputLikeTarget: isInputLikeTarget
  };
  window.isInputLikeTarget = isInputLikeTarget;
