import { Rating, State, createEmptyCard, fsrs } from 'ts-fsrs';
import {
  REVIEW_RATINGS,
  REVIEW_STATES,
  addDaysIso,
  assertValidRating,
  toIsoString,
} from './vocabulary-models.js';

const RATING_TO_FSRS = Object.freeze({
  [REVIEW_RATINGS.AGAIN]: Rating.Again,
  [REVIEW_RATINGS.HARD]: Rating.Hard,
  [REVIEW_RATINGS.GOOD]: Rating.Good,
  [REVIEW_RATINGS.EASY]: Rating.Easy,
});

const STATE_TO_FSRS = Object.freeze({
  [REVIEW_STATES.NEW]: State.New,
  [REVIEW_STATES.LEARNING]: State.Learning,
  [REVIEW_STATES.REVIEW]: State.Review,
  [REVIEW_STATES.RELEARNING]: State.Relearning,
});

const FSRS_TO_STATE = Object.freeze({
  [State.New]: REVIEW_STATES.NEW,
  [State.Learning]: REVIEW_STATES.LEARNING,
  [State.Review]: REVIEW_STATES.REVIEW,
  [State.Relearning]: REVIEW_STATES.RELEARNING,
});

export function createSrsScheduler(options = {}) {
  const maximumInterval = Number(options.maximum_interval || options.maximumInterval || 36500);
  const scheduler = fsrs({
    request_retention: options.request_retention || options.requestRetention || 0.9,
    maximum_interval: maximumInterval,
    enable_fuzz: options.enable_fuzz === true,
    enable_short_term: options.enable_short_term !== false,
    learning_steps: options.learning_steps || ['1m', '10m'],
    relearning_steps: options.relearning_steps || ['10m'],
  });

  function createInitialReviewState(wordId, now) {
    const card = createEmptyCard(new Date(toIsoString(now)));
    return cardToReviewState(wordId, card);
  }

  function schedule(reviewState, rating, reviewedAt) {
    assertValidRating(rating);
    if (!reviewState || !reviewState.word_id) {
      throw new Error('Cannot schedule review without an existing review state');
    }
    const reviewedAtIso = toIsoString(reviewedAt);
    const card = reviewStateToCard(reviewState);
    const result = scheduler.next(card, new Date(reviewedAtIso), RATING_TO_FSRS[rating]);
    return {
      reviewState: cardToReviewState(reviewState.word_id, result.card),
      schedulerLog: {
        rating,
        fsrs_rating: result.log.rating,
        fsrs_state: result.log.state,
        reviewed_at: reviewedAtIso,
        due_at: toIsoString(result.log.due),
      },
    };
  }

  function createKnownReviewState(reviewState, knownAt) {
    const knownAtIso = toIsoString(knownAt);
    const base = reviewState || {};
    return {
      word_id: base.word_id,
      due_at: addDaysIso(knownAtIso, maximumInterval),
      stability: Math.max(Number(base.stability || 0), maximumInterval),
      difficulty: Number(base.difficulty || 1),
      elapsed_days: Number(base.elapsed_days || 0),
      scheduled_days: maximumInterval,
      reps: Number(base.reps || 0),
      lapses: Number(base.lapses || 0),
      state: REVIEW_STATES.REVIEW,
      last_review_at: knownAtIso,
      learning_steps: Number(base.learning_steps || 0),
    };
  }

  return {
    createInitialReviewState,
    createKnownReviewState,
    schedule,
  };
}

function reviewStateToCard(reviewState) {
  const card = createEmptyCard(new Date(toIsoString(reviewState.due_at)));
  card.due = new Date(toIsoString(reviewState.due_at));
  // ts-fsrs represents a genuinely new card without a memory state. Legacy
  // migration persists contract-valid numeric placeholders (0/1); feeding
  // those placeholders back as an FSRS memory state is invalid.
  if (reviewState.state !== REVIEW_STATES.NEW || Number(reviewState.reps || 0) > 0) {
    card.stability = Number(reviewState.stability || 0);
    card.difficulty = Number(reviewState.difficulty || 0);
  }
  card.elapsed_days = Number(reviewState.elapsed_days || 0);
  card.scheduled_days = Number(reviewState.scheduled_days || 0);
  card.reps = Number(reviewState.reps || 0);
  card.lapses = Number(reviewState.lapses || 0);
  card.learning_steps = Number(reviewState.learning_steps || 0);
  card.state = STATE_TO_FSRS[reviewState.state] ?? State.New;
  card.last_review = reviewState.last_review_at ? new Date(toIsoString(reviewState.last_review_at)) : undefined;
  return card;
}

function cardToReviewState(wordId, card) {
  return {
    word_id: wordId,
    due_at: toIsoString(card.due),
    stability: Number(card.stability || 0),
    difficulty: Number(card.difficulty || 0),
    elapsed_days: Number(card.elapsed_days || 0),
    scheduled_days: Number(card.scheduled_days || 0),
    reps: Number(card.reps || 0),
    lapses: Number(card.lapses || 0),
    state: FSRS_TO_STATE[card.state] || REVIEW_STATES.NEW,
    last_review_at: card.last_review ? toIsoString(card.last_review) : null,
    learning_steps: Number(card.learning_steps || 0),
  };
}
