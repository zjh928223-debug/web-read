var runtime = {
  getAudioPlayer: null,
  getSelection: null,
  forceUpdateUI: null,
  notifyAnnotationBubbleWordClick: null
};

function getActiveSelection() {
  return typeof runtime.getSelection === 'function' ? runtime.getSelection() : null;
}

function hasActiveSelection() {
  var selection = getActiveSelection();
  return !!(selection && !selection.isCollapsed);
}

function getAudioPlayer() {
  return typeof runtime.getAudioPlayer === 'function' ? runtime.getAudioPlayer() : null;
}

function seekChunkTime(start) {
  var audio = getAudioPlayer();
  if (audio) audio.currentTime = start;
  if (typeof runtime.forceUpdateUI === 'function') {
    runtime.forceUpdateUI(start);
  }
}

function notifyAnnotation(target, options) {
  if (target && typeof runtime.notifyAnnotationBubbleWordClick === 'function') {
    return runtime.notifyAnnotationBubbleWordClick(target, options || {});
  }
  return false;
}

export function handleChunkWordClick(options) {
  var opts = options || {};
  var word = opts.word || null;
  var event = opts.event || null;
  var transcriptStore = opts.transcriptStore || null;
  var target = opts.element || event && event.currentTarget || null;

  if (hasActiveSelection()) return;

  var idx = word && word.globalIndex;
  if (transcriptStore && idx != null) {
    transcriptStore.currentWordIndex = idx;
  }

  var start = Number(word && word.start);
  if (Number.isFinite(start)) {
    seekChunkTime(start);
  }

  notifyAnnotation(target);
}

export function handleChunkWordContextMenu(options) {
  var opts = options || {};
  var event = opts.event || null;
  var target = opts.element || event && event.currentTarget || null;
  if (!event) return false;

  var annotationOpened = notifyAnnotation(target, { forceShow: true });
  if (annotationOpened) {
    event.preventDefault();
    event.stopPropagation();
  }
  return annotationOpened;
}

export function handleChunkContextMenu(options) {
  return false;
}

export function handleChunkClick(options) {
  var opts = options || {};
  var chunk = opts.chunk || null;
  var index = opts.index;
  var event = opts.event || null;
  var chunkStore = opts.chunkStore || null;

  if (event && event.target && event.target.closest('.chunk-note-tag')) return;
  if (hasActiveSelection()) return;

  var start = Number(chunk && chunk.start);
  if (!Number.isFinite(start)) return;

  seekChunkTime(start);
  if (chunkStore && Number.isInteger(index)) {
    chunkStore.activeChunkIdx = index;
  }
}

export function configureChunkInteractions(deps) {
  var source = deps || {};
  runtime = Object.assign({}, runtime, {
    getAudioPlayer: source.getAudioPlayer || runtime.getAudioPlayer,
    getSelection: source.getSelection || runtime.getSelection,
    forceUpdateUI: source.forceUpdateUI || runtime.forceUpdateUI,
    notifyAnnotationBubbleWordClick: source.notifyAnnotationBubbleWordClick || runtime.notifyAnnotationBubbleWordClick
  });
}
