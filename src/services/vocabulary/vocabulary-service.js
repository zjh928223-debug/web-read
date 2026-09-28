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
  normalizeVocabularyTags,
  toIsoString,
} from './vocabulary-models.js';
import { createIndexedDbVocabularyRepository } from './vocabulary-repository.js';
import { createSrsScheduler } from './srs-scheduler.js';
import {
  deriveTargetSenseKey,
  normalizeLearningUnit,
} from './vocabulary-learning-models.js';
import {
  createIndexedDbAcquisitionRepository,
} from './vocabulary-acquisition-repository.js';
import {
  normalizeContextEvidence,
} from './vocabulary-context-evidence.js';
import {
  createVocabularyAcquisitionService,
} from './vocabulary-acquisition-service.js';
import {
  canonicalJson,
  sha256Utf8,
} from './vocabulary-learning-uow.js';
import { getWindowsOwnerVocabularySrsIntegration } from './windows-owner-vocabulary-srs.js';

export const VOCABULARY_LEGACY_ADD_WORD_COMPATIBILITY = 'legacy-add-word.v1';

const PREVIEW_ACTIVATION_DELAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOCAL_TRANSACTION_CHUNK_SIZE = 4;
const DEFAULT_OWNER_TRANSACTION_CHUNK_SIZE = 20;
const PREVIEW_ACTIVATION_PENDING_STATUSES = new Set([
  'introduced',
  'acquiring',
  'ready_for_check',
]);

function previewLocalDayAt(isoTimestamp, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(isoTimestamp));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return new Date(isoTimestamp).toISOString().slice(0, 10);
  }
}

function resolvePreviewTime(options, nowProvider) {
  const nowIso = toIsoString(options.now || options.activatedAt || options.activated_at || nowProvider());
  let timeZone = normalizeNullableText(options.timezone || options.timeZone);
  if (!timeZone) {
    try {
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      timeZone = null;
    }
  }
  timeZone ||= 'UTC';
  const localDay = normalizeNullableText(options.local_day || options.localDay)
    || previewLocalDayAt(nowIso, timeZone);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(localDay)) {
    throw new Error('Preview activation local day must use YYYY-MM-DD format');
  }
  return { nowIso, timeZone, localDay };
}

function previewActivationDailyLimit(dueReviewCount) {
  if (dueReviewCount <= 15) return 5;
  if (dueReviewCount <= 24) return 2;
  return 0;
}

function isPreviewSource(pair) {
  return pair?.learning_unit?.extensions?.source === 'ielts-preview';
}

function hasPreviewPrimaryMeaning(unit) {
  const form = normalizeText(unit?.normalized_form).toLocaleLowerCase();
  const gloss = normalizeText(unit?.target_sense?.gloss);
  const definition = normalizeText(unit?.target_sense?.definition);
  return Boolean(
    definition
    || (gloss && gloss.toLocaleLowerCase() !== form),
  );
}

function isPreviewActivationCandidate(pair, nowIso) {
  const state = pair?.acquisition_state;
  const unit = pair?.learning_unit;
  if (!isPreviewSource(pair) || !PREVIEW_ACTIVATION_PENDING_STATUSES.has(state?.status)) return false;
  if (!normalizeText(unit?.normalized_form) || unit?.target_sense_id === null) return false;
  if (!hasPreviewPrimaryMeaning(unit)) return false;
  const introducedAt = Date.parse(state?.introduced_at || '');
  const nowMs = Date.parse(nowIso);
  return Number.isFinite(introducedAt)
    && Number.isFinite(nowMs)
    && nowMs - introducedAt >= PREVIEW_ACTIVATION_DELAY_MS;
}

function isPreviewActivatedOnLocalDay(pair, localDay, timeZone) {
  if (!isPreviewSource(pair) || pair?.acquisition_state?.status !== 'graduated') return false;
  const metadata = pair.acquisition_state.extensions?.preview_activation;
  if (metadata?.local_day === localDay) return true;
  return Boolean(
    pair.acquisition_state.graduated_at
    && previewLocalDayAt(pair.acquisition_state.graduated_at, timeZone) === localDay,
  );
}

function previewActivationMetadata(pair) {
  const metadata = pair?.acquisition_state?.extensions?.preview_activation;
  return metadata && typeof metadata === 'object' ? metadata : null;
}

function summarizePendingPreviewSnapshot(snapshot, nowIso) {
  const pairs = Object.values(snapshot?.by_learning_unit_id || {});
  const pending = pairs.filter((pair) => (
    isPreviewSource(pair)
    && PREVIEW_ACTIVATION_PENDING_STATUSES.has(pair?.acquisition_state?.status)
  ));
  return {
    schema_version: 'preview-learning-pending-summary.v1',
    waiting: pending.length,
    matureWaiting: pending.filter((pair) => isPreviewActivationCandidate(pair, nowIso)).length,
  };
}

function countDueReviewCards(reviewSnapshot, contentSnapshot, nowIso) {
  const nowMs = Date.parse(nowIso);
  const dueCardIds = new Set();
  const dueV2WordIds = new Set();
  const dueStates = Object.values(reviewSnapshot?.by_learning_unit_id || {});
  dueStates.forEach((state) => {
    if (!state || !Number.isFinite(Date.parse(state.due_at)) || Date.parse(state.due_at) > nowMs) return;
    const cardId = state.learning_unit_id
      ? `unit:${state.learning_unit_id}`
      : (state.word_id ? `word:${state.word_id}` : null);
    if (!cardId || dueCardIds.has(cardId)) return;
    dueCardIds.add(cardId);
    if (state.word_id) dueV2WordIds.add(String(state.word_id));
  });
  (contentSnapshot?.reviewStates || []).forEach((state) => {
    if (!state || !Number.isFinite(Date.parse(state.due_at)) || Date.parse(state.due_at) > nowMs) return;
    const learningUnitId = state.learning_unit_id ? String(state.learning_unit_id) : null;
    const wordId = state.word_id ? String(state.word_id) : null;
    const cardId = learningUnitId ? `unit:${learningUnitId}` : (wordId ? `word:${wordId}` : null);
    if (!cardId || dueCardIds.has(cardId) || (!learningUnitId && wordId && dueV2WordIds.has(wordId))) return;
    dueCardIds.add(cardId);
  });
  return dueCardIds.size;
}

export function createVocabularyService(options = {}) {
  const ownerIntegration = options.ownerIntegration
    || (!options.repository ? getWindowsOwnerVocabularySrsIntegration(options.windowObject || globalThis) : null);
  const repository = options.repository || ownerIntegration?.vocabularyRepository
    || createIndexedDbVocabularyRepository(options.repositoryOptions || {});
  const scheduler = options.scheduler || createSrsScheduler(options.schedulerOptions || {});
  const nowProvider = typeof options.now === 'function' ? options.now : () => new Date();
  const acquisitionEnabled = resolveAcquisitionFeatureFlag(options);
  const acquisitionRepository = options.acquisitionRepository
    || ownerIntegration?.acquisitionRepository
    || createIndexedDbAcquisitionRepository(options.acquisitionRepositoryOptions || {});
  const acquisitionServiceOptions = {
    enabled: acquisitionEnabled,
    now: () => toIsoString(nowProvider()),
  };
  if (typeof options.runVocabularyLearningUnitOfWork === 'function') {
    acquisitionServiceOptions.runUnitOfWork = options.runVocabularyLearningUnitOfWork;
  }
  if (typeof options.runVocabularyLearningBatchSession === 'function') {
    acquisitionServiceOptions.runBatchSession = options.runVocabularyLearningBatchSession;
  } else if (typeof ownerIntegration?.runVocabularyLearningBatchSession === 'function') {
    acquisitionServiceOptions.runBatchSession = ownerIntegration.runVocabularyLearningBatchSession;
  }
  if (typeof options.runVocabularyLearningUnitOfWork !== 'function'
    && typeof ownerIntegration?.runVocabularyLearningUnitOfWork === 'function') {
    acquisitionServiceOptions.runUnitOfWork = ownerIntegration.runVocabularyLearningUnitOfWork;
  }
  const acquisitionService = options.acquisitionService
    || createVocabularyAcquisitionService(acquisitionServiceOptions);
  const reviewStateRepository = options.reviewStateRepository
    || ownerIntegration?.reviewStateRepository
    || null;
  const legacyCompatibilityCalls = [];
  let previewActivationQueue = Promise.resolve();

  function normalizeWordInput(input = {}) {
    const createdAt = toIsoString(input.createdAt || input.created_at || nowProvider());
    const wordText = normalizeText(input.word);
    const lemma = normalizeLemma(input.lemma || wordText);
    const lookupKey = normalizeLookupKey(input.lookup_key || input.lookupKey || lemma);
    const language = normalizeLanguage(input.language);
    const initialMeaning = normalizeNullableText(input.meaning) || getContextMeaning(input.context);
    if (!wordText) throw new Error('Vocabulary word is required');
    if (!lemma) throw new Error('Vocabulary lemma is required');
    if (!lookupKey) throw new Error('Vocabulary lookup key is required');
    return {
      createdAt,
      wordText,
      lemma,
      lookupKey,
      language,
      initialMeaning,
    };
  }

  async function upsertVocabularyEntry(input = {}) {
    const normalized = normalizeWordInput(input);
    return repository.updateSnapshot((snapshot) => {
      const word = upsertWordInSnapshot(snapshot, input, normalized);
      addContextIfPresent(snapshot, word.id, input.context, normalized.createdAt);
      return word;
    });
  }

  function traceLegacyCompatibility(operation, input) {
    const trace = Object.freeze({
      compatibility: VOCABULARY_LEGACY_ADD_WORD_COMPATIBILITY,
      operation,
      caller: normalizeText(input && (input.legacyCaller || input.legacy_caller)) || 'unspecified',
      called_at: toIsoString(nowProvider()),
    });
    legacyCompatibilityCalls.push(trace);
    if (typeof options.onLegacyAddWordCall === 'function') {
      options.onLegacyAddWordCall(trace);
    }
  }

  async function addWordLegacy(input = {}) {
    traceLegacyCompatibility('addWordLegacy', input);
    const normalized = normalizeWordInput(input);
    return repository.updateSnapshot((snapshot) => {
      const word = upsertWordInSnapshot(snapshot, input, normalized);
      ensureReviewState(snapshot, word, normalized.createdAt, scheduler);
      addContextIfPresent(snapshot, word.id, input.context, normalized.createdAt);
      return word;
    });
  }

  async function addWord(input = {}) {
    traceLegacyCompatibility('addWord', input);
    return addWordLegacyWithoutTrace(input);
  }

  async function addWordLegacyWithoutTrace(input = {}) {
    const normalized = normalizeWordInput(input);
    return repository.updateSnapshot((snapshot) => {
      const word = upsertWordInSnapshot(snapshot, input, normalized);
      ensureReviewState(snapshot, word, normalized.createdAt, scheduler);
      addContextIfPresent(snapshot, word.id, input.context, normalized.createdAt);
      return word;
    });
  }

  async function queueVocabularyAcquisition(input = {}) {
    return queueVocabularyAcquisitionWithService(input, acquisitionService);
  }

  async function queueVocabularyAcquisitionWithService(input = {}, acquisitionCommands, batchOptions = {}) {
    const result = await queueAcquisitionInternal(input, {
      source: 'article-settlement',
      createContextEvidence: createArticleContextEvidence,
      acquisitionCommands,
      ...batchOptions,
    });
    if (result.alreadyGraduated) return result;
    if (typeof acquisitionCommands.completeArticleLearning !== 'function') {
      throw new Error('Article settlement requires the article completion acquisition command');
    }
    const completedAt = normalizeWordInput(input).createdAt;
    const commandBase = `article-completion:${result.learningUnit.learning_unit_id}`;
    const completion = await acquisitionCommands.completeArticleLearning({
      command_id: `${commandBase}:command`,
      correlation_id: commandBase,
      event_partition: completedAt.slice(0, 7),
      payload: {
        learning_unit_id: result.learningUnit.learning_unit_id,
        completed_at: completedAt,
        review_state_id: `vocabulary-review:${result.learningUnit.learning_unit_id}`,
        scheduler_version: 'fsrs.v1',
        scheduler_parameters_version: 'fsrs-parameters.v1',
        event_id: `${commandBase}:event`,
      },
    });
    return {
      ...result,
      acquisitionState: {
        ...(result.acquisitionState || {}),
        status: 'graduated',
      },
      alreadyGraduated: true,
      articleCompletion: completion,
    };
  }

  async function queuePreviewVocabularyAcquisition(input = {}) {
    return queueAcquisitionInternal(input, {
      source: 'ielts-preview',
      createContextEvidence: createPreviewContextEvidence,
    });
  }

  async function queueVocabularyAcquisitions(inputs = [], batchOptions = {}) {
    const candidates = (Array.isArray(inputs) ? inputs : []).filter((input) => input && input.word);
    if (!candidates.length) return [];
    if (!acquisitionEnabled || typeof acquisitionService.runBatch !== 'function') {
      const results = [];
      for (const input of candidates) results.push(await queueVocabularyAcquisition(input));
      return results;
    }

    const normalizedCandidates = candidates.map((input) => normalizeWordInput(input));
    const yieldControl = typeof batchOptions.yieldControl === 'function'
      ? batchOptions.yieldControl
      : yieldVocabularyBatchControl;
    const suppliedExistingWords = Array.isArray(batchOptions.existingWords)
      ? batchOptions.existingWords
      : null;
    const lookupSnapshot = suppliedExistingWords ? null : await repository.loadSnapshot();
    const preparedWords = candidates.map((input, index) => {
      const normalized = normalizedCandidates[index];
      const supplied = suppliedExistingWords && suppliedExistingWords[index];
      const existing = supplied && supplied.id
        ? supplied
        : lookupSnapshot?.words.find((word) => (
          word.lookup_key === normalized.lookupKey
          && word.language === normalized.language
        ));
      if (existing) return cloneVocabularyValue(existing);
      return upsertWordInSnapshot(
        { words: [] },
        { ...input, context: null },
        normalized,
      );
    });
    const acquisitionSnapshot = typeof acquisitionRepository.loadSnapshot === 'function'
      ? await acquisitionRepository.loadSnapshot()
      : { by_learning_unit_id: {} };
    const acquisitionPairs = Object.values(acquisitionSnapshot && acquisitionSnapshot.by_learning_unit_id || {});
    const acquisitionPairByWordAndSense = new Map(acquisitionPairs.map((pair) => [
      `${pair?.learning_unit?.word_id || ''}::${pair?.learning_unit?.target_sense_key || ''}`,
      pair,
    ]));
    const tasks = candidates.map((input, index) => {
      const word = preparedWords[index];
      const normalized = normalizedCandidates[index];
      const targetSenseKey = deriveTargetSenseKey(createTargetSense(input, normalized));
      const matchingPair = acquisitionPairByWordAndSense.get(`${word.id}::${targetSenseKey}`) || null;
      const existingPair = matchingPair?.learning_unit?.archived_at === null ? matchingPair : null;
      return { index, input: { ...input, createdAt: normalized.createdAt }, word, existingPair };
    });
    const results = new Array(candidates.length);
    const pendingTasks = [];
    for (const task of tasks) {
      if (task.existingPair?.acquisition_state?.status === 'graduated') {
        results[task.index] = await queueVocabularyAcquisitionWithService(task.input, acquisitionService, {
          preparedWord: task.word,
          existingBySense: task.existingPair.learning_unit,
          existingState: task.existingPair.acquisition_state,
          deferVocabularyFinalization: true,
        });
      } else {
        pendingTasks.push(task);
      }
    }
    if (pendingTasks.length) {
      const transactionChunkSize = Number.isInteger(batchOptions.transactionChunkSize)
        && batchOptions.transactionChunkSize > 0
        ? batchOptions.transactionChunkSize
        : (ownerIntegration
          ? DEFAULT_OWNER_TRANSACTION_CHUNK_SIZE
          : DEFAULT_LOCAL_TRANSACTION_CHUNK_SIZE);
      for (let chunkStart = 0; chunkStart < pendingTasks.length; chunkStart += transactionChunkSize) {
        const chunk = pendingTasks.slice(chunkStart, chunkStart + transactionChunkSize);
        await acquisitionService.runBatch(async (batchService) => {
          for (const task of chunk) {
            const { index, input, word, existingPair } = task;
            results[index] = await queueVocabularyAcquisitionWithService(input, batchService, {
              preparedWord: word,
              existingBySense: existingPair && existingPair.learning_unit || null,
              existingState: existingPair && existingPair.acquisition_state || null,
              deferVocabularyFinalization: true,
            });
          }
        });
        if (chunkStart + transactionChunkSize < pendingTasks.length) {
          await yieldControl();
        }
      }
    }
    await yieldControl();
    const finalizedWords = await repository.updateSnapshot((snapshot) => candidates.map((input, index) => (
      upsertWordInSnapshot(snapshot, {
        ...input,
        __prepared_word_id: preparedWords[index].id,
      }, normalizedCandidates[index])
    )).map((word, index) => {
      addContextIfPresent(snapshot, word.id, candidates[index].context, normalizedCandidates[index].createdAt);
      return word;
    }));
    return results.map((result, index) => ({ ...result, word: finalizedWords[index] }));
  }

  async function completePendingArticleLearning(options = {}) {
    if (!acquisitionEnabled || typeof acquisitionRepository.loadSnapshot !== 'function') {
      return {
        schema_version: 'article-learning-reconciliation-result.v1',
        completed: 0,
        remaining: 0,
      };
    }
    if (typeof acquisitionService.completeArticleLearning !== 'function') {
      throw new Error('Article learning reconciliation requires the article completion acquisition command');
    }
    const limit = Number.isInteger(options.limit) && options.limit > 0
      ? options.limit
      : 50;
    const snapshot = await acquisitionRepository.loadSnapshot();
    const pending = Object.values(snapshot.by_learning_unit_id || {})
      .filter((pair) => (
        pair?.learning_unit?.extensions?.source === 'article-settlement'
        && ['acquiring', 'ready_for_check'].includes(pair?.acquisition_state?.status)
      ));
    const selected = pending.slice(0, limit);
    const completedAt = toIsoString(options.completedAt || options.completed_at || nowProvider());
    const results = [];
    for (const pair of selected) {
      const learningUnitId = pair.learning_unit.learning_unit_id;
      const commandBase = `article-completion:${learningUnitId}`;
      results.push(await acquisitionService.completeArticleLearning({
        command_id: `${commandBase}:command`,
        correlation_id: commandBase,
        event_partition: completedAt.slice(0, 7),
        payload: {
          learning_unit_id: learningUnitId,
          completed_at: completedAt,
          review_state_id: `vocabulary-review:${learningUnitId}`,
          scheduler_version: 'fsrs.v1',
          scheduler_parameters_version: 'fsrs-parameters.v1',
          event_id: `${commandBase}:event`,
        },
      }));
    }
    return {
      schema_version: 'article-learning-reconciliation-result.v1',
      completed: results.length,
      remaining: Math.max(0, pending.length - results.length),
      results,
    };
  }

  async function loadPreviewReviewStateSnapshot(learningUnitIds) {
    if (typeof reviewStateRepository?.loadSnapshot === 'function') {
      return reviewStateRepository.loadSnapshot();
    }
    if (typeof reviewStateRepository?.getByLearningUnitId === 'function') {
      const entries = await Promise.all((Array.isArray(learningUnitIds) ? learningUnitIds : [])
        .map(async (learningUnitId) => [
          learningUnitId,
          await reviewStateRepository.getByLearningUnitId(learningUnitId),
        ]));
      return {
        schema_version: 'review-store.v2',
        by_learning_unit_id: Object.fromEntries(entries.filter(([, state]) => state)),
      };
    }
    return { schema_version: 'review-store.v2', by_learning_unit_id: {} };
  }

  async function loadPreviewActivationInputs() {
    const acquisitionSnapshot = await acquisitionRepository.loadSnapshot();
    const [contentSnapshot, reviewSnapshot] = await Promise.all([
      typeof repository.loadSnapshot === 'function'
        ? repository.loadSnapshot()
        : Promise.resolve({ words: [], reviewStates: [] }),
      loadPreviewReviewStateSnapshot(Object.keys(acquisitionSnapshot?.by_learning_unit_id || {})),
    ]);
    return { acquisitionSnapshot, contentSnapshot, reviewSnapshot };
  }

  async function getPendingPreviewLearningSummary(options = {}) {
    if (!acquisitionEnabled || typeof acquisitionRepository.loadSnapshot !== 'function') {
      return {
        schema_version: 'preview-learning-pending-summary.v1',
        waiting: 0,
        matureWaiting: 0,
      };
    }
    const { nowIso } = resolvePreviewTime(options, nowProvider);
    return summarizePendingPreviewSnapshot(await acquisitionRepository.loadSnapshot(), nowIso);
  }

  async function activatePendingPreviewLearning(options = {}) {
    const execute = async () => {
      if (!acquisitionEnabled || typeof acquisitionRepository.loadSnapshot !== 'function') {
        return {
          schema_version: 'preview-activation-plan.v1',
          local_day: null,
          due_review_count: 0,
          daily_limit: 0,
          dailyLimit: 0,
          activated: [],
          waiting: 0,
          matureWaiting: 0,
          remainingDailyCapacity: 0,
        };
      }
      if (typeof acquisitionService.activatePreviewLearningUnit !== 'function') {
        throw new Error('Preview activation command is unavailable');
      }
      const { nowIso, timeZone, localDay } = resolvePreviewTime(options, nowProvider);
      const { acquisitionSnapshot, contentSnapshot, reviewSnapshot } = await loadPreviewActivationInputs();
      const pairs = Object.values(acquisitionSnapshot?.by_learning_unit_id || {});
      const pending = pairs.filter((pair) => (
        isPreviewSource(pair)
        && PREVIEW_ACTIVATION_PENDING_STATUSES.has(pair?.acquisition_state?.status)
      ));
      const dueReviewCount = countDueReviewCards(
        reviewSnapshot,
        contentSnapshot,
        nowIso,
      );
      const activatedToday = pairs.filter((pair) => (
        isPreviewActivatedOnLocalDay(pair, localDay, timeZone)
      ));
      const persistedDailyLimit = activatedToday
        .map(previewActivationMetadata)
        .find((metadata) => Number.isInteger(metadata?.daily_limit) && metadata.daily_limit >= 0)
        ?.daily_limit;
      const dailyLimit = persistedDailyLimit ?? previewActivationDailyLimit(dueReviewCount);
      const remainingCapacity = Math.max(0, dailyLimit - activatedToday.length);
      const candidates = pending
        .filter((pair) => isPreviewActivationCandidate(pair, nowIso))
        .sort((left, right) => {
          const leftAt = Date.parse(left.acquisition_state.introduced_at);
          const rightAt = Date.parse(right.acquisition_state.introduced_at);
          if (leftAt !== rightAt) return leftAt - rightAt;
          return String(left.learning_unit.learning_unit_id)
            .localeCompare(String(right.learning_unit.learning_unit_id));
        })
        .slice(0, remainingCapacity);

      const makeCommand = (pair) => {
        const learningUnitId = pair.learning_unit.learning_unit_id;
        const commandBase = `preview-capacity-activation:${localDay}:${learningUnitId}`;
        return {
          command_id: `${commandBase}:command`,
          correlation_id: commandBase,
          event_partition: nowIso.slice(0, 7),
          payload: {
            learning_unit_id: learningUnitId,
            activated_at: nowIso,
            local_day: localDay,
            daily_limit: dailyLimit,
            due_review_count: dueReviewCount,
            review_state_id: `vocabulary-review:${learningUnitId}`,
            scheduler_version: 'fsrs.v1',
            scheduler_parameters_version: 'fsrs-parameters.v1',
            event_id: `${commandBase}:event`,
          },
        };
      };
      const activate = async (commands) => {
        const results = [];
        for (const pair of candidates) {
          results.push(await commands.activatePreviewLearningUnit(makeCommand(pair)));
        }
        return results;
      };
      const activated = candidates.length && typeof acquisitionService.runBatch === 'function'
        ? await acquisitionService.runBatch(activate)
        : await activate(acquisitionService);
      const postActivationSnapshot = await acquisitionRepository.loadSnapshot();
      const postPairs = Object.values(postActivationSnapshot?.by_learning_unit_id || {});
      const postSummary = summarizePendingPreviewSnapshot(postActivationSnapshot, nowIso);
      const activatedTodayAfter = postPairs.filter((pair) => (
        isPreviewActivatedOnLocalDay(pair, localDay, timeZone)
      )).length;
      return {
        schema_version: 'preview-activation-plan.v1',
        local_day: localDay,
        due_review_count: dueReviewCount,
        daily_limit: dailyLimit,
        dailyLimit,
        activated: Array.isArray(activated) ? activated : [],
        waiting: postSummary.waiting,
        matureWaiting: postSummary.matureWaiting,
        remainingDailyCapacity: Math.max(0, dailyLimit - activatedTodayAfter),
      };
    };
    const next = previewActivationQueue.then(execute, execute);
    previewActivationQueue = next.catch(() => undefined);
    return next;
  }

  async function queueAcquisitionInternal(input = {}, options = {}) {
    if (!acquisitionEnabled) {
      throw new Error('Vocabulary acquisition writes are disabled');
    }
    const normalized = normalizeWordInput(input);
    const commands = options.acquisitionCommands || acquisitionService;
    const word = options.preparedWord || await upsertVocabularyEntry({ ...input, context: null });
    const targetSense = createTargetSense(input, normalized);
    const targetSenseKey = deriveTargetSenseKey(targetSense);
    const existingBySenseProvided = Object.prototype.hasOwnProperty.call(options, 'existingBySense');
    const existingBySense = existingBySenseProvided
      ? options.existingBySense
      : await acquisitionRepository.findActiveByWordAndSense(word.id, targetSenseKey);
    const identity = createAcquisitionIdentity(word, input, targetSenseKey);
    let unit = existingBySense;
    if (!unit && !existingBySenseProvided) {
      unit = await acquisitionRepository.getLearningUnit(identity.learningUnitId);
    }
    const existingStateProvided = Object.prototype.hasOwnProperty.call(options, 'existingState');
    let state = unit
      ? existingStateProvided ? options.existingState : await acquisitionRepository.getState(unit.learning_unit_id)
      : null;
    let attachedContextEvidence = null;

    if (!unit) {
      const initialUnit = normalizeLearningUnit({
        schema_version: 'learning-unit.v1',
        learning_unit_id: identity.learningUnitId,
        word_id: word.id,
        normalized_form: normalized.lemma,
        language: normalized.language,
        target_sense_id: null,
        target_sense_key: null,
        target_sense: null,
        created_at: normalized.createdAt,
        updated_at: normalized.createdAt,
        archived_at: null,
        revision: 0,
        extensions: {
          source: options.source || 'article-settlement',
          ...(options.source === 'ielts-preview' ? {
            preview_item_id: normalizeNullableText(input.preview_item_id || input.previewItemId),
          } : {}),
        },
      });
      await commands.queueCandidate(createAcquisitionCommand(
        identity,
        'queue',
        normalized.createdAt,
        {
          learning_unit: initialUnit,
          event_id: identity.queueEventId,
        },
      ));
      unit = initialUnit;
      state = { status: 'candidate', context_evidence_ids: [], validated_anchor_id: null, revision: 0 };
    }

    if (state?.status === 'candidate' && unit?.target_sense_id === null) {
      await commands.selectTargetSense(createAcquisitionCommand(
        identity,
        'sense',
        unit.created_at,
        {
          learning_unit_id: unit.learning_unit_id,
          target_sense_id: identity.targetSenseId,
          target_sense: targetSense,
          occurred_at: unit.created_at,
          event_id: identity.senseEventId,
        },
      ));
      unit = normalizeLearningUnit({
        ...unit,
        target_sense_id: identity.targetSenseId,
        target_sense: targetSense,
        target_sense_key: null,
        revision: unit.revision + 1,
      });
    }

    if (state?.status === 'candidate') {
      await commands.introduceCandidate(createAcquisitionCommand(
        identity,
        'introduce',
        unit.created_at,
        {
          learning_unit_id: unit.learning_unit_id,
          episode_id: identity.episodeId,
          occurred_at: unit.created_at,
        },
      ));
      state = { ...state, status: 'introduced', revision: state.revision + 1 };
    }

    if ((state?.status === 'introduced' || state?.status === 'acquiring')
      && !state.context_evidence_ids.includes(identity.evidenceId)) {
      const evidence = options.createContextEvidence?.(input, unit, identity, unit.created_at) || null;
      attachedContextEvidence = evidence;
      if (evidence) {
        await commands.attachContextEvidence(createAcquisitionCommand(
          identity,
          'context',
          unit.created_at,
          {
            context_evidence: evidence,
            occurred_at: unit.created_at,
            event_id: identity.contextEventId,
          },
        ));
        state = {
          ...state,
          status: 'acquiring',
          context_evidence_ids: [...new Set([...state.context_evidence_ids, identity.evidenceId])],
          revision: state.revision + 1,
        };
      }
    }

    const storedWord = options.deferVocabularyFinalization ? word : await upsertVocabularyEntry(input);
    return {
      word: storedWord,
      learningUnit: unit,
      acquisitionState: state,
      contextEvidence: attachedContextEvidence,
      alreadyGraduated: state?.status === 'graduated',
      created: !existingBySense,
    };
  }

  async function getWordByLemma(lemma, options = {}) {
    return repository.findWordByLemma(lemma, { language: normalizeLanguage(options.language) });
  }

  async function getWordsAndContextsByLemmas(lemmas, options = {}) {
    const language = normalizeLanguage(options.language);
    const lookupKeys = Array.from(new Set((Array.isArray(lemmas) ? lemmas : [lemmas])
      .map((lemma) => normalizeLookupKey(lemma))
      .filter(Boolean)));
    if (!lookupKeys.length) return new Map();
    if (typeof repository.loadSnapshot !== 'function') return null;
    const lookupKeySet = new Set(lookupKeys);
    const snapshot = await repository.loadSnapshot();
    const wordsByKey = new Map((Array.isArray(snapshot && snapshot.words) ? snapshot.words : [])
      .filter((word) => word && word.language === language && lookupKeySet.has(word.lookup_key))
      .map((word) => [word.lookup_key, word]));
    const contextsByWordId = new Map();
    (Array.isArray(snapshot && snapshot.contexts) ? snapshot.contexts : []).forEach((context) => {
      const wordId = context && context.word_id;
      if (!wordId) return;
      const contexts = contextsByWordId.get(wordId) || [];
      contexts.push(context);
      contextsByWordId.set(wordId, contexts);
    });
    return new Map(lookupKeys.map((lookupKey) => {
      const word = wordsByKey.get(lookupKey) || null;
      return [lookupKey, {
        word: cloneVocabularyValue(word),
        contexts: word
          ? (contextsByWordId.get(word.id) || []).map(cloneVocabularyValue)
          : [],
      }];
    }));
  }

  async function getContextsForWord(wordId) {
    return repository.getContextsForWord(wordId);
  }

  async function getReviewLogs() {
    if (typeof repository.getReviewLogs !== 'function') return [];
    const logs = await repository.getReviewLogs();
    return logs.sort((left, right) => compareIsoAsc(right.reviewed_at, left.reviewed_at));
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
    return commitReview(wordId, rating, reviewedAt, false);
  }

  async function reviewWordKnown(wordId, reviewedAt) {
    return commitReview(wordId, REVIEW_RATINGS.EASY, reviewedAt, true);
  }

  async function commitReview(wordId, rating, reviewedAt, markKnown) {
    const reviewedAtIso = toIsoString(reviewedAt || nowProvider());
    return repository.updateSnapshot((snapshot) => {
      const word = findWordOrThrow(snapshot, wordId);
      if (word.status === WORD_STATUSES.IGNORED) {
        throw new Error(`Cannot review ignored vocabulary word: ${wordId}`);
      }
      const currentState = ensureReviewState(snapshot, word, word.created_at, scheduler);
      const beforeState = cloneVocabularyValue(currentState);
      const scheduled = scheduler.schedule(currentState, rating, reviewedAtIso);
      const afterState = markKnown
        ? scheduler.createKnownReviewState(scheduled.reviewState, reviewedAtIso)
        : scheduled.reviewState;
      replaceReviewState(snapshot, afterState);

      word.status = markKnown
        ? WORD_STATUSES.KNOWN
        : resolveReviewedWordStatus(word.status, rating, afterState);
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

  async function deleteWord(wordId) {
    return repository.updateSnapshot((snapshot) => {
      const word = findWordOrThrow(snapshot, wordId);
      snapshot.words = snapshot.words.filter((item) => item.id !== word.id);
      snapshot.contexts = snapshot.contexts.filter((context) => context.word_id !== word.id);
      snapshot.reviewStates = snapshot.reviewStates.filter((state) => state.word_id !== word.id);
      snapshot.reviewLogs = snapshot.reviewLogs.filter((log) => log.word_id !== word.id);
      return word;
    });
  }

  async function relearnWord(wordId, options = {}) {
    const relearnedAtIso = toIsoString(options.relearnedAt || options.relearned_at || options.updatedAt || options.updated_at || nowProvider());
    return repository.updateSnapshot((snapshot) => {
      const word = findWordOrThrow(snapshot, wordId);
      const reviewState = scheduler.createInitialReviewState(word.id, relearnedAtIso);
      replaceReviewState(snapshot, reviewState);
      word.status = WORD_STATUSES.LEARNING;
      mergeWordTags(word, options.tags);
      word.updated_at = relearnedAtIso;
      return {
        word,
        reviewState,
      };
    });
  }

  async function cacheGeneralMeanings(items, cachedAt) {
    const cachedAtIso = toIsoString(cachedAt || nowProvider());
    const updates = new Map(
      (Array.isArray(items) ? items : [])
        .map((item) => [
          normalizeText(item?.word_id || item?.wordId),
          {
            generalMeaning: normalizeNullableText(item?.general_meaning || item?.generalMeaning),
            dictionaryDefinition: normalizeNullableText(item?.dictionary_definition || item?.dictionaryDefinition),
            dictionarySource: normalizeNullableText(item?.dictionary_source || item?.dictionarySource),
          },
        ])
        .filter(([wordId, value]) => wordId && value.generalMeaning),
    );
    if (!updates.size) return [];
    return repository.updateSnapshot((snapshot) => {
      const changed = [];
      snapshot.words.forEach((word) => {
        const update = updates.get(word.id);
        if (!update) return;
        word.general_meaning = update.generalMeaning;
        word.dictionary_definition = update.dictionaryDefinition;
        word.dictionary_source = update.dictionarySource;
        word.dictionary_fetched_at = cachedAtIso;
        word.updated_at = cachedAtIso;
        changed.push(word);
      });
      return changed;
    });
  }

  return {
    addWord,
    addWordLegacy,
    upsertVocabularyEntry,
    queueVocabularyAcquisition,
    queueVocabularyAcquisitions,
    queuePreviewVocabularyAcquisition,
    completePendingArticleLearning,
    getPendingPreviewLearningSummary,
    activatePendingPreviewLearning,
    getAcquisitionRepository: () => acquisitionRepository,
    getAcquisitionService: () => acquisitionService,
    isAcquisitionEnabled: () => acquisitionEnabled,
    getLegacyCompatibilityCalls: () => legacyCompatibilityCalls.map((item) => ({ ...item })),
    getWordByLemma,
    getWordsAndContextsByLemmas,
    getContextsForWord,
    getReviewLogs,
    getDueWords,
    reviewWord,
    reviewWordKnown,
    markWordKnown,
    ignoreWord,
    deleteWord,
    relearnWord,
    cacheGeneralMeanings,
  };
}

function yieldVocabularyBatchControl() {
  if (typeof globalThis.scheduler?.yield === 'function') {
    return globalThis.scheduler.yield();
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function upsertWordInSnapshot(snapshot, input, normalized) {
  let word = snapshot.words.find((item) => (
    item.lookup_key === normalized.lookupKey
    && item.language === normalized.language
  ));
  if (!word) {
    word = {
      id: normalizeText(input.__prepared_word_id) || createVocabularyId('vocab_word'),
      word: normalized.wordText,
      lemma: normalized.lemma,
      lookup_key: normalized.lookupKey,
      entry_type: normalizeVocabularyEntryType(input.entry_type || input.entryType),
      language: normalized.language,
      phonetic: normalizeNullableText(input.phonetic),
      meaning: normalized.initialMeaning,
      general_meaning: normalizeNullableText(input.general_meaning || input.generalMeaning),
      dictionary_definition: normalizeNullableText(input.dictionary_definition || input.dictionaryDefinition),
      dictionary_source: normalizeNullableText(input.dictionary_source || input.dictionarySource),
      dictionary_fetched_at: null,
      note: normalizeNullableText(input.note),
      status: WORD_STATUSES.NEW,
      tags: normalizeVocabularyTags(input.tags),
      created_at: normalized.createdAt,
      updated_at: normalized.createdAt,
    };
    snapshot.words.push(word);
  } else if (input.preserve_existing_metadata !== true && mergeWordTags(word, input.tags)) {
    word.updated_at = normalized.createdAt;
  }
  return word;
}

function resolveAcquisitionFeatureFlag(options) {
  const configured = options.acquisitionEnabled
    ?? options.featureFlags?.VOCABULARY_ACQUISITION_ENABLED
    ?? globalThis.__READ_WEB_FEATURE_FLAGS__?.VOCABULARY_ACQUISITION_ENABLED
    ?? false;
  return configured === true || configured === 'true';
}

function createTargetSense(input, normalized) {
  const gloss = normalizeNullableText(input.meaning)
    || getContextMeaning(input.context)
    || normalized.lemma;
  return {
    gloss,
    normalized_gloss: gloss.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase(),
    part_of_speech: normalizeNullableText(input.part_of_speech || input.partOfSpeech),
    definition: normalizeNullableText(input.definition),
    language: normalized.language,
  };
}

function createStableIntegrationId(prefix, value) {
  return `${prefix}:${sha256Utf8(canonicalJson(value)).slice(0, 32)}`;
}

function createAcquisitionIdentity(word, input, targetSenseKey) {
  const context = input.context || {};
  const acquisitionIdentity = input.acquisition_identity || input.acquisitionIdentity || {};
  const seed = {
    word_id: word.id,
    target_sense_key: targetSenseKey,
    source_id: normalizeNullableText(
      acquisitionIdentity.source_id
        || acquisitionIdentity.sourceId
        || context.source_id
        || context.sourceId,
    ),
    target_id: normalizeNullableText(
      acquisitionIdentity.target_id
        || acquisitionIdentity.targetId
        || input.target_id
        || input.targetId,
    ),
  };
  const root = createStableIntegrationId('article-acquisition', seed);
  return {
    learningUnitId: `${root}:unit`,
    targetSenseId: `${root}:sense`,
    episodeId: `${root}:episode`,
    evidenceId: `${root}:context`,
    queueEventId: `${root}:queued`,
    senseEventId: `${root}:sense-selected`,
    contextEventId: `${root}:context-attached`,
    commandId: (step) => `${root}:${step}`,
    correlationId: root,
  };
}

function createAcquisitionCommand(identity, step, occurredAt, payload) {
  return {
    command_id: identity.commandId(step),
    correlation_id: identity.correlationId,
    event_partition: occurredAt.slice(0, 7),
    payload,
  };
}

function createArticleContextEvidence(input, unit, identity, createdAt) {
  const context = input.context;
  const sentence = normalizeText(context && context.sentence);
  if (!sentence) return null;
  const sourceId = normalizeNullableText(context.source_id || context.sourceId)
    || createStableIntegrationId('article-source', {
      source_title: normalizeNullableText(context.source_title || context.sourceTitle),
      source_url: normalizeNullableText(context.source_url || context.sourceUrl),
    });
  const sourceTitle = normalizeNullableText(context.source_title || context.sourceTitle)
    || sourceId;
  const sentenceIndex = Number(context.sentence_index ?? context.sentenceIndex ?? 0);
  return {
    schema_version: 'context-evidence.v1',
    context_evidence_id: identity.evidenceId,
    learning_unit_id: unit.learning_unit_id,
    sentence,
    surrounding_text: normalizeNullableText(context.surrounding_text || context.surroundingText),
    source_kind: 'article',
    source_id: sourceId,
    source_title: sourceTitle,
    source_locator: {
      locator_version: 'source-locator.v1',
      sentence_index: Number.isInteger(sentenceIndex) && sentenceIndex >= 0 ? sentenceIndex : 0,
    },
    license_kind: 'unknown',
    ownership: 'third_party',
    quality_status: 'pending',
    quality_reason: 'awaiting_source_validation',
    created_at: createdAt,
    validated_at: null,
    revision: 0,
    extensions: {
      source_url: normalizeNullableText(context.source_url || context.sourceUrl),
    },
  };
}

function createPreviewContextEvidence(input, unit, identity, createdAt) {
  const context = input.context;
  const sentence = normalizeText(context && context.sentence);
  if (!sentence) return null;

  const sourceKind = normalizeNullableText(context.source_kind || context.sourceKind)
    || 'user_local_exam_material';
  const sourceId = normalizeNullableText(context.source_id || context.sourceId)
    || `ielts-preview:${unit.normalized_form}`;
  const sourceTitle = normalizeNullableText(context.source_title || context.sourceTitle)
    || '剑桥雅思阅读本地语料';
  const qualityStatus = normalizeNullableText(context.quality_status || context.qualityStatus)
    || 'validated';
  const sourceLocator = context.source_locator || context.sourceLocator || {
    locator_version: 'source-locator.v1',
    local_locator: normalizeNullableText(context.local_locator || context.localLocator)
      || identity.evidenceId,
  };

  return normalizeContextEvidence({
    schema_version: 'context-evidence.v1',
    context_evidence_id: identity.evidenceId,
    learning_unit_id: unit.learning_unit_id,
    sentence,
    surrounding_text: normalizeNullableText(context.surrounding_text || context.surroundingText),
    source_kind: sourceKind,
    source_id: sourceId,
    source_title: sourceTitle,
    source_locator: sourceLocator,
    license_kind: normalizeNullableText(context.license_kind || context.licenseKind)
      || 'user_owned',
    ownership: normalizeNullableText(context.ownership) || 'private',
    quality_status: qualityStatus,
    quality_reason: normalizeNullableText(context.quality_reason || context.qualityReason)
      || '本地用户持有的剑桥雅思语料已通过来源校验',
    created_at: createdAt,
    validated_at: qualityStatus === 'validated'
      ? normalizeNullableText(context.validated_at || context.validatedAt) || createdAt
      : null,
    revision: 0,
    extensions: context.extensions && typeof context.extensions === 'object'
      ? context.extensions
      : {},
  });
}

function mergeWordTags(word, tags) {
  const nextTags = normalizeVocabularyTags(tags);
  if (!nextTags.length) return false;
  const current = normalizeVocabularyTags(word.tags);
  let changed = false;
  nextTags.forEach((tag) => {
    if (current.includes(tag)) return;
    current.push(tag);
    changed = true;
  });
  if (changed) word.tags = current;
  return changed;
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
    simple_meaning: getContextSimpleMeaning(context),
    source_id: normalizeNullableText(context.source_id || context.sourceId),
    source_title: normalizeNullableText(context.source_title || context.sourceTitle),
    source_url: normalizeNullableText(context.source_url || context.sourceUrl),
    surrounding_text: normalizeNullableText(context.surrounding_text || context.surroundingText),
    created_at: toIsoString(context.created_at || context.createdAt || createdAt),
  };
  const duplicate = snapshot.contexts.find((existing) => (
    existing.word_id === wordId
    && normalizeText(existing.sentence) === entry.sentence
    && normalizeNullableText(existing.meaning) === entry.meaning
    && normalizeNullableText(existing.simple_meaning || existing.simpleMeaning) === entry.simple_meaning
    && normalizeNullableText(existing.source_id || existing.sourceId) === entry.source_id
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

function getContextSimpleMeaning(context) {
  if (!context || typeof context !== 'object') return null;
  return normalizeNullableText(context.simple_meaning || context.simpleMeaning);
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
