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

export const VOCABULARY_LEGACY_ADD_WORD_COMPATIBILITY = 'legacy-add-word.v1';

export function createVocabularyService(options = {}) {
  const repository = options.repository || createIndexedDbVocabularyRepository(options.repositoryOptions || {});
  const scheduler = options.scheduler || createSrsScheduler(options.schedulerOptions || {});
  const nowProvider = typeof options.now === 'function' ? options.now : () => new Date();
  const acquisitionEnabled = resolveAcquisitionFeatureFlag(options);
  const acquisitionRepository = options.acquisitionRepository
    || createIndexedDbAcquisitionRepository(options.acquisitionRepositoryOptions || {});
  const acquisitionService = options.acquisitionService || createVocabularyAcquisitionService({
    enabled: acquisitionEnabled,
    runUnitOfWork: options.runVocabularyLearningUnitOfWork,
    now: () => toIsoString(nowProvider()),
  });
  const legacyCompatibilityCalls = [];

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
    return queueAcquisitionInternal(input, {
      source: 'article-settlement',
      createContextEvidence: createArticleContextEvidence,
    });
  }

  async function queuePreviewVocabularyAcquisition(input = {}) {
    return queueAcquisitionInternal(input, {
      source: 'ielts-preview',
      createContextEvidence: createPreviewContextEvidence,
    });
  }

  async function queueAcquisitionInternal(input = {}, options = {}) {
    if (!acquisitionEnabled) {
      throw new Error('Vocabulary acquisition writes are disabled');
    }
    const normalized = normalizeWordInput(input);
    const word = await upsertVocabularyEntry({ ...input, context: null });
    const targetSense = createTargetSense(input, normalized);
    const targetSenseKey = deriveTargetSenseKey(targetSense);
    const existingBySense = await acquisitionRepository.findActiveByWordAndSense(
      word.id,
      targetSenseKey,
    );
    const identity = createAcquisitionIdentity(word, input, targetSenseKey);
    let unit = existingBySense
      || await acquisitionRepository.getLearningUnit(identity.learningUnitId);
    let state = unit
      ? await acquisitionRepository.getState(unit.learning_unit_id)
      : null;
    let attachedContextEvidence = null;

    if (!unit) {
      await acquisitionService.queueCandidate(createAcquisitionCommand(
        identity,
        'queue',
        normalized.createdAt,
        {
          learning_unit: {
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
            },
          },
          event_id: identity.queueEventId,
        },
      ));
      unit = await acquisitionRepository.getLearningUnit(identity.learningUnitId);
      state = await acquisitionRepository.getState(identity.learningUnitId);
    }

    if (state?.status === 'candidate' && unit?.target_sense_id === null) {
      await acquisitionService.selectTargetSense(createAcquisitionCommand(
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
      unit = await acquisitionRepository.getLearningUnit(unit.learning_unit_id);
      state = await acquisitionRepository.getState(unit.learning_unit_id);
    }

    if (state?.status === 'candidate') {
      await acquisitionService.introduceCandidate(createAcquisitionCommand(
        identity,
        'introduce',
        unit.created_at,
        {
          learning_unit_id: unit.learning_unit_id,
          episode_id: identity.episodeId,
          occurred_at: unit.created_at,
        },
      ));
      state = await acquisitionRepository.getState(unit.learning_unit_id);
    }

    if ((state?.status === 'introduced' || state?.status === 'acquiring')
      && !state.context_evidence_ids.includes(identity.evidenceId)) {
      const evidence = options.createContextEvidence?.(input, unit, identity, unit.created_at) || null;
      attachedContextEvidence = evidence;
      if (evidence) {
        await acquisitionService.attachContextEvidence(createAcquisitionCommand(
          identity,
          'context',
          unit.created_at,
          {
            context_evidence: evidence,
            occurred_at: unit.created_at,
            event_id: identity.contextEventId,
          },
        ));
        state = await acquisitionRepository.getState(unit.learning_unit_id);
      }
    }

    const storedWord = await upsertVocabularyEntry(input);
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
    queuePreviewVocabularyAcquisition,
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

function upsertWordInSnapshot(snapshot, input, normalized) {
  let word = snapshot.words.find((item) => (
    item.lookup_key === normalized.lookupKey
    && item.language === normalized.language
  ));
  if (!word) {
    word = {
      id: createVocabularyId('vocab_word'),
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
