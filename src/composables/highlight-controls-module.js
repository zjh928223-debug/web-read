export function initHighlightControls(deps = {}) {
  var transcriptState = deps.transcriptState;
  var chunkState = deps.chunkState;
  var playbackState = deps.playbackState;
  var highlightModeBtn = deps.highlightModeBtn;
  var audioPlayer = deps.audioPlayer;

  function getForceUpdateUI() {
    if (typeof deps.getForceUpdateUI === 'function') return deps.getForceUpdateUI();
    return deps.forceUpdateUI;
  }

  function cycleHighlightMode() {
    transcriptState.highlightMode = (transcriptState.highlightMode + 1) % 3;
    playbackState.lastActiveSegIndex = -1;
    updateHighlightModeUI();
    var forceUpdateUI = getForceUpdateUI();
    if (typeof forceUpdateUI === 'function' && audioPlayer) {
      forceUpdateUI(audioPlayer.currentTime);
    }
  }

  function updateHighlightModeUI() {
    var text = ['高亮:关', '高亮:词', '高亮:句'][transcriptState.highlightMode];
    if (!highlightModeBtn) return;
    highlightModeBtn.textContent = text;
    highlightModeBtn.classList.toggle('active', transcriptState.highlightMode !== 0);
    document.body.classList.toggle(
      'highlight-sentence-mode',
      transcriptState.highlightMode === 2 && !chunkState.isChunkMode
    );
  }

  updateHighlightModeUI();

  window.cycleHighlightMode = cycleHighlightMode;

  return {
    cycleHighlightMode: cycleHighlightMode,
    updateHighlightModeUI: updateHighlightModeUI
  };
}
