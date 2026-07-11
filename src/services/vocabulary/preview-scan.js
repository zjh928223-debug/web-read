import {
  VOCABULARY_ENTRY_TYPES,
  normalizeLanguage,
  normalizeLookupKey,
  normalizeNullableText,
  normalizeText,
} from './vocabulary-models.js';

export const PREVIEW_SCAN_SOURCE = 'preview-scan';
export const PREVIEW_SCAN_GROUPS = Object.freeze({
  PRIORITY: 'priority',
  PROPER_NOUN: 'proper_noun',
});

export const DEFAULT_PREVIEW_SCAN_TARGET_COUNT = 12;
export const DEFAULT_PREVIEW_SCAN_MAX_COUNT = 20;
export const DEFAULT_PREVIEW_SCAN_MAX_OCCURRENCES_PER_LEMMA = 3;

const BASIC_WORDS = new Set(`
a about above across after again against all almost alone along already also although always am among an and another any anybody anyone
anything are area areas around as ask asked asking at away back be became because become becomes been before began behind being best better
between big both but by came can cannot case certain certainly change children come common could course day days did different do does done
down during each early end enough even ever every everything example few find first for found from full further gave get gets give given
go goes going good got great group had hand hard has have he head help her here high him his how however i if important in into is it its
itself just keep kind knew know known large last later least less let like likely line little long look made make makes man many may me mean
means men might more most much must my need never new next no non not now number of off often old on once one only or other others our out
over own part people place point possible present problem put quite rather really right said same saw say says second see seem seemed seems
seen set several she should show small so some something still such sure take taken than that the their them then there these they thing
things think this those though through time to together too took toward turn under until up upon us use used using very want wanted was way
we well went were what when where whether which while who whole why will with within without word words work world would year years yet you
your
`.trim().split(/\s+/));

function getWordText(word) {
  return normalizeText(word && (word.word || word.text));
}

function getBlockText(block) {
  if (!block) return '';
  const direct = normalizeText(block.text || block.rawEn || block.en);
  if (direct) return direct;
  const words = Array.isArray(block.words) ? block.words : [];
  return normalizeText(words.map(getWordText).filter(Boolean).join(' '));
}

function toInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function stripBoundaryPunctuation(value) {
  return normalizeText(value)
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/[^A-Za-z0-9]+$/, '')
    .trim();
}

export function normalizePreviewToken(value) {
  return stripBoundaryPunctuation(value)
    .replace(/['’]s$/i, '')
    .toLowerCase();
}

function isEnglishWord(value) {
  return /^[a-z]+(?:[-'][a-z]+)*$/i.test(value);
}

function isBasicWord(lemma) {
  if (!lemma) return true;
  if (lemma.length <= 2) return true;
  return BASIC_WORDS.has(lemma);
}

function stableHash(value) {
  const source = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function sanitizeIdPart(value) {
  return normalizeLookupKey(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'item';
}

function createPreviewTargetId(sourceId, lemma, globalIndex) {
  return `preview-${stableHash(sourceId)}-${Number(globalIndex || 0)}-${sanitizeIdPart(lemma)}`;
}

function createOccurrenceKey(blockId, globalIndex) {
  return `${PREVIEW_SCAN_SOURCE}::${String(blockId || 'block')}::g:${Number(globalIndex || 0)}-${Number(globalIndex || 0)}`;
}

export function buildPreviewDocumentContext(state = {}, options = {}) {
  const source = state && typeof state === 'object' ? state : {};
  const useChunkBlocks = !!(source.hasAiChunkData && Array.isArray(source.chunkItems) && source.chunkItems.length);
  const rawBlocks = useChunkBlocks ? source.chunkItems : (Array.isArray(source.segments) ? source.segments : []);
  const blocks = rawBlocks.map((block, index) => {
    const words = Array.isArray(block && block.words) ? block.words : [];
    return {
      type: useChunkBlocks ? 'chunk' : 'segment',
      index,
      id: normalizeText(block && (block.chunkRef || block.segId || block.id || block.segment_id || index)) || String(index),
      text: getBlockText(block),
      words,
    };
  }).filter((block) => block.text);

  if (!blocks.length && Array.isArray(source.words) && source.words.length) {
    blocks.push({
      type: 'words',
      index: 0,
      id: 'words',
      text: normalizeText(source.words.map(getWordText).filter(Boolean).join(' ')),
      words: source.words,
    });
  }

  const articleText = normalizeText(blocks.map((block) => block.text).filter(Boolean).join(' '));
  const articleSentences = blocks.map((block) => block.text).filter(Boolean);
  const documentId = normalizeText(options.documentId || source.documentId || source.currentDocId);
  const audioKey = normalizeText(options.audioKey || source.currentAudioKey);

  return {
    documentId,
    audioKey,
    sourceId: normalizeText(options.sourceId || documentId || audioKey || stableHash(articleText)),
    articleText,
    articleSentences,
    blocks,
  };
}

function buildGeneratedPreviewLookup(items = []) {
  const lookup = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    if (!isPreviewGeneratedItem(item)) return;
    const lemma = normalizePreviewToken(item.markedText || item.marked_text || item.word || item.text);
    if (!lemma) return;
    if (!lookup.has(lemma)) lookup.set(lemma, []);
    lookup.get(lemma).push(item);
  });
  return lookup;
}

export function isPreviewGeneratedItem(item) {
  const source = normalizeText(item && (item.source || item.provider || item.source_type || item.sourceType));
  const targetId = normalizeText(item && (item.targetId || item.target_id));
  return source === PREVIEW_SCAN_SOURCE || targetId.startsWith('preview-');
}

function isMarkedWord(globalIndex, markedMap) {
  if (!Number.isInteger(globalIndex) || !(markedMap instanceof Map)) return false;
  return markedMap.has(globalIndex);
}

function aggregatePreviewTokens(context, options = {}) {
  const markedMap = options.markedMap instanceof Map ? options.markedMap : new Map();
  const byLemma = new Map();
  context.blocks.forEach((block, blockIndex) => {
    const words = Array.isArray(block.words) ? block.words : [];
    words.forEach((word, localIndex) => {
      const text = getWordText(word);
      const lemma = normalizePreviewToken(text);
      const globalIndex = toInteger(word && word.globalIndex) ?? localIndex;
      if (!lemma || !isEnglishWord(lemma) || isBasicWord(lemma) || isMarkedWord(globalIndex, markedMap)) return;
      if (!byLemma.has(lemma)) {
        byLemma.set(lemma, {
          lemma,
          word: lemma,
          markedText: text,
          frequency: 0,
          firstBlockIndex: blockIndex,
          firstGlobalIndex: globalIndex,
          titleCaseCount: 0,
          lowerCaseCount: 0,
          occurrences: [],
        });
      }
      const entry = byLemma.get(lemma);
      entry.frequency += 1;
      if (/^[A-Z][a-z]+/.test(text)) entry.titleCaseCount += 1;
      if (/^[a-z]/.test(text)) entry.lowerCaseCount += 1;
      entry.occurrences.push({
        text,
        blockId: block.id,
        blockIndex,
        sentence: block.text,
        globalIndex,
        localIndex,
      });
    });
  });
  return Array.from(byLemma.values());
}

function scorePreviewEntry(entry) {
  const lengthScore = Math.min(12, entry.lemma.length) * 0.35;
  const frequencyScore = Math.min(5, entry.frequency) * 2.8;
  const earlyScore = entry.firstBlockIndex <= 2 ? 2 : (entry.firstBlockIndex <= 5 ? 1 : 0);
  const properNounScore = isLikelyProperNoun(entry) ? 1.2 : 0;
  return frequencyScore + lengthScore + earlyScore + properNounScore;
}

function isLikelyProperNoun(entry) {
  if (!entry) return false;
  if (entry.titleCaseCount <= 0) return false;
  if (entry.lowerCaseCount > 0) return false;
  return entry.lemma.length > 2;
}

function toPreviewCandidate(entry, context, options = {}) {
  const occurrence = entry.occurrences[0] || {};
  const sourceId = normalizeText(options.sourceId || context.sourceId);
  const group = isLikelyProperNoun(entry) ? PREVIEW_SCAN_GROUPS.PROPER_NOUN : PREVIEW_SCAN_GROUPS.PRIORITY;
  return {
    targetId: createPreviewTargetId(sourceId, entry.lemma, occurrence.globalIndex),
    target_id: createPreviewTargetId(sourceId, entry.lemma, occurrence.globalIndex),
    source: PREVIEW_SCAN_SOURCE,
    source_type: PREVIEW_SCAN_SOURCE,
    group,
    is_proper_noun: group === PREVIEW_SCAN_GROUPS.PROPER_NOUN,
    word: entry.word,
    lemma: entry.lemma,
    markedText: entry.markedText,
    marked_text: entry.markedText,
    entry_type: VOCABULARY_ENTRY_TYPES.WORD,
    language: normalizeLanguage(options.language),
    frequency: entry.frequency,
    score: scorePreviewEntry(entry),
    token_count: 1,
    blockId: normalizeText(occurrence.blockId),
    sourceSentence: normalizeText(occurrence.sentence),
    sentenceBefore: '',
    sentenceAfter: '',
    occurrenceGlobalStart: occurrence.globalIndex,
    occurrenceGlobalEnd: occurrence.globalIndex,
    occurrenceKey: createOccurrenceKey(occurrence.blockId, occurrence.globalIndex),
    occurrences: entry.occurrences.slice(0, DEFAULT_PREVIEW_SCAN_MAX_OCCURRENCES_PER_LEMMA),
    context: {
      sentence: normalizeText(occurrence.sentence),
      source_id: sourceId,
      source_title: normalizeNullableText(options.sourceTitle || options.source_title),
      source_url: normalizeNullableText(options.sourceUrl || options.source_url),
      surrounding_text: null,
    },
  };
}

export async function buildPreviewScan(options = {}) {
  const context = options.context || buildPreviewDocumentContext(options.state || {}, options);
  const vocabularyService = options.vocabularyService || null;
  const generatedLookup = buildGeneratedPreviewLookup(options.generatedItems || options.generated_items || []);
  const targetCount = Math.max(1, Number(options.targetCount || DEFAULT_PREVIEW_SCAN_TARGET_COUNT));
  const maxCount = Math.max(targetCount, Number(options.maxCount || DEFAULT_PREVIEW_SCAN_MAX_COUNT));
  const rawEntries = aggregatePreviewTokens(context, options)
    .map((entry) => ({ ...entry, score: scorePreviewEntry(entry) }))
    .sort((left, right) => right.score - left.score || right.frequency - left.frequency || left.lemma.localeCompare(right.lemma));

  const candidates = [];
  const alreadyExplained = [];
  const excluded = [];

  for (const entry of rawEntries) {
    if (candidates.length >= maxCount) break;
    const existingGenerated = generatedLookup.get(entry.lemma) || [];
    if (existingGenerated.length) {
      alreadyExplained.push(...existingGenerated);
      excluded.push({ lemma: entry.lemma, reason: 'already_explained_current_article' });
      continue;
    }
    if (vocabularyService && typeof vocabularyService.getWordByLemma === 'function') {
      const existingWord = await vocabularyService.getWordByLemma(entry.lemma, { language: options.language });
      if (existingWord) {
        excluded.push({ lemma: entry.lemma, reason: `vocabulary_${existingWord.status || 'existing'}` });
        continue;
      }
    }
    candidates.push(toPreviewCandidate(entry, context, options));
  }

  const limited = candidates.slice(0, maxCount);
  return {
    context,
    candidates: limited,
    alreadyExplained,
    excluded,
    summary: summarizePreviewScan(limited, alreadyExplained, excluded),
  };
}

export function summarizePreviewScan(candidates = [], alreadyExplained = [], excluded = []) {
  return {
    totalCandidates: candidates.length,
    priorityCount: candidates.filter((candidate) => candidate.group !== PREVIEW_SCAN_GROUPS.PROPER_NOUN).length,
    properNounCount: candidates.filter((candidate) => candidate.group === PREVIEW_SCAN_GROUPS.PROPER_NOUN).length,
    alreadyExplainedCount: Array.isArray(alreadyExplained) ? alreadyExplained.length : 0,
    excludedCount: Array.isArray(excluded) ? excluded.length : 0,
  };
}

export function buildPreviewAnnotationTemplate(options = {}) {
  const context = options.context || {};
  const candidates = Array.isArray(options.candidates) ? options.candidates : [];
  return {
    schemaVersion: 2,
    source: PREVIEW_SCAN_SOURCE,
    articleId: normalizeText(options.articleId || context.documentId || context.sourceId),
    articleText: normalizeText(context.articleText),
    articleSentences: Array.isArray(context.articleSentences)
      ? context.articleSentences.map(normalizeText).filter(Boolean)
      : [],
    items: candidates.map((candidate) => ({
      targetId: normalizeText(candidate.targetId),
      markedText: normalizeText(candidate.markedText || candidate.word || candidate.lemma),
      cleanMarkedText: normalizeText(candidate.word || candidate.lemma),
      sourceSentence: normalizeText(candidate.sourceSentence || candidate.context && candidate.context.sentence),
      sentenceBefore: normalizeText(candidate.sentenceBefore),
      sentenceAfter: normalizeText(candidate.sentenceAfter),
      occurrenceIndex: 0,
      previewSource: PREVIEW_SCAN_SOURCE,
    })).filter((item) => item.targetId && item.markedText && item.sourceSentence),
  };
}

export function buildPreviewGeneratedItemsFromResult(options = {}) {
  const resultItems = Array.isArray(options.result && options.result.items) ? options.result.items : [];
  const candidates = Array.isArray(options.candidates) ? options.candidates : [];
  const candidateByTargetId = new Map(candidates.map((candidate) => [normalizeText(candidate.targetId), candidate]));
  return resultItems.map((item, index) => {
    const targetId = normalizeText(item && (item.targetId || item.target_id));
    const candidate = candidateByTargetId.get(targetId);
    if (!candidate) return null;
    const simpleMeaning = normalizeNullableText(item.simpleMeaning || item.simple_meaning || item.shortMeaning || item.short_meaning);
    return {
      id: normalizeText(item.id) || `preview-${targetId}`,
      targetId,
      blockId: candidate.blockId || 'preview-scan',
      markedText: normalizeText(item.markedText || candidate.markedText || candidate.lemma),
      boundary: normalizeText(item.boundary || candidate.markedText || candidate.lemma),
      type: normalizeText(item.type || (candidate.is_proper_noun ? 'proper noun' : 'word')),
      meaning: normalizeText(item.meaning || item.explanation || item.definition),
      simpleMeaning,
      simple_meaning: simpleMeaning,
      memoryHint: normalizeText(item.memoryHint || item.memory_hint),
      occurrenceKey: candidate.occurrenceKey,
      occurrenceGlobalStart: candidate.occurrenceGlobalStart,
      occurrenceGlobalEnd: candidate.occurrenceGlobalEnd,
      sourceSentence: candidate.sourceSentence || candidate.context && candidate.context.sentence || '',
      source: PREVIEW_SCAN_SOURCE,
      preview_group: candidate.group,
      is_proper_noun: !!candidate.is_proper_noun,
      source_id: candidate.context && candidate.context.source_id || '',
      source_title: candidate.context && candidate.context.source_title || '',
      source_url: candidate.context && candidate.context.source_url || '',
      provider: normalizeText(item.provider),
      localOrder: index,
    };
  }).filter(Boolean);
}

export function getPreviewWordIndexesFromGeneratedItems(items = [], options = {}) {
  const maxPerLemma = Math.max(1, Number(options.maxPerLemma || DEFAULT_PREVIEW_SCAN_MAX_OCCURRENCES_PER_LEMMA));
  const counts = new Map();
  const indexes = [];
  (Array.isArray(items) ? items : []).forEach((item) => {
    if (!isPreviewGeneratedItem(item)) return;
    const start = toInteger(item.occurrenceGlobalStart);
    const end = toInteger(item.occurrenceGlobalEnd);
    if (start == null || end == null) return;
    const lemma = normalizePreviewToken(item.markedText || item.word || item.text);
    const count = counts.get(lemma) || 0;
    if (count >= maxPerLemma) return;
    counts.set(lemma, count + 1);
    for (let index = start; index <= end; index += 1) indexes.push(index);
  });
  return Array.from(new Set(indexes)).sort((left, right) => left - right);
}
