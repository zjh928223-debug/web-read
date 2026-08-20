import {
  ARTICLE_SRS_SETTLEMENT_GROUPS,
  VOCABULARY_ENTRY_TYPES,
  applyArticleSrsSettlement,
  applyArticleSrsSettlementProgress,
  buildArticleSrsSettlement,
  buildPreviewAnnotationTemplate,
  buildPreviewDocumentContext,
  buildPreviewGeneratedItemsFromResult,
  buildPreviewScan,
  createIndexedDbArticleSrsSettlementProgressRepository,
  createVocabularyService,
  applySettlementMeaningRefinementResult,
  buildSettlementMeaningRefinementTemplate,
  getSettlementMeaningRefinementCandidates,
  getArticleSrsSettlementProgressStatus,
  getPreviewWordIndexesFromGeneratedItems,
  selectArticleSrsSettlementCandidates,
} from '../services/vocabulary/index.js';
import { createDialogController } from '../services/runtime/dialog-controller.js';
import {
  getAnnotationGenerationScope,
  scheduleGeneratedAnnotationIndexRefresh,
} from './session-facades.js';
import { getAnnotationGenerationStorage } from './session-annotation-services.js';
import { formatDictionarySuggestion } from '../dictionary/ecdict/browser/dictionary-suggestion-view.mjs';
import { createAriaAmericanPronunciationService } from '../services/pronunciation/aria-american-pronunciation.js';
import { getPiniaRuntimeStores } from '../pinia-stores/runtime-registry.js';
import {
  canRunArticleSrsSettlementInWorker,
  runArticleSrsSettlementInWorker,
} from '../services/vocabulary/article-srs-settlement-worker-client.js';

const MODEL_STORAGE_KEY = 'annotationBackfillAi.model';
const SESSION_API_KEY = '__annotationBackfillAiSessionApiKey';
const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const SETTLEMENT_DIALOG_MIN_WIDTH = 420;
const SETTLEMENT_DIALOG_MIN_HEIGHT = 420;
const SETTLEMENT_DIALOG_MAX_WIDTH = 980;
const SETTLEMENT_DIALOG_MAX_HEIGHT = 860;
const SETTLEMENT_DIALOG_EDGE_GAP = 8;
const SETTLEMENT_SIMPLE_MEANING_MAX_LENGTH = 24;

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

function getSettlementCacheKey(sourceInfo = {}, items = []) {
  try {
    return [
      normalizeText(sourceInfo.sourceId),
      normalizeText(sourceInfo.sourceTitle),
      normalizeText(sourceInfo.sourceUrl),
      JSON.stringify(Array.isArray(items) ? items : []),
    ].join('::');
  } catch (_error) {
    return '';
  }
}

function getStoredModel(windowObject) {
  try {
    return normalizeText(windowObject && windowObject.localStorage && windowObject.localStorage.getItem(MODEL_STORAGE_KEY));
  } catch (_error) {
    return '';
  }
}

function persistModel(windowObject, model) {
  const normalized = normalizeText(model);
  if (!normalized) return;
  try {
    if (windowObject && windowObject.localStorage) windowObject.localStorage.setItem(MODEL_STORAGE_KEY, normalized);
  } catch (_error) {}
}

function getSessionApiKey(windowObject) {
  return normalizeText(windowObject && windowObject[SESSION_API_KEY]);
}

function persistSessionApiKey(windowObject, apiKey) {
  const normalized = normalizeText(apiKey);
  if (windowObject && normalized) windowObject[SESSION_API_KEY] = normalized;
}

function createElement(documentObject, tagName, className, textContent) {
  const element = documentObject.createElement(tagName);
  if (className) element.className = className;
  if (textContent != null) element.textContent = textContent;
  return element;
}

function createSpeakerIcon(documentObject) {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = documentObject.createElementNS(namespace, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const speaker = documentObject.createElementNS(namespace, 'path');
  speaker.setAttribute('d', 'M11 5 6 9H3v6h3l5 4V5Z');
  const sound = documentObject.createElementNS(namespace, 'path');
  sound.setAttribute('d', 'M15 9.5a4 4 0 0 1 0 5M17.5 7a7 7 0 0 1 0 10');
  svg.append(speaker, sound);
  return svg;
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

async function savePreviewGeneratedItems(windowObject, items) {
  const { storage, scope, bundle } = await loadCurrentAnnotationBundle(windowObject);
  const generated = bundle && bundle.generated ? bundle.generated : storage.createGeneratedJson(scope, []);
  const status = bundle && bundle.status ? bundle.status : storage.createStatusJson(scope, {});
  const byTargetId = new Map();
  (Array.isArray(generated.items) ? generated.items : []).forEach((item) => {
    const targetId = normalizeText(item && item.targetId);
    if (targetId) byTargetId.set(targetId, item);
  });
  (Array.isArray(items) ? items : []).forEach((item) => {
    const targetId = normalizeText(item && item.targetId);
    if (!targetId) return;
    byTargetId.set(targetId, {
      ...(byTargetId.get(targetId) || {}),
      ...item,
      source: 'preview-scan',
    });
  });
  const nextGenerated = {
    ...generated,
    source: generated.source || 'annotation-generated',
    items: Array.from(byTargetId.values()),
  };
  await storage.saveBundle(scope, nextGenerated, status);
  const store = windowObject && windowObject.AnnotationGeneratedResultStore;
  if (store && typeof store.indexBundle === 'function') {
    store.indexBundle(nextGenerated, scope);
  }
  await Promise.resolve(scheduleGeneratedAnnotationIndexRefresh());
  return nextGenerated;
}

function setPreviewWordIndexes(windowObject, indexes) {
  const stores = getPiniaRuntimeStores();
  if (stores && stores.transcript) {
    stores.transcript.previewVocabularyWordIndexes = Array.isArray(indexes) ? indexes.slice() : [];
  }
}

function getGeneratedItemsFromBundle(bundle) {
  return Array.isArray(bundle && bundle.generated && bundle.generated.items)
    ? bundle.generated.items
    : [];
}

function buildStateContext(state, scope, sourceInfo) {
  return buildPreviewDocumentContext(state, {
    documentId: scope && scope.documentId,
    audioKey: scope && scope.audioKey,
    sourceId: sourceInfo.sourceId,
  });
}

function renderCandidateList(documentObject, container, candidates) {
  container.textContent = '';
  if (!candidates.length) {
    container.appendChild(createElement(documentObject, 'div', 'vocabulary-preview-dialog__empty', '当前文章没有新的预习候选。'));
    return;
  }
  candidates.forEach((candidate) => {
    const row = createElement(documentObject, 'div', 'vocabulary-preview-dialog__item');
    const main = createElement(documentObject, 'div', 'vocabulary-preview-dialog__item-main');
    main.append(
      createElement(documentObject, 'strong', '', candidate.markedText || candidate.lemma),
      createElement(documentObject, 'span', 'vocabulary-preview-dialog__item-meta', candidate.group === 'proper_noun' ? '可能是专有名词' : `出现 ${candidate.frequency || 1} 次`)
    );
    const dictionaryText = formatDictionarySuggestion(candidate.dictionarySuggestion);
    if (dictionaryText) {
      main.appendChild(createElement(
        documentObject,
        'span',
        'vocabulary-preview-dialog__dictionary-suggestion',
        dictionaryText
      ));
    }
    row.appendChild(main);
    container.appendChild(row);
  });
}

function createPreviewDialog(options = {}) {
  const documentObject = options.documentObject;
  const dialogController = createDialogController({ documentObject });
  let busy = false;
  const onRun = options.onRun;
  const initialModel = options.initialModel || DEFAULT_MODEL;
  const getSharedApiKey = typeof options.getSessionApiKey === 'function' ? options.getSessionApiKey : function () { return ''; };
  const onApiKeyChange = typeof options.onApiKeyChange === 'function' ? options.onApiKeyChange : function () {};
  let root = null;
  let backdrop = null;
  let modelInput = null;
  let apiKeyInput = null;
  let statusEl = null;
  let listEl = null;
  let runButton = null;
  let closeButton = null;
  let mounted = false;
  let latestScan = null;

  function ensureMounted() {
    if (mounted) return;
    mounted = true;
    backdrop = createElement(documentObject, 'div', 'vocabulary-preview-dialog-backdrop');
    backdrop.hidden = true;
    root = createElement(documentObject, 'section', 'vocabulary-preview-dialog');
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', '当前文章预习');

    const header = createElement(documentObject, 'div', 'vocabulary-preview-dialog__header');
    const titleWrap = createElement(documentObject, 'div', 'vocabulary-preview-dialog__title-wrap');
    titleWrap.append(
      createElement(documentObject, 'h2', 'vocabulary-preview-dialog__title', '当前文章预习'),
      createElement(documentObject, 'p', 'vocabulary-preview-dialog__subtitle', '只扫描当前文章，不自动加入 SRS。')
    );
    closeButton = createElement(documentObject, 'button', 'vocabulary-preview-dialog__close', '×');
    closeButton.type = 'button';
    header.append(titleWrap, closeButton);

    const form = createElement(documentObject, 'form', 'vocabulary-preview-dialog__form');
    modelInput = createElement(documentObject, 'input', 'vocabulary-preview-dialog__input');
    modelInput.type = 'text';
    modelInput.value = initialModel;
    modelInput.placeholder = DEFAULT_MODEL;
    apiKeyInput = createElement(documentObject, 'input', 'vocabulary-preview-dialog__input');
    apiKeyInput.type = 'password';
    apiKeyInput.placeholder = '留空则使用后端保存的 key';
    const modelLabel = createElement(documentObject, 'label', 'vocabulary-preview-dialog__field');
    modelLabel.append(createElement(documentObject, 'span', 'vocabulary-preview-dialog__label', 'Gemini 模型'), modelInput);
    const keyLabel = createElement(documentObject, 'label', 'vocabulary-preview-dialog__field');
    keyLabel.append(createElement(documentObject, 'span', 'vocabulary-preview-dialog__label', 'Gemini API key'), apiKeyInput);

    statusEl = createElement(documentObject, 'div', 'vocabulary-preview-dialog__status');
    statusEl.setAttribute('role', 'status');
    statusEl.setAttribute('aria-live', 'polite');
    statusEl.setAttribute('aria-atomic', 'true');
    const dictionaryHint = createElement(
      documentObject,
      'p',
      'vocabulary-preview-dialog__hint',
      '候选卡上的 ECDICT 释义来自本地词典，仅用于筛选参考；点击“生成 AI 解释”后才会调用 Gemini 并写回当前文章。'
    );
    listEl = createElement(documentObject, 'div', 'vocabulary-preview-dialog__list');
    const footer = createElement(documentObject, 'div', 'vocabulary-preview-dialog__footer');
    const cancelButton = createElement(documentObject, 'button', 'vocabulary-preview-dialog__button vocabulary-preview-dialog__button--secondary', '取消');
    cancelButton.type = 'button';
    runButton = createElement(documentObject, 'button', 'vocabulary-preview-dialog__button vocabulary-preview-dialog__button--primary', '生成 AI 解释');
    runButton.type = 'submit';
    footer.append(cancelButton, runButton);
    form.append(modelLabel, keyLabel, statusEl, dictionaryHint, listEl, footer);
    root.append(header, form);
    documentObject.body.append(backdrop, root);

    closeButton.addEventListener('click', close);
    cancelButton.addEventListener('click', close);
    apiKeyInput.addEventListener('input', () => {
      const apiKey = normalizeText(apiKeyInput && apiKeyInput.value);
      if (apiKey) onApiKeyChange(apiKey);
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (typeof onRun === 'function') onRun(getValues());
    });
  }

  function getValues() {
    return {
      model: normalizeText(modelInput && modelInput.value) || DEFAULT_MODEL,
      apiKey: normalizeText(apiKeyInput && apiKeyInput.value),
    };
  }

  function setBusy(nextBusy) {
    busy = !!nextBusy;
    dialogController.setBusy(busy);
    if (modelInput) modelInput.disabled = busy;
    if (apiKeyInput) apiKeyInput.disabled = busy;
    if (runButton) {
      runButton.disabled = !!busy || !(latestScan && latestScan.candidates && latestScan.candidates.length);
      runButton.textContent = busy ? '解释中...' : '生成 AI 解释';
    }
  }

  function setStatus(message, state = 'idle') {
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.dataset.state = state;
  }

  function open(scan) {
    ensureMounted();
    latestScan = scan || null;
    const sharedApiKey = normalizeText(getSharedApiKey());
    if (sharedApiKey && apiKeyInput) apiKeyInput.value = sharedApiKey;
    const summary = scan && scan.summary ? scan.summary : {};
    setStatus(`重点预习 ${summary.priorityCount || 0} 个，可能是专有名词 ${summary.properNounCount || 0} 个，已生成 AI 解释 ${summary.alreadyExplainedCount || 0} 个。`);
    renderCandidateList(documentObject, listEl, Array.isArray(scan && scan.candidates) ? scan.candidates : []);
    setBusy(false);
    root.hidden = false;
    backdrop.hidden = false;
    dialogController.open(root, {
      initialFocus: modelInput,
      statusElement: statusEl,
      isPending: () => busy,
      onRequestClose: close,
    });
  }

  function close() {
    if (root) root.hidden = true;
    if (backdrop) backdrop.hidden = true;
    dialogController.close();
  }

  return {
    open,
    close,
    setBusy,
    setStatus,
    getValues,
    dispose() {
      close();
      dialogController.dispose();
    },
  };
}

function getSettlementEntryKindLabel(candidate) {
  return candidate && candidate.entry_type === VOCABULARY_ENTRY_TYPES.PHRASE ? 'phr' : 'w';
}

function getSettlementCompactMeaning(candidate) {
  const simpleMeaning = normalizeText(
    candidate && (
      candidate.simple_meaning
      || candidate.simpleMeaning
      || candidate.context && (candidate.context.simple_meaning || candidate.context.simpleMeaning)
    )
  );
  if (simpleMeaning) return simpleMeaning.length > SETTLEMENT_SIMPLE_MEANING_MAX_LENGTH
    ? `${simpleMeaning.slice(0, SETTLEMENT_SIMPLE_MEANING_MAX_LENGTH)}...`
    : simpleMeaning;
  return normalizeText(candidate && (
    candidate.meaning
    || candidate.context && candidate.context.meaning
  ));
}

function formatSettlementRefinementStatus(result = {}) {
  const requested = Number(result.requested || 0);
  const updated = Number(result.updated || 0);
  const rejected = Number(result.rejected || 0);
  const missing = Number(result.missing || 0);
  if (!requested) return '当前没有需要 AI 精简的候选。';
  const parts = [`AI 精简完成：更新 ${updated} 个`];
  if (rejected) parts.push(`丢弃过长结果 ${rejected} 个`);
  if (missing) parts.push(`无有效返回 ${missing} 个`);
  return `${parts.join('，')}。`;
}

function getSettlementCandidateGroups(candidates = []) {
  const words = [];
  const phrases = [];
  (Array.isArray(candidates) ? candidates : []).forEach((candidate) => {
    if (candidate && candidate.entry_type === VOCABULARY_ENTRY_TYPES.PHRASE) phrases.push(candidate);
    else words.push(candidate);
  });
  return [{
    key: 'words',
    label: '单词',
    candidates: words,
  }, {
    key: 'phrases',
    label: '短语',
    candidates: phrases,
  }].filter((group) => group.candidates.length);
}

function renderSettlementList(documentObject, container, candidates, removedIds, onRemove, onRelearn, onSpeak, speakingTargetId, expandedMeaningIds) {
  container.textContent = '';
  if (!candidates.length) {
    container.appendChild(createElement(documentObject, 'div', 'vocabulary-preview-dialog__empty', '当前文章没有可整理入 SRS 的候选。'));
    return;
  }
  getSettlementCandidateGroups(candidates).forEach((group) => {
    const section = createElement(documentObject, 'div', 'vocabulary-preview-dialog__group');
    section.dataset.group = group.key;
    const heading = createElement(documentObject, 'div', 'vocabulary-preview-dialog__group-heading');
    heading.append(
      createElement(documentObject, 'span', '', group.label),
      createElement(documentObject, 'span', 'vocabulary-preview-dialog__group-count', String(group.candidates.length))
    );
    section.appendChild(heading);
    group.candidates.forEach((candidate) => {
      const targetId = normalizeText(candidate.targetId);
      const row = createElement(documentObject, 'div', 'vocabulary-preview-dialog__item');
      row.dataset.targetId = targetId;
      row.dataset.removed = removedIds.has(targetId) ? 'true' : 'false';
      const main = createElement(documentObject, 'div', 'vocabulary-preview-dialog__item-main');
      const line = createElement(documentObject, 'span', 'vocabulary-preview-dialog__item-line');
      const spokenText = normalizeText(candidate.markedText || candidate.lemma);
      const speakerButton = createElement(documentObject, 'button', 'vocabulary-preview-dialog__speaker');
      speakerButton.type = 'button';
      speakerButton.title = `使用 Microsoft Aria Natural 发音朗读 ${spokenText}`;
      speakerButton.setAttribute('aria-label', speakerButton.title);
      speakerButton.setAttribute('aria-pressed', speakingTargetId === targetId ? 'true' : 'false');
      speakerButton.dataset.playing = speakingTargetId === targetId ? 'true' : 'false';
      speakerButton.appendChild(createSpeakerIcon(documentObject));
      speakerButton.addEventListener('click', () => onSpeak(candidate));
      line.append(
        createElement(documentObject, 'strong', '', candidate.markedText || candidate.lemma),
        createElement(documentObject, 'span', 'vocabulary-preview-dialog__item-meta', getSettlementEntryKindLabel(candidate))
      );
      const compactMeaning = getSettlementCompactMeaning(candidate);
      row.dataset.hasMeaning = compactMeaning ? 'true' : 'false';
      const meaning = createElement(documentObject, 'span', 'vocabulary-preview-dialog__item-meaning', compactMeaning);
      const isMeaningExpanded = !!compactMeaning && expandedMeaningIds.has(targetId);
      row.dataset.expanded = isMeaningExpanded ? 'true' : 'false';
      meaning.hidden = !isMeaningExpanded;
      function toggleMeaning() {
        if (!compactMeaning) return;
        if (meaning.hidden) expandedMeaningIds.add(targetId);
        else expandedMeaningIds.delete(targetId);
        meaning.hidden = !meaning.hidden;
        row.dataset.expanded = meaning.hidden ? 'false' : 'true';
        main.setAttribute('aria-expanded', meaning.hidden ? 'false' : 'true');
      }
      if (compactMeaning) {
        main.tabIndex = 0;
        main.setAttribute('role', 'button');
        main.setAttribute('aria-expanded', isMeaningExpanded ? 'true' : 'false');
        row.addEventListener('click', (event) => {
          if (event.target && typeof event.target.closest === 'function' && event.target.closest('button')) return;
          toggleMeaning();
        });
        main.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          toggleMeaning();
        });
      }
      main.append(line, meaning);
      const actions = createElement(documentObject, 'div', 'vocabulary-preview-dialog__item-actions');
      actions.addEventListener('click', (event) => event.stopPropagation());
      actions.appendChild(speakerButton);
      if (candidate.group === ARTICLE_SRS_SETTLEMENT_GROUPS.NEEDS_EXPLICIT_RELEARN && candidate.eligible === false) {
        const relearnBtn = createElement(documentObject, 'button', 'vocabulary-preview-dialog__mini-button', '重新学习');
        relearnBtn.type = 'button';
        relearnBtn.addEventListener('click', () => onRelearn(candidate));
        actions.appendChild(relearnBtn);
      }
      const removeBtn = createElement(documentObject, 'button', 'vocabulary-preview-dialog__mini-button', removedIds.has(targetId) ? '放回' : '移出本次');
      removeBtn.type = 'button';
      removeBtn.className = 'vocabulary-preview-dialog__remove-button';
      removeBtn.textContent = '×';
      removeBtn.title = removedIds.has(targetId) ? '放回本次' : '移出本次';
      removeBtn.setAttribute('aria-label', removedIds.has(targetId) ? '放回本次' : '移出本次');
      removeBtn.addEventListener('click', () => onRemove(candidate));
      actions.appendChild(removeBtn);
      row.append(main, actions);
      section.appendChild(row);
    });
    container.appendChild(section);
  });
}

function createSettlementDialog(options = {}) {
  const documentObject = options.documentObject;
  const dialogController = createDialogController({ documentObject });
  const windowObject = options.windowObject || documentObject.defaultView || globalThis;
  const onApply = options.onApply;
  const onSkip = options.onSkip;
  const onToggleRemove = options.onToggleRemove;
  const onRefineMeanings = options.onRefineMeanings;
  const pronunciation = options.pronunciationService || createAriaAmericanPronunciationService({
    windowObject,
    voiceWaitMs: 0,
  });
  let root = null;
  let backdrop = null;
  let statusEl = null;
  let listEl = null;
  let addAllButton = null;
  let addWordsButton = null;
  let refineButton = null;
  let closeButton = null;
  let mounted = false;
  let settlement = { candidates: [], summary: {} };
  let removedIds = new Set();
  let busy = false;
  let statusOverride = null;
  let dragState = null;
  let resizeState = null;
  let refinementInFlight = false;
  let speakingTargetId = '';
  let pronunciationRequestId = 0;
  let expandedMeaningIds = new Set();

  function getViewportSize() {
    const docEl = documentObject.documentElement || {};
    return {
      width: Number(windowObject && windowObject.innerWidth) || docEl.clientWidth || 1024,
      height: Number(windowObject && windowObject.innerHeight) || docEl.clientHeight || 768,
    };
  }

  function clampNumber(value, min, max) {
    const safeMax = Math.max(min, max);
    return Math.min(Math.max(value, min), safeMax);
  }

  function setDialogLayout(left, top, width, height) {
    if (!root) return;
    root.style.transform = 'none';
    root.style.left = `${Math.round(left)}px`;
    root.style.top = `${Math.round(top)}px`;
    if (width) root.style.width = `${Math.round(width)}px`;
    if (height) {
      root.style.height = `${Math.round(height)}px`;
      root.style.maxHeight = 'none';
    }
  }

  function updatePointerInteraction(event) {
    if (!root) return;
    const viewport = getViewportSize();
    if (dragState) {
      const rect = root.getBoundingClientRect();
      const left = clampNumber(event.clientX - dragState.offsetX, SETTLEMENT_DIALOG_EDGE_GAP, viewport.width - rect.width - SETTLEMENT_DIALOG_EDGE_GAP);
      const top = clampNumber(event.clientY - dragState.offsetY, SETTLEMENT_DIALOG_EDGE_GAP, viewport.height - rect.height - SETTLEMENT_DIALOG_EDGE_GAP);
      setDialogLayout(left, top);
      return;
    }
    if (resizeState) {
      const maxWidth = Math.min(SETTLEMENT_DIALOG_MAX_WIDTH, viewport.width - resizeState.left - SETTLEMENT_DIALOG_EDGE_GAP);
      const maxHeight = Math.min(SETTLEMENT_DIALOG_MAX_HEIGHT, viewport.height - resizeState.top - SETTLEMENT_DIALOG_EDGE_GAP);
      const minWidth = Math.min(SETTLEMENT_DIALOG_MIN_WIDTH, maxWidth);
      const minHeight = Math.min(SETTLEMENT_DIALOG_MIN_HEIGHT, maxHeight);
      const nextWidth = clampNumber(resizeState.width + event.clientX - resizeState.startX, minWidth, maxWidth);
      const nextHeight = clampNumber(resizeState.height + event.clientY - resizeState.startY, minHeight, maxHeight);
      setDialogLayout(
        resizeState.left,
        resizeState.top,
        nextWidth,
        nextHeight
      );
    }
  }

  function stopPointerInteraction() {
    if (root) {
      delete root.dataset.dragging;
      delete root.dataset.resizing;
    }
    dragState = null;
    resizeState = null;
    documentObject.removeEventListener('pointermove', updatePointerInteraction);
    documentObject.removeEventListener('pointerup', stopPointerInteraction);
    documentObject.removeEventListener('pointercancel', stopPointerInteraction);
  }

  function startDrag(event) {
    if (!root || event.button !== 0) return;
    if (event.target && typeof event.target.closest === 'function' && event.target.closest('button')) return;
    const rect = root.getBoundingClientRect();
    dragState = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    root.dataset.dragging = 'true';
    documentObject.addEventListener('pointermove', updatePointerInteraction);
    documentObject.addEventListener('pointerup', stopPointerInteraction);
    documentObject.addEventListener('pointercancel', stopPointerInteraction);
    event.preventDefault();
  }

  function startResize(event) {
    if (!root || event.button !== 0) return;
    const rect = root.getBoundingClientRect();
    resizeState = {
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
    root.dataset.resizing = 'true';
    documentObject.addEventListener('pointermove', updatePointerInteraction);
    documentObject.addEventListener('pointerup', stopPointerInteraction);
    documentObject.addEventListener('pointercancel', stopPointerInteraction);
    event.preventDefault();
    event.stopPropagation();
  }

  function ensureMounted() {
    if (mounted) return;
    mounted = true;
    backdrop = createElement(documentObject, 'div', 'vocabulary-preview-dialog-backdrop');
    backdrop.hidden = true;
    root = createElement(documentObject, 'section', 'vocabulary-preview-dialog vocabulary-preview-dialog--settlement');
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', '整理本篇生词');

    const header = createElement(documentObject, 'div', 'vocabulary-preview-dialog__header');
    const titleWrap = createElement(documentObject, 'div', 'vocabulary-preview-dialog__title-wrap');
    titleWrap.append(
      createElement(documentObject, 'h2', 'vocabulary-preview-dialog__title', '整理本篇生词'),
      createElement(documentObject, 'p', 'vocabulary-preview-dialog__subtitle', '从本篇已解释内容生成 SRS 候选，最后统一确认。')
    );
    closeButton = createElement(documentObject, 'button', 'vocabulary-preview-dialog__close', '×');
    closeButton.type = 'button';
    header.append(titleWrap, closeButton);
    statusEl = createElement(documentObject, 'div', 'vocabulary-preview-dialog__status');
    statusEl.setAttribute('role', 'status');
    statusEl.setAttribute('aria-live', 'polite');
    statusEl.setAttribute('aria-atomic', 'true');
    listEl = createElement(documentObject, 'div', 'vocabulary-preview-dialog__list');
    const footer = createElement(documentObject, 'div', 'vocabulary-preview-dialog__footer');
    refineButton = createElement(documentObject, 'button', 'vocabulary-preview-dialog__button vocabulary-preview-dialog__button--secondary', 'AI 精简释义');
    refineButton.type = 'button';
    const skipButton = createElement(documentObject, 'button', 'vocabulary-preview-dialog__button vocabulary-preview-dialog__button--secondary', '本篇不加入');
    skipButton.type = 'button';
    addWordsButton = createElement(documentObject, 'button', 'vocabulary-preview-dialog__button vocabulary-preview-dialog__button--secondary', '只加入单词');
    addWordsButton.type = 'button';
    addAllButton = createElement(documentObject, 'button', 'vocabulary-preview-dialog__button vocabulary-preview-dialog__button--primary', '加入单词和短语');
    addAllButton.type = 'button';
    const resizeHandle = createElement(documentObject, 'div', 'vocabulary-preview-dialog__resize-handle');
    resizeHandle.setAttribute('aria-hidden', 'true');
    footer.append(refineButton, skipButton, addWordsButton, addAllButton);
    root.append(header, statusEl, listEl, footer, resizeHandle);
    documentObject.body.append(backdrop, root);
    header.addEventListener('pointerdown', startDrag);
    resizeHandle.addEventListener('pointerdown', startResize);
    closeButton.addEventListener('click', close);
    skipButton.addEventListener('click', skip);
    refineButton.addEventListener('click', refineMeanings);
    addWordsButton.addEventListener('click', () => apply('words'));
    addAllButton.addEventListener('click', () => apply('all'));
  }

  function render() {
    const summary = settlement.summary || {};
    if (statusEl) {
      if (statusOverride) {
        statusEl.textContent = statusOverride.text;
        statusEl.dataset.state = statusOverride.state || '';
      } else {
        statusEl.textContent = summary.completed
          ? `本篇已整理 · 已处理 ${summary.processed || 0} 个候选`
          : [
            `可加入单词 ${summary.wordCandidates || 0} 个`,
            `可加入短语 ${summary.phraseCandidates || 0} 个`,
            `重新学习 ${summary.relearn || 0} 个`,
            `重点关注 ${summary.focus || 0} 个`,
            `需手动重新学习 ${summary.needsExplicitRelearn || 0} 个`,
            `已处理 ${summary.processed || 0} 个`,
            `已排除 ${summary.excluded || 0} 个`,
          ].join(' · ');
        statusEl.dataset.state = '';
      }
    }
    renderSettlementList(
      documentObject,
      listEl,
      settlement.candidates || [],
      removedIds,
      toggleRemove,
      markRelearn,
      speakCandidate,
      speakingTargetId,
      expandedMeaningIds
    );
    const activeCount = (settlement.candidates || []).filter((candidate) => candidate.eligible !== false && !removedIds.has(normalizeText(candidate.targetId))).length;
    const refinableCount = getSettlementMeaningRefinementCandidates((settlement.candidates || [])
      .filter((candidate) => !removedIds.has(normalizeText(candidate && candidate.targetId)))).length;
    if (addAllButton) addAllButton.disabled = busy || activeCount <= 0;
    if (addWordsButton) addWordsButton.disabled = busy || !(settlement.candidates || []).some((candidate) => candidate.entry_type === VOCABULARY_ENTRY_TYPES.WORD && candidate.eligible !== false && !removedIds.has(normalizeText(candidate.targetId)));
    if (refineButton) refineButton.disabled = busy || refinementInFlight || typeof onRefineMeanings !== 'function' || refinableCount <= 0;
  }

  function updateSpeakingState(targetId) {
    if (!listEl || typeof listEl.querySelectorAll !== 'function') return;
    listEl.querySelectorAll('.vocabulary-preview-dialog__item').forEach((row) => {
      const active = String(row.dataset.targetId || '') === String(targetId || '');
      const button = row.querySelector('.vocabulary-preview-dialog__speaker');
      if (!button) return;
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.dataset.playing = active ? 'true' : 'false';
    });
  }

  async function toggleRemove(candidate) {
    const targetId = normalizeText(candidate && candidate.targetId);
    if (!targetId) return;
    const nextRemoved = !removedIds.has(targetId);
    if (nextRemoved) removedIds.add(targetId);
    else removedIds.delete(targetId);
    statusOverride = null;
    render();
    if (typeof onToggleRemove !== 'function') return;
    try {
      await onToggleRemove({
        articleId: settlement.articleId,
        candidate,
        targetId,
        removed: nextRemoved,
      });
    } catch (error) {
      if (nextRemoved) removedIds.delete(targetId);
      else removedIds.add(targetId);
      statusOverride = {
        text: error && error.message ? error.message : '保存候选选择失败',
        state: 'error',
      };
      render();
    }
  }

  function markRelearn(candidate) {
    if (!candidate) return;
    candidate.eligible = true;
    candidate.group = ARTICLE_SRS_SETTLEMENT_GROUPS.RELEARN;
    candidate.relearn = true;
    statusOverride = null;
    render();
  }

  async function speakCandidate(candidate) {
    const targetId = normalizeText(candidate && candidate.targetId);
    const spokenText = normalizeText(candidate && (candidate.markedText || candidate.lemma));
    if (!targetId || !spokenText) return;
    if (speakingTargetId === targetId) {
      pronunciationRequestId += 1;
      pronunciation.stop();
      speakingTargetId = '';
      updateSpeakingState('');
      return;
    }
    const requestId = ++pronunciationRequestId;
    pronunciation.stop();
    speakingTargetId = targetId;
    updateSpeakingState(targetId);
    try {
      await pronunciation.speak(spokenText);
    } catch (error) {
      if (error && error.name !== 'AbortError' && requestId === pronunciationRequestId) {
        statusOverride = { text: 'Microsoft Aria Natural 发音暂不可用。', state: 'error' };
        if (statusEl) {
          statusEl.textContent = statusOverride.text;
          statusEl.dataset.state = statusOverride.state;
        }
      }
    } finally {
      if (requestId === pronunciationRequestId) {
        speakingTargetId = '';
        updateSpeakingState('');
      }
    }
  }

  function openLoading(message = '正在整理本篇生词…') {
    ensureMounted();
    pronunciationRequestId += 1;
    pronunciation.stop();
    speakingTargetId = '';
    expandedMeaningIds = new Set();
    settlement = { candidates: [], summary: {}, loading: true };
    removedIds = new Set();
    statusOverride = { text: message, state: 'working' };
    render();
    if (listEl) {
      listEl.textContent = '';
      listEl.appendChild(createElement(documentObject, 'div', 'vocabulary-preview-dialog__empty', message));
    }
    root.hidden = false;
    backdrop.hidden = false;
    dialogController.open(root, {
      initialFocus: closeButton,
      statusElement: statusEl,
      isPending: () => busy,
      onRequestClose: close,
    });
  }

  function open(nextSettlement) {
    ensureMounted();
    pronunciationRequestId += 1;
    pronunciation.stop();
    speakingTargetId = '';
    expandedMeaningIds = new Set();
    settlement = { ...(nextSettlement || { candidates: [], summary: {} }), loading: false };
    removedIds = new Set((Array.isArray(settlement.removedTargetIds) ? settlement.removedTargetIds : [])
      .map(normalizeText)
      .filter(Boolean));
    statusOverride = null;
    render();
    root.hidden = false;
    backdrop.hidden = false;
    dialogController.open(root, {
      initialFocus: closeButton,
      statusElement: statusEl,
      isPending: () => busy,
      onRequestClose: close,
    });
    const prefetchTexts = (settlement.candidates || [])
      .map((candidate) => normalizeText(candidate && (candidate.markedText || candidate.lemma)))
      .filter(Boolean);
    if (typeof pronunciation.prefetch === 'function' && prefetchTexts.length) {
      void pronunciation.prefetch(prefetchTexts).catch(() => {});
    }
  }

  function close() {
    pronunciationRequestId += 1;
    pronunciation.stop();
    speakingTargetId = '';
    expandedMeaningIds = new Set();
    if (root) root.hidden = true;
    if (backdrop) backdrop.hidden = true;
    dialogController.close();
  }

  function setBusy(nextBusy) {
    busy = !!nextBusy;
    dialogController.setBusy(busy);
    if (refineButton) refineButton.textContent = busy ? '精简中...' : 'AI 精简释义';
    render();
  }

  function setStatus(message, state = 'idle') {
    statusOverride = { text: message || '', state };
    if (statusEl) {
      statusEl.textContent = statusOverride.text;
      statusEl.dataset.state = state;
    }
  }

  async function refineMeanings() {
    if (typeof onRefineMeanings !== 'function' || busy || refinementInFlight) return;
    try {
      refinementInFlight = true;
      setBusy(true);
      statusOverride = { text: '正在用 AI 精简释义...', state: 'working' };
      render();
      const result = await onRefineMeanings({
        articleId: settlement.articleId,
        candidates: settlement.candidates || [],
        removedTargetIds: Array.from(removedIds),
      });
      const updated = result && result.updated || 0;
      const rejected = result && result.rejected || 0;
      statusOverride = {
        text: formatSettlementRefinementStatus({ ...result, updated, rejected }),
        state: 'success',
      };
    } catch (error) {
      statusOverride = { text: error && error.message ? error.message : 'AI 精简释义失败', state: 'error' };
    } finally {
      refinementInFlight = false;
      setBusy(false);
    }
  }

  async function apply(mode) {
    if (typeof onApply !== 'function') return;
    if (busy) return;
    busy = true;
    setStatus(
      mode === 'all' ? '正在加入单词和短语，请稍候…' : '正在加入单词，请稍候…',
      'working',
    );
    if (addAllButton) addAllButton.textContent = mode === 'all' ? '加入中…' : '加入单词和短语';
    if (addWordsButton) addWordsButton.textContent = mode === 'words' ? '加入中…' : '只加入单词';
    addAllButton.disabled = true;
    addWordsButton.disabled = true;
    if (refineButton) refineButton.disabled = true;
    try {
      const result = await onApply({
        articleId: settlement.articleId,
        mode,
        candidates: settlement.candidates || [],
        removedTargetIds: Array.from(removedIds),
      });
      if (result) close();
      else setStatus('本次没有完成加入，请稍后重试。', 'error');
    } catch (error) {
      setStatus(error && error.message ? error.message : '加入失败，请稍后重试。', 'error');
    } finally {
      busy = false;
      if (addAllButton) addAllButton.textContent = '加入单词和短语';
      if (addWordsButton) addWordsButton.textContent = '只加入单词';
      render();
    }
  }

  async function skip() {
    if (typeof onSkip !== 'function') {
      close();
      return;
    }
    if (busy) return;
    busy = true;
    render();
    try {
      const result = await onSkip({
        articleId: settlement.articleId,
        candidates: settlement.candidates || [],
      });
      if (result) close();
    } finally {
      busy = false;
      render();
    }
  }

  return {
    open,
    openLoading,
    close,
    setStatus,
    setSpeakingState: updateSpeakingState,
    dispose() {
      close();
      dialogController.dispose();
    },
  };
}

export function createVocabularyPreviewController(deps = {}) {
  const previewButton = deps.previewButton || null;
  const togglePreviewButton = deps.togglePreviewButton || null;
  const settleButton = deps.settleButton || null;
  const state = deps.state || {};
  const windowObject = deps.windowObject || globalThis;
  const documentObject = deps.documentObject || windowObject.document;
  const client = deps.client || null;
  const vocabularyService = deps.vocabularyService || createVocabularyService();
  const settlementApplicationRunner = typeof deps.runSettlementApplication === 'function'
    ? deps.runSettlementApplication
    : (options) => (
      canRunArticleSrsSettlementInWorker(windowObject)
        ? runArticleSrsSettlementInWorker({ ...options, windowObject })
        : applyArticleSrsSettlement({ ...options, vocabularyService })
    );
  const settlementProgressRepository = deps.settlementProgressRepository
    || createIndexedDbArticleSrsSettlementProgressRepository();
  const showToast = typeof deps.showToast === 'function' ? deps.showToast : function () {};
  const showError = typeof deps.showError === 'function' ? deps.showError : function () {};
  const dictionaryEnrichmentAdapter = deps.dictionaryEnrichmentAdapter || null;
  let previewVisible = false;
  let latestPreviewScan = null;
  let previewScanInFlight = null;
  let previewScanInFlightIdentityKey = '';
  let previewScanRequestId = 0;
  const previewDialog = createPreviewDialog({
    documentObject,
    initialModel: getStoredModel(windowObject) || DEFAULT_MODEL,
    getSessionApiKey() {
      return getSessionApiKey(windowObject);
    },
    onApiKeyChange(apiKey) {
      persistSessionApiKey(windowObject, apiKey);
    },
    onRun: runPreviewExplanation,
  });
  const settlementDialog = createSettlementDialog({
    documentObject,
    windowObject,
    onApply: applySettlement,
    onSkip: skipSettlement,
    onToggleRemove: setSettlementCandidateRemoved,
    onRefineMeanings: refineSettlementMeanings,
  });
  let activeIdentityKey = '';
  let settlementProgressBadgeRequestId = 0;
  let settlementOpening = false;
  let settlementCache = null;
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
      settleButton.title = '本文已有加入或跳过记录；打开可查看尚未处理的候选';
      return;
    }
    if (status === 'processing') {
      settleButton.textContent = '正在后台加入…';
      settleButton.title = '生词正在后台写入，不影响继续阅读';
      return;
    }
    if (status === 'completed') {
      settleButton.textContent = '已学完本篇';
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
    if (status === 'refinement_failed') {
      settleButton.textContent = '精简失败，可重试';
      settleButton.title = '上次 AI 精简失败；打开后可手动重试';
      return;
    }
    settleButton.textContent = '已学完本篇';
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
    const identityKey = `${identity.jobId}::${identity.audioKey}`;
    if (activeIdentityKey && identityKey !== activeIdentityKey) {
      previewScanRequestId += 1;
      previewVisible = false;
      latestPreviewScan = null;
      settlementCache = null;
      setPreviewWordIndexes(windowObject, []);
    }
    activeIdentityKey = identityKey;
    const available = !!identity.jobId;
    updateSettlementProgressBadge('none');
    void refreshSettlementProgressBadge(identity);
    if (previewButton) {
      const scanning = !!previewScanInFlight && previewScanInFlightIdentityKey === identityKey;
      previewButton.disabled = !available || scanning;
      previewButton.textContent = scanning ? '扫描中…' : '预习生词';
      previewButton.title = scanning
        ? '正在扫描当前文章的预习生词'
        : available ? '扫描当前文章的预习生词' : '请先打开标准素材库里的文章';
    }
    if (settleButton) {
      settleButton.disabled = !available || settlementOpening;
      settleButton.title = settlementOpening
        ? '正在整理本篇生词，请稍候'
        : available ? '确认本文已学完后，整理本篇已解释生词到 SRS' : '请先打开标准素材库里的文章';
      if (settlementOpening) settleButton.textContent = '正在整理本篇…';
    }
    if (togglePreviewButton) {
      togglePreviewButton.disabled = !available;
      togglePreviewButton.textContent = previewVisible ? '隐藏预习词' : '显示预习词';
    }
  }

  async function performPreviewScan(identityKey, requestId) {
    try {
      const { scope, bundle } = await loadCurrentAnnotationBundle(windowObject);
      const sourceInfo = getSourceInfo(state, scope);
      const context = buildStateContext(state, scope, sourceInfo);
      const previewScan = await buildPreviewScan({
        context,
        markedMap: state.markedMap instanceof Map ? state.markedMap : new Map(),
        generatedItems: getGeneratedItemsFromBundle(bundle),
        vocabularyService,
        sourceId: sourceInfo.sourceId,
        sourceTitle: sourceInfo.sourceTitle,
        sourceUrl: sourceInfo.sourceUrl,
      });
      const enrichedCandidates = dictionaryEnrichmentAdapter
        ? await dictionaryEnrichmentAdapter.enrichCandidates(previewScan.candidates)
        : previewScan.candidates;
      const currentIdentity = getCurrentIdentity(state);
      const currentIdentityKey = `${currentIdentity.jobId}::${currentIdentity.audioKey}`;
      if (requestId !== previewScanRequestId || currentIdentityKey !== identityKey) return null;
      latestPreviewScan = {
        ...previewScan,
        candidates: enrichedCandidates,
      };
      previewDialog.open(latestPreviewScan);
      return latestPreviewScan;
    } catch (error) {
      const currentIdentity = getCurrentIdentity(state);
      const currentIdentityKey = `${currentIdentity.jobId}::${currentIdentity.audioKey}`;
      if (requestId === previewScanRequestId && currentIdentityKey === identityKey) {
        showError('VOCABULARY_PREVIEW', error && error.message ? error.message : '预习生词扫描失败');
      }
      return null;
    }
  }

  function scanPreview() {
    const identity = getCurrentIdentity(state);
    if (!identity.jobId) {
      showError('VOCABULARY_PREVIEW', '请先打开标准素材库里的文章');
      return Promise.resolve(null);
    }
    const identityKey = `${identity.jobId}::${identity.audioKey}`;
    if (previewScanInFlight && previewScanInFlightIdentityKey === identityKey) return previewScanInFlight;
    const requestId = ++previewScanRequestId;
    let trackedTask;
    trackedTask = performPreviewScan(identityKey, requestId).finally(() => {
      if (previewScanInFlight !== trackedTask) return;
      previewScanInFlight = null;
      previewScanInFlightIdentityKey = '';
      refreshAvailability();
    });
    previewScanInFlight = trackedTask;
    previewScanInFlightIdentityKey = identityKey;
    refreshAvailability();
    return trackedTask;
  }

  async function runPreviewExplanation(values = {}) {
    if (!latestPreviewScan || !latestPreviewScan.candidates || !latestPreviewScan.candidates.length) return null;
    if (!client || typeof client.runAnnotationBackfill !== 'function') {
      showError('VOCABULARY_PREVIEW', '本地素材处理服务尚未就绪');
      return null;
    }
    const identity = getCurrentIdentity(state);
    if (!identity.jobId) {
      showError('VOCABULARY_PREVIEW', '请先打开标准素材库里的文章');
      return null;
    }
    const model = normalizeText(values.model) || DEFAULT_MODEL;
    const apiKey = normalizeText(values.apiKey) || getSessionApiKey(windowObject);
    persistModel(windowObject, model);
    if (apiKey) persistSessionApiKey(windowObject, apiKey);
    try {
      previewDialog.setBusy(true);
      previewDialog.setStatus('正在请求 AI 解释...', 'working');
      const template = buildPreviewAnnotationTemplate({
        context: latestPreviewScan.context,
        candidates: latestPreviewScan.candidates,
        articleId: latestPreviewScan.context && latestPreviewScan.context.documentId,
      });
      const payload = { template, model, mergeWithLatest: true };
      if (apiKey) payload.apiKey = apiKey;
      const response = await client.runAnnotationBackfill(identity.jobId, payload);
      const result = response && response.result ? response.result : response;
      const previewItems = buildPreviewGeneratedItemsFromResult({
        result,
        candidates: latestPreviewScan.candidates,
      });
      await savePreviewGeneratedItems(windowObject, previewItems);
      previewDialog.setStatus(`已生成 ${previewItems.length} 个预习解释。`, 'success');
      showToast(`预习解释完成：${previewItems.length} 个`, 'success');
      return { response, previewItems };
    } catch (error) {
      previewDialog.setStatus(error && error.message ? error.message : '预习解释失败', 'error');
      showError('VOCABULARY_PREVIEW', error && error.message ? error.message : '预习解释失败');
      return null;
    } finally {
      previewDialog.setBusy(false);
    }
  }

  async function togglePreviewWords() {
    try {
      previewVisible = !previewVisible;
      if (!previewVisible) {
        setPreviewWordIndexes(windowObject, []);
        refreshAvailability();
        return [];
      }
      const { bundle } = await loadCurrentAnnotationBundle(windowObject);
      const indexes = getPreviewWordIndexesFromGeneratedItems(getGeneratedItemsFromBundle(bundle));
      setPreviewWordIndexes(windowObject, indexes);
      showToast(indexes.length ? `已显示 ${indexes.length} 个预习提示位置` : '当前文章还没有已解释的预习词', indexes.length ? 'success' : 'info');
      refreshAvailability();
      return indexes;
    } catch (error) {
      previewVisible = false;
      setPreviewWordIndexes(windowObject, []);
      showError('VOCABULARY_PREVIEW', error && error.message ? error.message : '显示预习词失败');
      refreshAvailability();
      return [];
    }
  }

  async function openSettlement() {
    if (settlementOpening) return null;
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
      settlementDialog.openLoading('正在整理本篇生词…');
      const { scope, bundle } = await loadCurrentAnnotationBundle(windowObject);
      const sourceInfo = getSourceInfo(state, scope);
      const generatedItems = getGeneratedItemsFromBundle(bundle);
      const cacheKey = getSettlementCacheKey(sourceInfo, generatedItems);
      let builtSettlement = settlementCache && settlementCache.key === cacheKey
        ? settlementCache.value
        : null;
      if (!builtSettlement) {
        builtSettlement = await buildArticleSrsSettlement({
          items: generatedItems,
          vocabularyService,
          sourceId: sourceInfo.sourceId,
          sourceTitle: sourceInfo.sourceTitle,
          sourceUrl: sourceInfo.sourceUrl,
        });
        settlementCache = { key: cacheKey, value: builtSettlement };
      }
      let progress = await settlementProgressRepository.getProgress(sourceInfo.sourceId);
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
      if (getCurrentIdentity(state).jobId !== identity.jobId) {
        throw new Error('当前文章已切换，请重新打开“整理本篇生词”。');
      }
      const settlement = applyArticleSrsSettlementProgress(builtSettlement, progress);
      settlement.articleId = sourceInfo.sourceId;
      if (settlement.summary && settlement.summary.completed) {
        updateSettlementProgressBadge('completed');
      } else if (settlement.summary && settlement.summary.processing > 0) {
        updateSettlementProgressBadge('processing');
      } else if (settlement.summary && settlement.summary.processed > 0) {
        updateSettlementProgressBadge('processed');
      }
      settlementDialog.open(settlement);
      return settlement;
    } catch (error) {
      showError('VOCABULARY_SETTLEMENT', error && error.message ? error.message : '整理本篇生词失败');
      return null;
    } finally {
      settlementOpening = false;
      refreshAvailability();
    }
  }

  async function refineSettlementMeanings(options = {}) {
    if (!client || typeof client.runAnnotationBackfill !== 'function') {
      throw new Error('本地素材处理服务尚未就绪');
    }
    const { articleId, currentIdentity } = getCurrentSettlementActionIdentity(options);
    const removedTargetIds = new Set((Array.isArray(options.removedTargetIds) ? options.removedTargetIds : [])
      .map(normalizeText)
      .filter(Boolean));
    const candidates = (Array.isArray(options.candidates) ? options.candidates : [])
      .filter((candidate) => !removedTargetIds.has(normalizeText(candidate && candidate.targetId)));
    const refinableCandidates = getSettlementMeaningRefinementCandidates(candidates);
    const apiKey = getSessionApiKey(windowObject);
    const initialTemplate = buildSettlementMeaningRefinementTemplate({
      candidates: refinableCandidates,
      sourceId: articleId,
    });
    if (!initialTemplate.items.length) {
      return { requested: 0, updated: 0, rejected: 0, missing: 0 };
    }
    const requestableTargetIds = new Set(initialTemplate.items.map((item) => normalizeText(item && item.targetId)).filter(Boolean));
    const requestableCandidates = refinableCandidates.filter((candidate) => requestableTargetIds.has(normalizeText(candidate && candidate.targetId)));
    const refinementClaim = await settlementProgressRepository.claimRefinementAttempt(articleId, requestableCandidates);
    const claimedTargetIds = new Set(refinementClaim.claimedTargetIds);
    const claimedCandidates = requestableCandidates.filter((candidate) => claimedTargetIds.has(normalizeText(candidate && candidate.targetId)));
    if (!claimedCandidates.length) {
      showToast('这些候选已在另一窗口精简或已有精简记录。', 'info');
      return { requested: 0, updated: 0, rejected: 0, missing: 0 };
    }
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
    });
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
      await refreshSettlementProgressBadge(currentIdentity);
      throw formatGeminiModelError(apiError);
    }
    const result = response && response.result ? response.result : response;
    const stats = applySettlementMeaningRefinementResult(claimedCandidates, result);
    try {
      await settlementProgressRepository.recordRefinement(articleId, claimedCandidates, {
        claimToken: refinementClaim.claimToken,
      });
    } catch (progressError) {
      await refreshSettlementProgressBadge(currentIdentity);
      throw new Error(`AI 已返回精简释义，但持久化失败；为避免重复请求，本次不会自动重试。${progressError && progressError.message ? ` ${progressError.message}` : ''}`);
    }
    claimedCandidates.forEach((candidate) => {
      candidate.refinement_status = 'completed';
    });
    await refreshSettlementProgressBadge(currentIdentity);
    showToast(`AI 精简释义：更新 ${stats.updated} 个${stats.rejected ? `，丢弃过长 ${stats.rejected} 个` : ''}`, 'success');
    return stats;
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
        showError('VOCABULARY_SETTLEMENT_PROGRESS', `SRS 已写入，但整理印记保存失败：${progressError && progressError.message ? progressError.message : '未知错误'}`);
      }
      settlementCache = null;
      await refreshSettlementProgressBadge(actionIdentity.currentIdentity);
      showToast(`后台整理完成：新增 ${result.added} 个，追加语境 ${result.existingContextAdded + result.knownContextAdded} 个，重新学习 ${result.relearned || 0} 个。`, 'success');
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
        skippedTargetIds: selection.removedTargetIds,
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
      settlementCache = null;
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
    await settlementProgressRepository.setCandidateRemoved(
      articleId,
      options.targetId,
      options.removed
    );
    await refreshSettlementProgressBadge(currentIdentity);
    return true;
  }

  if (previewButton) previewButton.addEventListener('click', scanPreview);
  if (togglePreviewButton) togglePreviewButton.addEventListener('click', togglePreviewWords);
  if (settleButton) settleButton.addEventListener('click', openSettlement);
  refreshAvailability();

  return {
    scanPreview,
    runPreviewExplanation,
    togglePreviewWords,
    openSettlement,
    applySettlement,
    refreshAvailability,
    getStatusSnapshot() {
      return {
        previewVisible,
        previewScanning: !!previewScanInFlight,
        latestPreviewSummary: latestPreviewScan && latestPreviewScan.summary || null,
      };
    },
    dispose() {
      previewScanRequestId += 1;
      previewScanInFlight = null;
      previewScanInFlightIdentityKey = '';
      previewDialog.dispose();
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
