import {
  ARTICLE_SRS_SETTLEMENT_GROUPS,
  VOCABULARY_ENTRY_TYPES,
  getSettlementMeaningRefinementCandidates,
  isSettlementSimpleMeaningReady,
  isSettlementMeaningReadyForApplication,
  assertArticleSrsSettlementMeaningsReady,
  selectArticleSrsSettlementCandidates,
} from '../../services/vocabulary/index.js';
import { createDialogController } from '../../services/runtime/dialog-controller.js';
import { applyNativeControlStyles } from '../../lib/native-control-styles.js';
import { createAriaAmericanPronunciationService } from '../../services/pronunciation/aria-american-pronunciation.js';
import { getSettlementOverview } from './settlement-overview.js';
import { getSettlementMeaningView } from './settlement-meanings.js';
import { getSettlementKeyboardAction, resolveSettlementActiveTarget } from './settlement-keyboard.js';

const SETTLEMENT_DIALOG_MIN_WIDTH = 420;
const SETTLEMENT_DIALOG_MIN_HEIGHT = 420;
const SETTLEMENT_DIALOG_MAX_WIDTH = 1280;
const SETTLEMENT_DIALOG_MAX_HEIGHT = 860;
const SETTLEMENT_DIALOG_EDGE_GAP = 8;
const SETTLEMENT_ADD_LABEL = '加入生词本';

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function createElement(documentObject, tagName, className, textContent) {
  const element = documentObject.createElement(tagName);
  if (className) element.className = className;
  if (textContent != null) element.textContent = textContent;
  return element;
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

function renderSettlementList(documentObject, container, candidates, removedIds, onRelearn, onSpeak, speakingTargetId, selectionBlocked, onRemove) {
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
      applyNativeControlStyles(row, { owner: 'learning', variant: 'floating', size: 'reader' });
      row.dataset.targetId = targetId;
      row.dataset.removed = removedIds.has(targetId) ? 'true' : 'false';
      row.dataset.speaking = String(speakingTargetId === targetId);
      const main = createElement(documentObject, 'div', 'vocabulary-preview-dialog__item-main vocabulary-preview-dialog__entry-grid');
      const line = createElement(documentObject, 'span', 'vocabulary-preview-dialog__item-line vocabulary-preview-dialog__entry-identity');
      const spokenText = normalizeText(candidate.markedText || candidate.lemma);
      const speakerButton = createElement(documentObject, 'button', 'vocabulary-preview-dialog__speaker');
      speakerButton.type = 'button';
      speakerButton.setAttribute('data-ui-owner', 'learning');
      speakerButton.title = `使用 Microsoft Aria Natural 发音朗读 ${spokenText}`;
      speakerButton.setAttribute('aria-label', speakerButton.title);
      speakerButton.setAttribute('aria-pressed', speakingTargetId === targetId ? 'true' : 'false');
      speakerButton.dataset.playing = speakingTargetId === targetId ? 'true' : 'false';
      const arrow = createElement(documentObject, 'span', '', '›');
      arrow.setAttribute('aria-hidden', 'true');
      speakerButton.appendChild(arrow);
      speakerButton.addEventListener('click', () => onSpeak(candidate));
      line.append(createElement(documentObject, 'strong', '', candidate.markedText || candidate.lemma));
      const participation = candidate.application_status === 'applied' ? '已加入'
        : candidate.application_status === 'skipped' ? '已跳过'
        : candidate.application_processing ? '后台处理中' : '';
      if (participation) line.append(createElement(documentObject, 'span', 'vocabulary-preview-dialog__participation', participation));
      const view = getSettlementMeaningView(candidate);
      const comparison = createElement(documentObject, 'div', 'vocabulary-preview-dialog__meaning-comparison');
      comparison.dataset.meaningState = view.state;
      const simplified = createElement(documentObject, 'div', 'vocabulary-preview-dialog__meaning-column');
      simplified.dataset.meaningRegion = 'simple';
      simplified.tabIndex = -1;
      if (view.simple) simplified.appendChild(createElement(documentObject, 'p', 'vocabulary-preview-dialog__simple-meaning', view.simple));
      if (view.message) simplified.appendChild(createElement(documentObject, 'p', 'vocabulary-preview-dialog__meaning-state', view.message));
      comparison.append(simplified);
      main.tabIndex = 0;
      main.setAttribute('role', 'button');
      main.setAttribute('aria-label', `${spokenText}，${view.simple || view.message}`);
      main.append(comparison, line);
      const actions = createElement(documentObject, 'div', 'vocabulary-preview-dialog__item-actions');
      actions.addEventListener('click', (event) => event.stopPropagation());
      const pronunciationActions = createElement(documentObject, 'div', 'vocabulary-preview-dialog__pronunciation-actions');
      const selectionActions = createElement(documentObject, 'div', 'vocabulary-preview-dialog__selection-actions');
      pronunciationActions.appendChild(speakerButton);
      actions.append(pronunciationActions, selectionActions);
    if (!candidate.application_status && candidate.group === ARTICLE_SRS_SETTLEMENT_GROUPS.NEEDS_EXPLICIT_RELEARN && candidate.eligible === false) {
        const relearnBtn = createElement(documentObject, 'button', 'vocabulary-preview-dialog__mini-button', '重新学习');
        relearnBtn.type = 'button';
        relearnBtn.disabled = selectionBlocked || !!candidate.application_processing;
        relearnBtn.addEventListener('click', () => onRelearn(candidate));
        selectionActions.appendChild(relearnBtn);
      }
      if (!selectionActions.childNodes.length) selectionActions.remove();
      row.append(main, actions);
      if (!candidate.application_status && !candidate.application_processing) {
        const remove = createElement(documentObject, 'button', 'vocabulary-preview-dialog__remove-icon', '×');
        remove.type = 'button';
        remove.setAttribute('data-ui-owner', 'learning');
        remove.title = '移到本篇回收区';
        remove.setAttribute('aria-label', `将 ${spokenText} 移到本篇回收区`);
        remove.disabled = selectionBlocked;
        remove.addEventListener('click', event => { event.stopPropagation(); onRemove(candidate); });
        row.appendChild(remove);
      }
      section.appendChild(row);
    });
    container.appendChild(section);
  });
}

export function createSettlementDialog(options = {}) {
  const documentObject = options.documentObject;
  const dialogController = createDialogController({ documentObject });
  const removalController = createDialogController({ documentObject });
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
  let refineButton = null;
  let skipButton = null;
  let otherActions = null;
  let skipConfirmation = null;
  let skipCountText = null;
  let confirmSkipButton = null;
  let cancelSkipButton = null;
  let pendingSkipCandidates = null;
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
  let selectionPending = false;
  let dialogEpoch = 0;
  let automaticRefinementQueued = false;
  let activeTargetId = '';
  let comparisonOpen = false;
  let comparisonEl = null;
  let comparisonLayout = null;
  let recycleButton = null;
  let showingRecycle = false;
  let removalDialog = null;
  let removalMessage = null;
  let removalCandidate = null;
  let successTimer = null;
  let overviewTimer = null;
  let overviewNoticeExpired = false;

  function currentCandidate() {
    return [...(settlement.candidates || []), ...(settlement.reviewCandidates || [])]
      .find(candidate => normalizeText(candidate.targetId) === activeTargetId);
  }

  function updateCurrentControls() {
    const candidate = currentCandidate();
    if (!recycleButton) return;
    recycleButton.hidden = removedIds.size === 0;
    recycleButton.textContent = showingRecycle ? '返回词汇列表' : `回收区 ${removedIds.size}`;
    renderComparisonPanel(candidate);
  }

  function dismissRemoval() {
    removalCandidate = null;
    if (removalDialog) removalDialog.hidden = true;
    removalController.close();
  }

  function requestRemoval(candidate) {
    if (!candidate || candidate.application_status || candidate.application_processing || busy || selectionPending || settlement.refreshing || settlement.readError) return;
    removalCandidate = candidate;
    removalMessage.textContent = `将“${candidate.markedText || candidate.lemma}”移到本篇回收区？之后仍可放回。`;
    removalDialog.hidden = false;
    removalController.open(removalDialog, { initialFocus: removalDialog.querySelector('button'), onRequestClose: dismissRemoval });
  }

  function renderComparisonPanel(candidate) {
    if (!comparisonEl) return;
    comparisonEl.hidden = !comparisonOpen;
    root.dataset.comparisonOpen = String(comparisonOpen);
    comparisonEl.textContent = '';
    if (!comparisonOpen) return;
    if (!candidate) return;
    const content = createElement(documentObject, 'div', 'vocabulary-preview-dialog__comparison-content');
    const body = createElement(documentObject, 'div', 'vocabulary-preview-dialog__comparison-body');
    body.appendChild(createElement(documentObject, 'h3', '', candidate.markedText || candidate.lemma));
    const view = getSettlementMeaningView(candidate);
    const comparableMeaning = value => normalizeText(value).replace(/[。.!！?？]+$/, '');
    const sameMeaning = !view.usingOriginal && comparableMeaning(view.simple) === comparableMeaning(view.original);
    const regions = view.usingOriginal
      ? [['simple', '/'], ['original', view.original]]
      : sameMeaning ? [['simple', view.simple]]
        : [['simple', view.simple || view.message], ['original', view.original]];
    for (const [region, text] of regions) {
      const column = createElement(documentObject, 'div', 'vocabulary-preview-dialog__meaning-column');
      column.dataset.meaningRegion = region;
      if (view.usingOriginal && region === 'simple') column.dataset.empty = 'true';
      column.tabIndex = -1;
      const displayText = region === 'original' ? text.replace(/[。．.]+\s*$/u, '') : text;
      column.append(createElement(documentObject, 'p', '', displayText));
      body.appendChild(column);
    }
    const divider = createElement(documentObject, 'div', 'vocabulary-preview-dialog__card-divider');
    divider.setAttribute('aria-hidden', 'true');
    body.appendChild(divider);
    content.appendChild(body);
    comparisonEl.appendChild(content);
    const rows = candidateRows();
    const index = rows.findIndex(row => row.dataset.targetId === activeTargetId);
    const navigation = createElement(documentObject, 'div', 'vocabulary-preview-dialog__card-navigation');
    const position = createElement(documentObject, 'span', 'vocabulary-preview-dialog__card-position', `${index + 1} / ${rows.length}`);
    navigation.appendChild(position);
    if (!candidate.application_status && candidate.group === ARTICLE_SRS_SETTLEMENT_GROUPS.NEEDS_EXPLICIT_RELEARN && candidate.eligible === false) {
      const relearn = createElement(documentObject, 'button', '', '重新学习');
      relearn.type = 'button';
      applyNativeControlStyles(relearn, { owner: 'learning', variant: 'floating', size: 'sm' });
      relearn.disabled = busy || selectionPending || !!candidate.application_processing;
      relearn.addEventListener('click', () => markRelearn(candidate));
      navigation.appendChild(relearn);
    }
    comparisonEl.appendChild(navigation);
  }

  function setComparisonOpen(nextOpen) {
    if (nextOpen === comparisonOpen) return;
    if (nextOpen && getViewportSize().width >= 960) {
      const rect = root.getBoundingClientRect();
      comparisonLayout = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      const width = Math.min(rect.width + 340, getViewportSize().width - 32);
      setDialogLayout(Math.max(16, Math.min(rect.left - (width - rect.width) / 2, getViewportSize().width - width - 16)), rect.top, width, rect.height);
    } else if (!nextOpen && comparisonLayout) {
      const { left, top, width, height } = comparisonLayout;
      setDialogLayout(left, top, width, height);
      comparisonLayout = null;
    }
    comparisonOpen = nextOpen;
  }

  function clearSuccessTimer() {
    if (successTimer !== null) clearTimeout(successTimer);
    successTimer = null;
  }

  function expireSuccessNotice() {
    clearSuccessTimer();
    if (!statusOverride || statusOverride.state === 'working' || statusOverride.state === 'error') return;
    const notice = statusOverride;
    const epoch = dialogEpoch;
    successTimer = setTimeout(() => {
      successTimer = null;
      if (dialogEpoch !== epoch || statusOverride !== notice || root?.hidden) return;
      notice.expired = true;
      statusEl.dataset.noticeExpired = 'true';
      statusEl.dataset.state = 'idle';
      const message = statusEl.querySelector('.vocabulary-preview-dialog__status-message');
      if (message) { message.style.visibility = 'hidden'; message.setAttribute('aria-hidden', 'true'); }
    }, 3000);
  }

  function startOverviewNoticeTimer() {
    if (overviewTimer !== null) clearTimeout(overviewTimer);
    overviewNoticeExpired = false;
    overviewTimer = setTimeout(() => {
      overviewTimer = null;
      overviewNoticeExpired = true;
      const classification = statusEl?.querySelector('.vocabulary-preview-dialog__classification');
      if (classification) { classification.style.visibility = 'hidden'; classification.setAttribute('aria-hidden', 'true'); }
      if (statusOverride || root?.hidden || settlement.loading || settlement.readError) return;
      statusEl.dataset.noticeExpired = 'true';
      statusEl.dataset.state = 'idle';
      const message = statusEl.querySelector('.vocabulary-preview-dialog__status-message');
      if (message) { message.style.visibility = 'hidden'; message.setAttribute('aria-hidden', 'true'); }
    }, 3000);
  }

  function candidateRows() {
    return listEl ? [...listEl.querySelectorAll('.vocabulary-preview-dialog__item')] : [];
  }

  function activateRow(row, moveFocus = false) {
    if (!row) { activeTargetId = ''; updateCurrentControls(); return; }
    activeTargetId = row.dataset.targetId;
    candidateRows().forEach(item => {
      const active = item === row;
      item.dataset.active = String(active);
      item.classList.toggle('active', active);
      item.querySelector('.vocabulary-preview-dialog__item-main')?.setAttribute('aria-current', String(active));
    });
    updateCurrentControls();
    if (moveFocus) {
      if (windowObject.getComputedStyle?.(listEl).visibility === 'hidden') {
        comparisonEl?.focus({ preventScroll: true });
      } else {
        row.querySelector('.vocabulary-preview-dialog__item-main')?.focus({ preventScroll: true });
        row.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  function handleCandidateKeydown(event) {
    if (!root || root.hidden) return;
    const action = getSettlementKeyboardAction(event, {
      isTopmost: dialogController.isTopmost(),
      inList: listEl?.contains(event.target) || comparisonEl?.contains(event.target),
      confirmingSkip: !!pendingSkipCandidates,
      recording: !!documentObject.querySelector('.is-hotkey-waiting'),
    });
    if (!action) return;
    const rows = candidateRows();
    const row = resolveSettlementActiveTarget(rows, activeTargetId);
    if (!row) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (action === 'previous' || action === 'next') {
      const index = rows.indexOf(row);
      const next = index + (action === 'next' ? 1 : -1);
      if (next < 0 || next >= rows.length) {
        setStatus(next < 0 ? '已到第一个目标。' : '已到最后一个目标。');
      } else {
        activateRow(rows[next], true);
        void speakCandidate(currentCandidate());
      }
      return;
    }
    const candidate = currentCandidate();
    if (action === 'speak') { void speakCandidate(candidate); return; }
    if (action === 'remove') { requestRemoval(candidate); return; }
    if (action === 'meaning') {
      const nextRegion = documentObject.activeElement?.dataset.meaningRegion === 'original' ? 'simple' : 'original';
      if (!comparisonOpen) { setComparisonOpen(true); render(); }
      const region = comparisonEl?.querySelector(`[data-meaning-region="${nextRegion}"]`);
      region?.focus({ preventScroll: true });
      region?.scrollIntoView({ block: 'nearest' });
    }
  }

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
    root.dataset.uiTheme = 'light';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', '整理本篇生词');

    const header = createElement(documentObject, 'div', 'vocabulary-preview-dialog__header');
    const titleWrap = createElement(documentObject, 'div', 'vocabulary-preview-dialog__title-wrap');
    titleWrap.append(createElement(documentObject, 'h2', 'vocabulary-preview-dialog__title', '整理本篇生词'));
    closeButton = createElement(documentObject, 'button', 'vocabulary-preview-dialog__close', '×');
    closeButton.type = 'button';
    applyNativeControlStyles(closeButton, { owner: 'learning', variant: 'ghost', size: 'icon' });
    header.append(titleWrap, closeButton);
    statusEl = createElement(documentObject, 'div', 'vocabulary-preview-dialog__status');
    statusEl.setAttribute('role', 'status');
    statusEl.setAttribute('aria-live', 'polite');
    statusEl.setAttribute('aria-atomic', 'true');
    listEl = createElement(documentObject, 'div', 'vocabulary-preview-dialog__list');
    listEl.addEventListener('focusin', event => activateRow(event.target.closest('.vocabulary-preview-dialog__item')));
    listEl.addEventListener('click', event => {
      const row = event.target.closest('.vocabulary-preview-dialog__item');
      if (row && !event.target.closest('button')) {
        activateRow(row, true);
        void speakCandidate(currentCandidate());
      }
    });
    documentObject.addEventListener('keydown', handleCandidateKeydown, true);
    const footer = createElement(documentObject, 'div', 'vocabulary-preview-dialog__footer');
    refineButton = createElement(documentObject, 'button', 'vocabulary-preview-dialog__button', 'AI 精简释义');
    refineButton.type = 'button';
    applyNativeControlStyles(refineButton, { owner: 'learning', variant: 'outline', size: 'default' });
    skipButton = createElement(documentObject, 'button', 'vocabulary-preview-dialog__button', '跳过本篇剩余候选');
    skipButton.type = 'button';
    applyNativeControlStyles(skipButton, { owner: 'learning', variant: 'outline', size: 'default' });
    addAllButton = createElement(documentObject, 'button', 'vocabulary-preview-dialog__button', SETTLEMENT_ADD_LABEL);
    addAllButton.type = 'button';
    applyNativeControlStyles(addAllButton, { owner: 'learning', variant: 'default', size: 'default' });
    const resizeHandle = createElement(documentObject, 'div', 'vocabulary-preview-dialog__resize-handle');
    resizeHandle.setAttribute('aria-hidden', 'true');
    const primaryActions = createElement(documentObject, 'div', 'vocabulary-preview-dialog__primary-actions');
    primaryActions.append(refineButton, addAllButton);
    otherActions = createElement(documentObject, 'details', 'vocabulary-preview-dialog__other-actions');
    const otherSummary = createElement(documentObject, 'summary', '', '其他操作');
    otherSummary.tabIndex = 0;
    otherActions.append(otherSummary, skipButton);
    skipConfirmation = createElement(documentObject, 'div', 'vocabulary-preview-dialog__skip-confirmation');
    skipConfirmation.hidden = true;
    skipCountText = createElement(documentObject, 'p');
    confirmSkipButton = createElement(documentObject, 'button', 'vocabulary-preview-dialog__button', '确认跳过');
    confirmSkipButton.type = 'button';
    cancelSkipButton = createElement(documentObject, 'button', 'vocabulary-preview-dialog__button', '取消');
    cancelSkipButton.type = 'button';
    applyNativeControlStyles(confirmSkipButton, { owner: 'learning', variant: 'outline', size: 'default' });
    applyNativeControlStyles(cancelSkipButton, { owner: 'learning', variant: 'outline', size: 'default' });
    skipConfirmation.append(skipCountText, confirmSkipButton, cancelSkipButton);
    otherActions.append(skipConfirmation);
    otherActions.addEventListener('toggle', () => {
      if (!otherActions.open) pendingSkipCandidates = null;
      render();
    });
    const currentActions = createElement(documentObject, 'div', 'vocabulary-preview-dialog__current-actions');
    recycleButton = createElement(documentObject, 'button', 'vocabulary-preview-dialog__text-action', '回收区');
    recycleButton.type = 'button';
    recycleButton.addEventListener('click', () => { showingRecycle = !showingRecycle; render(); });
    currentActions.append(recycleButton);
    const toolbar = createElement(documentObject, 'div', 'vocabulary-preview-dialog__footer-toolbar');
    toolbar.append(currentActions, primaryActions);
    footer.appendChild(toolbar);
    comparisonEl = createElement(documentObject, 'aside', 'vocabulary-preview-dialog__comparison-panel');
    comparisonEl.id = 'reader-settlement-current-comparison';
    comparisonEl.setAttribute('aria-label', '当前词学习卡片');
    comparisonEl.tabIndex = -1;
    comparisonEl.hidden = true;
    root.append(header, statusEl, listEl, comparisonEl, footer, resizeHandle);
    const keyboardHint = createElement(documentObject, 'p', 'vocabulary-preview-dialog__keyboard-hint', '↑↓ 切词 · → / 2 / R 发音');
    currentActions.prepend(keyboardHint);
    documentObject.body.append(backdrop, root);
    removalDialog = createElement(documentObject, 'section', 'vocabulary-preview-dialog__removal-confirmation');
    removalDialog.hidden = true;
    removalDialog.setAttribute('aria-label', '确认移到本篇回收区');
    removalMessage = createElement(documentObject, 'p');
    const cancelRemoval = createElement(documentObject, 'button', '', '取消');
    const confirmRemoval = createElement(documentObject, 'button', '', '确定删除');
    for (const button of [cancelRemoval, confirmRemoval]) {
      button.type = 'button';
      applyNativeControlStyles(button, { owner: 'learning', variant: 'floating', size: 'sm' });
    }
    cancelRemoval.addEventListener('click', dismissRemoval);
    confirmRemoval.addEventListener('click', () => {
      const candidate = removalCandidate;
      dismissRemoval();
      void toggleRemove(candidate);
    });
    const removalActions = createElement(documentObject, 'div');
    removalActions.append(cancelRemoval, confirmRemoval);
    removalDialog.append(removalMessage, removalActions);
    documentObject.body.appendChild(removalDialog);
    header.addEventListener('pointerdown', startDrag);
    resizeHandle.addEventListener('pointerdown', startResize);
    closeButton.addEventListener('click', close);
    skipButton.addEventListener('click', requestSkip);
    confirmSkipButton.addEventListener('click', skip);
    cancelSkipButton.addEventListener('click', () => {
      pendingSkipCandidates = null;
      render();
      skipButton.focus();
    });
    refineButton.addEventListener('click', refineMeanings);
    addAllButton.addEventListener('click', () => apply());
  }

  function render() {
    const previousScrollTop = listEl?.scrollTop || 0;
    const oldRows = candidateRows();
    const previousIndex = oldRows.findIndex(row => row.dataset.targetId === activeTargetId);
    const focused = documentObject.activeElement;
    const focusedRow = focused?.closest?.('.vocabulary-preview-dialog__item');
    const focusedPart = focusedRow && listEl?.contains(focused) ? (
      focused.dataset.meaningRegion ? `[data-meaning-region="${focused.dataset.meaningRegion}"]`
        : focused.classList.contains('vocabulary-preview-dialog__speaker') ? '.vocabulary-preview-dialog__speaker'
        : focused.classList.contains('vocabulary-preview-dialog__selection-button') ? '.vocabulary-preview-dialog__selection-button'
        : '.vocabulary-preview-dialog__item-main'
    ) : null;
    if (!busy) {
      if (addAllButton) addAllButton.textContent = SETTLEMENT_ADD_LABEL;
      if (refineButton) refineButton.textContent = refinementInFlight ? '精简中…' : '重试精简';
    }
    dialogController.setBusy(busy || selectionPending);
    const summary = settlement.summary || {};
    const overview = getSettlementOverview(settlement);
    const available = (settlement.candidates || []).filter((candidate) => (
      candidate.eligible !== false && !candidate.application_processing && !removedIds.has(normalizeText(candidate.targetId))
    ));
    const unfinished = available.filter((candidate) => !isSettlementSimpleMeaningReady(candidate));
    const missingMeanings = available.filter(candidate => !isSettlementMeaningReadyForApplication(candidate));
    const meaningBlockReason = (items) => items.length
      ? `${items.length} 项暂无精简释义，将使用原释义。` : '';
    if (!busy) {
      if (addAllButton) addAllButton.textContent = SETTLEMENT_ADD_LABEL;
    }
    const blocked = busy || selectionPending || settlement.loading || settlement.refreshing || !!settlement.readError;
    const blockedReason = settlement.loading ? '正在读取解释和整理进度，请稍候'
      : settlement.readError ? '读取失败，请先重新读取'
      : settlement.refreshing ? '正在核对最新进度，可先浏览和发音'
      : selectionPending ? '正在保存本次选择，请稍候'
      : busy ? '当前操作正在处理，请稍候' : '';
    if (statusEl) {
      statusEl.dataset.noticeExpired = String(statusOverride ? statusOverride.expired === true : overviewNoticeExpired && !settlement.loading && !settlement.readError);
      statusEl.hidden = !settlement.loading && !settlement.readError && !(settlement.candidates || []).length && !overview.history;
      if (statusOverride) {
        statusEl.textContent = '';
        const message = createElement(documentObject, 'span', 'vocabulary-preview-dialog__status-message', statusOverride.text);
        if (statusOverride.expired) { message.style.visibility = 'hidden'; message.setAttribute('aria-hidden', 'true'); }
        statusEl.appendChild(message);
        statusEl.dataset.state = statusOverride.expired ? 'idle' : statusOverride.state || '';
      } else {
        const noticeText = [
            ...(settlement.refreshing ? ['正在核对最新进度，可先浏览和发音'] : []),
            ...(unfinished.length ? [meaningBlockReason(unfinished)] : []),
            ...(overview.state === 'loading' || overview.state === 'error' ? [overview.message] : overview.pending ? [`待整理 ${overview.pending} 项`] : []),
            ...(overview.processing ? [`后台处理中 ${overview.processing} 项`] : []),
            ...(overview.state === 'loading' || overview.state === 'error' ? [] : [
              ...(overview.history ? [overview.history] : []),
            ]),
          ].join(' · ');
        statusEl.textContent = '';
        const message = createElement(documentObject, 'span', 'vocabulary-preview-dialog__status-message', noticeText);
        if (overviewNoticeExpired && !settlement.loading && !settlement.readError) { message.style.visibility = 'hidden'; message.setAttribute('aria-hidden', 'true'); }
        statusEl.appendChild(message);
        statusEl.dataset.state = overview.state;
      }
        if (!settlement.loading && !settlement.readError && (settlement.candidates || []).length) {
          const detailText = [
            ...[
              ['可加入单词', available.filter((item) => item.entry_type === VOCABULARY_ENTRY_TYPES.WORD).length],
              ['可加入短语', available.filter((item) => item.entry_type === VOCABULARY_ENTRY_TYPES.PHRASE).length],
              ['重新学习', summary.relearn], ['重点关注', summary.focus], ['需手动重新学习', summary.needsExplicitRelearn],
            ].filter(([, count]) => count > 0).map(([label, count]) => `${label} ${count} 个`),
            ...(overview.filtered ? [`条件不符 ${overview.filtered} 项`] : []),
          ].join(' · ');
          if (detailText) {
            const classification = createElement(documentObject, 'div', 'vocabulary-preview-dialog__classification', detailText);
            if (overviewNoticeExpired) { classification.style.visibility = 'hidden'; classification.setAttribute('aria-hidden', 'true'); }
            statusEl.appendChild(classification);
          }
        }
    }
    renderSettlementList(
      documentObject,
      listEl,
      [...(settlement.candidates || []), ...(settlement.reviewCandidates || [])].filter(candidate => candidate.application_status !== 'skipped' && !removedIds.has(normalizeText(candidate.targetId))),
      removedIds,
      markRelearn,
      speakCandidate,
      speakingTargetId,
      blocked,
      requestRemoval
    );
    if (!removedIds.size) showingRecycle = false;
    if (showingRecycle) {
      listEl.textContent = '';
      listEl.appendChild(createElement(documentObject, 'div', 'vocabulary-preview-dialog__group-heading', '本篇回收区 · 切换文章前可放回，切换后自动清空'));
      (settlement.candidates || []).filter(candidate => removedIds.has(normalizeText(candidate.targetId))).forEach(candidate => {
        const item = createElement(documentObject, 'div', 'vocabulary-preview-dialog__recycle-item');
        const restore = createElement(documentObject, 'button', 'vocabulary-preview-dialog__text-action', '放回');
        restore.type = 'button';
        restore.disabled = blocked;
        restore.addEventListener('click', () => { void toggleRemove(candidate); });
        item.append(createElement(documentObject, 'strong', '', candidate.markedText || candidate.lemma), restore);
        listEl.appendChild(item);
      });
    }
    const activeRow = resolveSettlementActiveTarget(candidateRows(), activeTargetId, previousIndex);
    activateRow(activeRow);
    updateCurrentControls();
    if (focusedPart && dialogController.isTopmost() && !root.hidden) {
      const target = activeRow?.querySelector(focusedPart);
      const focusTarget = target && !target.disabled ? target : activeRow?.querySelector('.vocabulary-preview-dialog__item-main');
      (focusTarget || closeButton)?.focus({ preventScroll: true });
    }
    if (overview.message) {
      listEl.textContent = '';
      if (!settlement.loading && !settlement.readError) {
        listEl.appendChild(createElement(documentObject, 'div', 'vocabulary-preview-dialog__empty', overview.message));
      }
      if (settlement.readError && typeof options.onRetryRead === 'function') {
        const retryButton = createElement(documentObject, 'button', 'vocabulary-preview-dialog__button', '重新读取');
        retryButton.type = 'button';
        retryButton.title = settlement.readError;
        applyNativeControlStyles(retryButton, { owner: 'learning', variant: 'outline', size: 'default' });
        retryButton.addEventListener('click', () => options.onRetryRead());
        listEl.appendChild(retryButton);
      }
    }
    const refinableCount = getSettlementMeaningRefinementCandidates(available).length;
    function setAvailability(button, disabled, reason) {
      if (!button) return;
      button.disabled = disabled;
      button.title = disabled ? reason : '';
    }
    setAvailability(addAllButton, blocked || missingMeanings.length > 0 || available.length <= 0, blockedReason || (missingMeanings.length ? '缺少释义，请补充释义或移到回收区' : '') || '没有本次可加入的候选；请检查选择、重新学习资格或后台处理状态');
    setAvailability(refineButton, blocked || refinementInFlight || typeof onRefineMeanings !== 'function' || refinableCount <= 0, blockedReason || (refinementInFlight ? 'AI精简正在处理' : '没有需要精简的本次候选，或AI服务尚未就绪'));
    setAvailability(skipButton, blocked || !otherActions.open || !(settlement.candidates || []).length || overview.processing > 0, blockedReason || (!otherActions.open ? '展开其他操作后可跳过剩余候选' : overview.processing ? '本篇仍有候选在后台处理，请完成后再操作' : '本篇当前没有可跳过的待处理候选'));
    skipConfirmation.hidden = !pendingSkipCandidates;
    if (pendingSkipCandidates) skipCountText.textContent = `跳过剩余 ${pendingSkipCandidates.length} 项？已加入的内容保留。`;
    setAvailability(confirmSkipButton, blocked || !otherActions.open || !pendingSkipCandidates, blockedReason || '请先核对剩余候选');
    setAvailability(cancelSkipButton, busy || !otherActions.open || !pendingSkipCandidates, busy ? '正在保存跳过结果，请稍候' : '当前没有跳过确认');
    if (listEl) listEl.scrollTop = previousScrollTop;
  }

  function updateSpeakingState(targetId) {
    if (!listEl || typeof listEl.querySelectorAll !== 'function') return;
    listEl.querySelectorAll('.vocabulary-preview-dialog__item').forEach((row) => {
      const active = String(row.dataset.targetId || '') === String(targetId || '');
      const button = row.querySelector('.vocabulary-preview-dialog__speaker');
      if (!button) return;
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.dataset.playing = active ? 'true' : 'false';
      row.dataset.speaking = String(active);
    });
  }

  async function toggleRemove(candidate) {
    if (busy || selectionPending || settlement.refreshing || settlement.readError || candidate?.application_processing || candidate?.application_status) return;
    const targetId = normalizeText(candidate && candidate.targetId);
    if (!targetId) return;
    const epoch = dialogEpoch;
    const nextRemoved = !removedIds.has(targetId);
    if (nextRemoved) removedIds.add(targetId);
    else removedIds.delete(targetId);
    statusOverride = null;
    pendingSkipCandidates = null;
    selectionPending = true;
    render();
    try {
      await onToggleRemove?.({
        articleId: settlement.articleId,
        candidate,
        targetId,
        removed: nextRemoved,
      });
    } catch (error) {
      if (epoch !== dialogEpoch) return;
      if (nextRemoved) removedIds.delete(targetId);
      else removedIds.add(targetId);
      statusOverride = {
        text: error && error.message ? error.message : '保存候选选择失败',
        state: 'error',
      };
    } finally {
      if (epoch === dialogEpoch) {
        selectionPending = false;
        render();
        if (!nextRemoved) void refineMeanings({ automatic: true });
      }
    }
  }

  function markRelearn(candidate) {
    if (!candidate || busy || selectionPending || candidate.application_processing) return;
    pendingSkipCandidates = null;
    candidate.eligible = true;
    candidate.group = ARTICLE_SRS_SETTLEMENT_GROUPS.RELEARN;
    candidate.relearn = true;
    statusOverride = null;
    render();
    void refineMeanings({ automatic: true });
  }

  async function speakCandidate(candidate) {
    const targetId = normalizeText(candidate && candidate.targetId);
    const spokenText = normalizeText(candidate && (candidate.markedText || candidate.lemma));
    if (!targetId || !spokenText) return;
    activateRow(candidateRows().find(row => row.dataset.targetId === targetId));
    const requestId = ++pronunciationRequestId;
    pronunciation.stop();
    speakingTargetId = targetId;
    updateSpeakingState(targetId);
    try {
      await pronunciation.speak(spokenText);
    } catch (error) {
      if (error && error.name !== 'AbortError' && requestId === pronunciationRequestId) {
        setStatus('Microsoft Aria Natural 发音暂不可用。', 'error');
      }
    } finally {
      if (requestId === pronunciationRequestId) {
        speakingTargetId = '';
        updateSpeakingState('');
      }
    }
  }

  function openLoading(message = '正在整理本篇生词…', restoreFocusTarget) {
    clearSuccessTimer();
    setComparisonOpen(false);
    ensureMounted();
    dialogEpoch += 1;
    refinementInFlight = false;
    automaticRefinementQueued = false;
    selectionPending = false;
    busy = false;
    pendingSkipCandidates = null;
    otherActions.open = false;
    pronunciationRequestId += 1;
    pronunciation.stop();
    speakingTargetId = '';
    activeTargetId = '';
    showingRecycle = false;
    settlement = { candidates: [], summary: {}, loading: true };
    removedIds = new Set();
    statusOverride = { text: message, state: 'working' };
    render();
    if (listEl) {
      listEl.textContent = '';
    }
    root.hidden = false;
    backdrop.hidden = false;
    dialogController.open(root, {
      restoreFocusTarget,
      initialFocus: closeButton,
      statusElement: statusEl,
      isPending: () => busy,
      onRequestClose: close,
    });
  }

  function open(nextSettlement, restoreFocusTarget) {
    clearSuccessTimer();
    startOverviewNoticeTimer();
    setComparisonOpen(false);
    ensureMounted();
    dialogEpoch += 1;
    refinementInFlight = false;
    automaticRefinementQueued = false;
    selectionPending = false;
    busy = false;
    pendingSkipCandidates = null;
    otherActions.open = false;
    pronunciationRequestId += 1;
    pronunciation.stop();
    speakingTargetId = '';
    activeTargetId = '';
    showingRecycle = false;
    settlement = { ...(nextSettlement || { candidates: [], summary: {} }), loading: false };
    removedIds = new Set((Array.isArray(settlement.removedTargetIds) ? settlement.removedTargetIds : [])
      .map(normalizeText)
      .filter(Boolean));
    statusOverride = null;
    render();
    root.hidden = false;
    backdrop.hidden = false;
    if (currentCandidate()) {
      setComparisonOpen(true);
      render();
    }
    dialogController.open(root, {
      restoreFocusTarget,
      initialFocus: closeButton,
      statusElement: statusEl,
      isPending: () => busy,
      onRequestClose: close,
    });
    const prefetchTexts = [...(settlement.candidates || []), ...(settlement.reviewCandidates || [])]
      .map((candidate) => normalizeText(candidate && (candidate.markedText || candidate.lemma)))
      .filter(Boolean);
    if (typeof pronunciation.prefetch === 'function' && prefetchTexts.length) {
      void pronunciation.prefetch(prefetchTexts).catch(() => {});
    }
    void refineMeanings({ automatic: true });
  }

  function close() {
    if (overviewTimer !== null) clearTimeout(overviewTimer);
    overviewTimer = null;
    dismissRemoval();
    clearSuccessTimer();
    dialogEpoch += 1;
    refinementInFlight = false;
    automaticRefinementQueued = false;
    selectionPending = false;
    pendingSkipCandidates = null;
    pronunciationRequestId += 1;
    pronunciation.stop();
    speakingTargetId = '';
    if (root) root.hidden = true;
    if (backdrop) backdrop.hidden = true;
    dialogController.close();
    options.onClose?.();
  }

  function setBusy(nextBusy) {
    busy = !!nextBusy;
    dialogController.setBusy(busy);
    if (refineButton) refineButton.textContent = busy ? '精简中...' : 'AI 精简释义';
    render();
  }

  function setStatus(message, state = 'idle') {
    clearSuccessTimer();
    statusOverride = { text: message || '', state };
    // Keep classification rows present so a later comparison render cannot
    // restore them and push the list down after a keyboard boundary notice.
    if (statusEl) render();
    expireSuccessNotice();
  }

  async function refineMeanings({ automatic = false } = {}) {
    if (automatic && refinementInFlight) { automaticRefinementQueued = true; return; }
    if (typeof onRefineMeanings !== 'function' || busy || selectionPending || settlement.refreshing || settlement.readError || refinementInFlight || root?.hidden) return;
    const epoch = dialogEpoch;
    try {
      refinementInFlight = true;
      automaticRefinementQueued = false;
      render();
      const result = await onRefineMeanings({
        automatic,
        articleId: settlement.articleId,
        candidates: settlement.candidates || [],
        removedTargetIds: Array.from(removedIds),
        onProgress: () => { if (epoch === dialogEpoch && !busy) render(); },
      });
      if (epoch !== dialogEpoch) return;
      const updated = result && result.updated || 0;
      const rejected = result && result.rejected || 0;
      if (result?.requested && !busy) statusOverride = {
        text: formatSettlementRefinementStatus({ ...result, updated, rejected }),
        state: rejected || result.missing ? 'error' : 'success',
      };
      expireSuccessNotice();
    } catch (error) {
      if (epoch !== dialogEpoch) return;
      if (!busy) statusOverride = { text: `${error?.message || 'AI 精简失败'} 请重试精简或将未完成项移出本次后再加入。`, state: 'error' };
    } finally {
      if (epoch === dialogEpoch) {
        refinementInFlight = false;
        expireSuccessNotice();
        render();
        if (automaticRefinementQueued) void refineMeanings({ automatic: true });
      }
    }
  }

  async function apply() {
    const mode = 'all';
    if (typeof onApply !== 'function') return;
    if (busy || selectionPending || settlement.refreshing || settlement.readError) return;
    try {
      assertArticleSrsSettlementMeaningsReady(selectArticleSrsSettlementCandidates({
        candidates: settlement.candidates,
        mode,
        removedTargetIds: Array.from(removedIds),
      }).selectedCandidates);
    } catch (error) {
      setStatus(error.message, 'error');
      return;
    }
    const epoch = dialogEpoch;
    busy = true;
    setStatus('正在加入生词本，请稍候…', 'working');
    if (addAllButton) addAllButton.textContent = '加入中…';
    addAllButton.disabled = true;
    if (refineButton) refineButton.disabled = true;
    try {
      const result = await onApply({
        articleId: settlement.articleId,
        mode,
        candidates: structuredClone(settlement.candidates || []),
        removedTargetIds: Array.from(removedIds),
      });
      if (epoch !== dialogEpoch) return;
      if (result) close();
      else setStatus('本次没有完成加入，请稍后重试。', 'error');
    } catch (error) {
      if (epoch !== dialogEpoch) return;
      setStatus(error && error.message ? error.message : '加入失败，请稍后重试。', 'error');
    } finally {
      if (epoch === dialogEpoch) {
        busy = false;
        if (addAllButton) addAllButton.textContent = SETTLEMENT_ADD_LABEL;
        render();
      }
    }
  }

  function requestSkip() {
    if (busy || selectionPending || skipButton.disabled) return;
    pendingSkipCandidates = [...(settlement.candidates || [])];
    render();
    cancelSkipButton.focus();
  }

  async function skip() {
    if (typeof onSkip !== 'function') {
      close();
      return;
    }
    if (busy || selectionPending || !pendingSkipCandidates) return;
    const epoch = dialogEpoch;
    const candidates = pendingSkipCandidates;
    busy = true;
    render();
    try {
      const result = await onSkip({
        articleId: settlement.articleId,
        candidates,
      });
      if (epoch !== dialogEpoch) return;
      if (result) close();
      else setStatus('未能跳过，请重试。', 'error');
    } catch (error) {
      if (epoch !== dialogEpoch) return;
      setStatus(error && error.message ? error.message : '未能跳过，请重试。', 'error');
    } finally {
      if (epoch === dialogEpoch) {
        busy = false;
        render();
      }
    }
  }

  return {
    open,
    openLoading,
    getSnapshot() {
      return { ...settlement, removedTargetIds: Array.from(removedIds) };
    },
    refresh() { if (root && !root.hidden) render(); },
    openError(message) {
      settlement = { candidates: [], summary: {}, readError: message };
      removedIds = new Set();
      statusOverride = null;
      render();
    },
    update(nextSettlement) {
      if (!root || root.hidden) return;
      settlement = { ...nextSettlement, loading: false };
      removedIds = new Set(settlement.removedTargetIds || []);
      statusOverride = null;
      render();
      if (!settlement.refreshing && !settlement.readError) void refineMeanings({ automatic: true });
    },
    close,
    setStatus,
    setSpeakingState: updateSpeakingState,
    dispose() {
      close();
      documentObject.removeEventListener('keydown', handleCandidateKeydown, true);
      dialogController.dispose();
      removalController.dispose();
    },
  };
}

