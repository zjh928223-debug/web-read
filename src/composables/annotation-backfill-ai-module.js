import { createAnnotationBackfillDialog, createEmptySrsSummary } from '../features/annotation-backfill/create-annotation-backfill-dialog.js';
import { RECOMMENDED_ANNOTATION_MODEL, DEFAULT_GEMINI_MODEL, getResultItems, getTemplateItems, analyzeBackfillCoverage, buildRequestTemplate, createIncrementalConfirmMessage } from '../features/annotation-backfill/annotation-backfill-template.js';
import {
  VOCABULARY_ENTRY_TYPES,
  applySrsCandidatesToVocabulary,
  buildSrsCandidatesFromBackfillRun,
  createIndexedDbSrsPendingCandidatesRepository,
  createVocabularyService,
  getRemainingSrsCandidatesAfterApply,
  summarizeSrsCandidates,
} from '../services/vocabulary/index.js';
import { getWindowsOwnerVocabularySrsIntegration } from '../services/vocabulary/windows-owner-vocabulary-srs.js';




const DEFAULT_BUTTON_TEXT = 'AI解释标注';


const HIGH_DEMAND_BULK_MODELS = new Set(['gemini-3.5-flash']);
const ANNOTATION_BACKFILL_MODEL_STORAGE_KEY = 'annotationBackfillAi.model';
const ANNOTATION_BACKFILL_SESSION_API_KEY = '__annotationBackfillAiSessionApiKey';
const ANNOTATION_BACKFILL_SELECTED_RUN_STORAGE_PREFIX = 'annotationBackfillAi.selectedRun.';
const STANDARD_MATERIAL_ERROR = '请先通过素材处理打开标准素材库里的文章。';
const SWITCHED_ARTICLE_NOTICE = 'AI结果已生成，但当前文章已切换；请重新打开对应文章后手动导入结果。';
const TERMINAL_JOB_STATUSES = new Set(['ready', 'failed', 'canceled']);


function getCurrentIdentity(state) {
  const meta = state && state.currentAudioMeta && typeof state.currentAudioMeta === 'object'
    ? state.currentAudioMeta
    : {};
  const jobId = meta.source === 'youtube-workflow' && meta.jobId ? String(meta.jobId) : '';
  return {
    jobId,
    audioKey: state && state.currentAudioKey ? String(state.currentAudioKey) : '',
  };
}

function sameReaderIdentity(left, right) {
  return !!left
    && !!right
    && left.jobId === right.jobId
    && left.audioKey === right.audioKey;
}

function createJsonFileLike(payload, filename) {
  const text = JSON.stringify(payload, null, 2);
  if (typeof File === 'function') {
    return new File([text], filename, { type: 'application/json' });
  }
  return {
    name: filename,
    type: 'application/json',
    async text() {
      return text;
    },
  };
}

function getImportCount(importResult, fallbackCount) {
  const value = importResult && Number(importResult.importedCount);
  return Number.isFinite(value) ? value : fallbackCount;
}

async function optionalClientCall(client, methodName, fallbackValue) {
  if (!client || typeof client[methodName] !== 'function') return fallbackValue;
  try {
    return await client[methodName]();
  } catch (_error) {
    return fallbackValue;
  }
}

function getActiveJobCount(maintenanceInfo) {
  const statuses = maintenanceInfo && maintenanceInfo.jobStatuses && typeof maintenanceInfo.jobStatuses === 'object'
    ? maintenanceInfo.jobStatuses
    : {};
  return Object.entries(statuses).reduce((total, entry) => {
    const status = String(entry[0] || '');
    const count = Number(entry[1] || 0);
    if (!Number.isFinite(count) || TERMINAL_JOB_STATUSES.has(status)) return total;
    return total + Math.max(0, count);
  }, 0);
}

function getStoredModel(windowObject) {
  try {
    const value = windowObject && windowObject.localStorage
      ? windowObject.localStorage.getItem(ANNOTATION_BACKFILL_MODEL_STORAGE_KEY)
      : '';
    return String(value || '').trim();
  } catch (_error) {
    return '';
  }
}

function persistModel(windowObject, model) {
  const normalized = String(model || '').trim();
  if (!normalized) return;
  try {
    if (windowObject && windowObject.localStorage) {
      windowObject.localStorage.setItem(ANNOTATION_BACKFILL_MODEL_STORAGE_KEY, normalized);
    }
  } catch (_error) {}
}

function getSelectedRunStorageKey(jobId) {
  return `${ANNOTATION_BACKFILL_SELECTED_RUN_STORAGE_PREFIX}${encodeURIComponent(String(jobId || ''))}`;
}

function getSelectedRunId(windowObject, jobId) {
  if (!jobId) return '';
  try {
    const value = windowObject && windowObject.localStorage
      ? windowObject.localStorage.getItem(getSelectedRunStorageKey(jobId))
      : '';
    return String(value || '').trim();
  } catch (_error) {
    return '';
  }
}

function persistSelectedRunId(windowObject, jobId, runId) {
  const normalized = String(runId || '').trim();
  if (!jobId || !normalized) return;
  try {
    if (windowObject && windowObject.localStorage) {
      windowObject.localStorage.setItem(getSelectedRunStorageKey(jobId), normalized);
    }
  } catch (_error) {}
}

function getSessionApiKey(windowObject) {
  return String(windowObject && windowObject[ANNOTATION_BACKFILL_SESSION_API_KEY] || '').trim();
}

function persistSessionApiKey(windowObject, apiKey) {
  const normalized = String(apiKey || '').trim();
  if (!windowObject || !normalized) return;
  windowObject[ANNOTATION_BACKFILL_SESSION_API_KEY] = normalized;
}

function normalizeRunOptions(runOptions, fallbackOptions = {}) {
  const options = runOptions && typeof runOptions === 'object' ? runOptions : {};
  return {
    model: String(options.model || fallbackOptions.model || '').trim(),
    apiKey: String(options.apiKey || fallbackOptions.apiKey || '').trim(),
  };
}

function shouldUseRecommendedBulkModel(model, itemCount) {
  const normalizedModel = String(model || '').trim().toLowerCase();
  return Number(itemCount || 0) > 1 && HIGH_DEMAND_BULK_MODELS.has(normalizedModel);
}

async function getRunContext(client, runOptions = {}) {
  const [config, credentialStatus, maintenanceInfo] = await Promise.all([
    optionalClientCall(client, 'getConfig', {}),
    optionalClientCall(client, 'credentialStatus', null),
    optionalClientCall(client, 'maintenance', null),
  ]);
  const selectedModel = String(runOptions.model || '').trim();
  const model = String(selectedModel || config && config.model || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL;
  const credentialKnown = credentialStatus && typeof credentialStatus.stored === 'boolean';
  return {
    model,
    selectedModel: selectedModel || model,
    currentSelection: selectedModel || model,
    finalSubmittedModel: model,
    finalSubmittedState: '待提交',
    apiKey: String(runOptions.apiKey || '').trim(),
    baseUrl: String(config && config.baseUrl || '').trim(),
    credentialKnown,
    credentialStored: credentialKnown ? !!credentialStatus.stored : null,
    credentialProvider: String(credentialStatus && credentialStatus.provider || '').trim(),
    activeJobCount: getActiveJobCount(maintenanceInfo),
  };
}

function formatRunContextNotice(context) {
  const credentialText = context.apiKey
    ? '使用本次填写的 API key'
    : (context.credentialKnown
      ? (context.credentialStored ? `使用后端保存凭据${context.credentialProvider ? `(${context.credentialProvider})` : ''}` : '未提供 API key')
      : '凭据状态未知');
  const queueText = context.activeJobCount > 0
    ? `，当前有 ${context.activeJobCount} 个后台任务，解释请求会独立提交`
    : '';
  return `AI解释标注：模型 ${context.model}，${credentialText}${queueText}`;
}























async function loadSavedBackfillPayload(client, jobId) {
  if (!client || typeof client.getAnnotationBackfillResult !== 'function') return null;
  try {
    const payload = await client.getAnnotationBackfillResult(jobId);
    const result = payload && payload.result ? payload.result : payload;
    return result && Array.isArray(result.items) ? { ...payload, result } : null;
  } catch (_error) {
    return null;
  }
}

async function loadSavedBackfillPayloadForModel(client, jobId, model, latestPayload = null) {
  const payload = latestPayload || await loadSavedBackfillPayload(client, jobId);
  if (!payload) return null;
  if (isSavedBackfillForModel(payload, model)) return payload;
  if (!client || typeof client.getAnnotationBackfillRunResult !== 'function') return payload;
  const requestedModel = normalizeModelName(model);
  const history = Array.isArray(payload.history) ? payload.history : [];
  const matchingRecord = history.find((record) => (
    record
    && normalizeModelName(record.model) === requestedModel
    && String(record.runId || '').trim()
  ));
  if (!matchingRecord) return payload;
  try {
    const runPayload = await client.getAnnotationBackfillRunResult(jobId, String(matchingRecord.runId).trim());
    const result = runPayload && runPayload.result ? runPayload.result : runPayload;
    if (!result || !Array.isArray(result.items)) return payload;
    return {
      ...runPayload,
      result,
      history,
    };
  } catch (_error) {
    return payload;
  }
}

function normalizeModelName(value) {
  return String(value || '').trim().toLowerCase();
}

function getSavedBackfillModel(savedPayload) {
  const metadata = savedPayload && savedPayload.metadata && typeof savedPayload.metadata === 'object'
    ? savedPayload.metadata
    : {};
  const metadataModel = String(metadata.model || '').trim();
  if (metadataModel) return metadataModel;
  const history = savedPayload && Array.isArray(savedPayload.history) ? savedPayload.history : [];
  const firstRecord = history.find((record) => record && typeof record === 'object' && String(record.model || '').trim());
  return firstRecord ? String(firstRecord.model || '').trim() : '';
}

function getSavedBackfillRunId(savedPayload) {
  const metadata = savedPayload && savedPayload.metadata && typeof savedPayload.metadata === 'object'
    ? savedPayload.metadata
    : {};
  const metadataRunId = String(metadata.runId || '').trim();
  if (metadataRunId) return metadataRunId;
  const history = savedPayload && Array.isArray(savedPayload.history) ? savedPayload.history : [];
  const firstRecord = history.find((record) => record && typeof record === 'object' && String(record.runId || '').trim());
  return firstRecord ? String(firstRecord.runId || '').trim() : '';
}

function isSavedBackfillForModel(savedPayload, model) {
  const savedModel = normalizeModelName(getSavedBackfillModel(savedPayload));
  const requestedModel = normalizeModelName(model);
  return !!savedModel && !!requestedModel && savedModel === requestedModel;
}

function normalizeBackfillRecord(record, fallbackResult, coverage, index, selectedRunId) {
  const data = record && typeof record === 'object' ? record : {};
  const itemCount = Number(data.itemCount);
  const runId = String(data.runId || '').trim();
  const model = String(data.model || '').trim();
  const mergeWithLatestRecorded = Object.prototype.hasOwnProperty.call(data, 'mergeWithLatest')
    || Object.prototype.hasOwnProperty.call(data, 'merge_with_latest');
  const selected = selectedRunId ? runId === selectedRunId : index === 0;
  return {
    runId,
    model: model || '未记录',
    modelRecorded: !!model,
    runIdRecorded: !!runId,
    itemCount: Number.isFinite(itemCount) ? itemCount : getResultItems(fallbackResult).length,
    templateItemCount: Number(data.templateItemCount) || coverage.totalCount || 0,
    coveredCount: index === 0 ? coverage.coveredCount : null,
    missingCount: index === 0 ? coverage.missingCount : null,
    generatedAt: String(data.generatedAt || '').trim(),
    mergeWithLatest: mergeWithLatestRecorded
      ? (data.mergeWithLatest === true || data.merge_with_latest === true)
      : null,
    current: selected,
  };
}

function buildAnnotationSummary(template, savedPayload, selectedRunId = '', markedWordCount = 0) {
  const result = savedPayload && savedPayload.result ? savedPayload.result : null;
  const coverage = analyzeBackfillCoverage(template, result);
  const metadata = savedPayload && savedPayload.metadata && typeof savedPayload.metadata === 'object'
    ? savedPayload.metadata
    : {};
  const rawHistory = savedPayload && Array.isArray(savedPayload.history) && savedPayload.history.length
    ? savedPayload.history
    : (Object.keys(metadata).length ? [metadata] : []);
  const recordRunIds = new Set(rawHistory.map((record) => String(record && record.runId || '').trim()).filter(Boolean));
  const requestedRunId = String(selectedRunId || '').trim();
  const selectedRunMismatch = !!requestedRunId && !recordRunIds.has(requestedRunId);
  const effectiveSelectedRunId = requestedRunId
    ? (selectedRunMismatch ? '' : requestedRunId)
    : String(rawHistory[0] && rawHistory[0].runId || '').trim();
  const records = rawHistory.slice(0, 8).map((record, index) => normalizeBackfillRecord(
    record,
    result,
    coverage,
    index,
    effectiveSelectedRunId,
  )).map((record, index) => ({
    ...record,
    current: selectedRunMismatch ? false : record.current || (!effectiveSelectedRunId && index === 0),
  }));
  const selectedRecord = records.find((record) => record.current) || null;
  return {
    totalCount: coverage.totalCount,
    markedWordCount: Number(markedWordCount || 0),
    coveredCount: coverage.coveredCount,
    missingCount: coverage.missingCount,
    selectedRunId: effectiveSelectedRunId,
    requestedRunId,
    selectedRunMismatch,
    records,
    modelProvenance: {
      runRecordModel: selectedRecord ? selectedRecord.model : '',
      runRecordId: selectedRecord ? selectedRecord.runId : (selectedRunMismatch ? requestedRunId : ''),
      runRecordGeneratedAt: selectedRecord ? selectedRecord.generatedAt : '',
      runRecordState: selectedRunMismatch
        ? `未找到匹配运行记录（${requestedRunId}）`
        : (selectedRecord ? (selectedRecord.modelRecorded ? '已记录' : '记录缺少模型') : '未记录'),
      routeModel: '当前记录未提供',
      ...(selectedRecord && selectedRecord.mergeWithLatest === true
        ? { mergeText: '该运行记录为合并已有结果；旧结果的逐条来源未重新标记。' }
        : { mergeText: '' }),
    },
  };
}



function getSrsScopeKey(identity, template) {
  return String(
    identity && identity.jobId
    || template && template.articleId
    || identity && identity.audioKey
    || ''
  ).trim();
}

function normalizeSourceTitle(value) {
  return String(value || '')
    .replace(/\.[^.\\/]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getSrsSourceInfo(state, template) {
  const meta = state && state.currentAudioMeta && typeof state.currentAudioMeta === 'object'
    ? state.currentAudioMeta
    : {};
  return {
    sourceId: String(
      meta.jobId
      || template && template.articleId
      || state && state.currentAudioKey
      || ''
    ).trim(),
    sourceTitle: normalizeSourceTitle(meta.title || meta.name || template && template.articleId),
    sourceUrl: String(meta.source_url || meta.sourceUrl || meta.url || meta.webUrl || meta.videoSource || '').trim(),
  };
}

function getRequestTargetIds(requestTemplate) {
  return (Array.isArray(requestTemplate && requestTemplate.items) ? requestTemplate.items : [])
    .map((item) => String(item && (item.targetId || item.target_id || item.id) || '').trim())
    .filter(Boolean);
}

function mergeSrsPendingCandidates(existingGroup, nextGroup) {
  const byTargetId = new Map();
  const excludedByTargetId = new Map();
  const appendCandidate = (candidate) => {
    const targetId = String(candidate && (candidate.targetId || candidate.target_id) || '').trim();
    if (targetId) byTargetId.set(targetId, candidate);
  };
  const appendExcluded = (item) => {
    const targetId = String(item && (item.targetId || item.target_id) || '').trim();
    if (targetId) excludedByTargetId.set(targetId, item);
  };
  (Array.isArray(existingGroup && existingGroup.candidates) ? existingGroup.candidates : []).forEach(appendCandidate);
  (Array.isArray(nextGroup && nextGroup.candidates) ? nextGroup.candidates : []).forEach(appendCandidate);
  (Array.isArray(existingGroup && existingGroup.excluded) ? existingGroup.excluded : []).forEach(appendExcluded);
  (Array.isArray(nextGroup && nextGroup.excluded) ? nextGroup.excluded : []).forEach(appendExcluded);
  return {
    scopeKey: nextGroup && nextGroup.scopeKey || existingGroup && existingGroup.scopeKey || '',
    candidates: Array.from(byTargetId.values()),
    excluded: Array.from(excludedByTargetId.values()),
  };
}

async function collectExistingVocabularyWords(vocabularyService, candidates) {
  if (!vocabularyService || typeof vocabularyService.getWordByLemma !== 'function') return [];
  const seen = new Set();
  const existing = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const key = `${candidate && candidate.language || 'en'}::${candidate && candidate.lemma || ''}`;
    if (!candidate || !candidate.lemma || seen.has(key)) continue;
    seen.add(key);
    const word = await vocabularyService.getWordByLemma(candidate.lemma, { language: candidate.language });
    if (word) existing.push(word);
  }
  return existing;
}





export function createAnnotationBackfillAiController(deps = {}) {
  const button = deps.button || null;
  const state = deps.state || {};
  const annotationLightweightModule = deps.annotationLightweightModule || null;
  const client = deps.client || null;
  const showToast = typeof deps.showToast === 'function' ? deps.showToast : function () {};
  const showError = typeof deps.showError === 'function' ? deps.showError : function () {};
  const refreshAfterImport = typeof deps.refreshAfterImport === 'function' ? deps.refreshAfterImport : function () {};
  const windowObject = deps.windowObject || (typeof window !== 'undefined' ? window : null);
  const documentObject = deps.documentObject || (windowObject && windowObject.document) || (typeof document !== 'undefined' ? document : null);
  const ownerIntegration = deps.ownerIntegration
    || getWindowsOwnerVocabularySrsIntegration(windowObject || globalThis);
  const vocabularyService = deps.vocabularyService
    || (ownerIntegration ? createVocabularyService({ ownerIntegration }) : createVocabularyService());
  const srsPendingRepository = deps.srsPendingRepository
    || ownerIntegration?.srsPendingCandidatesRepository
    || createIndexedDbSrsPendingCandidatesRepository();
  const confirmRun = typeof deps.confirmRun === 'function'
    ? deps.confirmRun
    : (windowObject && typeof windowObject.confirm === 'function' ? windowObject.confirm.bind(windowObject) : function () { return true; });
  const inlineSrsEnabled = deps.enableInlineSrs === true;
  const originalButtonText = button && String(button.textContent || '').trim()
    ? String(button.textContent).trim()
    : DEFAULT_BUTTON_TEXT;
  let running = false;
  let contextRequestId = 0;
  let historyImportRequestId = 0;
  let annotationSummaryRequestId = 0;
  let hasRunStatus = false;
  let dialogIdentity = null;
  let activeStep = '';
  const initialModel = getStoredModel(windowObject) || DEFAULT_GEMINI_MODEL;
  const dialog = createAnnotationBackfillDialog({
    documentObject,
    initialModel,
    onModelChange(model) {
      persistModel(windowObject, model);
    },
    onSelectRecord(record) {
      return importSavedBackfillRun(record && record.runId);
    },
    onAddSrsCandidates(mode) {
      return addSrsCandidates(mode);
    },
    onSkipSrsCandidates() {
      return skipSrsCandidates();
    },
    onBuildSrsCandidatesFromExisting() {
      return generateSrsCandidatesFromExistingAnnotations();
    },
    onRun: function (runOptions) {
      return run(runOptions);
    },
    getSessionApiKey() {
      return getSessionApiKey(windowObject);
    },
    onApiKeyChange(apiKey) {
      persistSessionApiKey(windowObject, apiKey);
    },
    srsEnabled: inlineSrsEnabled,
  });

  function setButtonText(text) {
    if (button) button.textContent = text || originalButtonText;
  }

  function setRunningStatus(text) {
    running = true;
    if (button) {
      button.disabled = false;
      button.title = 'AI解释标注正在处理，点击查看进度';
    }
    setButtonText(text);
  }

  function refreshAvailability() {
    if (!button) return;
    if (running) {
      button.disabled = false;
      button.title = 'AI解释标注正在处理，点击查看进度';
      return;
    }
    const identity = getCurrentIdentity(state);
    const available = !!identity.jobId;
    button.disabled = !available;
    button.title = available
      ? '自动导出轻回填模板、请求 Gemini，并导入解释结果'
      : STANDARD_MATERIAL_ERROR;
  }

  function getCurrentMarkedWordCount() {
    return state && state.markedMap instanceof Map ? state.markedMap.size : 0;
  }

  function createEmptyAnnotationSummary() {
    const model = String(getStoredModel(windowObject) || initialModel || '').trim();
    return {
      totalCount: 0,
      markedWordCount: getCurrentMarkedWordCount(),
      coveredCount: 0,
      missingCount: 0,
      selectedRunId: '',
      requestedRunId: '',
      selectedRunMismatch: false,
      records: [],
      modelProvenance: {
        currentSelection: model,
        finalSubmittedModel: '',
        finalSubmittedState: '尚未提交',
        runRecordModel: '',
        runRecordId: '',
        runRecordGeneratedAt: '',
        runRecordState: '未记录',
        routeModel: '当前记录未提供',
        autoSwitchText: '',
        reuseText: '',
        mergeText: '',
      },
    };
  }

  function ensureDialogIdentity(identity) {
    if (sameReaderIdentity(dialogIdentity, identity)) return false;
    const changed = !!dialogIdentity;
    dialogIdentity = { ...identity };
    if (changed) {
      contextRequestId += 1;
      historyImportRequestId += 1;
      annotationSummaryRequestId += 1;
      if (!running) hasRunStatus = false;
    }
    dialog.updateAnnotationSummary(createEmptyAnnotationSummary());
    dialog.updateSrsSummary(createEmptySrsSummary());
    return changed;
  }

  async function refreshAnnotationSummaryForCurrentArticle() {
    const identity = getCurrentIdentity(state);
    ensureDialogIdentity(identity);
    const emptySummary = createEmptyAnnotationSummary();
    const requestId = ++annotationSummaryRequestId;
    if (!identity.jobId) {
      if (requestId === annotationSummaryRequestId) dialog.updateAnnotationSummary(emptySummary);
      return emptySummary;
    }
    if (!annotationLightweightModule || typeof annotationLightweightModule.buildManualLightweightAnnotationTemplate !== 'function') {
      if (requestId === annotationSummaryRequestId) dialog.updateAnnotationSummary(emptySummary);
      return emptySummary;
    }
    try {
      const template = annotationLightweightModule.buildManualLightweightAnnotationTemplate();
      const savedPayload = await loadSavedBackfillPayload(client, identity.jobId);
      if (requestId !== annotationSummaryRequestId || !sameReaderIdentity(identity, getCurrentIdentity(state))) return null;
      const summary = buildAnnotationSummary(template, savedPayload, getSelectedRunId(windowObject, identity.jobId), getCurrentMarkedWordCount());
      dialog.updateAnnotationSummary(summary);
      if (!inlineSrsEnabled) {
        dialog.updateSrsSummary(createEmptySrsSummary());
        return summary;
      }
      await refreshSrsPendingSummary(identity, template, { canBuildFromExisting: summary.coveredCount > 0 });
      return summary;
    } catch (_error) {
      if (requestId === annotationSummaryRequestId && sameReaderIdentity(identity, getCurrentIdentity(state))) {
        dialog.updateAnnotationSummary(emptySummary);
        dialog.updateSrsSummary(createEmptySrsSummary());
      }
      return emptySummary;
    }
  }

  async function buildSrsSummaryForGroup(group) {
    const candidates = Array.isArray(group && group.candidates) ? group.candidates : [];
    const excluded = Array.isArray(group && group.excluded) ? group.excluded : [];
    if (!candidates.length) {
      return {
        ...createEmptySrsSummary(),
        canBuildFromExisting: !!(group && group.canBuildFromExisting),
      };
    }
    const existingWords = await collectExistingVocabularyWords(vocabularyService, candidates);
    return {
      ...summarizeSrsCandidates(candidates, excluded, existingWords),
      pending: true,
    };
  }

  async function refreshSrsPendingSummary(identity, template, options = {}) {
    try {
      const scopeKey = getSrsScopeKey(identity, template);
      if (!scopeKey || !srsPendingRepository || typeof srsPendingRepository.getPendingCandidates !== 'function') {
        dialog.updateSrsSummary({
          ...createEmptySrsSummary(),
          canBuildFromExisting: !!options.canBuildFromExisting,
        });
        return null;
      }
      const group = await srsPendingRepository.getPendingCandidates(scopeKey);
      dialog.updateSrsSummary(await buildSrsSummaryForGroup({
        ...(group || {}),
        canBuildFromExisting: !!options.canBuildFromExisting,
      }));
      return group;
    } catch (_error) {
      dialog.updateSrsSummary({
        ...createEmptySrsSummary(),
        canBuildFromExisting: !!options.canBuildFromExisting,
      });
      return null;
    }
  }

  async function storeSrsCandidatesForRun(identity, template, requestTemplate, result) {
    if (!inlineSrsEnabled) return null;
    const scopeKey = getSrsScopeKey(identity, template);
    if (!scopeKey || !srsPendingRepository || typeof srsPendingRepository.setPendingCandidates !== 'function') return null;
    const requestedTargetIds = getRequestTargetIds(requestTemplate);
    const sourceInfo = getSrsSourceInfo(state, template);
    const built = buildSrsCandidatesFromBackfillRun({
      template,
      result,
      requestedTargetIds,
      sourceId: sourceInfo.sourceId,
      sourceTitle: sourceInfo.sourceTitle,
      sourceUrl: sourceInfo.sourceUrl,
    });
    if (!built.candidates.length && !built.excluded.length) {
      dialog.updateSrsSummary(createEmptySrsSummary());
      return null;
    }
    const existingGroup = typeof srsPendingRepository.getPendingCandidates === 'function'
      ? await srsPendingRepository.getPendingCandidates(scopeKey)
      : null;
    const merged = mergeSrsPendingCandidates(existingGroup, {
      scopeKey,
      candidates: built.candidates,
      excluded: built.excluded,
    });
    const saved = await srsPendingRepository.setPendingCandidates(scopeKey, merged);
    dialog.updateSrsSummary(await buildSrsSummaryForGroup(saved));
    return saved;
  }

  async function addSrsCandidates(mode = 'all') {
    if (!inlineSrsEnabled) return null;
    const identity = getCurrentIdentity(state);
    let template = null;
    try {
      template = annotationLightweightModule && typeof annotationLightweightModule.buildManualLightweightAnnotationTemplate === 'function'
        ? annotationLightweightModule.buildManualLightweightAnnotationTemplate()
        : null;
      const scopeKey = getSrsScopeKey(identity, template);
      if (!scopeKey) return null;
      const group = await srsPendingRepository.getPendingCandidates(scopeKey);
      const candidates = Array.isArray(group && group.candidates) ? group.candidates : [];
      if (!candidates.length) {
        dialog.updateSrsSummary(createEmptySrsSummary());
        return null;
      }
      const normalizedMode = mode === 'words' || mode === VOCABULARY_ENTRY_TYPES.WORD ? 'words' : 'all';
      const result = await applySrsCandidatesToVocabulary({
        vocabularyService,
        candidates,
        mode: normalizedMode,
      });
      const remaining = normalizedMode === 'words'
        ? getRemainingSrsCandidatesAfterApply(candidates, normalizedMode)
        : [];
      if (remaining.length) {
        const saved = await srsPendingRepository.setPendingCandidates(scopeKey, {
          ...group,
          candidates: remaining,
        });
        dialog.updateSrsSummary(await buildSrsSummaryForGroup(saved));
      } else {
        await srsPendingRepository.clearPendingCandidates(scopeKey);
        dialog.updateSrsSummary(createEmptySrsSummary());
      }
      showToast(`已加入 SRS：新增 ${result.added} 个，追加语境 ${result.existingContextAdded + result.knownContextAdded} 个，跳过忽略 ${result.ignoredSkipped} 个。`, 'success');
      return result;
    } catch (error) {
      showError('ANNOTATION_BACKFILL_SRS', error && error.message ? error.message : '加入 SRS 失败');
      await refreshSrsPendingSummary(identity, template);
      return null;
    }
  }

  async function skipSrsCandidates() {
    if (!inlineSrsEnabled) return false;
    const identity = getCurrentIdentity(state);
    let template = null;
    try {
      template = annotationLightweightModule && typeof annotationLightweightModule.buildManualLightweightAnnotationTemplate === 'function'
        ? annotationLightweightModule.buildManualLightweightAnnotationTemplate()
        : null;
      const scopeKey = getSrsScopeKey(identity, template);
      if (scopeKey) await srsPendingRepository.clearPendingCandidates(scopeKey);
      dialog.updateSrsSummary(createEmptySrsSummary());
      showToast('本次 AI 解释候选未加入 SRS。', 'info');
      return true;
    } catch (error) {
      showError('ANNOTATION_BACKFILL_SRS', error && error.message ? error.message : '清理 SRS 候选失败');
      await refreshSrsPendingSummary(identity, template);
      return false;
    }
  }

  async function generateSrsCandidatesFromExistingAnnotations() {
    if (!inlineSrsEnabled) return null;
    const identity = getCurrentIdentity(state);
    if (!identity.jobId) {
      refreshAvailability();
      showError('ANNOTATION_BACKFILL_SRS', STANDARD_MATERIAL_ERROR);
      return null;
    }
    if (!annotationLightweightModule || typeof annotationLightweightModule.buildManualLightweightAnnotationTemplate !== 'function') {
      showError('ANNOTATION_BACKFILL_SRS', '轻回填模板模块尚未就绪。');
      return null;
    }
    try {
      const template = annotationLightweightModule.buildManualLightweightAnnotationTemplate();
      const savedPayload = await loadSavedBackfillPayload(client, identity.jobId);
      const result = savedPayload && savedPayload.result ? savedPayload.result : null;
      if (!result || !Array.isArray(result.items) || !result.items.length) {
        dialog.updateSrsSummary(createEmptySrsSummary());
        showToast('当前文章没有可转入 SRS 的已有 AI 解释。', 'warning');
        return null;
      }
      const requestTemplate = buildRequestTemplate(template, getTemplateItems(template));
      const saved = await storeSrsCandidatesForRun(identity, template, requestTemplate, result);
      if (saved && Array.isArray(saved.candidates) && saved.candidates.length) {
        showToast('已从当前已有 AI 解释生成 SRS 候选。', 'success');
      } else {
        showToast('当前已有解释没有可加入 SRS 的单词或短语。', 'warning');
      }
      return saved;
    } catch (error) {
      dialog.updateSrsSummary(createEmptySrsSummary());
      showError('ANNOTATION_BACKFILL_SRS', error && error.message ? error.message : '从已有解释生成 SRS 候选失败');
      return null;
    }
  }

  async function openDialog() {
    const identity = getCurrentIdentity(state);
    ensureDialogIdentity(identity);
    if (!identity.jobId) {
      refreshAvailability();
      showError('ANNOTATION_BACKFILL_AI', STANDARD_MATERIAL_ERROR);
      return;
    }
    if (running) {
      dialog.open(null, { reset: false });
      dialog.setBusy(true);
      await refreshAnnotationSummaryForCurrentArticle();
      return;
    }
    if (hasRunStatus) {
      dialog.open(null, { reset: false });
      await refreshAnnotationSummaryForCurrentArticle();
      return;
    }
    dialog.open();
    const requestId = ++contextRequestId;
    const contextPromise = getRunContext(client, { model: getStoredModel(windowObject) || initialModel }).then((context) => {
      if (requestId !== contextRequestId || running || !sameReaderIdentity(identity, getCurrentIdentity(state))) return;
      dialog.updateContext(context);
    }).catch(() => {});
    await Promise.all([contextPromise, refreshAnnotationSummaryForCurrentArticle()]);
  }

  async function importBackfillResult(result, filenameBase) {
    const safeBase = String(filenameBase || 'annotation-backfill').replace(/[\\/:*?"<>|]+/g, '_');
    const importFile = createJsonFileLike(result, `${safeBase}_annotation_backfill_result.json`);
    const importResult = await annotationLightweightModule.importManualLightweightAnnotations(importFile, { replaceExisting: false });
    refreshAfterImport();
    return importResult;
  }

  async function importSavedBackfillRun(runId) {
    const selectedRunId = String(runId || '').trim();
    if (!selectedRunId) return null;
    const identity = getCurrentIdentity(state);
    if (!identity.jobId) {
      refreshAvailability();
      showError('ANNOTATION_BACKFILL_AI', STANDARD_MATERIAL_ERROR);
      return null;
    }
    if (!annotationLightweightModule || typeof annotationLightweightModule.importManualLightweightAnnotations !== 'function') {
      showError('ANNOTATION_BACKFILL_AI', '轻回填导入模块尚未就绪。');
      return null;
    }
    if (!client || typeof client.getAnnotationBackfillRunResult !== 'function') {
      showError('ANNOTATION_BACKFILL_AI', '本地服务尚不支持按历史版本导入 AI 解释。');
      return null;
    }
    const requestId = ++historyImportRequestId;
    const startedIdentity = getCurrentIdentity(state);
    try {
      dialog.setStatus('正在导入所选 AI 解释版本...', 'working');
      const response = await client.getAnnotationBackfillRunResult(startedIdentity.jobId, selectedRunId);
      if (requestId !== historyImportRequestId || !sameReaderIdentity(startedIdentity, getCurrentIdentity(state))) {
        return { response, imported: null, stale: true };
      }
      const result = response && response.result ? response.result : response;
      if (!result || !Array.isArray(result.items)) {
        throw new Error('所选 AI 解释版本缺少 items 数组。');
      }
      const importResult = await importBackfillResult(result, startedIdentity.jobId);
      persistSelectedRunId(windowObject, startedIdentity.jobId, selectedRunId);
      if (annotationLightweightModule && typeof annotationLightweightModule.buildManualLightweightAnnotationTemplate === 'function') {
        const template = annotationLightweightModule.buildManualLightweightAnnotationTemplate();
        const savedPayload = await loadSavedBackfillPayload(client, startedIdentity.jobId);
        if (requestId !== historyImportRequestId || !sameReaderIdentity(startedIdentity, getCurrentIdentity(state))) {
          return { response, imported: importResult, stale: true };
        }
        dialog.updateAnnotationSummary(buildAnnotationSummary(template, savedPayload, selectedRunId, getCurrentMarkedWordCount()));
      }
      const importedCount = getImportCount(importResult, result.items.length);
      dialog.setStatus(`已切换到所选解释版本，导入 ${importedCount} 条。`, 'success');
      showToast(`已切换 AI 解释版本：${importedCount} 条。`, 'success');
      return { response, imported: importResult };
    } catch (error) {
      dialog.setStatus(error && error.message ? error.message : '导入所选 AI 解释版本失败', 'error');
      showError('ANNOTATION_BACKFILL_AI', error && error.message ? error.message : '导入所选 AI 解释版本失败');
      return null;
    }
  }

  async function run(runOptions = {}) {
    if (running) return null;
    const dialogValues = dialog.getValues();
    runOptions = normalizeRunOptions(runOptions, {
      model: dialogValues.model || getStoredModel(windowObject) || DEFAULT_GEMINI_MODEL,
      apiKey: dialogValues.apiKey || getSessionApiKey(windowObject),
    });
    const startedIdentity = getCurrentIdentity(state);
    ensureDialogIdentity(startedIdentity);
    dialog.updateModelProvenance({
      currentSelection: runOptions.model || '未记录',
      finalSubmittedModel: '',
      finalSubmittedState: '尚未提交',
      runRecordModel: '',
      runRecordId: '',
      runRecordGeneratedAt: '',
      runRecordState: '未记录',
      routeModel: '当前记录未提供',
      autoSwitchText: '',
      reuseText: '',
      mergeText: '',
    });
    if (runOptions.model) {
      persistModel(windowObject, runOptions.model);
      dialog.rememberValues({ model: runOptions.model });
    }
    if (runOptions.apiKey) {
      persistSessionApiKey(windowObject, runOptions.apiKey);
      dialog.rememberValues({ apiKey: runOptions.apiKey });
    }
    if (!startedIdentity.jobId) {
      refreshAvailability();
      showError('ANNOTATION_BACKFILL_AI', STANDARD_MATERIAL_ERROR);
      return null;
    }
    if (!annotationLightweightModule || typeof annotationLightweightModule.buildManualLightweightAnnotationTemplate !== 'function') {
      showError('ANNOTATION_BACKFILL_AI', '轻回填模板模块尚未就绪。');
      return null;
    }
    if (!annotationLightweightModule || typeof annotationLightweightModule.importManualLightweightAnnotations !== 'function') {
      showError('ANNOTATION_BACKFILL_AI', '轻回填导入模块尚未就绪。');
      return null;
    }
    if (!client || typeof client.runAnnotationBackfill !== 'function') {
      showError('ANNOTATION_BACKFILL_AI', '本地素材处理服务尚未就绪。');
      return null;
    }

    try {
      hasRunStatus = true;
      activeStep = '';
      dialog.resetProgress();
      dialog.close();
      dialog.setBusy(true);
      dialog.setStatus('正在读取模型和凭据状态...', 'working');
      dialog.setStep('config', 'active', '读取中');
      activeStep = 'config';
      setRunningStatus('读取配置...');
      const runContext = await getRunContext(client, runOptions);
      dialog.updateContext(runContext);
      dialog.updateModelProvenance({
        currentSelection: String(runContext.currentSelection || runContext.selectedModel || runOptions.model || '').trim() || '未记录',
        finalSubmittedModel: String(runContext.finalSubmittedModel || runContext.model || '').trim(),
        finalSubmittedState: String(runContext.finalSubmittedState || '待提交').trim(),
        autoSwitchText: String(runContext.autoSwitchText || '').trim(),
      });
      dialog.setStep('config', 'done', runContext.model);
      activeStep = '';
      if (!runContext.apiKey && runContext.credentialKnown && !runContext.credentialStored) {
        throw new Error('请填写 Gemini API key，或先在素材处理面板保存系统凭据。');
      }
      showToast(formatRunContextNotice(runContext), runContext.activeJobCount > 0 ? 'warning' : 'info');

      dialog.setStatus('正在导出轻回填模板...', 'working');
      dialog.setStep('export', 'active', '生成中');
      activeStep = 'export';
      setRunningStatus('导出模板...');
      const template = annotationLightweightModule.buildManualLightweightAnnotationTemplate();
      const itemCount = Array.isArray(template && template.items) ? template.items.length : 0;
      dialog.setStep('export', 'done', `${itemCount} 条`);
      activeStep = '';

      dialog.setStatus('正在检查本地已有 AI 解释文件...', 'working');
      const latestSavedPayload = await loadSavedBackfillPayload(client, startedIdentity.jobId);
      const savedPayload = await loadSavedBackfillPayloadForModel(client, startedIdentity.jobId, runContext.model, latestSavedPayload);
      const savedResult = savedPayload && savedPayload.result ? savedPayload.result : null;
      const coverage = analyzeBackfillCoverage(template, savedResult);
      const savedBackfillMatchesModel = isSavedBackfillForModel(savedPayload, runContext.model);
      dialog.updateAnnotationSummary(buildAnnotationSummary(template, savedPayload, getSelectedRunId(windowObject, startedIdentity.jobId), getCurrentMarkedWordCount()));
      let requestTemplate = buildRequestTemplate(template, getTemplateItems(template));
      let mergeWithLatest = false;
      if (savedResult && coverage.coveredCount > 0 && savedBackfillMatchesModel) {
        dialog.setStatus(`已找到本地解释，正在恢复 ${coverage.coveredCount} 条...`, 'working');
        dialog.setStep('import', 'active', '恢复中');
        activeStep = 'import';
        const cachedImportResult = await importBackfillResult(savedResult, template && (template.articleId || startedIdentity.jobId));
        const restoredCount = getImportCount(cachedImportResult, coverage.coveredCount);
        const cachedRunId = getSavedBackfillRunId(savedPayload);
        if (cachedRunId) {
          persistSelectedRunId(windowObject, startedIdentity.jobId, cachedRunId);
          dialog.updateAnnotationSummary(buildAnnotationSummary(template, savedPayload, cachedRunId, getCurrentMarkedWordCount()));
        }
        dialog.setStep('import', 'done', `${restoredCount} 条`);
        activeStep = '';
        if (coverage.fullyCovered) {
          dialog.updateModelProvenance({
            finalSubmittedModel: '',
            finalSubmittedState: '未提交（复用已有结果）',
            reuseText: '复用已有结果，未调用 Gemini API。',
          });
          await refreshSrsPendingSummary(startedIdentity, template, { canBuildFromExisting: coverage.coveredCount > 0 });
          dialog.setStatus(`本地已有 ${coverage.coveredCount} 条解释，已恢复，未调用 Gemini API。`, 'success');
          showToast(`本地已有 ${coverage.coveredCount} 条 AI 解释，已恢复，未调用 API。`, 'success');
          return { response: { result: savedResult, reused: true }, imported: cachedImportResult };
        }
        if (coverage.partiallyCovered) {
          const confirmed = confirmRun(createIncrementalConfirmMessage(coverage));
          if (!confirmed) {
            await refreshSrsPendingSummary(startedIdentity, template, { canBuildFromExisting: coverage.coveredCount > 0 });
            dialog.setStatus(`已恢复 ${coverage.coveredCount} 条；新增 ${coverage.missingCount} 条未解释，已取消 API 调用。`, 'warning');
            showToast(`已恢复已有解释；新增 ${coverage.missingCount} 条未调用 API。`, 'warning');
            return { response: { result: savedResult, reused: true, canceled: true }, imported: cachedImportResult };
          }
          requestTemplate = buildRequestTemplate(template, coverage.missingItems);
          mergeWithLatest = true;
          dialog.updateModelProvenance({
            reuseText: `复用已有结果；本次仅提交新增 ${coverage.missingCount} 条。`,
            mergeText: '本轮请求会合并已有结果；旧结果的逐条来源未重新标记。',
          });
          dialog.setStatus(`确认调用 Gemini，只解释新增 ${coverage.missingCount} 条标注。`, 'working');
        }
      }

      const requestItemCount = Array.isArray(requestTemplate && requestTemplate.items) ? requestTemplate.items.length : 0;
      if (shouldUseRecommendedBulkModel(runContext.model, requestItemCount)) {
        const originalModel = runContext.model;
        runContext.model = RECOMMENDED_ANNOTATION_MODEL;
        runContext.selectedModel = originalModel;
        runContext.currentSelection = originalModel;
        runContext.finalSubmittedModel = RECOMMENDED_ANNOTATION_MODEL;
        runContext.finalSubmittedState = '已按现有批量规则确定';
        runContext.autoSwitchText = `原选择 ${originalModel} → 最终提交 ${RECOMMENDED_ANNOTATION_MODEL}（现有批量规则）`;
        runOptions.model = RECOMMENDED_ANNOTATION_MODEL;
        persistModel(windowObject, RECOMMENDED_ANNOTATION_MODEL);
        dialog.rememberValues({ model: RECOMMENDED_ANNOTATION_MODEL });
        dialog.updateContext(runContext);
        dialog.updateModelProvenance({
          currentSelection: String(runContext.currentSelection || originalModel).trim() || '未记录',
          finalSubmittedModel: String(runContext.finalSubmittedModel || runContext.model || '').trim(),
          finalSubmittedState: String(runContext.finalSubmittedState || '待提交').trim(),
          autoSwitchText: String(runContext.autoSwitchText || '').trim(),
        });
        dialog.setStep('config', 'done', RECOMMENDED_ANNOTATION_MODEL);
        showToast(
          `${originalModel} 当前批量标注解释容易 503，已自动切换到 ${RECOMMENDED_ANNOTATION_MODEL}。`,
          'warning',
        );
      }
      dialog.updateModelProvenance({
        currentSelection: String(runContext.currentSelection || runOptions.model || '').trim() || '未记录',
        finalSubmittedModel: runContext.model,
        finalSubmittedState: '已提交',
        autoSwitchText: String(runContext.autoSwitchText || '').trim(),
        mergeText: mergeWithLatest ? '本轮请求会合并已有结果；旧结果的逐条来源未重新标记。' : '',
      });
      dialog.setStep('export', 'done', `待解释 ${requestItemCount}/${itemCount}`);
      dialog.setStatus('正在请求 Gemini，可能需要几分钟。', 'working');
      dialog.setStep('request', 'active', '请求中');
      activeStep = 'request';
      setRunningStatus('请求 Gemini...');
      const requestPayload = {
        template: requestTemplate,
        model: runContext.model,
        apiKey: runOptions.apiKey,
      };
      if (!runOptions.apiKey) delete requestPayload.apiKey;
      if (mergeWithLatest) requestPayload.mergeWithLatest = true;
      const response = await client.runAnnotationBackfill(startedIdentity.jobId, requestPayload);
      dialog.setStep('request', 'done', '已返回');
      activeStep = '';
      const currentIdentity = getCurrentIdentity(state);
      if (currentIdentity.jobId !== startedIdentity.jobId || currentIdentity.audioKey !== startedIdentity.audioKey) {
        showToast(SWITCHED_ARTICLE_NOTICE, 'warning');
        dialog.setStatus(SWITCHED_ARTICLE_NOTICE, 'warning');
        return { response, imported: null };
      }

      const result = response && response.result ? response.result : response;
      if (!result || !Array.isArray(result.items)) {
        throw new Error('Gemini 返回结果缺少 items 数组。');
      }

      dialog.setStatus('正在导入解释结果...', 'working');
      dialog.setStep('import', 'active', '导入中');
      activeStep = 'import';
      setRunningStatus('导入结果...');
      const importResult = await importBackfillResult(result, template && (template.articleId || startedIdentity.jobId));
      const importedCount = getImportCount(importResult, result.items.length);
      refreshAfterImport();
      dialog.setStep('import', 'done', `${importedCount} 条`);
      activeStep = '';
      const generatedRunId = getSavedBackfillRunId(response);
      if (generatedRunId) persistSelectedRunId(windowObject, startedIdentity.jobId, generatedRunId);
      const responseMetadata = response && response.metadata && typeof response.metadata === 'object'
        ? response.metadata
        : {};
      const liveMergeFact = typeof responseMetadata.mergeWithLatest === 'boolean'
        ? responseMetadata.mergeWithLatest
        : (typeof responseMetadata.merge_with_latest === 'boolean' ? responseMetadata.merge_with_latest : mergeWithLatest);
      dialog.updateAnnotationSummary(buildAnnotationSummary(template, {
        result,
        metadata: { ...responseMetadata, mergeWithLatest: liveMergeFact },
        history: response && response.history,
      }, generatedRunId, getCurrentMarkedWordCount()));
      try {
        await storeSrsCandidatesForRun(startedIdentity, template, requestTemplate, result);
      } catch (_error) {
        dialog.updateSrsSummary(createEmptySrsSummary());
      }
      dialog.setStatus(`完成，已导入 ${importedCount} 条解释。`, 'success');
      showToast(`AI解释标注完成，已导入 ${importedCount} 条。`, 'success');
      return { response, imported: importResult };
    } catch (error) {
      if (activeStep) dialog.setStep(activeStep, 'error', '失败');
      activeStep = '';
      dialog.setStatus(error && error.message ? error.message : 'AI解释标注失败', 'error');
      showError('ANNOTATION_BACKFILL_AI', error && error.message ? error.message : 'AI解释标注失败');
      return null;
    } finally {
      running = false;
      dialog.setBusy(false);
      setButtonText(originalButtonText);
      refreshAvailability();
    }
  }

  if (button) {
    button.addEventListener('click', function (event) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      openDialog();
    });
    refreshAvailability();
  }

  return {
    run,
    addSrsCandidates,
    skipSrsCandidates,
    generateSrsCandidatesFromExistingAnnotations,
    importSavedBackfillRun,
    openDialog,
    closeDialog() {
      dialog.close();
    },
    isDialogOpen() {
      return dialog.isOpen();
    },
    getStatusSnapshot() {
      return dialog.getStatusSnapshot();
    },
    refreshAvailability,
    isRunning() {
      return running;
    },
    dispose() {
      dialog.dispose();
    },
  };
}

export function initAnnotationBackfillAiControls(deps = {}) {
  const controller = createAnnotationBackfillAiController(deps);
  const windowObject = deps.windowObject || (typeof window !== 'undefined' ? window : null);
  if (windowObject) windowObject.__annotationBackfillAiController = controller;
  return controller;
}
