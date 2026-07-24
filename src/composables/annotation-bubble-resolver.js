import { getAnnotationBubbleApi } from './annotation-bubble.js';
import {
  emitAnnotationDebug,
  emitAnnotationDiagnostics,
  getAnnotationClickResolver,
  getAnnotationGeneratedIndexScopeKey,
  getAnnotationGeneratedResultStore,
  getAnnotationGenerationScope,
  getAnnotationGenerationScopeKey
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
  const getWords = typeof options.getWords === 'function' ? options.getWords : function () { return []; };
  const markedMap = options.markedMap;
  const vocabMatchMap = options.vocabMatchMap;

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
      memoryHint: pickAnnotationValue(data, ['memoryHint', 'memory_hint', 'remember', 'note', 'not_meaning', 'hint'])
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
    const result = resolver.resolveClick({
      span,
      wordIndex,
      words: Array.isArray(words) ? words : [],
      generatedStore: store
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

  function resolveAnnotationBubbleForSpan(span) {
    const wordIndex = Number(span && span.dataset ? span.dataset.wordIndex : NaN);
    if (!Number.isFinite(wordIndex) || wordIndex < 0) return null;
    const generated = resolveGeneratedAnnotationBubbleForSpan(span, wordIndex);
    if (generated) return generated;
    if (!markedMap || typeof markedMap.has !== 'function' || !markedMap.has(wordIndex)) return null;
    if (!vocabMatchMap || typeof vocabMatchMap.get !== 'function') return null;
    const match = vocabMatchMap.get(wordIndex);
    if (!match) return null;
    return normalizeAnnotationBubbleHit(match, wordIndex, span);
  }

  function notifyAnnotationBubbleWordClick(span, options = {}) {
    const bubble = getAnnotationBubble();
    if (!bubble) {
      emitAnnotationDiagnostics('app.generated_bubble_click_skipped', {
        scope: getAnnotationGenerationScope(),
        reason: 'bubble-missing'
      });
      return false;
    }
    const annotation = resolveAnnotationBubbleForSpan(span);
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
    return false;
  }

  window.notifyAnnotationBubbleWordClick = notifyAnnotationBubbleWordClick;

  return {
    getAnnotationBubble,
    notifyAnnotationBubbleWordClick,
    resolveAnnotationBubbleForSpan,
    resolveGeneratedAnnotationBubbleForSpan,
    normalizeAnnotationBubbleHit
  };
}
