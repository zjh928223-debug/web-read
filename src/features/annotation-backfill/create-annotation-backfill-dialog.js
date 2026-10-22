import { createDialogController } from '../../services/runtime/dialog-controller.js';
import { applyNativeControlStyles } from '../../lib/native-control-styles.js';
import { applyNativeInputStyles } from '../../lib/native-input-styles.js';
import { DEFAULT_GEMINI_MODEL } from './annotation-backfill-template.js';

const STEP_LABELS = {
  config: '配置',
  export: '模板',
  request: 'Gemini',
  import: '导入',
};

function createEmptySrsSummary() {
  return {
    wordCandidates: 0,
    phraseCandidates: 0,
    excludedLongText: 0,
    existing: 0,
    known: 0,
    ignored: 0,
    pending: false,
    canBuildFromExisting: false,
    visible: false,
    compact: false,
  };
}

function createElement(documentObject, tagName, className, textContent) {
  const element = documentObject.createElement(tagName);
  if (className) element.className = className;
  if (textContent != null) element.textContent = textContent;
  return element;
}

function createEmptyModelProvenance(model = '') {
  return {
    currentSelection: String(model || '').trim(),
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
  };
}

function createAnnotationBackfillDialog(options = {}) {
  const documentObject = options.documentObject || null;
  const dialogController = createDialogController({ documentObject });
  const onRun = typeof options.onRun === 'function' ? options.onRun : function () {};
  const onSelectRecord = typeof options.onSelectRecord === 'function' ? options.onSelectRecord : function () {};
  const onModelChange = typeof options.onModelChange === 'function' ? options.onModelChange : function () {};
  const onAddSrsCandidates = typeof options.onAddSrsCandidates === 'function' ? options.onAddSrsCandidates : function () {};
  const onSkipSrsCandidates = typeof options.onSkipSrsCandidates === 'function' ? options.onSkipSrsCandidates : function () {};
  const onBuildSrsCandidatesFromExisting = typeof options.onBuildSrsCandidatesFromExisting === 'function'
    ? options.onBuildSrsCandidatesFromExisting
    : function () {};
  const getSharedApiKey = typeof options.getSessionApiKey === 'function' ? options.getSessionApiKey : function () { return ''; };
  const onApiKeyChange = typeof options.onApiKeyChange === 'function' ? options.onApiKeyChange : function () {};
  const srsEnabled = options.srsEnabled === true;
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
  let modelProvenanceEl = null;
  let recordsEl = null;
  let srsPanelEl = null;
  let srsStatsEl = null;
  let srsAddAllButton = null;
  let srsAddWordsButton = null;
  let srsSkipButton = null;
  let srsBuildExistingButton = null;
  let startButton = null;
  let closeButton = null;
  let cancelButton = null;
  const stepEls = {};
  const stepState = Object.keys(STEP_LABELS).reduce((acc, key) => {
    acc[key] = { state: 'idle', message: '等待' };
    return acc;
  }, {});
  let currentStatus = { message: '填写模型和 API key 后开始。', state: 'idle' };

  let modelProvenance = createEmptyModelProvenance(initialModel);
  let annotationSummary = {
    totalCount: 0,
    markedWordCount: 0,
    coveredCount: 0,
    missingCount: 0,
    selectedRunId: '',
    requestedRunId: '',
    selectedRunMismatch: false,
    records: [],
  };
  let srsSummary = createEmptySrsSummary();

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
    rootEl.setAttribute('data-ui-theme', 'light');
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
    applyNativeControlStyles(closeButton, { owner: 'learning', variant: 'ghost', size: 'icon' });
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
    applyNativeInputStyles(modelInput, { owner: 'learning', size: 'default', interaction: 'text' });
    modelLabel.append(modelLabelText, modelInput);

    const keyLabel = createElement(documentObject, 'label', 'annotation-backfill-dialog__field');
    const keyLabelText = createElement(documentObject, 'span', 'annotation-backfill-dialog__label', 'Gemini API key');
    apiKeyInput = createElement(documentObject, 'input', 'annotation-backfill-dialog__input');
    apiKeyInput.type = 'password';
    apiKeyInput.autocomplete = 'off';
    apiKeyInput.placeholder = '留空则使用后端保存的 key';
    applyNativeInputStyles(apiKeyInput, { owner: 'learning', size: 'default', interaction: 'text' });
    keyLabel.append(keyLabelText, apiKeyInput);

    const modelProvenanceSection = createElement(documentObject, 'div', 'annotation-backfill-dialog__records');
    const modelProvenanceTitle = createElement(documentObject, 'div', 'annotation-backfill-dialog__records-title', '模型与来源');
    modelProvenanceEl = createElement(documentObject, 'div', 'annotation-backfill-dialog__records-list');
    modelProvenanceSection.append(modelProvenanceTitle, modelProvenanceEl);
    renderModelProvenance();

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
    statusEl.setAttribute('role', 'status');
    statusEl.setAttribute('aria-live', 'polite');
    statusEl.setAttribute('aria-atomic', 'true');
    const recordsSection = createElement(documentObject, 'div', 'annotation-backfill-dialog__records');
    const recordsTitle = createElement(documentObject, 'div', 'annotation-backfill-dialog__records-title', '当前文章标注');
    recordsEl = createElement(documentObject, 'div', 'annotation-backfill-dialog__records-list');
    recordsSection.append(recordsTitle, recordsEl);

    srsPanelEl = createElement(documentObject, 'div', 'annotation-backfill-dialog__srs');
    const srsTitle = createElement(documentObject, 'div', 'annotation-backfill-dialog__records-title', 'SRS 词库');
    srsStatsEl = createElement(documentObject, 'div', 'annotation-backfill-dialog__srs-stats');
    const srsActions = createElement(documentObject, 'div', 'annotation-backfill-dialog__srs-actions');
    srsAddAllButton = createElement(documentObject, 'button', 'annotation-backfill-dialog__button annotation-backfill-dialog__button--primary', '加入单词和短语');
    srsAddAllButton.type = 'button';
    applyNativeControlStyles(srsAddAllButton, { owner: 'learning', variant: 'default', size: 'default' });
    srsAddWordsButton = createElement(documentObject, 'button', 'annotation-backfill-dialog__button annotation-backfill-dialog__button--secondary', '只加入单词');
    srsAddWordsButton.type = 'button';
    applyNativeControlStyles(srsAddWordsButton, { owner: 'learning', variant: 'outline', size: 'default' });
    srsSkipButton = createElement(documentObject, 'button', 'annotation-backfill-dialog__button annotation-backfill-dialog__button--secondary', '本次不加入');
    srsSkipButton.type = 'button';
    applyNativeControlStyles(srsSkipButton, { owner: 'learning', variant: 'outline', size: 'default' });
    srsBuildExistingButton = createElement(documentObject, 'button', 'annotation-backfill-dialog__button annotation-backfill-dialog__button--secondary', '从已有解释生成候选');
    srsBuildExistingButton.type = 'button';
    applyNativeControlStyles(srsBuildExistingButton, { owner: 'learning', variant: 'outline', size: 'default' });
    srsActions.append(srsAddAllButton, srsAddWordsButton, srsSkipButton, srsBuildExistingButton);
    srsPanelEl.append(srsTitle, srsStatsEl, srsActions);
    renderSrsSummary();

    const footer = createElement(documentObject, 'div', 'annotation-backfill-dialog__footer');
    cancelButton = createElement(documentObject, 'button', 'annotation-backfill-dialog__button annotation-backfill-dialog__button--secondary', '取消');
    cancelButton.type = 'button';
    applyNativeControlStyles(cancelButton, { owner: 'learning', variant: 'outline', size: 'default' });
    startButton = createElement(documentObject, 'button', 'annotation-backfill-dialog__button annotation-backfill-dialog__button--primary', '开始解释');
    startButton.type = 'submit';
    applyNativeControlStyles(startButton, { owner: 'learning', variant: 'default', size: 'default' });
    footer.append(cancelButton, startButton);

    form.append(modelLabel, keyLabel, modelProvenanceSection, recordsSection, srsPanelEl, progress, statusEl, footer);
    rootEl.append(header, form);
    documentObject.body.append(backdropEl, rootEl);

    modelInput.addEventListener('input', function () {
      modelDirty = true;
      latestValues.model = String(modelInput.value || '').trim();
      updateModelProvenance({
        currentSelection: latestValues.model || '未记录',
      });
      if (latestValues.model) onModelChange(latestValues.model);
    });
    apiKeyInput.addEventListener('input', function () {
      latestValues.apiKey = String(apiKeyInput.value || '').trim();
      if (latestValues.apiKey) onApiKeyChange(latestValues.apiKey);
    });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      return onRun(getValues());
    });
    closeButton.addEventListener('click', closeDialog);
    cancelButton.addEventListener('click', closeDialog);
    srsAddAllButton.addEventListener('click', function () { return onAddSrsCandidates('all'); });
    srsAddWordsButton.addEventListener('click', function () { return onAddSrsCandidates('words'); });
    srsSkipButton.addEventListener('click', function () { return onSkipSrsCandidates(); });
    srsBuildExistingButton.addEventListener('click', function () { return onBuildSrsCandidatesFromExisting(); });
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
    const sharedApiKey = String(getSharedApiKey() || '').trim();
    if (sharedApiKey) {
      latestValues.apiKey = sharedApiKey;
      if (apiKeyInput) apiKeyInput.value = sharedApiKey;
    }
    if (options.reset !== false) {
      resetProgress();
      setStatus('填写模型和 API key 后开始。', 'idle');
    } else {
      setStatus(currentStatus.message, currentStatus.state);
      Object.entries(stepState).forEach(([step, value]) => setStep(step, value.state, value.message));
    }
    setBusy(false);
    setOpenState(true);
    if (rootEl) {
      dialogController.open(rootEl, {
        initialFocus: modelInput,
        statusElement: statusEl,
        isPending: () => busy,
        onRequestClose: closeDialog,
      });
    }
  }

  function closeDialog() {
    setOpenState(false);
    dialogController.close();
  }

  function updateContext(context = {}) {
    const model = String(context.model || '').trim();
    if (model && !modelDirty) latestValues.model = model;
    if (modelInput && model && !modelDirty) modelInput.value = model;
    const currentSelection = String(context.currentSelection || context.selectedModel || model || '').trim();
    if (!modelDirty) {
      updateModelProvenance({
        currentSelection: currentSelection || modelProvenance.currentSelection,
        finalSubmittedModel: String(context.finalSubmittedModel || '').trim() || modelProvenance.finalSubmittedModel,
        finalSubmittedState: String(context.finalSubmittedState || '').trim() || modelProvenance.finalSubmittedState,
        autoSwitchText: String(context.autoSwitchText || '').trim() || modelProvenance.autoSwitchText,
      });
    }
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
      onApiKeyChange(apiKey);
    }
  }

  function setBusy(nextBusy) {
    busy = !!nextBusy;
    dialogController.setBusy(busy);
    if (modelInput) modelInput.disabled = busy;
    if (apiKeyInput) apiKeyInput.disabled = busy;
    if (cancelButton) cancelButton.disabled = busy;
    renderAnnotationSummary();
    renderSrsSummary();
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

  function updateModelProvenance(next = {}) {
    modelProvenance = { ...modelProvenance, ...next };
    renderModelProvenance();
  }

  function renderModelProvenance() {
    if (!modelProvenanceEl) return;
    modelProvenanceEl.textContent = '';
    const finalSubmittedText = modelProvenance.finalSubmittedModel
      ? `${modelProvenance.finalSubmittedModel}${modelProvenance.finalSubmittedState ? `（${modelProvenance.finalSubmittedState}）` : ''}`
      : (modelProvenance.finalSubmittedState || '尚未提交');
    const runRecordText = modelProvenance.runRecordModel || '未记录';
    const runIdentityText = modelProvenance.runRecordId
      ? `run ${modelProvenance.runRecordId}`
      : 'run 未记录';
    const runTimeText = modelProvenance.runRecordGeneratedAt || '时间未记录';
    const lines = [
      `当前选择：${modelProvenance.currentSelection || '未记录'}`,
      `最终提交模型：${finalSubmittedText}`,
      `本次运行记录模型：${runRecordText}（${modelProvenance.runRecordState || '未记录'}） · ${runIdentityText} · ${runTimeText}`,
      `实际执行/路由模型：${modelProvenance.routeModel || '当前记录未提供'}`,
    ];
    if (modelProvenance.autoSwitchText) lines.push(`自动切换：${modelProvenance.autoSwitchText}`);
    if (modelProvenance.reuseText) lines.push(`复用说明：${modelProvenance.reuseText}`);
    if (modelProvenance.mergeText) lines.push(`合并说明：${modelProvenance.mergeText}`);
    lines.forEach((line) => {
      modelProvenanceEl.appendChild(createElement(documentObject, 'div', 'annotation-backfill-dialog__record-empty', line));
    });
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
    if (annotationSummary.selectedRunMismatch) {
      recordsEl.appendChild(createElement(
        documentObject,
        'div',
        'annotation-backfill-dialog__record-empty',
        `未找到所选运行记录 ${annotationSummary.requestedRunId || '未记录'}；未将其它历史记录重新标记为当前。`,
      ));
    }
    annotationSummary.records.forEach((record, index) => {
      const row = createElement(documentObject, 'button', 'annotation-backfill-dialog__record annotation-backfill-dialog__record-tab');
      row.type = 'button';
      row.setAttribute('data-ui-owner', 'learning');
      row.disabled = busy;
      row.dataset.runId = record.runId || '';
      row.dataset.current = record.current ? 'true' : 'false';
      const model = createElement(documentObject, 'span', 'annotation-backfill-dialog__record-model', record.model || '未记录');
      const countText = index === 0 && record.coveredCount != null
        ? `已解释 ${record.coveredCount}/${total}`
        : `${record.itemCount || 0} 条`;
      const count = createElement(documentObject, 'span', 'annotation-backfill-dialog__record-count', countText);
      const run = createElement(documentObject, 'span', 'annotation-backfill-dialog__record-time', record.runId ? `run ${record.runId}` : 'run 未记录');
      const generatedAt = createElement(documentObject, 'span', 'annotation-backfill-dialog__record-time', record.generatedAt || '时间未记录');
      if (record.current) {
        row.appendChild(createElement(documentObject, 'span', 'annotation-backfill-dialog__record-current', '当前导入'));
      }
      row.append(model, count, run, generatedAt);
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
      requestedRunId: String(summary.requestedRunId || '').trim(),
      selectedRunMismatch: summary.selectedRunMismatch === true,
      records: Array.isArray(summary.records) ? summary.records : [],
    };
    if (summary.modelProvenance && typeof summary.modelProvenance === 'object') {
      updateModelProvenance(summary.modelProvenance);
    }
    renderAnnotationSummary();
  }

  function renderSrsSummary() {
    if (!srsEnabled) {
      if (srsPanelEl) srsPanelEl.hidden = true;
      return;
    }
    const total = Number(srsSummary.wordCandidates || 0) + Number(srsSummary.phraseCandidates || 0);
    const hasPending = !!srsSummary.pending && total > 0;
    const canBuild = !!srsSummary.canBuildFromExisting;
    if (srsPanelEl) srsPanelEl.hidden = !hasPending && !canBuild;
    if (srsStatsEl) {
      srsStatsEl.textContent = hasPending
        ? [
          `可加入单词 ${srsSummary.wordCandidates || 0} 个`,
          `可加入短语 ${srsSummary.phraseCandidates || 0} 个`,
          `已排除长文本 ${srsSummary.excludedLongText || 0} 个`,
          `已在词库中 ${srsSummary.existing || 0} 个`,
          `已掌握 ${srsSummary.known || 0} 个`,
          `已忽略 ${srsSummary.ignored || 0} 个`,
        ].join(' · ')
        : '已有 AI 解释，可生成 SRS 候选。';
    }
    if (srsAddAllButton) {
      srsAddAllButton.hidden = !hasPending;
      srsAddAllButton.disabled = busy || total <= 0;
    }
    if (srsAddWordsButton) {
      srsAddWordsButton.hidden = !hasPending;
      srsAddWordsButton.disabled = busy || Number(srsSummary.wordCandidates || 0) <= 0;
    }
    if (srsSkipButton) {
      srsSkipButton.hidden = !hasPending;
      srsSkipButton.disabled = busy || total <= 0;
    }
    if (srsBuildExistingButton) {
      srsBuildExistingButton.hidden = hasPending || !canBuild;
      srsBuildExistingButton.disabled = busy || hasPending || !canBuild;
    }
  }

  function updateSrsSummary(summary = {}) {
    const wordCandidates = Number(summary.wordCandidates || 0);
    const phraseCandidates = Number(summary.phraseCandidates || 0);
    const hasPending = !!summary.pending && (wordCandidates + phraseCandidates) > 0;
    const canBuildFromExisting = !!summary.canBuildFromExisting && !hasPending;
    srsSummary = {
      ...createEmptySrsSummary(),
      ...summary,
      wordCandidates,
      phraseCandidates,
      pending: hasPending,
      canBuildFromExisting,
      visible: hasPending || canBuildFromExisting,
      compact: !hasPending && canBuildFromExisting,
    };
    renderSrsSummary();
  }

  function getStatusSnapshot() {
    return {
      open,
      busy,
      status: { ...currentStatus },
      modelProvenance: { ...modelProvenance },
      steps: Object.fromEntries(Object.entries(stepState).map(([key, value]) => [key, { ...value }])),
      annotationSummary: {
        ...annotationSummary,
        records: annotationSummary.records.map((record) => ({ ...record })),
      },
      srsSummary: { ...srsSummary },
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
    updateModelProvenance,
    updateAnnotationSummary,
    updateSrsSummary,
    resetProgress,
    getStatusSnapshot,
    dispose() {
      setOpenState(false);
      dialogController.dispose();
    },
    isOpen() {
      return open;
    },
  };
}

export { createAnnotationBackfillDialog, createEmptySrsSummary };
