export const VOCABULARY_SCHEMA_VERSION = 1;
export const VOCABULARY_STORE_KEY = 'vocabulary.srs.store.v1';

export const SRS_REVIEW_PARTICIPATION_SCHEMA_VERSION = 'srs-review-participation.v1';
export const SRS_REVIEW_PARTICIPATION_FIELD = 'srs_review_participation';
export const SRS_REVIEW_PARTICIPATION_STATUSES = Object.freeze({
  EXCLUDED: 'excluded',
});

export const WORD_STATUSES = Object.freeze({
  NEW: 'new',
  LEARNING: 'learning',
  KNOWN: 'known',
  IGNORED: 'ignored',
});

export const VOCABULARY_ENTRY_TYPES = Object.freeze({
  WORD: 'word',
  PHRASE: 'phrase',
});

export const VOCABULARY_TAGS = Object.freeze({
  FOCUS: 'focus',
});

export const REVIEW_RATINGS = Object.freeze({
  AGAIN: 'again',
  HARD: 'hard',
  GOOD: 'good',
  EASY: 'easy',
});

export const REVIEW_STATES = Object.freeze({
  NEW: 'new',
  LEARNING: 'learning',
  REVIEW: 'review',
  RELEARNING: 'relearning',
});

const VALID_WORD_STATUSES = new Set(Object.values(WORD_STATUSES));
const VALID_VOCABULARY_ENTRY_TYPES = new Set(Object.values(VOCABULARY_ENTRY_TYPES));
const VALID_VOCABULARY_TAGS = new Set(Object.values(VOCABULARY_TAGS));
const VALID_REVIEW_RATINGS = new Set(Object.values(REVIEW_RATINGS));
const VALID_REVIEW_STATES = new Set(Object.values(REVIEW_STATES));

export function createEmptyVocabularySnapshot() {
  return {
    schemaVersion: VOCABULARY_SCHEMA_VERSION,
    words: [],
    contexts: [],
    reviewStates: [],
    reviewLogs: [],
  };
}

export function normalizeVocabularySnapshot(snapshot) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  return {
    schemaVersion: source.schemaVersion || VOCABULARY_SCHEMA_VERSION,
    words: Array.isArray(source.words) ? source.words.map(normalizeStoredWord).filter(Boolean) : [],
    contexts: Array.isArray(source.contexts) ? source.contexts.map(normalizeStoredContext).filter(Boolean) : [],
    reviewStates: Array.isArray(source.reviewStates) ? source.reviewStates.map(normalizeStoredReviewState).filter(Boolean) : [],
    reviewLogs: Array.isArray(source.reviewLogs) ? source.reviewLogs.map(normalizeStoredReviewLog).filter(Boolean) : [],
  };
}

export function cloneVocabularyValue(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

export function normalizeLemma(value) {
  return normalizeText(value);
}

export function normalizeLookupKey(value) {
  return normalizeText(value).toLowerCase();
}

export function normalizeLanguage(value) {
  return normalizeText(value || 'en').toLowerCase() || 'en';
}

export function normalizeVocabularyEntryType(value) {
  const normalized = normalizeText(value).toLowerCase();
  return VALID_VOCABULARY_ENTRY_TYPES.has(normalized) ? normalized : VOCABULARY_ENTRY_TYPES.WORD;
}

export function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function normalizeNullableText(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

export function normalizeVocabularyTags(tags) {
  const values = Array.isArray(tags) ? tags : (tags ? [tags] : []);
  const normalized = [];
  values.forEach((tag) => {
    const value = normalizeText(tag).toLowerCase();
    if (!VALID_VOCABULARY_TAGS.has(value)) return;
    if (!normalized.includes(value)) normalized.push(value);
  });
  return normalized;
}

export function assertValidRating(rating) {
  if (VALID_REVIEW_RATINGS.has(rating)) return rating;
  throw new Error(`Invalid SRS review rating: ${rating}`);
}

export function assertValidWordStatus(status) {
  if (VALID_WORD_STATUSES.has(status)) return status;
  throw new Error(`Invalid vocabulary word status: ${status}`);
}

export function normalizeReviewStateName(state) {
  if (VALID_REVIEW_STATES.has(state)) return state;
  return REVIEW_STATES.NEW;
}

export function toIsoString(value, fallback = new Date()) {
  const candidate = value === undefined || value === null ? fallback : value;
  const date = candidate instanceof Date ? candidate : new Date(candidate);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date value: ${candidate}`);
  }
  return date.toISOString();
}

export function addDaysIso(value, days) {
  const start = new Date(toIsoString(value));
  start.setTime(start.getTime() + Number(days || 0) * 24 * 60 * 60 * 1000);
  return start.toISOString();
}

export function createVocabularyId(prefix) {
  const safePrefix = normalizeText(prefix || 'vocabulary').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'vocabulary';
  const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return `${safePrefix}_${cryptoApi.randomUUID()}`;
  }
  return `${safePrefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function compareIsoAsc(left, right) {
  return Date.parse(left || 0) - Date.parse(right || 0);
}

export function normalizeSrsReviewParticipation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.status !== SRS_REVIEW_PARTICIPATION_STATUSES.EXCLUDED) return null;
  const operationId = normalizeText(value.operation_id || value.operationId) || 'legacy-unknown';
  let removedAt = new Date(0).toISOString();
  try {
    removedAt = toIsoString(value.removed_at || value.removedAt || removedAt);
  } catch (_error) {
    // A malformed legacy marker remains excluded; do not silently re-enter review.
  }
  return {
    schema_version: SRS_REVIEW_PARTICIPATION_SCHEMA_VERSION,
    status: SRS_REVIEW_PARTICIPATION_STATUSES.EXCLUDED,
    operation_id: operationId,
    removed_at: removedAt,
  };
}

export function isSrsReviewParticipationExcluded(value) {
  return value?.status === SRS_REVIEW_PARTICIPATION_STATUSES.EXCLUDED;
}

export function createSrsReviewExclusionMarker(operationId, removedAt) {
  const normalizedOperationId = normalizeText(operationId);
  if (!normalizedOperationId) throw new Error('SRS review removal operation ID is required');
  return {
    schema_version: SRS_REVIEW_PARTICIPATION_SCHEMA_VERSION,
    status: SRS_REVIEW_PARTICIPATION_STATUSES.EXCLUDED,
    operation_id: normalizedOperationId,
    removed_at: toIsoString(removedAt),
  };
}

function normalizeStoredWord(word) {
  if (!word || typeof word !== 'object') return null;
  const id = normalizeText(word.id);
  const lemma = normalizeLemma(word.lemma || word.word);
  if (!id || !lemma) return null;
  const createdAt = toIsoString(word.created_at || word.createdAt || new Date(0));
  const reviewParticipation = normalizeSrsReviewParticipation(
    word.review_participation || word.reviewParticipation,
  );
  return {
    id,
    word: normalizeText(word.word) || lemma,
    lemma,
    lookup_key: normalizeLookupKey(word.lookup_key || word.lookupKey || lemma),
    entry_type: normalizeVocabularyEntryType(word.entry_type || word.entryType),
    language: normalizeLanguage(word.language),
    phonetic: normalizeNullableText(word.phonetic),
    meaning: normalizeNullableText(word.meaning),
    general_meaning: normalizeNullableText(word.general_meaning || word.generalMeaning),
    dictionary_definition: normalizeNullableText(word.dictionary_definition || word.dictionaryDefinition),
    dictionary_source: normalizeNullableText(word.dictionary_source || word.dictionarySource),
    dictionary_fetched_at: word.dictionary_fetched_at || word.dictionaryFetchedAt
      ? toIsoString(word.dictionary_fetched_at || word.dictionaryFetchedAt)
      : null,
    note: normalizeNullableText(word.note),
    status: VALID_WORD_STATUSES.has(word.status) ? word.status : WORD_STATUSES.NEW,
    tags: normalizeVocabularyTags(word.tags),
    created_at: createdAt,
    updated_at: toIsoString(word.updated_at || word.updatedAt || createdAt),
    ...(reviewParticipation ? { review_participation: reviewParticipation } : {}),
  };
}

function normalizeStoredContext(context) {
  if (!context || typeof context !== 'object') return null;
  const wordId = normalizeText(context.word_id || context.wordId);
  const sentence = normalizeText(context.sentence);
  if (!wordId || !sentence) return null;
  return {
    id: normalizeText(context.id) || createVocabularyId('vocab_context'),
    word_id: wordId,
    sentence,
    meaning: normalizeNullableText(context.meaning),
    simple_meaning: normalizeNullableText(context.simple_meaning || context.simpleMeaning),
    source_id: normalizeNullableText(context.source_id || context.sourceId),
    source_title: normalizeNullableText(context.source_title || context.sourceTitle),
    source_url: normalizeNullableText(context.source_url || context.sourceUrl),
    surrounding_text: normalizeNullableText(context.surrounding_text || context.surroundingText),
    created_at: toIsoString(context.created_at || context.createdAt || new Date(0)),
  };
}

function normalizeStoredReviewState(reviewState) {
  if (!reviewState || typeof reviewState !== 'object') return null;
  const wordId = normalizeText(reviewState.word_id || reviewState.wordId);
  if (!wordId) return null;
  return {
    word_id: wordId,
    due_at: toIsoString(reviewState.due_at || reviewState.dueAt || new Date(0)),
    stability: Number(reviewState.stability || 0),
    difficulty: Number(reviewState.difficulty || 0),
    elapsed_days: Number(reviewState.elapsed_days || reviewState.elapsedDays || 0),
    scheduled_days: Number(reviewState.scheduled_days || reviewState.scheduledDays || 0),
    reps: Number(reviewState.reps || 0),
    lapses: Number(reviewState.lapses || 0),
    state: normalizeReviewStateName(reviewState.state),
    last_review_at: reviewState.last_review_at || reviewState.lastReviewAt
      ? toIsoString(reviewState.last_review_at || reviewState.lastReviewAt)
      : null,
    learning_steps: Number(reviewState.learning_steps || reviewState.learningSteps || 0),
  };
}

function normalizeStoredReviewLog(log) {
  if (!log || typeof log !== 'object') return null;
  const wordId = normalizeText(log.word_id || log.wordId);
  const rating = log.rating;
  if (!wordId || !VALID_REVIEW_RATINGS.has(rating)) return null;
  return {
    id: normalizeText(log.id) || createVocabularyId('vocab_review_log'),
    word_id: wordId,
    rating,
    reviewed_at: toIsoString(log.reviewed_at || log.reviewedAt || new Date(0)),
    before_state: cloneVocabularyValue(log.before_state || log.beforeState || null),
    after_state: cloneVocabularyValue(log.after_state || log.afterState || null),
  };
}
