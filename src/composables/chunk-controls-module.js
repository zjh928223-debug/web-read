export function initChunkControls(deps = {}) {
  var state = deps.state;
  var toggleChunkBtn = deps.toggleChunkBtn;
  var chunkCnHoldBtn = deps.chunkCnHoldBtn;
  var audioPlayer = (window.__mediaSource && typeof window.__mediaSource.createActiveMediaProxy === 'function')
    ? window.__mediaSource.createActiveMediaProxy(deps.audioPlayer)
    : deps.audioPlayer;
  var holdPrevHadFocusClass = null;

  function bridgeToPinia() {
    if (typeof deps.bridgeToPinia === 'function') deps.bridgeToPinia();
  }

  function getForceUpdateUI() {
    if (typeof deps.getForceUpdateUI === 'function') return deps.getForceUpdateUI();
    return deps.forceUpdateUI;
  }

  function renderTranscript() {
    if (typeof deps.renderTranscript === 'function') deps.renderTranscript();
  }

  function renderChunkMode() {
    if (typeof deps.renderChunkMode === 'function') deps.renderChunkMode();
  }

  function toggleChunkMode(forceState = null) {
    if (!state.chunkItems || state.chunkItems.length === 0 || !state.hasAiChunkData) {
      return;
    }

    var newState = forceState !== null ? forceState : !state.isChunkMode;
    if (newState === state.isChunkMode) return;

    var runtimeWordCount = window.__state && Array.isArray(window.__state.words) ? window.__state.words.length : 0;
    var preserveScrollAnchor = runtimeWordCount <= 2000;
    var anchorRatio = 0;
    var container = document.getElementById('main-app-area');
    var anchorEl = null;
    if (preserveScrollAnchor) {
      if (state.isChunkMode) {
        anchorEl = document.querySelector('.chunk-active') || document.querySelector('.chunk-block');
      } else {
        anchorEl = document.querySelector('.sentence-active') || document.querySelector('.transcript-line');
      }
    }

    if (preserveScrollAnchor && anchorEl && container) {
      var rect = anchorEl.getBoundingClientRect();
      var containerRect = container.getBoundingClientRect();
      anchorRatio = rect.top - containerRect.top;
    }

    state.isChunkMode = newState;
    var transcriptView = document.getElementById('transcript-vue-container');
    var chunkView = document.getElementById('chunk-vue-container');
    if (transcriptView && chunkView) {
      transcriptView.classList.toggle('reader-view-hidden', newState);
      chunkView.classList.toggle('reader-view-hidden', !newState);
    }
    if (!state.isChunkMode) {
      state.lastAiPrevTapChunkIndex = -1;
      state.lastAiPrevTapAt = 0;
    }
    localStorage.setItem('isChunkMode', state.isChunkMode);
    if (toggleChunkBtn) toggleChunkBtn.classList.toggle('active', state.isChunkMode);
    if (typeof deps.updateHighlightModeUI === 'function') deps.updateHighlightModeUI();

    if (preserveScrollAnchor) {
      if (state.isChunkMode) renderChunkMode();
      else renderTranscript();
      updateChunkFocusModeUI();
    }

    if (!preserveScrollAnchor) {
      requestAnimationFrame(function () {
        var forceUpdateUI = getForceUpdateUI();
        if (typeof forceUpdateUI === 'function' && audioPlayer) forceUpdateUI(audioPlayer.currentTime);
      });
      return;
    }

    requestAnimationFrame(function () {
      if (preserveScrollAnchor) updateChunkFocusModeUI();
      var forceUpdateUI = getForceUpdateUI();
      if (typeof forceUpdateUI === 'function' && audioPlayer) {
        forceUpdateUI(audioPlayer.currentTime);
      }

      var newAnchor = null;
      if (state.isChunkMode) {
        newAnchor = document.querySelector('.chunk-active');
      } else {
        newAnchor = document.querySelector('.sentence-active');
      }

      if (preserveScrollAnchor && newAnchor && container) {
        var nextRect = newAnchor.getBoundingClientRect();
        var currentTop = nextRect.top - container.getBoundingClientRect().top;
        container.scrollTop += currentTop - anchorRatio;
      }
    });
  }

  function setChunkCnVisible(value, persist = true) {
    if (!state.isChunkMode) return;
    state.chunkCnVisible = !!value;
    if (persist) localStorage.setItem('st.chunkCnVisible', String(state.chunkCnVisible));
    document.querySelectorAll('.chunk-cn').forEach(function (el) {
      if (state.chunkCnVisible) el.classList.remove('hidden-cn');
      else el.classList.add('hidden-cn');
    });
    bridgeToPinia();
  }

  function toggleChunkCn() {
    if (!state.isChunkMode) return;
    setChunkCnVisible(!state.chunkCnVisible, true);
  }

  function updateChunkCnHoldBtn() {
    var btn = document.getElementById('btn-chunk-cn-hold');
    if (!btn) return;
    btn.classList.toggle('active', state.chunkCnHoldMode);
    btn.innerText = state.chunkCnHoldMode ? '按住' : '持续';
    bridgeToPinia();
  }

  function toggleChunkCnHoldMode() {
    state.chunkCnHoldMode = !state.chunkCnHoldMode;
    localStorage.setItem('st.chunkCnHoldMode', String(state.chunkCnHoldMode));
    updateChunkCnHoldBtn();
  }

  function beginHoldChunkCn() {
    if (!state.isChunkMode) return;
    if (state.isHoldingChunkCn) return;
    state.isHoldingChunkCn = true;
    state.holdPrevChunkCnVisible = state.chunkCnVisible;
    var container = document.getElementById('transcript-container');
    if (!container) return;
    holdPrevHadFocusClass = container.classList.contains('cn-mode-focus');
    if (!holdPrevHadFocusClass) container.classList.add('cn-mode-focus');
    if (!state.chunkCnVisible) setChunkCnVisible(true, false);
  }

  function endHoldChunkCn() {
    if (!state.isChunkMode) return;
    if (!state.isHoldingChunkCn) return;
    state.isHoldingChunkCn = false;
    var container = document.getElementById('transcript-container');
    if (container && holdPrevHadFocusClass === false) container.classList.remove('cn-mode-focus');
    if (state.holdPrevChunkCnVisible === false) setChunkCnVisible(false, false);
    state.holdPrevChunkCnVisible = null;
    holdPrevHadFocusClass = null;
    bridgeToPinia();
  }

  function updateChunkFocusModeUI() {
    var btn = document.getElementById('btn-chunk-focus');
    var legacyContainer = document.getElementById('transcript-container');
    var vueContainer = document.getElementById('chunk-vue-container');
    var isFocus = state.chunkCnMode === 'focus';
    if (btn) {
      btn.innerText = isFocus ? '聚焦' : '全局';
      btn.classList.toggle('active', isFocus);
    }
    if (legacyContainer) legacyContainer.classList.toggle('cn-mode-focus', isFocus);
    if (vueContainer) vueContainer.classList.toggle('cn-mode-focus', isFocus);
    bridgeToPinia();
  }

  function toggleChunkFocusMode() {
    if (!state.isChunkMode) return;
    state.chunkCnMode = state.chunkCnMode === 'global' ? 'focus' : 'global';
    localStorage.setItem('st.chunkCnMode', state.chunkCnMode);
    updateChunkFocusModeUI();
  }

  function toggleChunkShadow() {
    state.isChunkShadowOn = !state.isChunkShadowOn;
    localStorage.setItem('isChunkShadowOn', state.isChunkShadowOn);

    if (state.isChunkShadowOn) {
      document.body.classList.remove('hide-chunk-shadow');
    } else {
      document.body.classList.add('hide-chunk-shadow');
    }
    updateShadowBtnText();
  }

  function updateShadowBtnText() {
    var btn = document.getElementById('btn-toggle-shadow-manual');
    if (btn) btn.innerText = state.isChunkShadowOn ? '开关 S' : '开关 S';
  }

  function toggleChunkShadowManual() {
    toggleChunkShadow();
  }

  if (chunkCnHoldBtn && chunkCnHoldBtn.dataset.chunkControlsBound !== '1') {
    chunkCnHoldBtn.dataset.chunkControlsBound = '1';
    chunkCnHoldBtn.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      toggleChunkCnHoldMode();
    });
  }

  setTimeout(function () {
    try { updateChunkCnHoldBtn(); } catch (e) {}
  }, 0);

  var api = {
    toggleChunkMode: toggleChunkMode,
    setChunkCnVisible: setChunkCnVisible,
    toggleChunkCn: toggleChunkCn,
    updateChunkCnHoldBtn: updateChunkCnHoldBtn,
    toggleChunkCnHoldMode: toggleChunkCnHoldMode,
    beginHoldChunkCn: beginHoldChunkCn,
    endHoldChunkCn: endHoldChunkCn,
    updateChunkFocusModeUI: updateChunkFocusModeUI,
    toggleChunkFocusMode: toggleChunkFocusMode,
    toggleChunkShadow: toggleChunkShadow,
    updateShadowBtnText: updateShadowBtnText,
    toggleChunkShadowManual: toggleChunkShadowManual
  };

  window.toggleChunkMode = toggleChunkMode;
  window.toggleChunkFocusMode = toggleChunkFocusMode;
  window.toggleChunkShadowManual = toggleChunkShadowManual;
  window.updateChunkCnHoldBtn = updateChunkCnHoldBtn;

  return api;
}
