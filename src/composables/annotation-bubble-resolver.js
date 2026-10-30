import { getAnnotationBubbleApi } from './annotation-bubble.js';
import {
  emitAnnotationDebug,
  emitAnnotationDiagnostics,
  getAnnotationClickResolver,
  getAnnotationGeneratedIndexScopeKey,
  getAnnotationGeneratedResultStore,
  getAnnotationGenerationScope,
  getAnnotationGenerationScopeKey,
  waitForGeneratedAnnotationIndex
} from './session-facades.js';

function pickAnnotationValue(source, keys) {
  if (!source || typeof source !== 'object') return '';
  for (const key of keys) {
    const value = source[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function getAnnotationBubble() {
  const bubble = getAnnotationBubbleApi();
  if (!bubble) return null;
  if (typeof bubble.init === 'function') {
    try {
      bubble.init();
    } catch (error) {}
  }
  return bubble;
}

export function initAnnotationBubbleResolver(options = {}) {
  const initOptions = options;
  const getWords = typeof options.getWords === 'function' ? options.getWords : function () { return []; };
  const markedMap = options.markedMap;
  const vocabMatchMap = options.vocabMatchMap;
  let bubbleRequestId = 0;
  let disposed = false;
  const bubble = getAnnotationBubble();
  const unsubscribeHide = bubble && typeof bubble.onHide === 'function'
    ? bubble.onHide(() => {
      ++bubbleRequestId;
      if (typeof options.onClose === 'function') options.onClose();
    }) : null;

  function normalizeAnnotationBubbleHit(match, wordIndex, span) {
    const data = match && match.data ? match.data : match;
    if (!data || typeof data !== 'object') return null;
    const words = getWords();
    const word = Number.isFinite(wordIndex) && Array.isArray(words) ? words[wordIndex] : null;
    const clickedText = ((span && span.textContent) || (word && (word.word || word.text)) || '').trim();
    return {
      markedText: pickAnnotationValue(data, ['markedText', 'marked_text', 'word', 'text']) || clickedText,
      boundary: pickAnnotationValue(data, ['boundary', 'match_context', 'context', 'phrase']) || clickedText,
      type: pickAnnotationValue(data, ['type', 'category', 'label', 'tag']),
      meaning: pickAnnotationValue(data, ['meaning', 'means', 'explanation', 'definition', 'cn', 'zh']),
      simpleMeaning: pickAnnotationValue(data, ['simpleMeaning', 'simple_meaning', 'shortMeaning', 'short_meaning']),
      memoryHint: pickAnnotationValue(data, ['memoryHint', 'memory_hint', 'remember', 'note', 'not_meaning', 'hint']),
      source: pickAnnotationValue(data, ['source', 'provider'])
    };
  }

  function resolveGeneratedAnnotationBubbleForSpan(span, wordIndex) {
    const resolver = getAnnotationClickResolver();
    const store = getAnnotationGeneratedResultStore();
    if (!resolver || typeof resolver.resolveClick !== 'function' || !store) return null;
    const currentScopeKey = getAnnotationGenerationScopeKey();
    const indexedScopeKey = getAnnotationGeneratedIndexScopeKey();
    if (indexedScopeKey && indexedScopeKey !== currentScopeKey) {
      emitAnnotationDebug('app.generated_click_scope_mismatch', {
        scope: getAnnotationGenerationScope(),
        indexedScopeKey,
        currentScopeKey,
        wordIndex
      });
      emitAnnotationDiagnostics('app.generated_click_scope_mismatch', {
        scope: getAnnotationGenerationScope(),
        indexedScopeKey,
        currentScopeKey,
        wordIndex
      });
      return null;
    }
    const words = getWords();
    const mark = markedMap && typeof markedMap.get === 'function'
      ? markedMap.get(wordIndex)
      : null;
    const occurrenceKey = mark && mark.occurrenceKey;
    const targetId = mark && mark.targetId;
    const result = resolver.resolveClick({
      span,
      wordIndex,
      words: Array.isArray(words) ? words : [],
      generatedStore: store,
      occurrenceKey,
      targetId
    });
    emitAnnotationDebug('app.generated_click_resolve', {
      scope: getAnnotationGenerationScope(),
      wordIndex,
      clickedText: String((span && span.textContent) || '').trim(),
      hit: !!result,
      targetId: result && result.targetId || '',
      occurrenceKey: result && result.occurrenceKey || '',
      hasMeaning: !!(result && String(result.meaning || '').trim()),
      hasMemoryHint: !!(result && String(result.memoryHint || '').trim()),
      indexedItemCount: typeof store.getItems === 'function' ? store.getItems().length : 0
    });
    emitAnnotationDiagnostics('app.generated_click_resolved', {
      scope: getAnnotationGenerationScope(),
      wordIndex,
      hit: !!result,
      indexedScopeKey,
      generatedItemCount: typeof store.getItems === 'function' ? store.getItems().length : 0,
      occurrenceKey: result && result.occurrenceKey || ''
    });
    return result;
  }

  function resolveAnnotationBubbleForSpan(span, resolveOptions = {}) {
    const wordIndex = Number(span && span.dataset ? span.dataset.wordIndex : NaN);
    if (!Number.isFinite(wordIndex) || wordIndex < 0) return null;
    const generated = resolveGeneratedAnnotationBubbleForSpan(span, wordIndex);
    if (generated) return generated;
    if (!resolveOptions.allowUnmarked && (!markedMap || typeof markedMap.has !== 'function' || !markedMap.has(wordIndex))) return null;
    if (!vocabMatchMap || typeof vocabMatchMap.get !== 'function') return null;
    const match = vocabMatchMap.get(wordIndex);
    if (!match) return null;
    return normalizeAnnotationBubbleHit(match, wordIndex, span);
  }

  function hasPotentialAnnotation(span) {
    const wordIndex = Number(span && span.dataset ? span.dataset.wordIndex : NaN);
    if (!Number.isFinite(wordIndex) || wordIndex < 0) return false;
    if (markedMap && typeof markedMap.has === 'function' && markedMap.has(wordIndex)) return true;
    return !!(vocabMatchMap && typeof vocabMatchMap.has === 'function' && vocabMatchMap.has(wordIndex));
  }

  function generatedAnnotationIndexReady() {
    return getAnnotationGeneratedIndexScopeKey() === getAnnotationGenerationScopeKey();
  }

  function getNavigableWordIndices() {
    const indices = new Set();
    if (markedMap && typeof markedMap.keys === 'function') for (const index of markedMap.keys()) indices.add(Number(index));
    if (vocabMatchMap && typeof vocabMatchMap.entries === 'function') for (const [index, match] of vocabMatchMap.entries()) {
      if (pickAnnotationValue(match && match.data || match, ['meaning', 'means', 'explanation', 'definition', 'cn', 'zh', 'simpleMeaning', 'memoryHint'])) indices.add(Number(index));
    }
    const store = getAnnotationGeneratedResultStore();
    if (generatedAnnotationIndexReady() && store && typeof store.getItems === 'function') {
      const words = getWords();
      for (const item of store.getItems()) {
        if (!pickAnnotationValue(item, ['meaning', 'simpleMeaning', 'memoryHint'])) continue;
        const start = item.occurrenceGlobalStart;
        const end = item.occurrenceGlobalEnd;
        if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
        for (let index = Math.max(0, start); index <= Math.min(end, words.length - 1); index++) indices.add(index);
      }
    }
    return [...indices];
  }

  function setTargetStatus(bubble, span, message, show) {
    const text = String(span && span.textContent || '').trim();
    if (typeof bubble.setStatus === 'function') bubble.setStatus((text ? text + '：' : '') + message);
    else if (typeof bubble.clearAnnotation === 'function') bubble.clearAnnotation();
    if (show && typeof bubble.show === 'function') bubble.show();
  }

  function deferBubbleUntilGeneratedIndex(span, options, requestId) {
    if (typeof waitForGeneratedAnnotationIndex !== 'function') return;
    const scopeKey = getAnnotationGenerationScopeKey();
    emitAnnotationDiagnostics('app.generated_bubble_click_deferred', {
      scope: getAnnotationGenerationScope(),
      wordIndex: Number(span && span.dataset ? span.dataset.wordIndex : NaN),
      indexedScopeKey: getAnnotationGeneratedIndexScopeKey(),
      currentScopeKey: scopeKey
    });
    let wait;
    try {
      wait = waitForGeneratedAnnotationIndex();
    } catch (error) {
      const bubble = getAnnotationBubble();
      if (bubble) setTargetStatus(bubble, span, '释义读取失败，请重试', true);
      emitAnnotationDiagnostics('app.generated_bubble_click_deferred_failed', {
        scope: getAnnotationGenerationScope(),
        reason: error && error.code ? error.code : 'wait-start-failed'
      });
      return;
    }
    Promise.resolve(wait).then(() => {
      if (disposed || requestId !== bubbleRequestId) return;
      if (getAnnotationGenerationScopeKey() !== scopeKey) return;
      if (span && span.isConnected === false) return;
      const annotation = resolveAnnotationBubbleForSpan(span, options);
      const bubble = getAnnotationBubble();
      if (!bubble || typeof bubble.setAnnotation !== 'function') return;
      if (!annotation) {
        setTargetStatus(bubble, span, '暂无释义', true);
        return;
      }
      const bubbleVisible = typeof bubble.isVisible === 'function' ? bubble.isVisible() : false;
      bubble.setAnnotation(annotation);
      if ((!bubbleVisible || options.forceShow) && typeof bubble.show === 'function') {
        bubble.show();
      }
      emitAnnotationDiagnostics('app.generated_bubble_click_deferred_resolved', {
        scope: getAnnotationGenerationScope(),
        wordIndex: Number(span && span.dataset ? span.dataset.wordIndex : NaN),
        occurrenceKey: annotation.occurrenceKey || ''
      });
    }).catch((error) => {
      if (disposed || requestId !== bubbleRequestId || getAnnotationGenerationScopeKey() !== scopeKey || span?.isConnected === false) return;
      const bubble = getAnnotationBubble();
      if (bubble) setTargetStatus(bubble, span, '释义读取失败，请重试', true);
      emitAnnotationDiagnostics('app.generated_bubble_click_deferred_failed', {
        scope: getAnnotationGenerationScope(),
        reason: error && error.code ? error.code : 'wait-failed'
      });
    });
  }

  function notifyAnnotationBubbleWordHover(span) {
    if (disposed || span?.isConnected === false) return false;
    const bubble = getAnnotationBubble();
    if (!bubble?.isVisible?.() || !generatedAnnotationIndexReady()) return false;
    const wordIndex = Number(span?.dataset?.wordIndex);
    if (!Number.isInteger(wordIndex) || !markedMap?.has(wordIndex)) return false;
    const annotation = resolveAnnotationBubbleForSpan(span);
    if (!pickAnnotationValue(annotation, ['meaning', 'simpleMeaning'])) return false;
    if (typeof bubble.setAnnotation !== 'function') return false;
    ++bubbleRequestId;
    if (typeof initOptions.onTargetSelected === 'function') initOptions.onTargetSelected(span);
    bubble.setAnnotation(annotation);
    return true;
  }

  function notifyAnnotationBubbleWordClick(span, options = {}) {
    if (disposed) return false;
    const requestId = ++bubbleRequestId;
    const bubble = getAnnotationBubble();
    if (!bubble) {
      emitAnnotationDiagnostics('app.generated_bubble_click_skipped', {
        scope: getAnnotationGenerationScope(),
        reason: 'bubble-missing'
      });
      return false;
    }
    if (typeof initOptions.onTargetSelected === 'function') initOptions.onTargetSelected(span);
    const annotation = resolveAnnotationBubbleForSpan(span, options);
    const bubbleVisible = typeof bubble.isVisible === 'function' ? bubble.isVisible() : false;
    emitAnnotationDiagnostics('app.generated_bubble_annotation', {
      scope: getAnnotationGenerationScope(),
      wordIndex: Number(span && span.dataset ? span.dataset.wordIndex : NaN),
      hit: !!annotation,
      occurrenceKey: annotation && annotation.occurrenceKey || '',
      bubbleVisible,
      hasMeaning: !!(annotation && String(annotation.meaning || '').trim()),
      hasMemoryHint: !!(annotation && String(annotation.memoryHint || '').trim())
    });
    if (annotation && typeof bubble.setAnnotation === 'function') {
      bubble.setAnnotation(annotation);
      if ((!bubbleVisible || options.forceShow) && typeof bubble.show === 'function') {
        bubble.show();
      }
      return true;
    }
    if (!annotation && hasPotentialAnnotation(span) && !generatedAnnotationIndexReady()) {
      setTargetStatus(bubble, span, '正在读取释义…', true);
      deferBubbleUntilGeneratedIndex(span, options, requestId);
    } else if (!annotation) {
      setTargetStatus(bubble, span, '暂无释义', bubbleVisible || options.forceShow);
    }
    return false;
  }

  window.notifyAnnotationBubbleWordClick = notifyAnnotationBubbleWordClick;

  return {
    getAnnotationBubble,
    notifyAnnotationBubbleWordClick,
    notifyAnnotationBubbleWordHover,
    resolveAnnotationBubbleForSpan,
    resolveGeneratedAnnotationBubbleForSpan,
    normalizeAnnotationBubbleHit,
    getNavigableWordIndices,
    getScopeKey: getAnnotationGenerationScopeKey,
    clear() {
      ++bubbleRequestId;
      const bubble = getAnnotationBubble();
      if (bubble) { bubble.hide(); bubble.clearAnnotation(); }
    },
    dispose() {
      disposed = true;
      ++bubbleRequestId;
      if (unsubscribeHide) unsubscribeHide();
      if (window.notifyAnnotationBubbleWordClick === notifyAnnotationBubbleWordClick) delete window.notifyAnnotationBubbleWordClick;
    }
  };
}
