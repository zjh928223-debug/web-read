export const VOCABULARY_SCHEMA_VERSION = 1;
export const VOCABULARY_STORE_KEY = 'vocabulary.srs.store.v1';

export const WORD_STATUSES = Object.freeze({
  NEW: 'new',
  LEARNING: 'learning',
  KNOWN: 'known',
  IGNORED: 'ignored',
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

export function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function normalizeNullableText(value) {
  const normalized = normalizeText(value);
  return normalized || null;
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

function normalizeStoredWord(word) {
  if (!word || typeof word !== 'object') return null;
  const id = normalizeText(word.id);
  const lemma = normalizeLemma(word.lemma || word.word);
  if (!id || !lemma) return null;
  const createdAt = toIsoString(word.created_at || word.createdAt || new Date(0));
  return {
    id,
    word: normalizeText(word.word) || lemma,
    lemma,
    lookup_key: normalizeLookupKey(word.lookup_key || word.lookupKey || lemma),
    language: normalizeLanguage(word.language),
    phonetic: normalizeNullableText(word.phonetic),
    meaning: normalizeNullableText(word.meaning),
    note: normalizeNullableText(word.note),
    status: VALID_WORD_STATUSES.has(word.status) ? word.status : WORD_STATUSES.NEW,
    created_at: createdAt,
    updated_at: toIsoString(word.updated_at || word.updatedAt || createdAt),
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
