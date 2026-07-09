import {
  REVIEW_RATINGS,
  REVIEW_STATES,
  WORD_STATUSES,
  assertValidRating,
  cloneVocabularyValue,
  compareIsoAsc,
  createVocabularyId,
  normalizeLanguage,
  normalizeVocabularyEntryType,
  normalizeLemma,
  normalizeLookupKey,
  normalizeNullableText,
  normalizeText,
  toIsoString,
} from './vocabulary-models.js';
import { createIndexedDbVocabularyRepository } from './vocabulary-repository.js';
import { createSrsScheduler } from './srs-scheduler.js';

export function createVocabularyService(options = {}) {
  const repository = options.repository || createIndexedDbVocabularyRepository(options.repositoryOptions || {});
  const scheduler = options.scheduler || createSrsScheduler(options.schedulerOptions || {});
  const nowProvider = typeof options.now === 'function' ? options.now : () => new Date();

  async function addWord(input = {}) {
    const createdAt = toIsoString(input.createdAt || input.created_at || nowProvider());
    const wordText = normalizeText(input.word);
    const lemma = normalizeLemma(input.lemma || wordText);
    const lookupKey = normalizeLookupKey(input.lookup_key || input.lookupKey || lemma);
    const language = normalizeLanguage(input.language);
    const initialMeaning = normalizeNullableText(input.meaning) || getContextMeaning(input.context);
    if (!wordText) throw new Error('Vocabulary word is required');
    if (!lemma) throw new Error('Vocabulary lemma is required');
    if (!lookupKey) throw new Error('Vocabulary lookup key is required');

    return repository.updateSnapshot((snapshot) => {
      let word = snapshot.words.find((item) => item.lookup_key === lookupKey && item.language === language);
      if (!word) {
        word = {
          id: createVocabularyId('vocab_word'),
          word: wordText,
          lemma,
          lookup_key: lookupKey,
          entry_type: normalizeVocabularyEntryType(input.entry_type || input.entryType),
          language,
          phonetic: normalizeNullableText(input.phonetic),
          meaning: initialMeaning,
          note: normalizeNullableText(input.note),
          status: WORD_STATUSES.NEW,
          created_at: createdAt,
          updated_at: createdAt,
        };
        snapshot.words.push(word);
      }

      ensureReviewState(snapshot, word, createdAt, scheduler);
      addContextIfPresent(snapshot, word.id, input.context, createdAt);
      return word;
    });
  }

  async function getWordByLemma(lemma, options = {}) {
    return repository.findWordByLemma(lemma, { language: normalizeLanguage(options.language) });
  }

  async function getDueWords(now) {
    const nowIso = toIsoString(now || nowProvider());
    const snapshot = await repository.loadSnapshot();
    const wordsById = new Map(snapshot.words.map((word) => [word.id, word]));
    return snapshot.reviewStates
      .filter((reviewState) => Date.parse(reviewState.due_at) <= Date.parse(nowIso))
      .map((reviewState) => {
        const word = wordsById.get(reviewState.word_id);
        if (!word || word.status === WORD_STATUSES.IGNORED) return null;
        return {
          word: cloneVocabularyValue(word),
          reviewState: cloneVocabularyValue(reviewState),
          contexts: snapshot.contexts
            .filter((context) => context.word_id === word.id)
            .map(cloneVocabularyValue),
        };
      })
      .filter(Boolean)
      .sort((left, right) => compareIsoAsc(left.reviewState.due_at, right.reviewState.due_at));
  }

  async function reviewWord(wordId, rating, reviewedAt) {
    assertValidRating(rating);
    const reviewedAtIso = toIsoString(reviewedAt || nowProvider());
    return repository.updateSnapshot((snapshot) => {
      const word = findWordOrThrow(snapshot, wordId);
      if (word.status === WORD_STATUSES.IGNORED) {
        throw new Error(`Cannot review ignored vocabulary word: ${wordId}`);
      }
      const currentState = ensureReviewState(snapshot, word, word.created_at, scheduler);
      const beforeState = cloneVocabularyValue(currentState);
      const scheduled = scheduler.schedule(currentState, rating, reviewedAtIso);
      const afterState = scheduled.reviewState;
      replaceReviewState(snapshot, afterState);

      word.status = resolveReviewedWordStatus(word.status, rating, afterState);
      word.updated_at = reviewedAtIso;

      const reviewLog = {
        id: createVocabularyId('vocab_review_log'),
        word_id: word.id,
        rating,
        reviewed_at: reviewedAtIso,
        before_state: beforeState,
        after_state: cloneVocabularyValue(afterState),
      };
      snapshot.reviewLogs.push(reviewLog);

      return {
        word,
        reviewState: afterState,
        reviewLog,
        rating,
        nextDueAt: afterState.due_at,
      };
    });
  }

  async function markWordKnown(wordId, markedAt) {
    const markedAtIso = toIsoString(markedAt || nowProvider());
    return repository.updateSnapshot((snapshot) => {
      const word = findWordOrThrow(snapshot, wordId);
      const currentState = ensureReviewState(snapshot, word, word.created_at, scheduler);
      const knownState = scheduler.createKnownReviewState(currentState, markedAtIso);
      replaceReviewState(snapshot, knownState);
      word.status = WORD_STATUSES.KNOWN;
      word.updated_at = markedAtIso;
      return {
        word,
        reviewState: knownState,
      };
    });
  }

  async function ignoreWord(wordId, ignoredAt) {
    const ignoredAtIso = toIsoString(ignoredAt || nowProvider());
    return repository.updateSnapshot((snapshot) => {
      const word = findWordOrThrow(snapshot, wordId);
      word.status = WORD_STATUSES.IGNORED;
      word.updated_at = ignoredAtIso;
      return word;
    });
  }

  return {
    addWord,
    getWordByLemma,
    getDueWords,
    reviewWord,
    markWordKnown,
    ignoreWord,
  };
}

function ensureReviewState(snapshot, word, now, scheduler) {
  let reviewState = snapshot.reviewStates.find((state) => state.word_id === word.id);
  if (!reviewState) {
    reviewState = scheduler.createInitialReviewState(word.id, now);
    snapshot.reviewStates.push(reviewState);
  }
  return reviewState;
}

function addContextIfPresent(snapshot, wordId, context, createdAt) {
  if (!context) return null;
  const sentence = normalizeText(context.sentence);
  if (!sentence) throw new Error('Vocabulary context sentence is required');
  const entry = {
    id: createVocabularyId('vocab_context'),
    word_id: wordId,
    sentence,
    meaning: getContextMeaning(context),
    source_title: normalizeNullableText(context.source_title || context.sourceTitle),
    source_url: normalizeNullableText(context.source_url || context.sourceUrl),
    surrounding_text: normalizeNullableText(context.surrounding_text || context.surroundingText),
    created_at: toIsoString(context.created_at || context.createdAt || createdAt),
  };
  const duplicate = snapshot.contexts.find((existing) => (
    existing.word_id === wordId
    && normalizeText(existing.sentence) === entry.sentence
    && normalizeNullableText(existing.meaning) === entry.meaning
    && normalizeNullableText(existing.source_url || existing.sourceUrl) === entry.source_url
    && normalizeNullableText(existing.source_title || existing.sourceTitle) === entry.source_title
  ));
  if (duplicate) return duplicate;
  snapshot.contexts.push(entry);
  return entry;
}

function getContextMeaning(context) {
  if (!context || typeof context !== 'object') return null;
  return normalizeNullableText(context.meaning);
}

function findWordOrThrow(snapshot, wordId) {
  const id = normalizeText(wordId);
  const word = snapshot.words.find((item) => item.id === id);
  if (!word) throw new Error(`Vocabulary word not found: ${wordId}`);
  return word;
}

function replaceReviewState(snapshot, reviewState) {
  const index = snapshot.reviewStates.findIndex((item) => item.word_id === reviewState.word_id);
  if (index >= 0) {
    snapshot.reviewStates[index] = reviewState;
    return;
  }
  snapshot.reviewStates.push(reviewState);
}

function resolveReviewedWordStatus(currentStatus, rating, reviewState) {
  if (currentStatus === WORD_STATUSES.IGNORED) return WORD_STATUSES.IGNORED;
  if (rating === REVIEW_RATINGS.AGAIN) return WORD_STATUSES.LEARNING;
  if (reviewState.state === REVIEW_STATES.REVIEW && Number(reviewState.reps || 0) >= 3) {
    return WORD_STATUSES.KNOWN;
  }
  return WORD_STATUSES.LEARNING;
}
