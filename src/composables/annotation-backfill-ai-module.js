const DEFAULT_BUTTON_TEXT = 'AI解释标注';
const RECOMMENDED_ANNOTATION_MODEL = 'gemini-3.1-flash-lite';
const DEFAULT_GEMINI_MODEL = RECOMMENDED_ANNOTATION_MODEL;
const HIGH_DEMAND_BULK_MODELS = new Set(['gemini-3.5-flash']);
const ANNOTATION_BACKFILL_MODEL_STORAGE_KEY = 'annotationBackfillAi.model';
const ANNOTATION_BACKFILL_SESSION_API_KEY = '__annotationBackfillAiSessionApiKey';
const ANNOTATION_BACKFILL_SELECTED_RUN_STORAGE_PREFIX = 'annotationBackfillAi.selectedRun.';
const STANDARD_MATERIAL_ERROR = '请先通过素材处理打开标准素材库里的文章。';
const SWITCHED_ARTICLE_NOTICE = 'AI结果已生成，但当前文章已切换；请重新打开对应文章后手动导入结果。';
const TERMINAL_JOB_STATUSES = new Set(['ready', 'failed', 'canceled']);
const STEP_LABELS = {
  config: '配置',
  export: '模板',
  request: 'Gemini',
  import: '导入',
};

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
  const model = String(runOptions.model || config && config.model || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL;
  const credentialKnown = credentialStatus && typeof credentialStatus.stored === 'boolean';
  return {
    model,
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

function getResultItems(result) {
  return result && Array.isArray(result.items) ? result.items : [];
}

function getTemplateItems(template) {
  return template && Array.isArray(template.items) ? template.items : [];
}

function getTargetId(item) {
  return String(item && item.targetId || '').trim();
}

function hasBackfillContent(item) {
  return ['boundary', 'type', 'meaning', 'memoryHint'].some((key) => String(item && item[key] || '').trim());
}

function analyzeBackfillCoverage(template, result) {
  const templateItems = getTemplateItems(template);
  const resultItems = getResultItems(result);
  const resultByTargetId = new Map();
  resultItems.forEach((item) => {
    const targetId = getTargetId(item);
    if (targetId && hasBackfillContent(item)) resultByTargetId.set(targetId, item);
  });
  const missingItems = [];
  let coveredCount = 0;
  templateItems.forEach((item) => {
    const targetId = getTargetId(item);
    if (targetId && resultByTargetId.has(targetId)) coveredCount += 1;
    else missingItems.push(item);
  });
  return {
    totalCount: templateItems.length,
    resultCount: resultItems.length,
    coveredCount,
    missingCount: missingItems.length,
    missingItems,
    fullyCovered: templateItems.length > 0 && coveredCount === templateItems.length,
    partiallyCovered: coveredCount > 0 && missingItems.length > 0,
  };
}

function normalizeTemplateText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getTemplateSentences(template) {
  return Array.isArray(template && template.articleSentences)
    ? template.articleSentences.map((sentence) => normalizeTemplateText(sentence)).filter(Boolean)
    : [];
}

function findSentenceIndexForItem(sentences, item) {
  const sourceSentence = normalizeTemplateText(item && item.sourceSentence);
  if (!sourceSentence) return -1;
  return sentences.findIndex((sentence) => (
    sentence === sourceSentence
    || sentence.includes(sourceSentence)
    || sourceSentence.includes(sentence)
  ));
}

function truncateArticleTextByItems(template, requestItems) {
  const items = Array.isArray(requestItems) ? requestItems : [];
  const sentences = getTemplateSentences(template);
  if (!items.length) {
    return {
      articleText: normalizeTemplateText(template && template.articleText),
      articleSentences: sentences,
    };
  }

  let lastSentenceIndex = -1;
  items.forEach((item) => {
    const sentenceIndex = findSentenceIndexForItem(sentences, item);
    if (sentenceIndex > lastSentenceIndex) lastSentenceIndex = sentenceIndex;
  });
  if (lastSentenceIndex >= 0) {
    const scopedSentences = sentences.slice(0, lastSentenceIndex + 1);
    return {
      articleText: scopedSentences.join(' '),
      articleSentences: scopedSentences,
    };
  }

  const articleText = normalizeTemplateText(template && template.articleText);
  let lastEnd = 0;
  items.forEach((item) => {
    const sourceSentence = normalizeTemplateText(item && item.sourceSentence);
    if (!sourceSentence || !articleText) return;
    const index = articleText.indexOf(sourceSentence);
    if (index >= 0) lastEnd = Math.max(lastEnd, index + sourceSentence.length);
  });
  if (lastEnd > 0) {
    return {
      articleText: articleText.slice(0, lastEnd).trim(),
      articleSentences: sentences,
    };
  }
  return { articleText, articleSentences: sentences };
}

function buildRequestTemplate(template, requestItems) {
  const items = Array.isArray(requestItems) ? requestItems : [];
  const scopedArticle = truncateArticleTextByItems(template, items);
  return {
    ...template,
    articleText: scopedArticle.articleText,
    articleSentences: scopedArticle.articleSentences,
    items,
  };
}

function createIncrementalConfirmMessage(coverage) {
  return [
    `当前文章已有 ${coverage.coveredCount} 个标注解释。`,
    `检测到新增 ${coverage.missingCount} 个未解释标注。`,
    '确认调用 Gemini，只为新增标注生成解释吗？',
  ].join('\n');
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
  const selected = selectedRunId ? runId === selectedRunId : index === 0;
  return {
    runId,
    model: String(data.model || '').trim() || '未知模型',
    itemCount: Number.isFinite(itemCount) ? itemCount : getResultItems(fallbackResult).length,
    templateItemCount: Number(data.templateItemCount) || coverage.totalCount || 0,
    coveredCount: index === 0 ? coverage.coveredCount : null,
    missingCount: index === 0 ? coverage.missingCount : null,
    generatedAt: String(data.generatedAt || '').trim(),
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
  const effectiveSelectedRunId = selectedRunId && recordRunIds.has(selectedRunId)
    ? selectedRunId
    : String(rawHistory[0] && rawHistory[0].runId || '').trim();
  return {
    totalCount: coverage.totalCount,
    markedWordCount: Number(markedWordCount || 0),
    coveredCount: coverage.coveredCount,
    missingCount: coverage.missingCount,
    selectedRunId: effectiveSelectedRunId,
    records: rawHistory.slice(0, 8).map((record, index) => normalizeBackfillRecord(record, result, coverage, index, effectiveSelectedRunId)),
  };
}

function createElement(documentObject, tagName, className, textContent) {
  const element = documentObject.createElement(tagName);
  if (className) element.className = className;
  if (textContent != null) element.textContent = textContent;
  return element;
}

function createAnnotationBackfillDialog(options = {}) {
  const documentObject = options.documentObject || null;
  const onRun = typeof options.onRun === 'function' ? options.onRun : function () {};
  const onSelectRecord = typeof options.onSelectRecord === 'function' ? options.onSelectRecord : function () {};
  const onModelChange = typeof options.onModelChange === 'function' ? options.onModelChange : function () {};
  const initialModel = String(options.initialModel || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL;
  let mounted = false;
  let open = false;
  let busy = false;
  let modelDirty = false;
  let latestValues = { model: initialModel, apiKey: '' };
  let backdropEl = null;
  let rootEl = null;
  let modelInput = null;
  let apiKeyInput = null;
  let statusEl = null;
  let recordsEl = null;
  let startButton = null;
  let closeButton = null;
  let cancelButton = null;
  const stepEls = {};
  const stepState = Object.keys(STEP_LABELS).reduce((acc, key) => {
    acc[key] = { state: 'idle', message: '等待' };
    return acc;
  }, {});
  let currentStatus = { message: '填写模型和 API key 后开始。', state: 'idle' };

  let annotationSummary = { totalCount: 0, markedWordCount: 0, coveredCount: 0, missingCount: 0, selectedRunId: '', records: [] };

  function setOpenState(nextOpen) {
    open = !!nextOpen;
    if (rootEl) rootEl.hidden = !open;
    if (backdropEl) backdropEl.hidden = !open;
  }

  function ensureMounted() {
    if (mounted || !documentObject || typeof documentObject.createElement !== 'function') return;
    mounted = true;

    backdropEl = createElement(documentObject, 'div', 'annotation-backfill-dialog-backdrop');
    backdropEl.hidden = true;

    rootEl = createElement(documentObject, 'section', 'annotation-backfill-dialog');
    rootEl.hidden = true;
    rootEl.setAttribute('role', 'dialog');
    rootEl.setAttribute('aria-modal', 'true');
    rootEl.setAttribute('aria-label', 'AI解释标注');

    const header = createElement(documentObject, 'div', 'annotation-backfill-dialog__header');
    const titleWrap = createElement(documentObject, 'div', 'annotation-backfill-dialog__title-wrap');
    const title = createElement(documentObject, 'h2', 'annotation-backfill-dialog__title', 'AI解释标注');
    const subtitle = createElement(documentObject, 'p', 'annotation-backfill-dialog__subtitle', '本次只解释当前文章的标注，不改素材处理队列配置。');
    titleWrap.append(title, subtitle);
    closeButton = createElement(documentObject, 'button', 'annotation-backfill-dialog__close', '×');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', '关闭 AI解释标注');
    header.append(titleWrap, closeButton);

    const form = createElement(documentObject, 'form', 'annotation-backfill-dialog__form');
    const modelLabel = createElement(documentObject, 'label', 'annotation-backfill-dialog__field');
    const modelLabelText = createElement(documentObject, 'span', 'annotation-backfill-dialog__label', 'Gemini 模型');
    modelInput = createElement(documentObject, 'input', 'annotation-backfill-dialog__input');
    modelInput.type = 'text';
    modelInput.autocomplete = 'off';
    modelInput.spellcheck = false;
    modelInput.value = latestValues.model;
    modelInput.placeholder = DEFAULT_GEMINI_MODEL;
    modelLabel.append(modelLabelText, modelInput);

    const keyLabel = createElement(documentObject, 'label', 'annotation-backfill-dialog__field');
    const keyLabelText = createElement(documentObject, 'span', 'annotation-backfill-dialog__label', 'Gemini API key');
    apiKeyInput = createElement(documentObject, 'input', 'annotation-backfill-dialog__input');
    apiKeyInput.type = 'password';
    apiKeyInput.autocomplete = 'off';
    apiKeyInput.placeholder = '留空则使用后端保存的 key';
    keyLabel.append(keyLabelText, apiKeyInput);

    const progress = createElement(documentObject, 'div', 'annotation-backfill-dialog__progress');
    Object.entries(STEP_LABELS).forEach(([key, label]) => {
      const item = createElement(documentObject, 'div', 'annotation-backfill-dialog__step');
      item.dataset.state = 'idle';
      const dot = createElement(documentObject, 'span', 'annotation-backfill-dialog__step-dot');
      const text = createElement(documentObject, 'span', 'annotation-backfill-dialog__step-label', label);
      const detail = createElement(documentObject, 'span', 'annotation-backfill-dialog__step-detail', '等待');
      item.append(dot, text, detail);
      progress.appendChild(item);
      stepEls[key] = { item, detail };
    });

    statusEl = createElement(documentObject, 'div', 'annotation-backfill-dialog__status', '填写模型和 API key 后开始。');
    const recordsSection = createElement(documentObject, 'div', 'annotation-backfill-dialog__records');
    const recordsTitle = createElement(documentObject, 'div', 'annotation-backfill-dialog__records-title', '当前文章标注');
    recordsEl = createElement(documentObject, 'div', 'annotation-backfill-dialog__records-list');
    recordsSection.append(recordsTitle, recordsEl);

    const footer = createElement(documentObject, 'div', 'annotation-backfill-dialog__footer');
    cancelButton = createElement(documentObject, 'button', 'annotation-backfill-dialog__button annotation-backfill-dialog__button--secondary', '取消');
    cancelButton.type = 'button';
    startButton = createElement(documentObject, 'button', 'annotation-backfill-dialog__button annotation-backfill-dialog__button--primary', '开始解释');
    startButton.type = 'submit';
    footer.append(cancelButton, startButton);

    form.append(modelLabel, keyLabel, recordsSection, progress, statusEl, footer);
    rootEl.append(header, form);
    documentObject.body.append(backdropEl, rootEl);

    modelInput.addEventListener('input', function () {
      modelDirty = true;
      latestValues.model = String(modelInput.value || '').trim();
      if (latestValues.model) onModelChange(latestValues.model);
    });
    apiKeyInput.addEventListener('input', function () {
      latestValues.apiKey = String(apiKeyInput.value || '').trim();
    });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      return onRun(getValues());
    });
    closeButton.addEventListener('click', closeDialog);
    cancelButton.addEventListener('click', closeDialog);
  }

  function resetProgress() {
    Object.values(stepEls).forEach((entry) => {
      entry.item.dataset.state = 'idle';
      entry.detail.textContent = '等待';
    });
  }

  function openDialog(context) {
    ensureMounted();
    if (context && context.model) updateContext(context);
    resetProgress();
    setStatus('填写模型和 API key 后开始。', 'idle');
    setBusy(false);
    setOpenState(true);
    if (modelInput) modelInput.focus();
  }

  function resetProgress() {
    Object.keys(stepState).forEach((key) => {
      stepState[key] = { state: 'idle', message: '等待' };
      const entry = stepEls[key];
      if (!entry) return;
      entry.item.dataset.state = 'idle';
      entry.detail.textContent = '等待';
    });
  }

  function openDialog(context, options = {}) {
    ensureMounted();
    if (context && context.model) updateContext(context);
    if (options.reset !== false) {
      resetProgress();
      setStatus('填写模型和 API key 后开始。', 'idle');
    } else {
      setStatus(currentStatus.message, currentStatus.state);
      Object.entries(stepState).forEach(([step, value]) => setStep(step, value.state, value.message));
    }
    setBusy(false);
    setOpenState(true);
    if (modelInput) modelInput.focus();
  }

  function closeDialog() {
    setOpenState(false);
  }

  function updateContext(context = {}) {
    const model = String(context.model || '').trim();
    if (model && !modelDirty) latestValues.model = model;
    if (modelInput && model && !modelDirty) modelInput.value = model;
    if (statusEl && context.activeJobCount > 0 && !busy) {
      setStatus(`当前后台还有 ${context.activeJobCount} 个任务；本次解释会使用这里填写的模型和 key。`, 'warning');
    }
    renderAnnotationSummary();
  }

  function getValues() {
    latestValues = {
      model: String(modelInput ? modelInput.value : latestValues.model || '').trim(),
      apiKey: String(apiKeyInput ? apiKeyInput.value : latestValues.apiKey || '').trim(),
    };
    return { ...latestValues };
  }

  function rememberValues(values = {}) {
    const model = String(values.model || '').trim();
    const apiKey = String(values.apiKey || '').trim();
    if (model) {
      latestValues.model = model;
      if (modelInput) modelInput.value = model;
      onModelChange(model);
    }
    if (apiKey) {
      latestValues.apiKey = apiKey;
      if (apiKeyInput) apiKeyInput.value = apiKey;
    }
  }

  function setBusy(nextBusy) {
    busy = !!nextBusy;
    if (modelInput) modelInput.disabled = busy;
    if (apiKeyInput) apiKeyInput.disabled = busy;
    if (cancelButton) cancelButton.disabled = busy;
    renderAnnotationSummary();
    if (startButton) {
      startButton.disabled = busy;
      startButton.textContent = busy ? '解释中...' : '开始解释';
    }
  }

  function setStatus(message, state = 'idle') {
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.dataset.state = state;
  }

  function setStep(step, state, message) {
    const entry = stepEls[step];
    if (!entry) return;
    entry.item.dataset.state = state || 'idle';
    entry.detail.textContent = message || '';
  }

  function setStatus(message, state = 'idle') {
    currentStatus = { message: message || '', state };
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.dataset.state = state;
  }

  function setStep(step, state, message) {
    if (stepState[step]) stepState[step] = { state: state || 'idle', message: message || '' };
    const entry = stepEls[step];
    if (!entry) return;
    entry.item.dataset.state = state || 'idle';
    entry.detail.textContent = message || '';
  }

  function renderAnnotationSummary() {
    if (!recordsEl) return;
    recordsEl.textContent = '';
    const total = Number(annotationSummary.totalCount || 0);
    const markedWordCount = Number(annotationSummary.markedWordCount || 0);
    const countLabel = markedWordCount && markedWordCount !== total
      ? `${markedWordCount} 个标记词位，${total} 条解释目标`
      : `${total} 条解释目标`;
    if (!total) {
      recordsEl.appendChild(createElement(documentObject, 'div', 'annotation-backfill-dialog__record-empty', markedWordCount
        ? `当前 ${markedWordCount} 个标记词位，暂未形成可解释目标`
        : '当前文章暂无标注'));
      return;
    }
    if (!annotationSummary.records.length) {
      recordsEl.appendChild(createElement(documentObject, 'div', 'annotation-backfill-dialog__record-empty', `当前 ${countLabel}，暂无 AI 解释记录`));
      return;
    }
    recordsEl.appendChild(createElement(documentObject, 'div', 'annotation-backfill-dialog__record-empty', `当前 ${countLabel}`));
    annotationSummary.records.forEach((record, index) => {
      const row = createElement(documentObject, 'button', 'annotation-backfill-dialog__record annotation-backfill-dialog__record-tab');
      row.type = 'button';
      row.disabled = busy;
      row.dataset.runId = record.runId || '';
      row.dataset.current = record.current ? 'true' : 'false';
      const model = createElement(documentObject, 'span', 'annotation-backfill-dialog__record-model', record.model || '未知模型');
      const countText = index === 0 && record.coveredCount != null
        ? `已解释 ${record.coveredCount}/${total}`
        : `${record.itemCount || 0} 条`;
      const count = createElement(documentObject, 'span', 'annotation-backfill-dialog__record-count', countText);
      if (record.current) {
        row.appendChild(createElement(documentObject, 'span', 'annotation-backfill-dialog__record-current', '当前导入'));
      }
      row.append(model, count, createElement(documentObject, 'span', 'annotation-backfill-dialog__record-time', record.generatedAt || ''));
      row.addEventListener('click', function () {
        if (record.runId) onSelectRecord(record);
      });
      recordsEl.appendChild(row);
    });
  }

  function updateAnnotationSummary(summary = {}) {
    annotationSummary = {
      totalCount: Number(summary.totalCount || 0),
      markedWordCount: Number(summary.markedWordCount || 0),
      coveredCount: Number(summary.coveredCount || 0),
      missingCount: Number(summary.missingCount || 0),
      selectedRunId: String(summary.selectedRunId || '').trim(),
      records: Array.isArray(summary.records) ? summary.records : [],
    };
    renderAnnotationSummary();
  }

  function getStatusSnapshot() {
    return {
      open,
      busy,
      status: { ...currentStatus },
      steps: Object.fromEntries(Object.entries(stepState).map(([key, value]) => [key, { ...value }])),
      annotationSummary: {
        ...annotationSummary,
        records: annotationSummary.records.map((record) => ({ ...record })),
      },
      values: { ...latestValues },
    };
  }

  return {
    open: openDialog,
    close: closeDialog,
    updateContext,
    getValues,
    rememberValues,
    setBusy,
    setStatus,
    setStep,
    updateAnnotationSummary,
    resetProgress,
    getStatusSnapshot,
    isOpen() {
      return open;
    },
  };
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
  const confirmRun = typeof deps.confirmRun === 'function'
    ? deps.confirmRun
    : (windowObject && typeof windowObject.confirm === 'function' ? windowObject.confirm.bind(windowObject) : function () { return true; });
  const originalButtonText = button && String(button.textContent || '').trim()
    ? String(button.textContent).trim()
    : DEFAULT_BUTTON_TEXT;
  let running = false;
  let contextRequestId = 0;
  let hasRunStatus = false;
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
    onRun: function (runOptions) {
      return run(runOptions);
    },
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

  async function refreshAnnotationSummaryForCurrentArticle() {
    const emptySummary = { totalCount: 0, markedWordCount: getCurrentMarkedWordCount(), coveredCount: 0, missingCount: 0, selectedRunId: '', records: [] };
    const identity = getCurrentIdentity(state);
    if (!identity.jobId) {
      dialog.updateAnnotationSummary(emptySummary);
      return emptySummary;
    }
    if (!annotationLightweightModule || typeof annotationLightweightModule.buildManualLightweightAnnotationTemplate !== 'function') {
      dialog.updateAnnotationSummary(emptySummary);
      return emptySummary;
    }
    try {
      const template = annotationLightweightModule.buildManualLightweightAnnotationTemplate();
      const savedPayload = await loadSavedBackfillPayload(client, identity.jobId);
      const summary = buildAnnotationSummary(template, savedPayload, getSelectedRunId(windowObject, identity.jobId), getCurrentMarkedWordCount());
      dialog.updateAnnotationSummary(summary);
      return summary;
    } catch (_error) {
      dialog.updateAnnotationSummary(emptySummary);
      return emptySummary;
    }
  }

  async function openDialog() {
    const identity = getCurrentIdentity(state);
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
      if (requestId !== contextRequestId || running) return;
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
    try {
      dialog.setStatus('正在导入所选 AI 解释版本...', 'working');
      const response = await client.getAnnotationBackfillRunResult(identity.jobId, selectedRunId);
      const result = response && response.result ? response.result : response;
      if (!result || !Array.isArray(result.items)) {
        throw new Error('所选 AI 解释版本缺少 items 数组。');
      }
      const importResult = await importBackfillResult(result, identity.jobId);
      persistSelectedRunId(windowObject, identity.jobId, selectedRunId);
      if (annotationLightweightModule && typeof annotationLightweightModule.buildManualLightweightAnnotationTemplate === 'function') {
        const template = annotationLightweightModule.buildManualLightweightAnnotationTemplate();
        const savedPayload = await loadSavedBackfillPayload(client, identity.jobId);
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
    if (runOptions.model) {
      persistModel(windowObject, runOptions.model);
      dialog.rememberValues({ model: runOptions.model });
    }
    if (runOptions.apiKey) {
      persistSessionApiKey(windowObject, runOptions.apiKey);
      dialog.rememberValues({ apiKey: runOptions.apiKey });
    }
    const startedIdentity = getCurrentIdentity(state);
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
          dialog.setStatus(`本地已有 ${coverage.coveredCount} 条解释，已恢复，未调用 Gemini API。`, 'success');
          showToast(`本地已有 ${coverage.coveredCount} 条 AI 解释，已恢复，未调用 API。`, 'success');
          return { response: { result: savedResult, reused: true }, imported: cachedImportResult };
        }
        if (coverage.partiallyCovered) {
          const confirmed = confirmRun(createIncrementalConfirmMessage(coverage));
          if (!confirmed) {
            dialog.setStatus(`已恢复 ${coverage.coveredCount} 条；新增 ${coverage.missingCount} 条未解释，已取消 API 调用。`, 'warning');
            showToast(`已恢复已有解释；新增 ${coverage.missingCount} 条未调用 API。`, 'warning');
            return { response: { result: savedResult, reused: true, canceled: true }, imported: cachedImportResult };
          }
          requestTemplate = buildRequestTemplate(template, coverage.missingItems);
          mergeWithLatest = true;
          dialog.setStatus(`确认调用 Gemini，只解释新增 ${coverage.missingCount} 条标注。`, 'working');
        }
      }

      const requestItemCount = Array.isArray(requestTemplate && requestTemplate.items) ? requestTemplate.items.length : 0;
      if (shouldUseRecommendedBulkModel(runContext.model, requestItemCount)) {
        const originalModel = runContext.model;
        runContext.model = RECOMMENDED_ANNOTATION_MODEL;
        runOptions.model = RECOMMENDED_ANNOTATION_MODEL;
        persistModel(windowObject, RECOMMENDED_ANNOTATION_MODEL);
        dialog.rememberValues({ model: RECOMMENDED_ANNOTATION_MODEL });
        dialog.updateContext(runContext);
        dialog.setStep('config', 'done', RECOMMENDED_ANNOTATION_MODEL);
        showToast(
          `${originalModel} 当前批量标注解释容易 503，已自动切换到 ${RECOMMENDED_ANNOTATION_MODEL}。`,
          'warning',
        );
      }
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
      dialog.updateAnnotationSummary(buildAnnotationSummary(template, {
        result,
        metadata: response && response.metadata,
        history: response && response.history,
      }, generatedRunId, getCurrentMarkedWordCount()));
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
  };
}

export function initAnnotationBackfillAiControls(deps = {}) {
  const controller = createAnnotationBackfillAiController(deps);
  const windowObject = deps.windowObject || (typeof window !== 'undefined' ? window : null);
  if (windowObject) windowObject.__annotationBackfillAiController = controller;
  return controller;
}
