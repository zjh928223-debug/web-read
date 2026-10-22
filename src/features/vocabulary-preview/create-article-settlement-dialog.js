import { ARTICLE_SRS_SETTLEMENT_GROUPS, VOCABULARY_ENTRY_TYPES, getSettlementMeaningRefinementCandidates } from '../../services/vocabulary/index.js';
import { createDialogController } from '../../services/runtime/dialog-controller.js';
import { applyNativeControlStyles } from '../../lib/native-control-styles.js';
import { createAriaAmericanPronunciationService } from '../../services/pronunciation/aria-american-pronunciation.js';
import { getSettlementOverview } from './settlement-overview.js';
import { getSettlementMeaningView } from './settlement-meanings.js';
import { getSettlementKeyboardAction, resolveSettlementActiveTarget } from './settlement-keyboard.js';

const SETTLEMENT_DIALOG_MIN_WIDTH = 420;
const SETTLEMENT_DIALOG_MIN_HEIGHT = 420;
const SETTLEMENT_DIALOG_MAX_WIDTH = 980;
const SETTLEMENT_DIALOG_MAX_HEIGHT = 860;
const SETTLEMENT_DIALOG_EDGE_GAP = 8;

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
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

function getSettlementEntryKindLabel(candidate) {
  return candidate && candidate.entry_type === VOCABULARY_ENTRY_TYPES.PHRASE ? 'phr' : 'w';
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

function renderSettlementList(documentObject, container, candidates, removedIds, onRemove, onRelearn, onSpeak, speakingTargetId, expandedMeaningIds, selectionBlocked) {
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
      speakerButton.appendChild(createElement(documentObject, 'span', '', '发音'));
      speakerButton.addEventListener('click', () => onSpeak(candidate));
      line.append(
        createElement(documentObject, 'strong', '', candidate.markedText || candidate.lemma),
        createElement(documentObject, 'span', 'vocabulary-preview-dialog__item-meta', getSettlementEntryKindLabel(candidate))
      );
      const participation = removedIds.has(targetId) ? '未参与本次'
        : candidate.application_processing ? '后台处理中'
        : candidate.eligible === false ? '待重新学习' : '参与本次';
      line.append(createElement(documentObject, 'span', 'vocabulary-preview-dialog__participation', participation));
      const view = getSettlementMeaningView(candidate);
      row.dataset.hasMeaning = view.expandable ? 'true' : 'false';
      const comparison = createElement(documentObject, 'div', 'vocabulary-preview-dialog__meaning-comparison');
      comparison.dataset.meaningState = view.state;
      const original = createElement(documentObject, 'div', 'vocabulary-preview-dialog__meaning-column');
      const meaning = createElement(documentObject, 'p', 'vocabulary-preview-dialog__original-meaning', view.original || '暂无原解释');
      original.append(createElement(documentObject, 'span', 'vocabulary-preview-dialog__meaning-label', '原解释'), meaning);
      const simplified = createElement(documentObject, 'div', 'vocabulary-preview-dialog__meaning-column');
      original.dataset.meaningRegion = 'original';
      simplified.dataset.meaningRegion = 'simple';
      original.tabIndex = -1;
      simplified.tabIndex = -1;
      simplified.appendChild(createElement(documentObject, 'span', 'vocabulary-preview-dialog__meaning-label', '精简义'));
      if (view.simple) simplified.appendChild(createElement(documentObject, 'p', 'vocabulary-preview-dialog__simple-meaning', view.simple));
      if (view.message) simplified.appendChild(createElement(documentObject, 'p', 'vocabulary-preview-dialog__meaning-state', view.message));
      comparison.append(original, simplified);
      const isMeaningExpanded = view.expandable && expandedMeaningIds.has(targetId);
      row.dataset.expanded = isMeaningExpanded ? 'true' : 'false';
      const expansionHint = createElement(documentObject, 'span', 'vocabulary-preview-dialog__meaning-toggle');
      function updateExpansion() {
        const expanded = expandedMeaningIds.has(targetId);
        meaning.classList.toggle('is-collapsed', view.expandable && !expanded);
        row.dataset.expanded = expanded ? 'true' : 'false';
        main.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        expansionHint.textContent = expanded ? '收起原解释' : '展开原解释';
      }
      function toggleMeaning() {
        if (!view.expandable) return;
        if (!expandedMeaningIds.has(targetId)) expandedMeaningIds.add(targetId);
        else expandedMeaningIds.delete(targetId);
        updateExpansion();
      }
      if (view.expandable) {
        main.setAttribute('role', 'button');
        line.appendChild(expansionHint);
        updateExpansion();
        row.addEventListener('click', (event) => {
          if (event.target && typeof event.target.closest === 'function' && event.target.closest('button')) return;
          toggleMeaning();
        });
        main.addEventListener('keydown', (event) => {
          if (event.target !== main || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          toggleMeaning();
        });
      }
      main.tabIndex = 0;
      main.setAttribute('aria-label', `${spokenText}，浏览解释`);
      main.append(line, comparison);
      const actions = createElement(documentObject, 'div', 'vocabulary-preview-dialog__item-actions');
      actions.addEventListener('click', (event) => event.stopPropagation());
      const pronunciationActions = createElement(documentObject, 'div', 'vocabulary-preview-dialog__pronunciation-actions');
      const selectionActions = createElement(documentObject, 'div', 'vocabulary-preview-dialog__selection-actions');
      pronunciationActions.appendChild(speakerButton);
      actions.append(pronunciationActions, selectionActions);
      if (candidate.group === ARTICLE_SRS_SETTLEMENT_GROUPS.NEEDS_EXPLICIT_RELEARN && candidate.eligible === false) {
        const relearnBtn = createElement(documentObject, 'button', 'vocabulary-preview-dialog__mini-button', '重新学习');
        relearnBtn.type = 'button';
        relearnBtn.disabled = selectionBlocked || !!candidate.application_processing;
        relearnBtn.addEventListener('click', () => onRelearn(candidate));
        selectionActions.appendChild(relearnBtn);
      }
      const removeBtn = createElement(documentObject, 'button', 'vocabulary-preview-dialog__mini-button vocabulary-preview-dialog__selection-button', removedIds.has(targetId) ? '放回本次' : '移出本次');
      removeBtn.type = 'button';
      removeBtn.disabled = selectionBlocked || !!candidate.application_processing;
      removeBtn.title = removedIds.has(targetId) ? '放回本次' : '移出本次';
      removeBtn.setAttribute('aria-label', removedIds.has(targetId) ? '放回本次' : '移出本次');
      removeBtn.addEventListener('click', () => onRemove(candidate));
      selectionActions.appendChild(removeBtn);
      row.append(main, actions);
      section.appendChild(row);
    });
    container.appendChild(section);
  });
}

export function createSettlementDialog(options = {}) {
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
  let expandedMeaningIds = new Set();
  let selectionPending = false;
  let dialogEpoch = 0;
  let automaticRefinementQueued = false;
  let activeTargetId = '';

  function candidateRows() {
    return listEl ? [...listEl.querySelectorAll('.vocabulary-preview-dialog__item')] : [];
  }

  function activateRow(row, moveFocus = false) {
    if (!row) { activeTargetId = ''; return; }
    activeTargetId = row.dataset.targetId;
    candidateRows().forEach(item => {
      const active = item === row;
      item.dataset.active = String(active);
      item.querySelector('.vocabulary-preview-dialog__item-main')?.setAttribute('aria-current', String(active));
    });
    if (moveFocus) {
      row.querySelector('.vocabulary-preview-dialog__item-main')?.focus({ preventScroll: true });
      row.scrollIntoView({ block: 'nearest' });
    }
  }

  function handleCandidateKeydown(event) {
    const action = getSettlementKeyboardAction(event, {
      isTopmost: dialogController.isTopmost(),
      inList: listEl?.contains(event.target),
      confirmingSkip: !!pendingSkipCandidates,
      recording: !!documentObject.querySelector('.is-hotkey-waiting'),
    });
    if (!action) return;
    const rows = candidateRows();
    const row = resolveSettlementActiveTarget(rows, activeTargetId);
    if (!row) return;
    event.preventDefault();
    event.stopPropagation();
    if (action === 'previous' || action === 'next') {
      const index = rows.indexOf(row);
      const next = index + (action === 'next' ? 1 : -1);
      if (next < 0 || next >= rows.length) {
        setStatus(next < 0 ? '已到第一个目标。' : '已到最后一个目标。');
      } else activateRow(rows[next], true);
      return;
    }
    const candidate = (settlement.candidates || []).find(item => normalizeText(item.targetId) === row.dataset.targetId);
    if (action === 'speak') { void speakCandidate(candidate); return; }
    if (action === 'remove') { void toggleRemove(candidate); return; }
    if (action === 'expand') {
      if (row.dataset.hasMeaning === 'true') row.querySelector('.vocabulary-preview-dialog__item-main')?.click();
      return;
    }
    const nextRegion = documentObject.activeElement?.dataset.meaningRegion === 'original' ? 'simple' : 'original';
    const region = row.querySelector(`[data-meaning-region="${nextRegion}"]`);
    region?.focus({ preventScroll: true });
    region?.scrollIntoView({ block: 'nearest' });
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
      if (row) activateRow(row, !event.target.closest('button'));
    });
    root.addEventListener('keydown', handleCandidateKeydown);
    const footer = createElement(documentObject, 'div', 'vocabulary-preview-dialog__footer');
    refineButton = createElement(documentObject, 'button', 'vocabulary-preview-dialog__button', 'AI 精简释义');
    refineButton.type = 'button';
    applyNativeControlStyles(refineButton, { owner: 'learning', variant: 'outline', size: 'default' });
    skipButton = createElement(documentObject, 'button', 'vocabulary-preview-dialog__button', '跳过本篇剩余候选');
    skipButton.type = 'button';
    applyNativeControlStyles(skipButton, { owner: 'learning', variant: 'outline', size: 'default' });
    addWordsButton = createElement(documentObject, 'button', 'vocabulary-preview-dialog__button', '只加入单词');
    addWordsButton.type = 'button';
    applyNativeControlStyles(addWordsButton, { owner: 'learning', variant: 'outline', size: 'default' });
    addAllButton = createElement(documentObject, 'button', 'vocabulary-preview-dialog__button', '加入单词和短语');
    addAllButton.type = 'button';
    applyNativeControlStyles(addAllButton, { owner: 'learning', variant: 'default', size: 'default' });
    const resizeHandle = createElement(documentObject, 'div', 'vocabulary-preview-dialog__resize-handle');
    resizeHandle.setAttribute('aria-hidden', 'true');
    const primaryActions = createElement(documentObject, 'div', 'vocabulary-preview-dialog__primary-actions');
    primaryActions.append(refineButton, addWordsButton, addAllButton);
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
    footer.append(primaryActions, otherActions);
    root.append(header, statusEl, listEl, footer, resizeHandle);
    const keyboardHint = createElement(documentObject, 'p', 'vocabulary-preview-dialog__keyboard-hint', '列表内：↑↓ 浏览 · R 发音/停止 · M 移出/放回 · E 展开 · D 两义浏览');
    footer.prepend(keyboardHint);
    documentObject.body.append(backdrop, root);
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
    addWordsButton.addEventListener('click', () => apply('words'));
    addAllButton.addEventListener('click', () => apply('all'));
  }

  function render() {
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
      if (addAllButton) addAllButton.textContent = '加入单词和短语';
      if (addWordsButton) addWordsButton.textContent = '只加入单词';
      if (refineButton) refineButton.textContent = refinementInFlight ? '精简中…' : '重试精简';
    }
    dialogController.setBusy(busy || selectionPending);
    const summary = settlement.summary || {};
    const overview = getSettlementOverview(settlement);
    const available = (settlement.candidates || []).filter((candidate) => (
      candidate.eligible !== false && !candidate.application_processing && !removedIds.has(normalizeText(candidate.targetId))
    ));
    const usingOriginal = available.some((candidate) =>
      candidate.refinement_attempted && getSettlementMeaningView(candidate).state !== 'ready');
    if (!busy) {
      if (addAllButton) addAllButton.textContent = usingOriginal ? '用原义加入单词和短语' : '加入单词和短语';
      if (addWordsButton) addWordsButton.textContent = usingOriginal ? '用原义只加入单词' : '只加入单词';
    }
    const blocked = busy || selectionPending || settlement.loading || !!settlement.readError;
    const blockedReason = settlement.loading ? '正在读取解释和整理进度，请稍候'
      : settlement.readError ? '读取失败，请先重新读取'
      : selectionPending ? '正在保存本次选择，请稍候'
      : busy ? '当前操作正在处理，请稍候' : '';
    if (statusEl) {
      statusEl.hidden = !settlement.loading && !settlement.readError && !(settlement.candidates || []).length && !overview.history;
      if (statusOverride) {
        statusEl.textContent = statusOverride.text;
        statusEl.dataset.state = statusOverride.state || '';
      } else {
        const wasExpanded = statusEl.querySelector('details')?.open || false;
        statusEl.textContent = [
            ...(overview.state === 'loading' || overview.state === 'error' ? [overview.message] : overview.pending ? [`待整理 ${overview.pending} 项`] : []),
            ...(overview.processing ? [`后台处理中 ${overview.processing} 项`] : []),
            ...(overview.state === 'loading' || overview.state === 'error' ? [] : [
              ...(overview.history ? [overview.history] : []),
            ]),
          ].join(' · ');
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
            const details = createElement(documentObject, 'details');
            details.open = wasExpanded;
            details.append(
              createElement(documentObject, 'summary', '', '查看分类'),
              createElement(documentObject, 'div', '', detailText),
            );
            statusEl.appendChild(details);
          }
        }
        statusEl.dataset.state = overview.state;
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
      expandedMeaningIds,
      blocked
    );
    const activeRow = resolveSettlementActiveTarget(candidateRows(), activeTargetId, previousIndex);
    activateRow(activeRow);
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
    setAvailability(addAllButton, blocked || available.length <= 0, blockedReason || '没有本次可加入的候选；请检查选择、重新学习资格或后台处理状态');
    setAvailability(addWordsButton, blocked || !available.some((item) => item.entry_type === VOCABULARY_ENTRY_TYPES.WORD), blockedReason || '没有本次可加入的单词；短语可用“加入单词和短语”');
    setAvailability(refineButton, blocked || refinementInFlight || typeof onRefineMeanings !== 'function' || refinableCount <= 0, blockedReason || (refinementInFlight ? 'AI精简正在处理' : '没有需要精简的本次候选，或AI服务尚未就绪'));
    setAvailability(skipButton, blocked || !otherActions.open || !(settlement.candidates || []).length || overview.processing > 0, blockedReason || (!otherActions.open ? '展开其他操作后可跳过剩余候选' : overview.processing ? '本篇仍有候选在后台处理，请完成后再操作' : '本篇当前没有可跳过的待处理候选'));
    skipConfirmation.hidden = !pendingSkipCandidates;
    if (pendingSkipCandidates) skipCountText.textContent = `跳过剩余 ${pendingSkipCandidates.length} 项？已加入的内容保留。`;
    setAvailability(confirmSkipButton, blocked || !otherActions.open || !pendingSkipCandidates, blockedReason || '请先核对剩余候选');
    setAvailability(cancelSkipButton, busy || !otherActions.open || !pendingSkipCandidates, busy ? '正在保存跳过结果，请稍候' : '当前没有跳过确认');
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
    if (busy || selectionPending || candidate?.application_processing) return;
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

  function openLoading(message = '正在整理本篇生词…', restoreFocusTarget) {
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
    expandedMeaningIds = new Set();
    activeTargetId = '';
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
    expandedMeaningIds = new Set();
    activeTargetId = '';
    settlement = { ...(nextSettlement || { candidates: [], summary: {} }), loading: false };
    removedIds = new Set((Array.isArray(settlement.removedTargetIds) ? settlement.removedTargetIds : [])
      .map(normalizeText)
      .filter(Boolean));
    statusOverride = null;
    render();
    root.hidden = false;
    backdrop.hidden = false;
    dialogController.open(root, {
      restoreFocusTarget,
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
    void refineMeanings({ automatic: true });
  }

  function close() {
    dialogEpoch += 1;
    refinementInFlight = false;
    automaticRefinementQueued = false;
    selectionPending = false;
    pendingSkipCandidates = null;
    pronunciationRequestId += 1;
    pronunciation.stop();
    speakingTargetId = '';
    expandedMeaningIds = new Set();
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
    statusOverride = { text: message || '', state };
    if (statusEl) {
      statusEl.textContent = statusOverride.text;
      statusEl.dataset.state = state;
    }
  }

  async function refineMeanings({ automatic = false } = {}) {
    if (automatic && refinementInFlight) { automaticRefinementQueued = true; return; }
    if (typeof onRefineMeanings !== 'function' || busy || selectionPending || refinementInFlight || root?.hidden) return;
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
    } catch (error) {
      if (epoch !== dialogEpoch) return;
      if (!busy) statusOverride = { text: `${error?.message || 'AI 精简失败'} 可用原义加入或重试。`, state: 'error' };
    } finally {
      if (epoch === dialogEpoch) {
        refinementInFlight = false;
        render();
        if (automaticRefinementQueued) void refineMeanings({ automatic: true });
      }
    }
  }

  async function apply(mode) {
    if (typeof onApply !== 'function') return;
    if (busy || selectionPending) return;
    const epoch = dialogEpoch;
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
        candidates: (settlement.candidates || []).map((candidate) => {
          const copy = structuredClone(candidate);
          if (getSettlementMeaningView(candidate).state !== 'ready') {
            delete copy.simple_meaning;
            delete copy.simpleMeaning;
            if (copy.context) { delete copy.context.simple_meaning; delete copy.context.simpleMeaning; }
          }
          return copy;
        }),
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
        if (addAllButton) addAllButton.textContent = '加入单词和短语';
        if (addWordsButton) addWordsButton.textContent = '只加入单词';
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
    openError(message) {
      settlement = { candidates: [], summary: {}, readError: message };
      removedIds = new Set();
      statusOverride = null;
      render();
    },
    close,
    setStatus,
    setSpeakingState: updateSpeakingState,
    dispose() {
      close();
      dialogController.dispose();
    },
  };
}

