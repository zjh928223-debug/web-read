function requireAnnotationMarksFunction(deps, name) {
  if (deps && typeof deps[name] === 'function') return deps[name];
  throw new Error(`Missing annotation marks dependency: ${name}`);
}

export function normalizeAnnotationMark(mark, fallbackSourceType = 'manual-mark') {
  if (!mark || !Number.isInteger(Number(mark.globalIndex))) return null;
  return {
    ...mark,
    globalIndex: Number(mark.globalIndex),
    sourceType: String(mark.sourceType || mark.source || fallbackSourceType)
  };
}

export function parseEncodedAnnotationTargetId(targetId, deps = {}) {
  const normalizeAnnotationTextValue = requireAnnotationMarksFunction(deps, 'normalizeAnnotationTextValue');
  const normalized = normalizeAnnotationTextValue(targetId);
  if (!normalized) return null;
  const match = normalized.match(/^(.*)-([^-]+)-(\d+)-(\d+)$/);
  if (!match) return null;
  const sourceType = normalizeAnnotationTextValue(match[1]);
  const sentenceId = normalizeAnnotationTextValue(match[2]);
  const globalStart = Number(match[3]);
  const globalEnd = Number(match[4]);
  if (!sourceType || !sentenceId || !Number.isInteger(globalStart) || !Number.isInteger(globalEnd) || globalStart < 0 || globalEnd < globalStart) {
    return null;
  }
  return {
    sourceType,
    sentenceId,
    occurrenceGlobalStart: globalStart,
    occurrenceGlobalEnd: globalEnd
  };
}

export function createSessionAnnotationMarksRuntime(deps = {}) {
  const state = deps.state || {};
  const normalizeAnnotationTextValue = requireAnnotationMarksFunction(deps, 'normalizeAnnotationTextValue');

  function buildSyntheticAnnotationTargetFromEncodedId(targetId, fallbackItem = null) {
    const parsed = parseEncodedAnnotationTargetId(targetId, { normalizeAnnotationTextValue });
    if (!parsed) return null;
    const start = parsed.occurrenceGlobalStart;
    const end = parsed.occurrenceGlobalEnd;
    const words = Array.isArray(state.words) ? state.words : [];
    if (start >= words.length || end >= words.length) return null;

    const matchedWords = words.slice(start, end + 1);
    const markedText = normalizeAnnotationTextValue(
      (fallbackItem && fallbackItem.markedText)
      || matchedWords.map((word) => String(word && (word.word || word.text) || '').trim()).filter(Boolean).join(' ')
    );
    const context = requireAnnotationMarksFunction(deps, 'buildAnnotationGenerationDocumentContext')();
    const block = Array.isArray(context && context.blocks)
      ? context.blocks.find((item) => String(item && item.id || '') === parsed.sentenceId)
        || context.blocks.find((item) => String(item && item.index) === parsed.sentenceId)
        || null
      : null;
    const sentenceText = normalizeAnnotationTextValue(
      (fallbackItem && (fallbackItem.sourceSentence || fallbackItem.sentence))
      || (block && block.text)
      || ''
    );
    const boundary = normalizeAnnotationTextValue(
      (fallbackItem && fallbackItem.boundary)
      || sentenceText
      || markedText
    );

    return {
      id: normalizeAnnotationTextValue(targetId),
      sourceType: parsed.sourceType,
      sentenceId: parsed.sentenceId,
      blockId: parsed.sentenceId,
      markedText,
      boundary,
      sentenceText,
      sentencePlainText: sentenceText,
      occurrenceGlobalStart: start,
      occurrenceGlobalEnd: end,
      occurrenceKey: `${parsed.sourceType}::${parsed.sentenceId}::g:${start}-${end}`
    };
  }

  function getAnnotationItemOccurrenceRange(item, targetLookup) {
    const lookup = targetLookup instanceof Map ? targetLookup : new Map();
    const targetId = normalizeAnnotationTextValue(item && item.targetId);
    const target = targetId ? lookup.get(targetId) : null;
    const itemStartValue = item && item.occurrenceGlobalStart;
    const itemEndValue = item && item.occurrenceGlobalEnd;
    const targetStartValue = target && target.occurrenceGlobalStart;
    const targetEndValue = target && target.occurrenceGlobalEnd;
    const start = itemStartValue != null && Number.isInteger(Number(itemStartValue))
      ? Number(itemStartValue)
      : (targetStartValue != null && Number.isInteger(Number(targetStartValue)) ? Number(targetStartValue) : null);
    const end = itemEndValue != null && Number.isInteger(Number(itemEndValue))
      ? Number(itemEndValue)
      : (targetEndValue != null && Number.isInteger(Number(targetEndValue)) ? Number(targetEndValue) : null);
    if ((!Number.isInteger(start) || !Number.isInteger(end)) && targetId) {
      const parsed = parseEncodedAnnotationTargetId(targetId, { normalizeAnnotationTextValue });
      if (parsed) {
        return {
          start: parsed.occurrenceGlobalStart,
          end: parsed.occurrenceGlobalEnd
        };
      }
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) return null;
    return { start, end };
  }

  function rebuildMarksFromAnnotationItems(items, options = {}) {
    const annotationItems = Array.isArray(items) ? items : [];
    const sourceType = String(options.sourceType || 'annotation-import');
    const replaceExisting = options.replaceExisting !== false;
    const targetLookup = options.targetLookup instanceof Map
      ? options.targetLookup
      : requireAnnotationMarksFunction(deps, 'buildAnnotationTargetCollection')().byId;
    const nextMap = replaceExisting ? new Map() : new Map(state.markedMap);
    let addedCount = 0;
    const words = Array.isArray(state.words) ? state.words : [];

    annotationItems.forEach((item) => {
      const range = getAnnotationItemOccurrenceRange(item, targetLookup);
      if (!range) return;
      for (let globalIndex = range.start; globalIndex <= range.end; globalIndex++) {
        const word = words[globalIndex];
        if (!word) continue;
        if (nextMap.has(globalIndex) && !replaceExisting) continue;
        nextMap.set(globalIndex, normalizeAnnotationMark({
          word: String(word.word || word.text || '').trim(),
          start: word.start,
          globalIndex,
          targetId: normalizeAnnotationTextValue(item && item.targetId),
          occurrenceKey: normalizeAnnotationTextValue(item && item.occurrenceKey),
          sourceType
        }, sourceType));
        addedCount += 1;
      }
    });

    if (!addedCount && replaceExisting) {
      state.markedMap.clear();
      deps.saveToDB('marks', []);
      return { addedCount: 0, totalCount: 0 };
    }

    if (!addedCount && !replaceExisting) {
      return { addedCount: 0, totalCount: state.markedMap.size };
    }

    state.markedMap.clear();
    nextMap.forEach((value, key) => state.markedMap.set(key, value));
    deps.saveToDB('marks', Array.from(state.markedMap.values()));
    if (state.isChunkMode) {
      deps.renderChunkMode();
    } else {
      deps.renderTranscript();
    }
    deps.forceUpdateUI(deps.getAudioCurrentTime());
    deps.syncAnnotationGenerationEntryStatus();
    return { addedCount, totalCount: state.markedMap.size };
  }

  return {
    buildSyntheticAnnotationTargetFromEncodedId,
    getAnnotationItemOccurrenceRange,
    normalizeAnnotationMark,
    parseEncodedAnnotationTargetId(targetId) {
      return parseEncodedAnnotationTargetId(targetId, { normalizeAnnotationTextValue });
    },
    rebuildMarksFromAnnotationItems
  };
}
