import {
  cloneVocabularyValue,
  normalizeNullableText,
  normalizeText,
  toIsoString,
} from './vocabulary-models.js';
import { summarizeArticleSrsSettlement } from './article-srs-settlement.js';
import { SETTLEMENT_MEANING_REFINEMENT_PROMPT_VERSION } from './settlement-meaning-refinement.js';

export const ARTICLE_SRS_SETTLEMENT_PROGRESS_STORE_KEY = 'vocabulary-article-srs-settlement-progress';

const DB_NAME = 'SeekPlayerDB';
const DB_VERSION = 1;
const STORE_NAME = 'files';

function assertVocabularyBrowserWriterAllowed(operation) {
  globalThis?.__windowsOwnerDomainCutover?.assertBrowserWriterAllowed?.('vocabulary-srs', operation);
}
const APPLICATION_CLAIM_TTL_MS = 15 * 60 * 1000;

function createEmptyStore() {
  return { schemaVersion: 1, articles: {} };
}

function getTargetId(value) {
  return normalizeText(value && (value.target_id || value.targetId || value.id));
}

function getSimpleMeaning(value) {
  return normalizeNullableText(value && (
    value.simple_meaning
    || value.simpleMeaning
    || value.context && (value.context.simple_meaning || value.context.simpleMeaning)
  ));
}

function createOperationToken(prefix) {
  const randomId = typeof globalThis !== 'undefined'
    && globalThis.crypto
    && typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomId}`;
}

function normalizeTargetIds(values) {
  const result = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const targetId = normalizeText(value);
    if (targetId && !result.includes(targetId)) result.push(targetId);
  });
  return result;
}

function normalizeRefinement(refinement) {
  const targetId = getTargetId(refinement);
  if (!targetId) return null;
  const attemptedAt = toIsoString(refinement.attempted_at || refinement.attemptedAt || new Date());
  const status = ['pending', 'completed', 'failed'].includes(normalizeText(refinement.status))
    ? normalizeText(refinement.status)
    : 'completed';
  return {
    target_id: targetId,
    simple_meaning: getSimpleMeaning(refinement),
    prompt_version: Number(refinement.prompt_version || refinement.promptVersion) || 0,
    status,
    attempt_token: normalizeText(refinement.attempt_token || refinement.attemptToken),
    attempted_at: attemptedAt,
    completed_at: refinement.completed_at || refinement.completedAt
      ? toIsoString(refinement.completed_at || refinement.completedAt)
      : null,
    failed_at: refinement.failed_at || refinement.failedAt
      ? toIsoString(refinement.failed_at || refinement.failedAt)
      : null,
    error: normalizeNullableText(refinement.error),
  };
}

function normalizeClaim(claim) {
  const targetId = getTargetId(claim);
  if (!targetId) return null;
  const claimedAt = toIsoString(claim.claimed_at || claim.claimedAt || new Date());
  const expiresAt = toIsoString(claim.expires_at || claim.expiresAt || new Date(Date.parse(claimedAt) + APPLICATION_CLAIM_TTL_MS));
  return {
    target_id: targetId,
    claim_token: normalizeText(claim.claim_token || claim.claimToken),
    claimed_at: claimedAt,
    expires_at: expiresAt,
  };
}

function normalizeProgress(progress, articleIdFallback = '') {
  if (!progress || typeof progress !== 'object') return null;
  const articleId = normalizeText(progress.article_id || progress.articleId || articleIdFallback);
  if (!articleId) return null;
  const refinedAt = progress.refined_at || progress.refinedAt;
  const appliedAt = progress.applied_at || progress.appliedAt;
  const skippedAt = progress.skipped_at || progress.skippedAt;
  return {
    article_id: articleId,
    refinements: (Array.isArray(progress.refinements) ? progress.refinements : [])
      .map(normalizeRefinement)
      .filter(Boolean),
    application_claims: (Array.isArray(progress.application_claims || progress.applicationClaims)
      ? progress.application_claims || progress.applicationClaims
      : []).map(normalizeClaim).filter(Boolean),
    settlement_target_ids: normalizeTargetIds(progress.settlement_target_ids || progress.settlementTargetIds),
    removed_target_ids: normalizeTargetIds(progress.removed_target_ids || progress.removedTargetIds),
    applied_target_ids: normalizeTargetIds(progress.applied_target_ids || progress.appliedTargetIds),
    skipped_target_ids: normalizeTargetIds(progress.skipped_target_ids || progress.skippedTargetIds),
    last_apply_mode: normalizeText(progress.last_apply_mode || progress.lastApplyMode),
    refined_at: refinedAt ? toIsoString(refinedAt) : null,
    applied_at: appliedAt ? toIsoString(appliedAt) : null,
    skipped_at: skippedAt ? toIsoString(skippedAt) : null,
    updated_at: toIsoString(progress.updated_at || progress.updatedAt || skippedAt || appliedAt || refinedAt || new Date()),
  };
}

function normalizeStore(store) {
  const source = store && typeof store === 'object' ? store : {};
  const articles = {};
  Object.entries(source.articles || {}).forEach(([articleId, progress]) => {
    const normalized = normalizeProgress(progress, articleId);
    if (normalized) articles[normalized.article_id] = normalized;
  });
  return { schemaVersion: 1, articles };
}

function getActiveClaims(progress, nowValue = new Date()) {
  const now = Date.parse(toIsoString(nowValue));
  return (progress && Array.isArray(progress.application_claims) ? progress.application_claims : [])
    .filter((claim) => Date.parse(claim.expires_at) > now);
}

export function createArticleSrsSettlementProgressRepository(storage) {
  const hasAtomicStorage = storage
    && typeof storage.getProgress === 'function'
    && typeof storage.updateProgress === 'function';
  const hasStoreStorage = storage
    && typeof storage.loadStore === 'function'
    && typeof storage.saveStore === 'function';
  if (!hasAtomicStorage && !hasStoreStorage) {
    throw new Error('Article SRS settlement progress repository requires atomic progress or store storage methods');
  }
  let fallbackQueue = Promise.resolve();

  async function getProgress(articleId) {
    const normalizedArticleId = normalizeText(articleId);
    if (!normalizedArticleId) return null;
    if (hasAtomicStorage) {
      return cloneVocabularyValue(normalizeProgress(await storage.getProgress(normalizedArticleId), normalizedArticleId));
    }
    await fallbackQueue;
    const store = normalizeStore(await storage.loadStore());
    return cloneVocabularyValue(store.articles[normalizedArticleId] || null);
  }

  function updateProgress(articleId, mutator) {
    const normalizedArticleId = normalizeText(articleId);
    if (!normalizedArticleId) return Promise.reject(new Error('Article SRS settlement progress requires an article id'));
    if (hasAtomicStorage) {
      return storage.updateProgress(normalizedArticleId, (current) => normalizeProgress(
        mutator(normalizeProgress(current, normalizedArticleId) || {
          article_id: normalizedArticleId,
          refinements: [],
          application_claims: [],
          settlement_target_ids: [],
          removed_target_ids: [],
          applied_target_ids: [],
          skipped_target_ids: [],
        }),
        normalizedArticleId
      ));
    }
    const operation = fallbackQueue.then(async () => {
      const store = normalizeStore(await storage.loadStore());
      const current = store.articles[normalizedArticleId] || {
        article_id: normalizedArticleId,
        refinements: [],
        application_claims: [],
        settlement_target_ids: [],
        removed_target_ids: [],
        applied_target_ids: [],
        skipped_target_ids: [],
      };
      const next = normalizeProgress(mutator(current), normalizedArticleId);
      store.articles[normalizedArticleId] = next;
      await storage.saveStore(normalizeStore(store));
      return cloneVocabularyValue(next);
    });
    fallbackQueue = operation.catch(() => {});
    return operation;
  }

  async function claimRefinementAttempt(articleId, candidates = [], options = {}) {
    const attemptedAt = toIsoString(options.attemptedAt || options.attempted_at || new Date());
    const claimToken = normalizeText(options.claimToken || options.claim_token) || createOperationToken('refinement');
    const promptVersion = Number(options.promptVersion || options.prompt_version) || SETTLEMENT_MEANING_REFINEMENT_PROMPT_VERSION;
    let claimedTargetIds = [];
    const progress = await updateProgress(articleId, (current) => {
      const byTargetId = new Map(current.refinements.map((item) => [item.target_id, item]));
      claimedTargetIds = [];
      (Array.isArray(candidates) ? candidates : []).forEach((candidate) => {
        const targetId = getTargetId(candidate);
        if (!targetId) return;
        const existing = byTargetId.get(targetId);
        if (existing && existing.prompt_version === promptVersion && (existing.status === 'pending' || existing.status === 'completed')) return;
        claimedTargetIds.push(targetId);
        byTargetId.set(targetId, {
          ...(existing || {}),
          target_id: targetId,
          prompt_version: promptVersion,
          status: 'pending',
          attempt_token: claimToken,
          attempted_at: attemptedAt,
          completed_at: null,
          failed_at: null,
          error: null,
        });
      });
      return {
        ...current,
        refinements: Array.from(byTargetId.values()),
        refined_at: attemptedAt,
        updated_at: attemptedAt,
      };
    });
    return { progress, claimedTargetIds, claimToken };
  }

  function recordRefinement(articleId, candidates = [], options = {}) {
    const refinedAt = toIsoString(options.refinedAt || options.refined_at || new Date());
    const claimToken = normalizeText(options.claimToken || options.claim_token);
    const promptVersion = Number(options.promptVersion || options.prompt_version) || SETTLEMENT_MEANING_REFINEMENT_PROMPT_VERSION;
    return updateProgress(articleId, (current) => {
      const byTargetId = new Map(current.refinements.map((item) => [item.target_id, item]));
      (Array.isArray(candidates) ? candidates : []).forEach((candidate) => {
        const targetId = getTargetId(candidate);
        if (!targetId) return;
        const existing = byTargetId.get(targetId);
        if (claimToken && (!existing || existing.attempt_token !== claimToken)) return;
        byTargetId.set(targetId, {
          ...(existing || {}),
          target_id: targetId,
          simple_meaning: getSimpleMeaning(candidate),
          prompt_version: promptVersion,
          status: 'completed',
          attempted_at: byTargetId.get(targetId) && byTargetId.get(targetId).attempted_at || refinedAt,
          completed_at: refinedAt,
          failed_at: null,
          error: null,
        });
      });
      return {
        ...current,
        refinements: Array.from(byTargetId.values()),
        refined_at: refinedAt,
        updated_at: refinedAt,
      };
    });
  }

  function recordRefinementFailure(articleId, candidates = [], error, options = {}) {
    const failedAt = toIsoString(options.failedAt || options.failed_at || new Date());
    const claimToken = normalizeText(options.claimToken || options.claim_token);
    const promptVersion = Number(options.promptVersion || options.prompt_version) || SETTLEMENT_MEANING_REFINEMENT_PROMPT_VERSION;
    return updateProgress(articleId, (current) => {
      const byTargetId = new Map(current.refinements.map((item) => [item.target_id, item]));
      (Array.isArray(candidates) ? candidates : []).forEach((candidate) => {
        const targetId = getTargetId(candidate);
        if (!targetId) return;
        const existing = byTargetId.get(targetId);
        if (claimToken && (!existing || existing.attempt_token !== claimToken)) return;
        byTargetId.set(targetId, {
          ...(existing || {}),
          target_id: targetId,
          prompt_version: promptVersion,
          status: 'failed',
          attempted_at: byTargetId.get(targetId) && byTargetId.get(targetId).attempted_at || failedAt,
          completed_at: null,
          failed_at: failedAt,
          error: normalizeNullableText(error && error.message || error),
        });
      });
      return {
        ...current,
        refinements: Array.from(byTargetId.values()),
        refined_at: failedAt,
        updated_at: failedAt,
      };
    });
  }

  function setCandidateRemoved(articleId, targetId, removed, options = {}) {
    const normalizedTargetId = normalizeText(targetId);
    if (!normalizedTargetId) return Promise.reject(new Error('Article SRS candidate removal requires a target id'));
    const updatedAt = toIsoString(options.updatedAt || options.updated_at || new Date());
    return updateProgress(articleId, (current) => {
      const removedTargetIds = new Set(current.removed_target_ids);
      if (removed) removedTargetIds.add(normalizedTargetId);
      else removedTargetIds.delete(normalizedTargetId);
      return {
        ...current,
        removed_target_ids: Array.from(removedTargetIds),
        updated_at: updatedAt,
      };
    });
  }

  function recordSettlementTargets(articleId, targetIds = [], options = {}) {
    const settlementTargetIds = normalizeTargetIds(targetIds);
    const appliedTargetIds = normalizeTargetIds(options.appliedTargetIds || options.applied_target_ids);
    const updatedAt = toIsoString(options.updatedAt || options.updated_at || new Date());
    return updateProgress(articleId, (current) => ({
      ...current,
      settlement_target_ids: Array.from(new Set([
        ...current.settlement_target_ids,
        ...settlementTargetIds,
      ])),
      applied_target_ids: Array.from(new Set([
        ...current.applied_target_ids,
        ...appliedTargetIds,
      ])),
      updated_at: updatedAt,
    }));
  }

  async function claimApplication(articleId, options = {}) {
    const requestedTargetIds = normalizeTargetIds(options.candidateTargetIds || options.candidate_target_ids);
    const requestedSkippedIds = normalizeTargetIds(options.skippedTargetIds || options.skipped_target_ids);
    const settlementTargetIds = normalizeTargetIds(
      options.allCandidateTargetIds
      || options.all_candidate_target_ids
      || [...requestedTargetIds, ...requestedSkippedIds]
    );
    const claimedAt = toIsoString(options.claimedAt || options.claimed_at || new Date());
    const claimToken = normalizeText(options.claimToken || options.claim_token) || createOperationToken('application');
    let claimedTargetIds = [];
    const progress = await updateProgress(articleId, (current) => {
      const activeClaims = getActiveClaims(current, claimedAt);
      const unavailable = new Set([
        ...current.applied_target_ids,
        ...current.skipped_target_ids,
        ...activeClaims.map((claim) => claim.target_id),
      ]);
      const skippedTargetIds = requestedSkippedIds.filter((targetId) => !unavailable.has(targetId));
      skippedTargetIds.forEach((targetId) => unavailable.add(targetId));
      claimedTargetIds = requestedTargetIds.filter((targetId) => !unavailable.has(targetId));
      const expiresAt = new Date(Date.parse(claimedAt) + APPLICATION_CLAIM_TTL_MS).toISOString();
      return {
        ...current,
        settlement_target_ids: Array.from(new Set([
          ...current.settlement_target_ids,
          ...settlementTargetIds,
        ])),
        application_claims: [
          ...activeClaims,
          ...claimedTargetIds.map((targetId) => ({ target_id: targetId, claim_token: claimToken, claimed_at: claimedAt, expires_at: expiresAt })),
        ],
        removed_target_ids: current.removed_target_ids.filter((targetId) => !skippedTargetIds.includes(targetId)),
        skipped_target_ids: [...current.skipped_target_ids, ...skippedTargetIds],
        skipped_at: skippedTargetIds.length ? claimedAt : current.skipped_at,
        updated_at: claimedAt,
      };
    });
    return { progress, claimedTargetIds, claimToken };
  }

  function releaseApplicationClaim(articleId, targetIds = [], options = {}) {
    const releasedAt = toIsoString(options.releasedAt || options.released_at || new Date());
    const released = new Set(normalizeTargetIds(targetIds));
    const claimToken = normalizeText(options.claimToken || options.claim_token);
    return updateProgress(articleId, (current) => ({
      ...current,
      application_claims: current.application_claims.filter((claim) => (
        !released.has(claim.target_id) || claimToken && claim.claim_token !== claimToken
      )),
      updated_at: releasedAt,
    }));
  }

  function recordApplication(articleId, options = {}) {
    const appliedAt = toIsoString(options.appliedAt || options.applied_at || new Date());
    const requestedAppliedTargetIds = normalizeTargetIds(options.appliedTargetIds || options.applied_target_ids);
    const skippedTargetIds = normalizeTargetIds(options.skippedTargetIds || options.skipped_target_ids);
    const claimToken = normalizeText(options.claimToken || options.claim_token);
    return updateProgress(articleId, (current) => {
      const ownedTargetIds = claimToken
        ? new Set(current.application_claims.filter((claim) => claim.claim_token === claimToken).map((claim) => claim.target_id))
        : null;
      const appliedTargetIds = ownedTargetIds
        ? requestedAppliedTargetIds.filter((targetId) => ownedTargetIds.has(targetId))
        : requestedAppliedTargetIds;
      const finalized = new Set([...appliedTargetIds, ...skippedTargetIds]);
      return {
        ...current,
        application_claims: current.application_claims.filter((claim) => (
          !finalized.has(claim.target_id) || claimToken && claim.claim_token !== claimToken
        )),
        removed_target_ids: current.removed_target_ids.filter((targetId) => !finalized.has(targetId)),
        applied_target_ids: [...current.applied_target_ids, ...appliedTargetIds],
        skipped_target_ids: [...current.skipped_target_ids, ...skippedTargetIds],
        last_apply_mode: options.mode,
        applied_at: appliedAt,
        updated_at: appliedAt,
      };
    });
  }

  function recordSkip(articleId, options = {}) {
    const skippedAt = toIsoString(options.skippedAt || options.skipped_at || new Date());
    const requested = normalizeTargetIds(options.skippedTargetIds || options.skipped_target_ids);
    return updateProgress(articleId, (current) => {
      const claimed = new Set(getActiveClaims(current, skippedAt).map((claim) => claim.target_id));
      const applied = new Set(current.applied_target_ids);
      const skippedTargetIds = requested.filter((targetId) => !claimed.has(targetId) && !applied.has(targetId));
      return {
        ...current,
        removed_target_ids: current.removed_target_ids.filter((targetId) => !skippedTargetIds.includes(targetId)),
        skipped_target_ids: [...current.skipped_target_ids, ...skippedTargetIds],
        skipped_at: skippedAt,
        updated_at: skippedAt,
      };
    });
  }

  return {
    getProgress,
    claimRefinementAttempt,
    recordRefinement,
    recordRefinementFailure,
    setCandidateRemoved,
    recordSettlementTargets,
    claimApplication,
    releaseApplicationClaim,
    recordApplication,
    recordSkip,
  };
}

export function createInMemoryArticleSrsSettlementProgressRepository(initialStore) {
  let store = normalizeStore(initialStore || createEmptyStore());
  return createArticleSrsSettlementProgressRepository({
    async loadStore() {
      return store;
    },
    async saveStore(nextStore) {
      store = normalizeStore(nextStore);
    },
  });
}

export function createIndexedDbArticleSrsSettlementProgressRepository(options = {}) {
  const indexedDBApi = options.indexedDBApi || (typeof globalThis !== 'undefined' ? globalThis.indexedDB : null);
  const dbName = options.dbName || DB_NAME;
  const dbVersion = options.dbVersion || DB_VERSION;
  const storeName = options.storeName || STORE_NAME;
  const storageKey = options.storageKey || ARTICLE_SRS_SETTLEMENT_PROGRESS_STORE_KEY;
  let dbPromise = null;

  function openDb() {
    if (!indexedDBApi) throw new Error('IndexedDB is unavailable for article SRS settlement progress');
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDBApi.open(dbName, dbVersion);
      request.onerror = () => reject(request.error || new Error('Failed to open article SRS settlement IndexedDB'));
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: 'id' });
      };
      request.onsuccess = (event) => resolve(event.target.result);
    });
    return dbPromise;
  }

  function getRowId(articleId) {
    return `${storageKey}:${encodeURIComponent(articleId)}`;
  }

  async function getProgress(articleId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readonly');
      const request = transaction.objectStore(storeName).get(getRowId(articleId));
      let result = null;
      request.onsuccess = () => {
        result = request.result && request.result.content ? request.result.content : null;
      };
      request.onerror = () => reject(request.error || new Error('Failed to load article SRS settlement progress'));
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error || new Error('Article SRS settlement read was aborted'));
      transaction.onerror = () => reject(transaction.error || new Error('Article SRS settlement read failed'));
    });
  }

  async function updateProgress(articleId, mutator) {
    assertVocabularyBrowserWriterAllowed('settlement_progress_update');
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const objectStore = transaction.objectStore(storeName);
      const request = objectStore.get(getRowId(articleId));
      let next = null;
      request.onsuccess = () => {
        try {
          const current = request.result && request.result.content ? request.result.content : null;
          next = normalizeProgress(mutator(current), articleId);
          objectStore.put({
            id: getRowId(articleId),
            content: next,
            timestamp: Date.now(),
          });
        } catch (error) {
          transaction.abort();
          reject(error);
        }
      };
      request.onerror = () => reject(request.error || new Error('Failed to load article SRS settlement progress for update'));
      transaction.oncomplete = () => resolve(cloneVocabularyValue(next));
      transaction.onabort = () => reject(transaction.error || new Error('Article SRS settlement update was aborted'));
      transaction.onerror = () => reject(transaction.error || new Error('Article SRS settlement update failed'));
    });
  }

  return createArticleSrsSettlementProgressRepository({ getProgress, updateProgress });
}

export function getArticleSrsSettlementProgressStatus(progress) {
  const normalized = normalizeProgress(progress || {}, progress && (progress.article_id || progress.articleId));
  if (!normalized) return 'none';
  if (getActiveClaims(normalized).length) return 'processing';
  const finalizedTargetIds = new Set([
    ...normalized.applied_target_ids,
    ...normalized.skipped_target_ids,
  ]);
  const hasUnfinalizedRefinementTarget = normalized.refinements.some((item) => (
    item.target_id && !finalizedTargetIds.has(item.target_id)
  ));
  const legacyCompletedAll = normalized.settlement_target_ids.length === 0
    && normalized.last_apply_mode === 'all'
    && !!normalized.applied_at
    && finalizedTargetIds.size > 0
    && !hasUnfinalizedRefinementTarget
    && normalized.removed_target_ids.length === 0;
  if (legacyCompletedAll) return 'completed';
  if (normalized.settlement_target_ids.length
    && normalized.settlement_target_ids.every((targetId) => finalizedTargetIds.has(targetId))) {
    return 'completed';
  }
  if (normalized.removed_target_ids.length || finalizedTargetIds.size) return 'processed';
  const currentRefinements = normalized.refinements.filter((item) => (
    item.prompt_version === SETTLEMENT_MEANING_REFINEMENT_PROMPT_VERSION
  ));
  if (currentRefinements.some((item) => item.status === 'pending')) return 'refinement_pending';
  if (currentRefinements.some((item) => item.status === 'failed')) return 'refinement_failed';
  if (currentRefinements.length) return 'refined';
  return 'none';
}

export function applyArticleSrsSettlementProgress(settlement = {}, progress = null) {
  const next = cloneVocabularyValue(settlement || {});
  const normalizedProgress = normalizeProgress(progress || {}, progress && (progress.article_id || progress.articleId));
  if (!normalizedProgress) return next;
  const refinements = new Map(normalizedProgress.refinements
    .filter((item) => item.prompt_version === SETTLEMENT_MEANING_REFINEMENT_PROMPT_VERSION)
    .map((item) => [item.target_id, item]));
  const activeClaims = getActiveClaims(normalizedProgress);
  const processingTargetIds = new Set(activeClaims.map((claim) => claim.target_id));
  const processedTargetIds = new Set([
    ...normalizedProgress.applied_target_ids,
    ...normalizedProgress.skipped_target_ids,
  ]);
  const sourceCandidates = Array.isArray(next.candidates) ? next.candidates : [];
  const matchedProcessedTargetIds = new Set();
  next.candidates = sourceCandidates.map((candidate) => {
    const targetId = getTargetId(candidate);
    const refinement = refinements.get(targetId);
    if (refinement) {
      candidate.refinement_attempted = true;
      candidate.refinement_status = refinement.status;
      if (refinement.simple_meaning) {
        candidate.simple_meaning = refinement.simple_meaning;
        candidate.simpleMeaning = refinement.simple_meaning;
        if (candidate.context && typeof candidate.context === 'object') {
          candidate.context.simple_meaning = refinement.simple_meaning;
          candidate.context.simpleMeaning = refinement.simple_meaning;
        }
      }
    }
    if (processedTargetIds.has(targetId)) matchedProcessedTargetIds.add(targetId);
    candidate.application_processing = processingTargetIds.has(targetId);
    return candidate;
  }).filter((candidate) => !matchedProcessedTargetIds.has(getTargetId(candidate)));
  const baseSummary = summarizeArticleSrsSettlement(next.candidates, next.excluded);
  const processed = (baseSummary.processed || 0) + matchedProcessedTargetIds.size;
  next.summary = {
    ...baseSummary,
    processed,
    processing: sourceCandidates.filter((candidate) => processingTargetIds.has(getTargetId(candidate))).length,
    completed: (sourceCandidates.length > 0 || processed > 0) && next.candidates.length === 0,
  };
  const currentTargetIds = new Set(sourceCandidates.map(getTargetId).filter(Boolean));
  next.removedTargetIds = normalizedProgress.removed_target_ids.filter((targetId) => currentTargetIds.has(targetId));
  next.progress = normalizedProgress;
  return next;
}
