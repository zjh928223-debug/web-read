import {
  VOCABULARY_ENTRY_TYPES,
  VOCABULARY_TAGS,
  WORD_STATUSES,
  normalizeLanguage,
  normalizeLookupKey,
  normalizeNullableText,
  normalizeText,
} from './vocabulary-models.js';
import {
  applySrsCandidatesToVocabulary,
  classifySrsCandidateText,
  normalizeSrsCandidateText,
} from './srs-candidates.js';
import { isPreviewGeneratedItem, PREVIEW_SCAN_SOURCE } from './preview-scan.js';

export const ARTICLE_SRS_SETTLEMENT_GROUPS = Object.freeze({
  READY: 'ready',
  RELEARN: 'relearn',
  FOCUS: 'focus',
  NEEDS_EXPLICIT_RELEARN: 'needs_explicit_relearn',
  EXCLUDED: 'excluded',
});

function getItemTargetId(item) {
  return normalizeText(item && (item.targetId || item.target_id || item.id));
}

function getItemText(item) {
  return normalizeText(item && (item.markedText || item.marked_text || item.word || item.text || item.boundary));
}

function getItemMeaning(item) {
  return normalizeNullableText(item && (item.meaning || item.explanation || item.definition || item.cn || item.zh));
}

function getItemSimpleMeaning(item) {
  return normalizeNullableText(item && (item.simpleMeaning || item.simple_meaning || item.shortMeaning || item.short_meaning));
}

function getItemSentence(item) {
  return normalizeText(item && (
    item.sourceSentence
    || item.source_sentence
    || item.sentence
    || item.sentenceText
    || item.boundary
    || item.context
  ));
}

function isProperNounPreview(item) {
  if (!isPreviewGeneratedItem(item)) return false;
  if (item && item.is_proper_noun === true) return true;
  const group = normalizeText(item && (item.preview_group || item.group)).toLowerCase();
  const type = normalizeText(item && item.type).toLowerCase();
  return group === 'proper_noun' || type === 'proper noun' || type === 'proper-noun';
}

function getContextSourceId(context) {
  return normalizeText(context && (context.source_id || context.sourceId || context.source_url || context.sourceUrl || context.source_title || context.sourceTitle));
}

function getExplicitContextSourceId(context) {
  return normalizeText(context && (context.source_id || context.sourceId));
}

function countReencounterSources(word, contexts, currentSourceId) {
  const statusUpdatedAt = Date.parse(word && (word.updated_at || word.updatedAt) || 0);
  const sourceIds = new Set();
  (Array.isArray(contexts) ? contexts : []).forEach((context) => {
    const createdAt = Date.parse(context && (context.created_at || context.createdAt) || 0);
    if (Number.isFinite(statusUpdatedAt) && Number.isFinite(createdAt) && createdAt < statusUpdatedAt) return;
    const sourceId = getContextSourceId(context);
    if (sourceId) sourceIds.add(sourceId);
  });
  const current = normalizeText(currentSourceId);
  if (current) sourceIds.add(current);
  return sourceIds.size;
}

function findContextFromCurrentSource(contexts, currentSourceId, sentence) {
  const normalizedSourceId = normalizeText(currentSourceId);
  const normalizedSentence = normalizeText(sentence).toLowerCase();
  if (!normalizedSourceId || !normalizedSentence) return null;
  return (Array.isArray(contexts) ? contexts : []).find((context) => (
    getExplicitContextSourceId(context) === normalizedSourceId
    && normalizeText(context && context.sentence).toLowerCase() === normalizedSentence
  )) || null;
}

function buildSurroundingTextFromItem(item) {
  const pieces = [
    item && (item.sentenceBefore || item.sentence_before),
    getItemSentence(item),
    item && (item.sentenceAfter || item.sentence_after),
  ].map(normalizeText).filter(Boolean);
  return pieces.length ? pieces.join(' ') : null;
}

async function getExistingWordInfo(vocabularyService, lemma, language) {
  if (!vocabularyService || typeof vocabularyService.getWordByLemma !== 'function') {
    return { word: null, contexts: [] };
  }
  const word = await vocabularyService.getWordByLemma(lemma, { language });
  if (!word) return { word: null, contexts: [] };
  const contexts = typeof vocabularyService.getContextsForWord === 'function'
    ? await vocabularyService.getContextsForWord(word.id)
    : [];
  return { word, contexts };
}

async function getExistingWordsAndContexts(vocabularyService, lemmas, language) {
  const lookupKeys = Array.from(new Set((Array.isArray(lemmas) ? lemmas : [])
    .map((lemma) => normalizeLookupKey(lemma))
    .filter(Boolean)));
  if (!lookupKeys.length || !vocabularyService) return new Map();
  if (typeof vocabularyService.getWordsAndContextsByLemmas === 'function') {
    const result = await vocabularyService.getWordsAndContextsByLemmas(lookupKeys, { language });
    if (result instanceof Map) return result;
    if (result && typeof result === 'object') return new Map(Object.entries(result));
  }
  const entries = await Promise.all(lookupKeys.map(async (lookupKey) => [
    lookupKey,
    await getExistingWordInfo(vocabularyService, lookupKey, language),
  ]));
  return new Map(entries);
}

function determineCandidateDisposition({ item, existingWord, contexts, sourceId }) {
  const manual = !isPreviewGeneratedItem(item);
  const status = existingWord && existingWord.status;
  const reencounterCount = existingWord ? countReencounterSources(existingWord, contexts, sourceId) : 0;

  if (!existingWord) {
    return { group: ARTICLE_SRS_SETTLEMENT_GROUPS.READY, eligible: true, reencounterCount };
  }
  if (status === WORD_STATUSES.IGNORED) {
    if (!manual) {
      return { group: ARTICLE_SRS_SETTLEMENT_GROUPS.EXCLUDED, eligible: false, reason: 'ignored_preview', reencounterCount };
    }
    if (reencounterCount >= 3) {
      return { group: ARTICLE_SRS_SETTLEMENT_GROUPS.FOCUS, eligible: true, relearn: true, tags: [VOCABULARY_TAGS.FOCUS], recordReencounter: true, reencounterCount };
    }
    if (reencounterCount >= 2) {
      return { group: ARTICLE_SRS_SETTLEMENT_GROUPS.RELEARN, eligible: true, relearn: true, recordReencounter: true, reencounterCount };
    }
    return {
      group: ARTICLE_SRS_SETTLEMENT_GROUPS.NEEDS_EXPLICIT_RELEARN,
      eligible: false,
      relearn: true,
      recordReencounter: true,
      reason: 'ignored_requires_relearn',
      reencounterCount,
    };
  }
  if (status === WORD_STATUSES.KNOWN) {
    if (!manual) {
      return { group: ARTICLE_SRS_SETTLEMENT_GROUPS.EXCLUDED, eligible: false, reason: 'known_preview', reencounterCount };
    }
    if (reencounterCount >= 2) {
      return { group: ARTICLE_SRS_SETTLEMENT_GROUPS.FOCUS, eligible: true, relearn: true, tags: [VOCABULARY_TAGS.FOCUS], reencounterCount };
    }
    return { group: ARTICLE_SRS_SETTLEMENT_GROUPS.RELEARN, eligible: true, relearn: true, reencounterCount };
  }
  return { group: ARTICLE_SRS_SETTLEMENT_GROUPS.READY, eligible: true, reencounterCount };
}

function dedupeSettlementCandidates(candidates) {
  const byKey = new Map();
  candidates.forEach((candidate) => {
    const key = [
      candidate.language,
      candidate.lemma,
      candidate.entry_type,
      candidate.source_type,
      candidate.context && candidate.context.sentence,
      candidate.context && candidate.context.meaning,
    ].map((value) => normalizeText(value).toLowerCase()).join('::');
    if (!byKey.has(key)) byKey.set(key, candidate);
  });
  return Array.from(byKey.values());
}

export async function buildArticleSrsSettlement(options = {}) {
  const items = Array.isArray(options.items) ? options.items : [];
  const vocabularyService = options.vocabularyService || null;
  const language = normalizeLanguage(options.language);
  const sourceId = normalizeText(options.sourceId || options.source_id);
  const sourceTitle = normalizeNullableText(options.sourceTitle || options.source_title);
  const sourceUrl = normalizeNullableText(options.sourceUrl || options.source_url);
  const candidates = [];
  const excluded = [];
  const existingInfoByLemma = await getExistingWordsAndContexts(
    vocabularyService,
    items.map((item) => normalizeSrsCandidateText(getItemText(item))),
    language,
  );

  for (const item of items) {
    const targetId = getItemTargetId(item);
    const rawText = getItemText(item);
    const meaning = getItemMeaning(item);
    const sentence = getItemSentence(item);
    if (!targetId || !rawText) {
      excluded.push({ targetId, reason: 'missing_target_or_text' });
      continue;
    }
    if (!meaning) {
      excluded.push({ targetId, markedText: rawText, reason: 'missing_meaning' });
      continue;
    }
    const classification = classifySrsCandidateText(rawText);
    if (!classification.candidate) {
      excluded.push({ targetId, markedText: rawText, reason: classification.reason || 'excluded' });
      continue;
    }
    if (isProperNounPreview(item)) {
      excluded.push({ targetId, markedText: rawText, reason: 'preview_proper_noun' });
      continue;
    }
    const lemma = normalizeSrsCandidateText(rawText);
    const displayText = classification.normalized || lemma;
    const simpleMeaning = getItemSimpleMeaning(item);
    const existingInfo = existingInfoByLemma.get(normalizeLookupKey(lemma)) || { word: null, contexts: [] };
    const existingSourceContext = findContextFromCurrentSource(existingInfo.contexts, sourceId, sentence || rawText);
    if (existingSourceContext) {
      excluded.push({
        targetId,
        markedText: rawText,
        lemma,
        reason: 'already_added_current_article',
        simple_meaning: normalizeNullableText(existingSourceContext.simple_meaning || existingSourceContext.simpleMeaning),
      });
      continue;
    }
    const disposition = determineCandidateDisposition({
      item,
      existingWord: existingInfo.word,
      contexts: existingInfo.contexts,
      sourceId,
    });
    if (disposition.group === ARTICLE_SRS_SETTLEMENT_GROUPS.EXCLUDED) {
      excluded.push({
        targetId,
        markedText: rawText,
        lemma,
        reason: disposition.reason || 'excluded_by_status',
        existingStatus: existingInfo.word && existingInfo.word.status,
      });
      continue;
    }

    candidates.push({
      targetId,
      target_id: targetId,
      word: lemma,
      lemma,
      entry_type: classification.entry_type,
      language,
      source_type: isPreviewGeneratedItem(item) ? PREVIEW_SCAN_SOURCE : 'manual_annotation',
      sourceType: isPreviewGeneratedItem(item) ? PREVIEW_SCAN_SOURCE : 'manual_annotation',
      marked_text: displayText,
      markedText: displayText,
      meaning,
      simple_meaning: simpleMeaning,
      token_count: classification.tokenCount,
      group: disposition.group,
      eligible: !!disposition.eligible,
      relearn: !!disposition.relearn,
      record_reencounter: !!disposition.recordReencounter,
      tags: disposition.tags || [],
      reencounter_count: disposition.reencounterCount || 0,
      existing_status: existingInfo.word && existingInfo.word.status || '',
      existing_word_id: existingInfo.word && existingInfo.word.id || '',
      reason: disposition.reason || '',
      context: {
        sentence: sentence || rawText,
        meaning,
        simple_meaning: simpleMeaning,
        source_id: sourceId,
        source_title: sourceTitle,
        source_url: sourceUrl,
        surrounding_text: buildSurroundingTextFromItem(item),
      },
    });
  }

  const deduped = dedupeSettlementCandidates(candidates);
  return {
    candidates: deduped,
    excluded,
    summary: summarizeArticleSrsSettlement(deduped, excluded),
  };
}

export function summarizeArticleSrsSettlement(candidates = [], excluded = []) {
  const active = candidates.filter((candidate) => candidate && candidate.eligible !== false);
  const processed = (Array.isArray(excluded) ? excluded : [])
    .filter((item) => item && item.reason === 'already_added_current_article').length;
  return {
    total: candidates.length,
    ready: candidates.filter((candidate) => candidate.group === ARTICLE_SRS_SETTLEMENT_GROUPS.READY).length,
    relearn: candidates.filter((candidate) => candidate.group === ARTICLE_SRS_SETTLEMENT_GROUPS.RELEARN).length,
    focus: candidates.filter((candidate) => candidate.group === ARTICLE_SRS_SETTLEMENT_GROUPS.FOCUS).length,
    needsExplicitRelearn: candidates.filter((candidate) => candidate.group === ARTICLE_SRS_SETTLEMENT_GROUPS.NEEDS_EXPLICIT_RELEARN).length,
    wordCandidates: active.filter((candidate) => candidate.entry_type === VOCABULARY_ENTRY_TYPES.WORD).length,
    phraseCandidates: active.filter((candidate) => candidate.entry_type === VOCABULARY_ENTRY_TYPES.PHRASE).length,
    excluded: Array.isArray(excluded) ? excluded.length : 0,
    processed,
    completed: candidates.length === 0 && processed > 0,
  };
}

function shouldApplyCandidate(candidate, mode, removedTargetIds) {
  if (!candidate || candidate.eligible === false) return false;
  const targetId = getItemTargetId(candidate);
  if (removedTargetIds && removedTargetIds.has(targetId)) return false;
  if (mode === 'words' && candidate.entry_type !== VOCABULARY_ENTRY_TYPES.WORD) return false;
  return true;
}

export function selectArticleSrsSettlementCandidates(options = {}) {
  const candidates = Array.isArray(options.candidates) ? options.candidates : [];
  const mode = options.mode === 'words' || options.mode === VOCABULARY_ENTRY_TYPES.WORD ? 'words' : 'all';
  const removedTargetIds = new Set((Array.isArray(options.removedTargetIds) ? options.removedTargetIds : [])
    .map(normalizeText)
    .filter(Boolean));
  const selectedCandidates = candidates.filter((candidate) => shouldApplyCandidate(candidate, mode, removedTargetIds));
  return {
    mode,
    selectedCandidates,
    selectedTargetIds: selectedCandidates.map(getItemTargetId).filter(Boolean),
    removedTargetIds: candidates
      .map(getItemTargetId)
      .filter((targetId) => targetId && removedTargetIds.has(targetId)),
  };
}

async function recordContextOnly(vocabularyService, candidate) {
  if (!vocabularyService
    || typeof vocabularyService.upsertVocabularyEntry !== 'function'
    || !candidate
    || !candidate.existing_word_id) {
    return false;
  }
  await vocabularyService.upsertVocabularyEntry({
    word: candidate.word || candidate.lemma,
    lemma: candidate.lemma,
    language: candidate.language,
    entry_type: candidate.entry_type,
    context: candidate.context,
  });
  return true;
}

export async function applyArticleSrsSettlement(options = {}) {
  const vocabularyService = options.vocabularyService;
  const candidates = Array.isArray(options.candidates) ? options.candidates : [];
  const selection = selectArticleSrsSettlementCandidates(options);
  const mode = selection.mode;
  const selected = [];
  const alreadyAppliedTargetIds = [];
  const candidatesByLanguage = new Map();
  selection.selectedCandidates.forEach((candidate) => {
    const language = normalizeLanguage(candidate && candidate.language);
    const group = candidatesByLanguage.get(language) || [];
    group.push(candidate);
    candidatesByLanguage.set(language, group);
  });
  const existingInfoByKey = new Map();
  for (const [language, languageCandidates] of candidatesByLanguage) {
    const existingForLanguage = await getExistingWordsAndContexts(
      vocabularyService,
      languageCandidates.map((candidate) => candidate && candidate.lemma),
      language,
    );
    existingForLanguage.forEach((value, lookupKey) => {
      existingInfoByKey.set(`${language}::${normalizeLookupKey(lookupKey)}`, value);
    });
  }
  for (const candidate of selection.selectedCandidates) {
    const existingInfo = existingInfoByKey.get(
      `${normalizeLanguage(candidate.language)}::${normalizeLookupKey(candidate.lemma)}`,
    ) || { word: null, contexts: [] };
    const context = candidate && candidate.context || {};
    const existingSourceContext = findContextFromCurrentSource(
      existingInfo.contexts,
      context.source_id || context.sourceId,
      context.sentence
    );
    if (existingSourceContext) {
      alreadyAppliedTargetIds.push(getItemTargetId(candidate));
    } else {
      selected.push(candidate);
    }
  }
  const selectedTargetIds = selected.map(getItemTargetId).filter(Boolean);
  const persistedRemovedTargetIds = selection.removedTargetIds;
  const removedTargetIds = new Set(persistedRemovedTargetIds);
  const result = await applySrsCandidatesToVocabulary({
    vocabularyService,
    candidates: selected,
    mode,
    existingInfoByKey,
    transactionChunkSize: options.transactionChunkSize,
  });

  let signalContextsRecorded = 0;
  if (options.recordReencounterSignals !== false) {
    const selectedIds = new Set(selected.map((candidate) => getItemTargetId(candidate)));
    for (const candidate of candidates) {
      const targetId = getItemTargetId(candidate);
      if (!candidate || !candidate.record_reencounter || selectedIds.has(targetId) || removedTargetIds.has(targetId)) continue;
      if (await recordContextOnly(vocabularyService, candidate)) signalContextsRecorded += 1;
    }
  }

  return {
    ...result,
    selectedCount: selected.length,
    selectedTargetIds,
    alreadyAppliedTargetIds,
    removedTargetIds: persistedRemovedTargetIds,
    signalContextsRecorded,
  };
}
