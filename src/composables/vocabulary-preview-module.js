import { createSettlementDialog } from '../features/vocabulary-preview/create-article-settlement-dialog.js';
import {
  applyArticleSrsSettlement,
  applyArticleSrsSettlementProgress,
  buildArticleSrsSettlement,

  createIndexedDbArticleSrsSettlementProgressRepository,
  createVocabularyService,
  applySettlementMeaningRefinementResult,
  buildSettlementMeaningRefinementTemplate,
  getSettlementMeaningRefinementCandidates,
  getSettlementMeaningRefinementInputKey,
  getArticleSrsSettlementProgressStatus,

  selectArticleSrsSettlementCandidates,
} from '../services/vocabulary/index.js';
import { getWindowsOwnerVocabularySrsIntegration } from '../services/vocabulary/windows-owner-vocabulary-srs.js';
import {
  getAnnotationGenerationScope,

} from './session-facades.js';
import { getAnnotationGenerationStorage } from './session-annotation-services.js';
import {
  canRunArticleSrsSettlementInWorker,
  runArticleSrsSettlementInWorker,
} from '../services/vocabulary/article-srs-settlement-worker-client.js';

const SESSION_API_KEY = '__annotationBackfillAiSessionApiKey';
function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function formatGeminiModelError(error) {
  const message = normalizeText(error && error.message ? error.message : error);
  const code = normalizeText(error && error.code).toLowerCase();
  const quotaOrCapacity = /(?:429|quota|resource.?exhausted|rate.?limit|high demand|capacity|temporar(?:y|ily) unavailable)/i.test(message)
    || /(?:quota|rate|resource.?exhausted|unavailable)/i.test(code);
  if (quotaOrCapacity) {
    return new Error('当前模型额度已满或暂时繁忙，请到“素材处理 → 设置 → 高级设置”切换模型后重试。');
  }
  return error instanceof Error ? error : new Error(message || 'AI 精简释义失败');
}

function normalizeSourceTitle(value) {
  return normalizeText(value).replace(/\.[^.\\/]+$/, '').trim();
}

function getCurrentIdentity(state = {}) {
  const meta = state && state.currentAudioMeta && typeof state.currentAudioMeta === 'object'
    ? state.currentAudioMeta
    : {};
  return {
    jobId: meta.source === 'youtube-workflow' && meta.jobId ? String(meta.jobId) : '',
    audioKey: state && state.currentAudioKey ? String(state.currentAudioKey) : '',
  };
}

function getSourceInfo(state = {}, scope = {}) {
  const meta = state && state.currentAudioMeta && typeof state.currentAudioMeta === 'object'
    ? state.currentAudioMeta
    : {};
  return {
    sourceId: normalizeText(
      meta.jobId
      || scope.documentId
      || state.currentAudioKey
      || scope.audioKey
    ),
    sourceTitle: normalizeSourceTitle(meta.title || meta.name || scope.documentId || state.currentAudioKey),
    sourceUrl: normalizeText(meta.source_url || meta.sourceUrl || meta.url || meta.webUrl || meta.videoSource),
  };
}

function getSessionApiKey(windowObject) {
  return normalizeText(windowObject && windowObject[SESSION_API_KEY]);
}

function persistSessionApiKey(windowObject, apiKey) {
  const normalized = normalizeText(apiKey);
  if (windowObject && normalized) windowObject[SESSION_API_KEY] = normalized;
}

function getStorage(windowObject) {
  return getAnnotationGenerationStorage(windowObject || globalThis);
}

async function loadCurrentAnnotationBundle(windowObject) {
  const storage = getStorage(windowObject);
  if (!storage || typeof storage.loadBundle !== 'function') {
    throw new Error('AnnotationGenerationStorage is unavailable');
  }
  const scope = getAnnotationGenerationScope();
  const bundle = await storage.loadBundle(scope);
  return { storage, scope, bundle };
}

function getGeneratedItemsFromBundle(bundle) {
  return Array.isArray(bundle && bundle.generated && bundle.generated.items)
    ? bundle.generated.items
    : [];
}

export function createVocabularyPreviewController(deps = {}) {
      const settleButton = deps.settleButton || null;
  const state = deps.state || {};
  const windowObject = deps.windowObject || globalThis;
  const documentObject = deps.documentObject || windowObject.document;
  const client = deps.client || null;
  const ownerIntegration = deps.ownerIntegration
    || getWindowsOwnerVocabularySrsIntegration(windowObject);
  const vocabularyService = deps.vocabularyService
    || (ownerIntegration
      ? createVocabularyService({ ownerIntegration, acquisitionEnabled: true })
      : createVocabularyService());
  const settlementApplicationRunner = typeof deps.runSettlementApplication === 'function'
    ? deps.runSettlementApplication
    : (options) => (
      !ownerIntegration && canRunArticleSrsSettlementInWorker(windowObject)
        ? runArticleSrsSettlementInWorker({ ...options, windowObject })
        : applyArticleSrsSettlement({ ...options, vocabularyService })
    );
  const settlementProgressRepository = deps.settlementProgressRepository
    || ownerIntegration?.settlementProgressRepository
    || createIndexedDbArticleSrsSettlementProgressRepository();
  const showToast = typeof deps.showToast === 'function' ? deps.showToast : function () {};
  const showError = typeof deps.showError === 'function' ? deps.showError : function () {};
                  const settlementDialog = createSettlementDialog({
    documentObject,
    windowObject,
    pronunciationService: deps.pronunciationService,
    onApply: applySettlement,
    onSkip: skipSettlement,
    onToggleRemove: setSettlementCandidateRemoved,
    onRefineMeanings: refineSettlementMeanings,
    onRetryRead: () => openSettlement({ restoreFocusTarget: settleButton }),
    onClose: cancelSettlementOpening,
  });
  let settlementProgressBadgeRequestId = 0;
  let settlementOpening = false;
  let settlementOpeningId = 0;
  let settlementSelectionWrite = Promise.resolve();
  const refinementsInFlight = new Map();
  // Retry only the owner write after a returned result. This cache is transient;
  // persisted progress and its claim token remain the authority.
  const refinementsPendingSave = new Map();
  const settlementApplicationsInFlight = new Map();

  function updateSettlementProgressBadge(status) {
    if (!settleButton) return;
    settleButton.dataset.settlementProgress = status;
    if (settlementOpening) {
      settleButton.disabled = true;
      settleButton.textContent = '正在整理本篇…';
      settleButton.title = '正在整理本篇生词，请稍候';
      return;
    }
    if (status === 'processed') {
      settleButton.textContent = '本篇已有整理记录';
      settleButton.title = '本篇已保存整理进度；打开可继续选择和加入';
      return;
    }
    if (status === 'processing') {
      settleButton.textContent = '正在后台加入…';
      settleButton.title = '生词正在后台写入，不影响继续阅读';
      return;
    }
    if (status === 'completed') {
      settleButton.textContent = '本篇已处理完';
      settleButton.title = '本文候选已全部加入或跳过';
      return;
    }
    if (status === 'refined') {
      settleButton.textContent = '释义已精简';
      settleButton.title = '本文已生成并保存 AI 精简释义；打开可继续加入 SRS';
      return;
    }
    if (status === 'refinement_pending') {
      settleButton.textContent = '释义精简中断待确认';
      settleButton.title = '本文已有一笔 AI 精简请求记录；打开可查看当前候选';
      return;
    }
    if (status === 'refinement_retryable') {
      settleButton.textContent = '精简中断，可重试';
      settleButton.title = '上次 AI 精简请求长时间未完成；打开后可安全重试';
      return;
    }
    if (status === 'refinement_failed') {
      settleButton.textContent = '精简失败，可重试';
      settleButton.title = '上次 AI 精简失败；打开后可手动重试';
      return;
    }
    settleButton.textContent = '本篇学习成果整理';
  }

  async function refreshSettlementProgressBadge(identity) {
    const requestId = ++settlementProgressBadgeRequestId;
    if (!identity || !identity.jobId) {
      updateSettlementProgressBadge('none');
      return;
    }
    try {
      const progress = await settlementProgressRepository.getProgress(identity.jobId);
      if (requestId !== settlementProgressBadgeRequestId) return;
      const currentIdentity = getCurrentIdentity(state);
      if (currentIdentity.jobId !== identity.jobId) return;
      updateSettlementProgressBadge(getArticleSrsSettlementProgressStatus(progress));
    } catch (_error) {
      if (requestId === settlementProgressBadgeRequestId) updateSettlementProgressBadge('none');
    }
  }

  function getCurrentSettlementActionIdentity(options = {}) {
    const currentIdentity = getCurrentIdentity(state);
    const articleId = normalizeText(options.articleId) || currentIdentity.jobId;
    if (!articleId || !currentIdentity.jobId) throw new Error('请先打开标准素材库里的文章');
    if (currentIdentity.jobId !== articleId) {
      throw new Error('当前文章已切换，请重新打开“整理本篇生词”。');
    }
    return { articleId, currentIdentity };
  }

  function refreshAvailability() {
    const identity = getCurrentIdentity(state);
    const available = !!identity.jobId;
    updateSettlementProgressBadge('none');
    void refreshSettlementProgressBadge(identity);
        if (settleButton) {
      settleButton.disabled = !available || settlementOpening;
      settleButton.title = settlementOpening
        ? '正在整理本篇生词，请稍候'
        : available ? '确认本文已学完后，整理本篇已解释生词到 SRS' : '请先打开标准素材库里的文章';
      if (settlementOpening) settleButton.textContent = '正在整理本篇…';
    }
      }

  async function openSettlement(options = {}) {
    if (settlementOpening) return null;
    const openingId = ++settlementOpeningId;
    const restoreFocusTarget = options.restoreFocusTarget || documentObject.activeElement;
    settlementOpening = true;
    try {
      const identity = getCurrentIdentity(state);
      if (!identity.jobId) {
        showError('VOCABULARY_SETTLEMENT', '请先打开标准素材库里的文章');
        return null;
      }
      if (settleButton) {
        settleButton.disabled = true;
        settleButton.textContent = '正在整理本篇…';
        settleButton.title = '正在整理本篇生词，请稍候';
      }
      settlementDialog.openLoading('正在整理本篇生词…', restoreFocusTarget);
      await settlementSelectionWrite;
      if (openingId !== settlementOpeningId) return null;
      const { scope, bundle } = await loadCurrentAnnotationBundle(windowObject);
      if (openingId !== settlementOpeningId) return null;
      if (getCurrentIdentity(state).jobId !== identity.jobId) {
        throw new Error('当前文章已切换，请重新打开“整理本篇生词”。');
      }
      const sourceInfo = getSourceInfo(state, scope);
      const generatedItems = getGeneratedItemsFromBundle(bundle);
      // Qualification depends on current vocabulary/context, not only annotations.
      // Bulk-read on each opening; saved valid meanings are still reused below.
      const builtSettlement = await buildArticleSrsSettlement({
        items: generatedItems,
        vocabularyService,
        sourceId: sourceInfo.sourceId,
        sourceTitle: sourceInfo.sourceTitle,
        sourceUrl: sourceInfo.sourceUrl,
      });
      if (openingId !== settlementOpeningId) return null;
      let progress = await settlementProgressRepository.getProgress(sourceInfo.sourceId);
      if (openingId !== settlementOpeningId) return null;
      if (getCurrentIdentity(state).jobId !== identity.jobId) {
        throw new Error('当前文章已切换，请重新打开“整理本篇生词”。');
      }
      const candidateTargetIds = (Array.isArray(builtSettlement.candidates) ? builtSettlement.candidates : [])
        .map((candidate) => normalizeText(candidate && (candidate.targetId || candidate.target_id)))
        .filter(Boolean);
      const alreadyAppliedTargetIds = (Array.isArray(builtSettlement.excluded) ? builtSettlement.excluded : [])
        .filter((candidate) => candidate && candidate.reason === 'already_added_current_article')
        .map((candidate) => normalizeText(candidate && (candidate.targetId || candidate.target_id)))
        .filter(Boolean);
      const settlementTargetIds = Array.from(new Set([
        ...candidateTargetIds,
        ...alreadyAppliedTargetIds,
      ]));
      const knownTargetIds = new Set(progress && progress.settlement_target_ids || []);
      const knownAppliedTargetIds = new Set(progress && progress.applied_target_ids || []);
      const requiresProgressReconciliation = settlementTargetIds.some((targetId) => !knownTargetIds.has(targetId))
        || alreadyAppliedTargetIds.some((targetId) => !knownAppliedTargetIds.has(targetId));
      if (requiresProgressReconciliation && typeof settlementProgressRepository.recordSettlementTargets === 'function') {
        progress = await settlementProgressRepository.recordSettlementTargets(
          sourceInfo.sourceId,
          settlementTargetIds,
          { appliedTargetIds: alreadyAppliedTargetIds },
        );
      }
      if (openingId !== settlementOpeningId) return null;
      if (getCurrentIdentity(state).jobId !== identity.jobId) {
        throw new Error('当前文章已切换，请重新打开“整理本篇生词”。');
      }
      const settlement = applyArticleSrsSettlementProgress(builtSettlement, progress);
      settlement.articleId = sourceInfo.sourceId;
      settlement.generatedItemCount = generatedItems.length;
      if (settlement.summary && settlement.summary.completed) {
        updateSettlementProgressBadge('completed');
      } else if (settlement.summary && settlement.summary.processing > 0) {
        updateSettlementProgressBadge('processing');
      } else if (settlement.summary && settlement.summary.processed > 0) {
        updateSettlementProgressBadge('processed');
      }
      const pendingSave = refinementsPendingSave.get(sourceInfo.sourceId);
      if (pendingSave) {
        pendingSave.candidates = pendingSave.candidates.filter((candidate) => {
          const row = progress?.refinements?.find((item) => item.target_id === candidate.targetId);
          return row?.attempt_token === pendingSave.claimToken && row.status === 'pending'
            && row.input_key === getSettlementMeaningRefinementInputKey(candidate, sourceInfo.sourceId);
        });
        if (!pendingSave.candidates.length) refinementsPendingSave.delete(sourceInfo.sourceId);
        else copyRefinementState(settlement.candidates, pendingSave.candidates, sourceInfo.sourceId);
      }
      settlementDialog.open(settlement, restoreFocusTarget);
      return settlement;
    } catch (error) {
      if (openingId !== settlementOpeningId) return null;
      const message = error && error.message ? error.message : '整理本篇生词失败';
      settlementDialog.openError(message);
      showError('VOCABULARY_SETTLEMENT', message);
      return null;
    } finally {
      if (openingId === settlementOpeningId) {
        settlementOpening = false;
        refreshAvailability();
      }
    }
  }

  function cancelSettlementOpening() {
    settlementOpeningId += 1;
    settlementOpening = false;
    refreshAvailability();
  }

  function copyRefinementState(targets = [], sources = [], articleId) {
    const sourceMap = new Map((sources || []).map((candidate) => [candidate.targetId, candidate]));
    targets.forEach((candidate) => {
      const source = sourceMap.get(candidate.targetId);
      if (!source || getSettlementMeaningRefinementInputKey(source, articleId) !== getSettlementMeaningRefinementInputKey(candidate, articleId)) return;
      ['simple_meaning', 'simpleMeaning', 'refinement_attempted', 'refinement_status',
        'refinement_attempted_at', 'refinement_error', 'refinement_save_pending'].forEach((key) => {
        candidate[key] = source[key];
      });
      if (candidate.context && source.context) {
        candidate.context.simple_meaning = source.context.simple_meaning;
        candidate.context.simpleMeaning = source.context.simpleMeaning;
      }
    });
  }

  async function refineSettlementMeanings(options = {}) {
    const actionIdentity = getCurrentSettlementActionIdentity(options);
    const { articleId } = actionIdentity;
    const previous = refinementsInFlight.get(articleId);
    if (previous) {
      let completed;
      try { completed = await previous; }
      catch (error) {
        const progress = await settlementProgressRepository.getProgress(articleId);
        copyRefinementState(options.candidates, applyArticleSrsSettlementProgress({ candidates: options.candidates }, progress).candidates, articleId);
        copyRefinementState(options.candidates, refinementsPendingSave.get(articleId)?.candidates, articleId);
        options.onProgress?.();
        throw error;
      }
      copyRefinementState(options.candidates, completed.candidates, articleId);
      options.onProgress?.();
      // New/edited targets can follow the existing operation; failed targets do
      // not automatically enter another attempt.
      return refineSettlementMeanings(options);
    }
    const operation = runSettlementRefinement(options, actionIdentity);
    refinementsInFlight.set(articleId, operation);
    try {
      const completed = await operation;
      return completed.stats;
    } finally {
      if (refinementsInFlight.get(articleId) === operation) refinementsInFlight.delete(articleId);
    }
  }

  async function runSettlementRefinement(options, { articleId, currentIdentity }) {
    const removedTargetIds = new Set((Array.isArray(options.removedTargetIds) ? options.removedTargetIds : [])
      .map(normalizeText)
      .filter(Boolean));
    const candidates = (Array.isArray(options.candidates) ? options.candidates : [])
      .filter((candidate) => !candidate.application_processing && !removedTargetIds.has(normalizeText(candidate && candidate.targetId)));
    const pendingSave = refinementsPendingSave.get(articleId);
    if (pendingSave && !options.automatic) {
      const matching = pendingSave.candidates.filter((saved) => candidates.some((candidate) =>
        getSettlementMeaningRefinementInputKey(candidate, articleId) === getSettlementMeaningRefinementInputKey(saved, articleId)));
      if (matching.length) {
        const progress = await settlementProgressRepository.recordRefinement(articleId, matching, { claimToken: pendingSave.claimToken });
        const acknowledged = new Set((progress.refinements || []).filter((row) =>
          row.attempt_token === pendingSave.claimToken && row.status === 'completed').map((row) => row.target_id));
        const originals = matching.map((candidate) => {
          const original = structuredClone(candidate);
          delete original.simple_meaning;
          delete original.simpleMeaning;
          if (original.context) { delete original.context.simple_meaning; delete original.context.simpleMeaning; }
          original.refinement_save_pending = false;
          original.refinement_status = 'failed';
          return original;
        });
        const reconciled = applyArticleSrsSettlementProgress({ candidates: originals }, progress).candidates;
        copyRefinementState(candidates, reconciled, articleId);
        pendingSave.candidates = pendingSave.candidates.filter((candidate) => !matching.includes(candidate));
        if (!pendingSave.candidates.length) refinementsPendingSave.delete(articleId);
        options.onProgress?.();
        await refreshSettlementProgressBadge(currentIdentity);
        const updated = reconciled.filter((candidate) => acknowledged.has(candidate.targetId) && candidate.simple_meaning && !candidate.refinement_error).length;
        const rejected = reconciled.filter((candidate) => acknowledged.has(candidate.targetId) && candidate.refinement_error === 'simple_meaning_too_long').length;
        return { candidates: reconciled, stats: { requested: matching.length, updated, rejected, missing: matching.length - updated - rejected } };
      }
    }
    const refinableCandidates = getSettlementMeaningRefinementCandidates(candidates, { automatic: options.automatic });
    const apiKey = getSessionApiKey(windowObject);
    const initialTemplate = buildSettlementMeaningRefinementTemplate({
      candidates: refinableCandidates,
      sourceId: articleId,
    });
    if (!initialTemplate.items.length) {
      return { candidates: [], stats: { requested: 0, updated: 0, rejected: 0, missing: 0 } };
    }
    if (!client || typeof client.runAnnotationBackfill !== 'function') {
      throw new Error('本地素材处理服务尚未就绪');
    }
    const requestableTargetIds = new Set(initialTemplate.items.map((item) => normalizeText(item && item.targetId)).filter(Boolean));
    const requestableCandidates = refinableCandidates.filter((candidate) => requestableTargetIds.has(normalizeText(candidate && candidate.targetId)));
    const refinementClaim = await settlementProgressRepository.claimRefinementAttempt(articleId, requestableCandidates, { automatic: options.automatic });
    const claimedTargetIds = new Set(refinementClaim.claimedTargetIds);
    const claimedCandidates = structuredClone(requestableCandidates.filter((candidate) => claimedTargetIds.has(normalizeText(candidate && candidate.targetId))));
    if (!claimedCandidates.length) {
      const reconciled = applyArticleSrsSettlementProgress({ candidates }, refinementClaim.progress);
      copyRefinementState(candidates, reconciled.candidates, articleId);
      options.onProgress?.();
      return { candidates: [], stats: { requested: 0, updated: 0, rejected: 0, missing: 0 } };
    }
    const claimedRefinements = new Map((refinementClaim.progress?.refinements || [])
      .map((refinement) => [normalizeText(refinement && refinement.target_id), refinement]));
    const template = buildSettlementMeaningRefinementTemplate({
      candidates: claimedCandidates,
      sourceId: articleId,
    });
    const payload = {
      template,
      mergeWithLatest: false,
      purpose: 'srs_meaning_refinement',
      singleRequest: true,
      maxApiCalls: 1,
    };
    if (apiKey) payload.apiKey = apiKey;
    if (apiKey) persistSessionApiKey(windowObject, apiKey);
    claimedCandidates.forEach((candidate) => {
      candidate.refinement_attempted = true;
      candidate.refinement_status = 'pending';
      candidate.refinement_attempted_at = claimedRefinements.get(normalizeText(candidate && candidate.targetId))?.attempted_at || '';
    });
    copyRefinementState(candidates, claimedCandidates, articleId);
    options.onProgress?.();
    await refreshSettlementProgressBadge(currentIdentity);
    let response;
    try {
      response = await client.runAnnotationBackfill(articleId, payload);
    } catch (apiError) {
      try {
        await settlementProgressRepository.recordRefinementFailure(articleId, claimedCandidates, apiError, {
          claimToken: refinementClaim.claimToken,
        });
      } catch (_persistenceError) {}
      claimedCandidates.forEach((candidate) => {
        candidate.refinement_status = 'failed';
      });
      copyRefinementState(candidates, claimedCandidates, articleId);
      options.onProgress?.();
      await refreshSettlementProgressBadge(currentIdentity);
      throw formatGeminiModelError(apiError);
    }
    const result = response && response.result ? response.result : response;
    const stats = applySettlementMeaningRefinementResult(claimedCandidates, result);
    let savedProgress;
    try {
      savedProgress = await settlementProgressRepository.recordRefinement(articleId, claimedCandidates, {
        claimToken: refinementClaim.claimToken,
      });
    } catch (progressError) {
      claimedCandidates.forEach((candidate) => { candidate.refinement_save_pending = true; });
      refinementsPendingSave.set(articleId, { candidates: claimedCandidates, claimToken: refinementClaim.claimToken });
      copyRefinementState(candidates, claimedCandidates, articleId);
      options.onProgress?.();
      await refreshSettlementProgressBadge(currentIdentity);
      throw new Error('精简结果待保存，请重试保存。');
    }
    const acknowledged = new Set((savedProgress.refinements || []).filter((row) =>
      row.attempt_token === refinementClaim.claimToken && row.status === 'completed').map((row) => row.target_id));
    const acknowledgedCandidates = claimedCandidates.filter((candidate) => acknowledged.has(candidate.targetId));
    acknowledgedCandidates.forEach((candidate) => { candidate.refinement_status = 'completed'; candidate.refinement_save_pending = false; });
    stats.updated = acknowledgedCandidates.filter((candidate) => candidate.simple_meaning && !candidate.refinement_error).length;
    const reconciled = applyArticleSrsSettlementProgress({ candidates }, savedProgress);
    copyRefinementState(candidates, reconciled.candidates, articleId);
    options.onProgress?.();
    await refreshSettlementProgressBadge(currentIdentity);
    return { candidates: reconciled.candidates, stats };
  }

  async function runClaimedSettlementApplication(context) {
    const {
      actionIdentity,
      articleId,
      claimToken,
      claimedCandidates,
      claimedTargetIds,
      mode,
    } = context;
    try {
      const result = await settlementApplicationRunner({
        candidates: claimedCandidates,
        mode,
      });
      let progressSaved = true;
      try {
        await settlementProgressRepository.recordApplication(articleId, {
          appliedTargetIds: [
            ...(result.selectedTargetIds || []),
            ...(result.alreadyAppliedTargetIds || []),
          ],
          claimToken,
          mode,
        });
      } catch (progressError) {
        progressSaved = false;
        showError('VOCABULARY_SETTLEMENT_PROGRESS', `SRS 已写入，但整理印记保存失败：${progressError && progressError.message ? progressError.message : '未知错误'}`);
      }
      await refreshSettlementProgressBadge(actionIdentity.currentIdentity);
      if (progressSaved) {
        showToast(`后台整理完成：新增词条 ${result.added} 个，追加语境 ${result.existingContextAdded + result.knownContextAdded} 个，处理目标 ${result.processed} 个，重新学习 ${result.relearned || 0} 个。`, 'success');
      } else {
        showToast('已加入 SRS，整理进度待同步；重开整理可恢复。', 'info');
      }
      return result;
    } catch (error) {
      try {
        await settlementProgressRepository.releaseApplicationClaim(articleId, claimedTargetIds, { claimToken });
      } catch (_releaseError) {}
      await refreshSettlementProgressBadge(actionIdentity.currentIdentity);
      showError('VOCABULARY_SETTLEMENT', error && error.message ? error.message : '加入 SRS 失败');
      return null;
    } finally {
      settlementApplicationsInFlight.delete(articleId);
    }
  }

  async function applySettlement(options = {}) {
    let claimedTargetIds = [];
    let claimToken = '';
    let articleId = '';
    try {
      const actionIdentity = getCurrentSettlementActionIdentity(options);
      articleId = actionIdentity.articleId;
      if (settlementApplicationsInFlight.has(articleId)) {
        showToast('本篇生词正在后台加入。', 'info');
        return { background: true };
      }
      const selection = selectArticleSrsSettlementCandidates(options);
      const claim = await settlementProgressRepository.claimApplication(articleId, {
        candidateTargetIds: selection.selectedTargetIds,
        allCandidateTargetIds: (Array.isArray(options.candidates) ? options.candidates : [])
          .map((candidate) => normalizeText(candidate && (candidate.targetId || candidate.target_id)))
          .filter(Boolean),
      });
      claimedTargetIds = claim.claimedTargetIds;
      claimToken = claim.claimToken;
      const claimedTargetIdSet = new Set(claimedTargetIds);
      const claimedCandidates = selection.selectedCandidates.filter((candidate) => (
        claimedTargetIdSet.has(normalizeText(candidate && (candidate.targetId || candidate.target_id)))
      ));
      if (!claimedCandidates.length) {
        await refreshSettlementProgressBadge(actionIdentity.currentIdentity);
        showToast('这些候选已在另一窗口处理或已加入 SRS。', 'info');
        return { selectedCount: 0, selectedTargetIds: [], removedTargetIds: selection.removedTargetIds };
      }
      updateSettlementProgressBadge('processing');
      const scheduleBackgroundTask = typeof windowObject.setTimeout === 'function'
        ? (callback) => windowObject.setTimeout(callback, 0)
        : (callback) => setTimeout(callback, 0);
      const operation = new Promise((resolve) => scheduleBackgroundTask(resolve))
        .then(() => runClaimedSettlementApplication({
          actionIdentity,
          articleId,
          claimToken,
          claimedCandidates,
          claimedTargetIds,
          mode: options.mode,
        }));
      settlementApplicationsInFlight.set(articleId, operation);
      void operation;
      showToast('已转到后台加入，可继续阅读。', 'info');
      return { background: true, selectedCount: claimedCandidates.length };
    } catch (error) {
      if (articleId && claimedTargetIds.length) {
        try {
          await settlementProgressRepository.releaseApplicationClaim(articleId, claimedTargetIds, { claimToken });
        } catch (_releaseError) {}
      }
      showError('VOCABULARY_SETTLEMENT', error && error.message ? error.message : '加入 SRS 失败');
      return null;
    }
  }

  async function skipSettlement(options = {}) {
    try {
      const { articleId, currentIdentity } = getCurrentSettlementActionIdentity(options);
      const skippedTargetIds = (Array.isArray(options.candidates) ? options.candidates : [])
        .map((candidate) => normalizeText(candidate && (candidate.targetId || candidate.target_id)))
        .filter(Boolean);
      await settlementProgressRepository.recordSkip(articleId, { skippedTargetIds });
      await refreshSettlementProgressBadge(currentIdentity);
      showToast('本篇候选已标记为不加入 SRS。', 'info');
      return true;
    } catch (error) {
      showError('VOCABULARY_SETTLEMENT', error && error.message ? error.message : '保存本篇整理状态失败');
      return false;
    }
  }

  async function setSettlementCandidateRemoved(options = {}) {
    const { articleId, currentIdentity } = getCurrentSettlementActionIdentity(options);
    const operation = settlementSelectionWrite.then(() => settlementProgressRepository.setCandidateRemoved(
      articleId, options.targetId, options.removed,
    ));
    settlementSelectionWrite = operation.catch(() => {});
    await operation;
    await refreshSettlementProgressBadge(currentIdentity);
    return true;
  }

      if (settleButton) settleButton.addEventListener('click', openSettlement);
  refreshAvailability();

  return {

    openSettlement,
    applySettlement,
    refreshAvailability,

    dispose() {
                              settlementDialog.dispose();
    },
  };
}

export function initVocabularyPreviewControls(deps = {}) {
  const controller = createVocabularyPreviewController(deps);
  const windowObject = deps.windowObject || globalThis;
  if (windowObject) windowObject.__vocabularyPreviewController = controller;
  return controller;
}
