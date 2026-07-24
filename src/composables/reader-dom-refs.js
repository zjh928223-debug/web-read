export function collectReaderDomRefs(doc = document) {
  const mainAppArea = doc.getElementById('main-app-area');
  if (mainAppArea && !mainAppArea.hasAttribute('tabindex')) {
    mainAppArea.setAttribute('tabindex', '-1');
  }

  return {
    audioPlayer: doc.getElementById('audio-player'),
    transcriptContainer: doc.getElementById('transcript-container'),
    toggleFollowBtn: doc.getElementById('toggle-follow'),
    highlightModeBtn: doc.getElementById('highlight-mode-btn'),
    themeControlsEl: doc.getElementById('theme-controls'),
    themeToggleBtn: doc.getElementById('theme-toggle'),
    themeCustomPanel: doc.getElementById('theme-custom-panel'),
    themeCustomBgInput: doc.getElementById('theme-custom-bg'),
    themeCustomTextInput: doc.getElementById('theme-custom-text'),
    themeCustomSubInput: doc.getElementById('theme-custom-sub'),
    themeCustomBorderInput: doc.getElementById('theme-custom-border'),
    themeCustomButtonInput: doc.getElementById('theme-custom-button'),
    themeCustomResetBtn: doc.getElementById('theme-custom-reset'),
    toggleChunkBtn: doc.getElementById('toggle-chunk-btn'),
    chunkCnHoldBtn: doc.getElementById('btn-chunk-cn-hold'),
    audioFileInput: doc.getElementById('audio-file'),
    transcriptFileInput: doc.getElementById('transcript-file'),
    visualFileInput: doc.getElementById('visual-file'),
    lblAudio: doc.getElementById('lbl-audio'),
    lblTranscript: doc.getElementById('lbl-transcript'),
    lblVisual: doc.getElementById('lbl-visual'),
    highlightColorInput: doc.getElementById('highlight-color-input'),
    sentenceColorInput: doc.getElementById('sentence-color-input'),
    hotkeyInput: doc.getElementById('hotkey-input'),
    hotkeyAnnotationBubbleInput: doc.getElementById('hotkey-annotation-bubble-input'),
    hotkeyBackwardInput: doc.getElementById('hotkey-backward-input'),
    hotkeyForwardInput: doc.getElementById('hotkey-forward-input'),
    hotkeyChunkCnInput: doc.getElementById('hotkey-chunk-cn-input'),
    hotkeyChunkShadowInput: doc.getElementById('hotkey-chunk-shadow-input'),
    mainAppArea,
    importMarksBtn: doc.getElementById('import-marks-btn'),
    importMarksInput: doc.getElementById('import-marks-file'),
    exportJsonBtn: doc.getElementById('export-json'),
    exportMdAllBtn: doc.getElementById('export-md-all'),
    exportAnnotationLightweightBtn: doc.getElementById('btn-export-annotation-lightweight'),
    importAnnotationLightweightInput: doc.getElementById('import-annotation-lightweight-file'),
    importAnnotationLightweightBtn: doc.getElementById('btn-import-annotation-lightweight'),
    annotationBackfillAiBtn: doc.getElementById('btn-annotation-backfill-ai')
  };
}
