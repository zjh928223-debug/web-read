import {
  isSettlementMeaningRefinementPendingRetryable,
  isSettlementSimpleMeaningValid,
} from '../../services/vocabulary/settlement-meaning-refinement.js';

function text(value) {
  return typeof value === 'string' ? value : '';
}

export function getSettlementMeaningView(candidate = {}, { refining = false } = {}) {
  const original = text(candidate.meaning || candidate.context?.meaning);
  const simple = text(candidate.simple_meaning || candidate.simpleMeaning
    || candidate.context?.simple_meaning || candidate.context?.simpleMeaning).replace(/\s+/g, ' ').trim();
  const valid = isSettlementSimpleMeaningValid(simple, candidate.entry_type);
  let state = valid ? 'ready' : 'missing';
  let message = valid ? '' : '暂无精简义';
  if (candidate.refinement_save_pending) {
    state = 'unsaved'; message = '待保存，可重试保存';
  } else if (refining || (candidate.refinement_status === 'pending'
    && !isSettlementMeaningRefinementPendingRetryable(candidate))) {
    state = 'pending'; message = '精简中…';
  } else if (candidate.refinement_status === 'pending') {
    state = 'interrupted'; message = '精简中断';
  } else if (candidate.refinement_status === 'failed') {
    state = 'failed'; message = '精简失败';
  } else if (candidate.refinement_error === 'simple_meaning_too_long' || (simple && !valid)) {
    state = 'invalid'; message = '结果过长，未采用';
  } else if (!valid && candidate.refinement_status === 'completed') {
    state = 'missing-result'; message = '未返回精简义';
  }
  return { original, simple: valid ? simple : '', state, message,
    expandable: original.length > 100 || original.includes('\n') };
}
