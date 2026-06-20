function requireImportNormalizationFunction(deps, name) {
  if (deps && typeof deps[name] === 'function') return deps[name];
  throw new Error(`Missing annotation import normalization dependency: ${name}`);
}

export function buildManualLightweightTargetLookup(targets, deps = {}) {
  const normalizeAnnotationTextValue = requireImportNormalizationFunction(deps, 'normalizeAnnotationTextValue');
  const normalizeAnnotationSentenceValue = requireImportNormalizationFunction(deps, 'normalizeAnnotationSentenceValue');
  const getAnnotationTargetSentenceText = requireImportNormalizationFunction(deps, 'getAnnotationTargetSentenceText');

  const byId = new Map();
  const bySentenceAndMarkedText = new Map();
  const occurrenceByTargetId = new Map();

  (Array.isArray(targets) ? targets : []).forEach((target) => {
    const targetId = normalizeAnnotationTextValue(target && target.id);
    if (targetId) byId.set(targetId, target);

    const sentence = normalizeAnnotationSentenceValue(getAnnotationTargetSentenceText(target));
    const markedText = normalizeAnnotationTextValue(target && target.markedText).toLowerCase();
    if (!sentence || !markedText) return;

    const key = `${sentence}::${markedText}`;
    if (!bySentenceAndMarkedText.has(key)) bySentenceAndMarkedText.set(key, []);
    const list = bySentenceAndMarkedText.get(key);
    list.push(target);
    occurrenceByTargetId.set(targetId, list.length - 1);
  });

  return {
    byId,
    bySentenceAndMarkedText,
    occurrenceByTargetId
  };
}

export function resolveManualLightweightImportTarget(item, lookup, deps = {}) {
  const buildSyntheticAnnotationTargetFromEncodedId = requireImportNormalizationFunction(
    deps,
    'buildSyntheticAnnotationTargetFromEncodedId'
  );
  const normalizeAnnotationTextValue = requireImportNormalizationFunction(deps, 'normalizeAnnotationTextValue');
  const normalizeAnnotationSentenceValue = requireImportNormalizationFunction(deps, 'normalizeAnnotationSentenceValue');

  if (!item || !lookup) {
    return { target: null, matchType: 'none', reason: 'invalid-item' };
  }

  const directTarget = lookup.byId instanceof Map ? lookup.byId.get(item.targetId) : null;
  if (directTarget) {
    return { target: directTarget, matchType: 'targetId', reason: '' };
  }

  const encodedTarget = buildSyntheticAnnotationTargetFromEncodedId(item.targetId, item);
  if (encodedTarget) {
    return { target: encodedTarget, matchType: 'targetId-encoded-range', reason: '' };
  }

  const normalizedSentence = normalizeAnnotationSentenceValue(item.sentence);
  const markedText = normalizeAnnotationTextValue(item.markedText).toLowerCase();
  if (!normalizedSentence || !markedText) {
    return { target: null, matchType: 'none', reason: 'missing-sentence-or-markedText' };
  }

  const key = `${normalizedSentence}::${markedText}`;
  const matches = lookup.bySentenceAndMarkedText instanceof Map ? (lookup.bySentenceAndMarkedText.get(key) || []) : [];
  if (!matches.length) {
    return { target: null, matchType: 'none', reason: 'missing-target' };
  }
  if (matches.length === 1) {
    return { target: matches[0], matchType: 'sentence+markedText', reason: '' };
  }

  if (Number.isInteger(item.occurrenceIndex) && item.occurrenceIndex >= 0 && item.occurrenceIndex < matches.length) {
    return { target: matches[item.occurrenceIndex], matchType: 'sentence+markedText+occurrenceIndex', reason: '' };
  }

  return { target: null, matchType: 'ambiguous', reason: 'ambiguous-without-occurrenceIndex', candidateCount: matches.length };
}

export function normalizeManualLightweightImportedItem(raw, index, deps = {}) {
  const normalizeAnnotationTextValue = requireImportNormalizationFunction(deps, 'normalizeAnnotationTextValue');

  if (!raw || typeof raw !== 'object') return null;
  const targetId = normalizeAnnotationTextValue(raw.targetId);
  const markedText = normalizeAnnotationTextValue(raw.markedText || raw.marked_text || raw.word || raw.text);
  const sourceSentence = normalizeAnnotationTextValue(raw.sourceSentence || raw.source_sentence || raw.sentence || raw.sentenceText || raw.sentence_text || raw.contextSentence);
  const boundary = normalizeAnnotationTextValue(raw.boundary || raw.match_context || raw.context || raw.phrase);
  const type = normalizeAnnotationTextValue(raw.type || raw.category || raw.label || raw.tag);
  const meaning = normalizeAnnotationTextValue(raw.meaning || raw.means || raw.explanation || raw.definition || raw.cn || raw.zh);
  const memoryHint = normalizeAnnotationTextValue(raw.memoryHint || raw.memory_hint || raw.remember || raw.note || raw.not_meaning || raw.hint);
  const occurrenceIndexValue = Number(raw.occurrenceIndex != null ? raw.occurrenceIndex : raw.occurrence_index);
  const occurrenceIndex = Number.isInteger(occurrenceIndexValue) && occurrenceIndexValue >= 0 ? occurrenceIndexValue : null;
  if (!targetId) {
    return {
      index,
      ok: false,
      reason: 'missing-targetId'
    };
  }
  return {
    index,
    ok: true,
    targetId,
    markedText,
    sentence: sourceSentence,
    sourceSentence,
    occurrenceIndex,
    boundary,
    type,
    meaning,
    memoryHint,
    hasAnyBackfillField: !!(boundary || type || meaning || memoryHint)
  };
}
