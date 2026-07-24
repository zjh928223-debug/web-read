var runtime = {
  getAudioPlayer: null,
  forceUpdateUI: null,
  notifyAnnotationBubbleWordClick: null,
  isChunkMode: null,
  hasActiveTextSelectionWithinChunk: null
};

var legacyTranscriptContainer = null;

function readWordStart(word, element) {
  var value = word && word.start != null ? word.start : element && element.dataset ? element.dataset.wordStart : null;
  var start = Number(value);
  return Number.isFinite(start) ? start : NaN;
}

function readWordIndex(word, element) {
  var value = word && word.globalIndex != null ? word.globalIndex : element && element.dataset ? element.dataset.wordIndex : null;
  var index = Number(value);
  return Number.isInteger(index) ? index : -1;
}

function getRuntimeAudioPlayer() {
  return typeof runtime.getAudioPlayer === 'function' ? runtime.getAudioPlayer() : null;
}

function seekTranscriptWord(start) {
  var audio = getRuntimeAudioPlayer();
  if (audio) audio.currentTime = start;
  if (typeof runtime.forceUpdateUI === 'function') {
    runtime.forceUpdateUI(start);
  }
}

function notifyWordClick(element, options) {
  if (element && typeof runtime.notifyAnnotationBubbleWordClick === 'function') {
    return runtime.notifyAnnotationBubbleWordClick(element, options || {});
  }
  return false;
}

export function handleTranscriptWordClick(options) {
  var opts = options || {};
  var word = opts.word || null;
  var event = opts.event || null;
  var element = opts.element || event && event.currentTarget || null;
  var transcriptStore = opts.transcriptStore || null;
  var start = readWordStart(word, element);
  var index = readWordIndex(word, element);

  if (transcriptStore && index !== -1) {
    transcriptStore.currentWordIndex = index;
  }
  if (Number.isFinite(start)) {
    seekTranscriptWord(start);
  }
  notifyWordClick(element);
}

export function handleTranscriptWordContextMenu(options) {
  var opts = options || {};
  var event = opts.event || null;
  var element = opts.element || event && event.currentTarget || null;
  var opened = notifyWordClick(element, { forceShow: true });
  if (opened && event) {
    event.preventDefault();
    event.stopPropagation();
  }
  return opened;
}

function bindLegacyTranscriptContainer(container) {
  if (!container || legacyTranscriptContainer === container) return;
  legacyTranscriptContainer = container;
  container.addEventListener('click', function (event) {
    var span = event.target && event.target.closest ? event.target.closest('span[data-word-start]') : null;
    if (!span || !container.contains(span)) return;
    if (
      typeof runtime.isChunkMode === 'function' &&
      runtime.isChunkMode() &&
      typeof runtime.hasActiveTextSelectionWithinChunk === 'function' &&
      runtime.hasActiveTextSelectionWithinChunk()
    ) {
      return;
    }
    handleTranscriptWordClick({ event: event, element: span });
  }, true);
}

export function configureTranscriptInteractions(deps) {
  var source = deps || {};
  runtime = Object.assign({}, runtime, {
    getAudioPlayer: source.getAudioPlayer || runtime.getAudioPlayer,
    forceUpdateUI: source.forceUpdateUI || runtime.forceUpdateUI,
    notifyAnnotationBubbleWordClick: source.notifyAnnotationBubbleWordClick || runtime.notifyAnnotationBubbleWordClick,
    isChunkMode: source.isChunkMode || runtime.isChunkMode,
    hasActiveTextSelectionWithinChunk: source.hasActiveTextSelectionWithinChunk || runtime.hasActiveTextSelectionWithinChunk
  });
  if (source.legacyTranscriptContainer) {
    bindLegacyTranscriptContainer(source.legacyTranscriptContainer);
  }
}
