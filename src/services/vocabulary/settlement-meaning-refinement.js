import {
  VOCABULARY_ENTRY_TYPES,
  normalizeNullableText,
  normalizeText,
} from './vocabulary-models.js';

export const SETTLEMENT_MEANING_REFINEMENT_SOURCE = 'article-srs-meaning-refinement';
export const SETTLEMENT_MEANING_REFINEMENT_PROMPT_VERSION = 3;
// A pending refinement protects against duplicate requests from concurrent
// tabs. Once the single backfill request has been quiet for this long, the
// original tab may have gone away after the Host committed only the claim.
export const SETTLEMENT_MEANING_REFINEMENT_PENDING_RETRY_AFTER_MS = 2 * 60 * 1000;
const WORD_SIMPLE_MEANING_TARGET_LENGTH = 10;
const PHRASE_SIMPLE_MEANING_TARGET_LENGTH = 14;
const WORD_SIMPLE_MEANING_MAX_LENGTH = 16;
const PHRASE_SIMPLE_MEANING_MAX_LENGTH = 20;
const MAX_REFINEMENT_SENTENCE_LENGTH = 220;
const MAX_REFINEMENT_MEANING_LENGTH = 160;
const MAX_REFINEMENT_LOCAL_CONTEXT_LENGTH = 600;

function truncateText(value, maxLength) {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

function getCandidateTargetId(candidate) {
  return normalizeText(candidate && (candidate.targetId || candidate.target_id || candidate.id));
}

function getCandidateSimpleMeaning(candidate) {
  return normalizeNullableText(candidate && (
    candidate.simple_meaning
    || candidate.simpleMeaning
    || candidate.context && (candidate.context.simple_meaning || candidate.context.simpleMeaning)
  ));
}

function getCandidateMeaning(candidate) {
  return normalizeNullableText(candidate && (
    candidate.meaning
    || candidate.context && candidate.context.meaning
  ));
}

function getCandidateSentence(candidate) {
  return normalizeNullableText(candidate && (
    candidate.context && candidate.context.sentence
    || candidate.sentence
    || candidate.sourceSentence
    || candidate.source_sentence
  ));
}

function getCandidateLocalContext(candidate) {
  return normalizeNullableText(candidate && (
    candidate.context && (candidate.context.surrounding_text || candidate.context.surroundingText)
    || candidate.surrounding_text
    || candidate.surroundingText
    || getCandidateSentence(candidate)
  ));
}

function getResultTargetId(item) {
  return normalizeText(item && (
    item.targetId
    || item.target_id
    || item.id
    || item.itemId
    || item.item_id
  ));
}

function getResultSimpleMeaning(item) {
  return normalizeNullableText(item && (
    item.simpleMeaning
    || item.simple_meaning
    || item.shortMeaning
    || item.short_meaning
    || item.meaning
    || item.definition
    || item.translation
    || item.zh
    || item.cn
  ));
}

export function getSettlementSimpleMeaningLimit(entryType) {
  return entryType === VOCABULARY_ENTRY_TYPES.PHRASE
    ? PHRASE_SIMPLE_MEANING_MAX_LENGTH
    : WORD_SIMPLE_MEANING_MAX_LENGTH;
}

export function isSettlementSimpleMeaningValid(value, entryType) {
  const normalized = normalizeNullableText(value);
  if (!normalized) return false;
  return normalized.length <= getSettlementSimpleMeaningLimit(entryType);
}

function parseRefinementTimestamp(value) {
  try {
    return Date.parse(new Date(value).toISOString());
  } catch (_error) {
    return Number.NaN;
  }
}

export function isSettlementMeaningRefinementPendingRetryable(candidate, now = new Date()) {
  if (normalizeText(candidate && (candidate.refinement_status || candidate.status)).toLowerCase() !== 'pending') {
    return false;
  }
  const attemptedAt = candidate && (
    candidate.refinement_attempted_at
    || candidate.refinementAttemptedAt
    || candidate.attempted_at
    || candidate.attemptedAt
  );
  const attemptedAtMs = parseRefinementTimestamp(attemptedAt);
  const nowMs = parseRefinementTimestamp(now);
  return Number.isFinite(attemptedAtMs)
    && Number.isFinite(nowMs)
    && nowMs >= attemptedAtMs + SETTLEMENT_MEANING_REFINEMENT_PENDING_RETRY_AFTER_MS;
}

export function needsSettlementMeaningRefinement(candidate, options = {}) {
  if (!candidate || candidate.eligible === false) return false;
  if (!getCandidateTargetId(candidate)) return false;
  if (!getCandidateMeaning(candidate)) return false;
  if (options.automatic && candidate.refinement_attempted === true) return false;
  if (candidate.refinement_save_pending) return !options.automatic;
  if (candidate.refinement_status === 'pending'
    && !isSettlementMeaningRefinementPendingRetryable(candidate, options.now)) return false;
  return !isSettlementSimpleMeaningValid(getCandidateSimpleMeaning(candidate), candidate.entry_type);
}

// Exact request provenance, stored as an optional field in the existing progress
// row. Full input identity avoids reusing a short meaning after an explanation edit.
export function getSettlementMeaningRefinementInputKey(candidate, articleId = '') {
  return JSON.stringify([
    SETTLEMENT_MEANING_REFINEMENT_PROMPT_VERSION, articleId, getCandidateTargetId(candidate),
    normalizeText(candidate?.markedText || candidate?.marked_text || candidate?.word || candidate?.lemma),
    candidate?.entry_type || VOCABULARY_ENTRY_TYPES.WORD, getCandidateMeaning(candidate),
    getCandidateSentence(candidate), getCandidateLocalContext(candidate),
  ]);
}

export function getSettlementMeaningRefinementCandidates(candidates = [], options = {}) {
  return (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => needsSettlementMeaningRefinement(candidate, options));
}

export function buildSettlementMeaningRefinementTemplate(options = {}) {
  const candidates = getSettlementMeaningRefinementCandidates(options.candidates);
  const articleId = normalizeText(options.articleId || options.sourceId || options.source_id);
  return {
    schemaVersion: 1,
    source: SETTLEMENT_MEANING_REFINEMENT_SOURCE,
    articleId,
    instructions: [
      '为 SRS 复习生成所选单词或短语本身的极短中文词汇释义。',
      `单词尽量不超过 ${WORD_SIMPLE_MEANING_TARGET_LENGTH} 个中文字，硬上限 ${WORD_SIMPLE_MEANING_MAX_LENGTH} 个中文字。`,
      `短语尽量不超过 ${PHRASE_SIMPLE_MEANING_TARGET_LENGTH} 个中文字，硬上限 ${PHRASE_SIMPLE_MEANING_MAX_LENGTH} 个中文字。`,
      'simpleMeaning 必须翻译 markedText/boundary 这段表达本身，而不是它在文章中的具体指代、实体名称或解释对象。',
      'sentence、localContext 和 contextualExplanation 只用于选择这段表达在当前语境中的词义；即使 contextualExplanation 明确指出具体实体，也不能用该实体替换原表达，除非实体名称本身明确出现在 markedText/boundary 中。',
      '示例：markedText="invisible gas"，contextualExplanation 指出它是 ethylene，simpleMeaning="不可见气体"，不能写“乙烯气体”。',
      '示例：markedText="the capital"，contextualExplanation 指出它是 Beijing，simpleMeaning="首都"，不能写“北京”。',
      '示例：markedText="the enzyme"，contextualExplanation 指出它是 polyphenol oxidase，simpleMeaning="这种酶"，不能写“多酚氧化酶”。',
      '对照示例：markedText="ethylene gas"，simpleMeaning="乙烯气体"；markedText="polyphenol oxidase"，simpleMeaning="多酚氧化酶"。',
      '只给核心意思，不要解释原因，不要记忆法，不要翻译整句，不要输出文章背景。',
      '如果候选是专有名词、临时术语或不适合 SRS，simpleMeaning 返回空字符串。',
      '只返回 JSON：{"items":[{"targetId":"...","simpleMeaning":"..."}]}',
    ],
    items: candidates.map((candidate) => {
      const entryType = candidate.entry_type === VOCABULARY_ENTRY_TYPES.PHRASE
        ? VOCABULARY_ENTRY_TYPES.PHRASE
        : VOCABULARY_ENTRY_TYPES.WORD;
      const targetId = getCandidateTargetId(candidate);
      const text = normalizeText(candidate.markedText || candidate.marked_text || candidate.word || candidate.lemma);
      const sentence = truncateText(getCandidateSentence(candidate), MAX_REFINEMENT_SENTENCE_LENGTH);
      const localContext = truncateText(getCandidateLocalContext(candidate), MAX_REFINEMENT_LOCAL_CONTEXT_LENGTH);
      const meaning = truncateText(getCandidateMeaning(candidate), MAX_REFINEMENT_MEANING_LENGTH);
      const maxLength = getSettlementSimpleMeaningLimit(entryType);
      return {
        targetId,
        target_id: targetId,
        id: targetId,
        text,
        markedText: text,
        marked_text: text,
        boundary: text,
        type: entryType,
        entry_type: entryType,
        sentence,
        sourceSentence: sentence,
        source_sentence: sentence,
        localContext,
        local_context: localContext,
        contextualExplanation: meaning,
        contextual_explanation: meaning,
        meaning,
        currentMeaning: meaning,
        explanation: meaning,
        maxLength,
        max_length: maxLength,
        simpleMeaning: '',
      };
    }).filter((item) => item.targetId && item.text && item.meaning),
  };
}

export function applySettlementMeaningRefinementResult(candidates = [], result = {}) {
  const sourceCandidates = Array.isArray(candidates) ? candidates : [];
  const byTargetId = new Map();
  sourceCandidates.forEach((candidate) => {
    const targetId = getCandidateTargetId(candidate);
    if (targetId) byTargetId.set(targetId, candidate);
  });
  const stats = {
    requested: byTargetId.size,
    updated: 0,
    rejected: 0,
    missing: 0,
  };
  const resultItems = Array.isArray(result && result.items) ? result.items : [];
  const seen = new Set();
  resultItems.forEach((item) => {
    const targetId = getResultTargetId(item);
    const candidate = byTargetId.get(targetId);
    if (!candidate || seen.has(targetId)) return;
    seen.add(targetId);
    const simpleMeaning = getResultSimpleMeaning(item);
    if (!simpleMeaning) {
      stats.missing += 1;
      return;
    }
    if (!isSettlementSimpleMeaningValid(simpleMeaning, candidate.entry_type)) {
      candidate.refinement_error = 'simple_meaning_too_long';
      stats.rejected += 1;
      return;
    }
    candidate.simple_meaning = simpleMeaning;
    candidate.simpleMeaning = simpleMeaning;
    candidate.refinement_error = '';
    if (candidate.context && typeof candidate.context === 'object') {
      candidate.context.simple_meaning = simpleMeaning;
      candidate.context.simpleMeaning = simpleMeaning;
    }
    stats.updated += 1;
  });
  stats.missing += byTargetId.size - seen.size;
  return stats;
}
