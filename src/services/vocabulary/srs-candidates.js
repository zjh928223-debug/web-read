import {
  VOCABULARY_ENTRY_TYPES,
  WORD_STATUSES,
  normalizeLanguage,
  normalizeLookupKey,
  normalizeNullableText,
  normalizeText,
} from './vocabulary-models.js';

const SRS_ADD_MODES = Object.freeze({
  WORDS_ONLY: 'words',
  ALL: 'all',
});

function stripBoundaryPunctuation(value) {
  return normalizeText(value)
    .replace(/^[\s"'“”‘’()[\]{}<>.,!?;:，。！？；：、-]+/g, '')
    .replace(/[\s"'“”‘’()[\]{}<>.,!?;:，。！？；：、-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeSrsCandidateText(value) {
  return stripBoundaryPunctuation(value)
    .replace(/[,.，。]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getEnglishTokens(value) {
  const normalized = normalizeSrsCandidateText(value);
  return normalized.match(/[a-z]+(?:[-'’][a-z]+)*/g) || [];
}

export function classifySrsCandidateText(value, options = {}) {
  const maxPhraseTokens = Number(options.maxPhraseTokens || 8);
  const normalized = normalizeSrsCandidateText(value);
  const tokens = getEnglishTokens(value);
  if (!normalized || !tokens.length) {
    return { candidate: false, reason: 'empty', normalized, tokenCount: tokens.length };
  }
  if (/\r|\n/.test(String(value || ''))) {
    return { candidate: false, reason: 'long_text', normalized, tokenCount: tokens.length };
  }
  if (tokens.length === 1) {
    return { candidate: true, entry_type: VOCABULARY_ENTRY_TYPES.WORD, normalized, tokenCount: tokens.length };
  }
  if (tokens.length <= maxPhraseTokens) {
    return { candidate: true, entry_type: VOCABULARY_ENTRY_TYPES.PHRASE, normalized, tokenCount: tokens.length };
  }
  return { candidate: false, reason: 'long_text', normalized, tokenCount: tokens.length };
}

function getTargetId(item) {
  return normalizeText(item && (item.targetId || item.target_id || item.id));
}

function buildTemplateItemMap(template) {
  const map = new Map();
  const items = Array.isArray(template && template.items) ? template.items : [];
  items.forEach((item) => {
    const targetId = getTargetId(item);
    if (targetId) map.set(targetId, item);
  });
  return map;
}

function buildSurroundingText(templateItem) {
  const pieces = [
    templateItem && templateItem.sentenceBefore,
    templateItem && templateItem.sourceSentence,
    templateItem && templateItem.sentenceAfter,
  ].map(normalizeText).filter(Boolean);
  return pieces.length ? pieces.join(' ') : null;
}

export function buildSrsCandidatesFromBackfillRun(options = {}) {
  const template = options.template || {};
  const result = options.result || {};
  const requestedTargetIds = new Set((Array.isArray(options.requestedTargetIds) ? options.requestedTargetIds : [])
    .map(normalizeText)
    .filter(Boolean));
  const templateByTargetId = buildTemplateItemMap(template);
  const resultItems = Array.isArray(result.items) ? result.items : [];
  const sourceTitle = normalizeNullableText(options.sourceTitle || options.source_title);
  const sourceUrl = normalizeNullableText(options.sourceUrl || options.source_url);
  const sourceId = normalizeNullableText(options.sourceId || options.source_id);
  const language = normalizeLanguage(options.language);
  const candidates = [];
  const excluded = [];

  resultItems.forEach((resultItem) => {
    const targetId = getTargetId(resultItem);
    if (!targetId || (requestedTargetIds.size && !requestedTargetIds.has(targetId))) return;
    const templateItem = templateByTargetId.get(targetId) || {};
    const rawText = normalizeText(resultItem.markedText || templateItem.markedText || resultItem.boundary);
    const classification = classifySrsCandidateText(rawText);
    const normalizedText = classification.normalized;
    const base = {
      target_id: targetId,
      targetId,
      marked_text: normalizedText,
      markedText: normalizedText,
      lemma: normalizedText,
      token_count: classification.tokenCount,
    };
    if (!classification.candidate) {
      excluded.push({ ...base, reason: classification.reason || 'excluded' });
      return;
    }
    candidates.push({
      ...base,
      word: normalizedText,
      entry_type: classification.entry_type,
      language,
      context: {
        sentence: normalizeText(templateItem.sourceSentence),
        meaning: normalizeNullableText(resultItem.meaning),
        simple_meaning: normalizeNullableText(resultItem.simpleMeaning || resultItem.simple_meaning),
        source_id: sourceId,
        source_title: sourceTitle,
        source_url: sourceUrl,
        surrounding_text: buildSurroundingText(templateItem),
      },
    });
  });

  return { candidates, excluded };
}

export function summarizeSrsCandidates(candidates = [], excluded = [], existingWords = []) {
  const existingByLookupKey = new Map();
  existingWords.forEach((word) => {
    const lookupKey = normalizeLookupKey(word && (word.lookup_key || word.lookupKey || word.lemma || word.word));
    if (lookupKey) existingByLookupKey.set(`${normalizeLanguage(word && word.language)}::${lookupKey}`, word);
  });
  const summary = {
    wordCandidates: 0,
    phraseCandidates: 0,
    excludedLongText: Array.isArray(excluded) ? excluded.length : 0,
    existing: 0,
    known: 0,
    ignored: 0,
  };
  candidates.forEach((candidate) => {
    if (candidate && candidate.entry_type === VOCABULARY_ENTRY_TYPES.PHRASE) summary.phraseCandidates += 1;
    else summary.wordCandidates += 1;
    const key = `${normalizeLanguage(candidate && candidate.language)}::${normalizeLookupKey(candidate && candidate.lemma)}`;
    const existing = existingByLookupKey.get(key);
    if (!existing) return;
    if (existing.status === WORD_STATUSES.KNOWN) summary.known += 1;
    else if (existing.status === WORD_STATUSES.IGNORED) summary.ignored += 1;
    else summary.existing += 1;
  });
  return summary;
}

export function getRemainingSrsCandidatesAfterApply(candidates = [], mode = SRS_ADD_MODES.ALL) {
  if (mode === SRS_ADD_MODES.WORDS_ONLY || mode === VOCABULARY_ENTRY_TYPES.WORD) {
    return candidates.filter((candidate) => candidate && candidate.entry_type === VOCABULARY_ENTRY_TYPES.PHRASE);
  }
  return [];
}

export async function applySrsCandidatesToVocabulary(options = {}) {
  const vocabularyService = options.vocabularyService;
  if (!vocabularyService
    || typeof vocabularyService.getWordByLemma !== 'function') {
    throw new Error('SRS candidate application requires a vocabulary service');
  }
  const acquisitionEnabled = typeof vocabularyService.isAcquisitionEnabled === 'function'
    && vocabularyService.isAcquisitionEnabled();
  if (acquisitionEnabled && typeof vocabularyService.queueVocabularyAcquisition !== 'function') {
    throw new Error('SRS candidate application requires the acquisition service when enabled');
  }
  if (!acquisitionEnabled && typeof vocabularyService.addWordLegacy !== 'function') {
    throw new Error('SRS candidate application requires the explicit legacy adapter when acquisition is disabled');
  }
  const mode = options.mode === SRS_ADD_MODES.WORDS_ONLY || options.mode === VOCABULARY_ENTRY_TYPES.WORD
    ? SRS_ADD_MODES.WORDS_ONLY
    : SRS_ADD_MODES.ALL;
  const candidates = Array.isArray(options.candidates) ? options.candidates : [];
  const existingInfoByKey = options.existingInfoByKey instanceof Map
    ? options.existingInfoByKey
    : null;
  const selected = mode === SRS_ADD_MODES.WORDS_ONLY
    ? candidates.filter((candidate) => candidate && candidate.entry_type === VOCABULARY_ENTRY_TYPES.WORD)
    : candidates;
  const result = {
    processed: 0,
    added: 0,
    existingContextAdded: 0,
    knownContextAdded: 0,
    ignoredSkipped: 0,
    relearned: 0,
  };
  const yieldControl = typeof options.yieldControl === 'function'
    ? options.yieldControl
    : () => new Promise((resolve) => setTimeout(resolve, 0));

  const pendingWrites = [];
  for (let candidateIndex = 0; candidateIndex < selected.length; candidateIndex += 1) {
    const candidate = selected[candidateIndex];
    if (!candidate || !candidate.lemma) continue;
    const existingKey = `${normalizeLanguage(candidate.language)}::${normalizeLookupKey(candidate.lemma)}`;
    const existingInfo = existingInfoByKey && existingInfoByKey.get(existingKey);
    const existing = existingInfoByKey
      ? existingInfo && existingInfo.word || null
      : await vocabularyService.getWordByLemma(candidate.lemma, { language: candidate.language });
    if (existing && existing.status === WORD_STATUSES.IGNORED && !candidate.relearn) {
      result.ignoredSkipped += 1;
      result.processed += 1;
      continue;
    }
    const wordInput = {
      word: candidate.word || candidate.lemma,
      lemma: candidate.lemma,
      language: candidate.language,
      entry_type: candidate.entry_type,
      meaning: candidate.meaning,
      tags: candidate.tags,
      context: candidate.context,
      target_id: candidate.target_id || candidate.targetId,
      preserve_existing_metadata: !!existing,
    };
    if (acquisitionEnabled) {
      pendingWrites.push({ candidate, existing, wordInput });
    } else {
      await vocabularyService.addWordLegacy({
        ...wordInput,
        legacyCaller: 'srs-candidates:feature-flag-fallback',
      });
      if (existing && candidate.relearn && typeof vocabularyService.relearnWord === 'function') {
        await vocabularyService.relearnWord(existing.id, { tags: candidate.tags });
        result.relearned += 1;
      }
    }
    if (!acquisitionEnabled) {
      if (!existing) result.added += 1;
      else if (existing.status === WORD_STATUSES.KNOWN) result.knownContextAdded += 1;
      else result.existingContextAdded += 1;
      result.processed += 1;
      if (candidateIndex < selected.length - 1) await yieldControl();
    }
  }

  if (acquisitionEnabled && pendingWrites.length) {
    if (typeof vocabularyService.queueVocabularyAcquisitions === 'function') {
      await vocabularyService.queueVocabularyAcquisitions(
        pendingWrites.map((item) => item.wordInput),
        {
          existingWords: pendingWrites.map((item) => item.existing),
          transactionChunkSize: options.transactionChunkSize,
        },
      );
    } else {
      for (const item of pendingWrites) await vocabularyService.queueVocabularyAcquisition(item.wordInput);
    }
    pendingWrites.forEach(({ existing }) => {
      if (!existing) result.added += 1;
      else if (existing.status === WORD_STATUSES.KNOWN) result.knownContextAdded += 1;
      else result.existingContextAdded += 1;
      result.processed += 1;
    });
  }

  result.remaining = getRemainingSrsCandidatesAfterApply(candidates, mode);
  return result;
}
