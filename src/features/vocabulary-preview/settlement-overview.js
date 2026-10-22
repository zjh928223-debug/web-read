// Presentation only: target counts do not imply newly created words or learning events.
export function getSettlementOverview(settlement = {}) {
  const candidates = Array.isArray(settlement.candidates) ? settlement.candidates : [];
  const excluded = Array.isArray(settlement.excluded) ? settlement.excluded : [];
  const summary = settlement.summary || {};
  const progress = settlement.progress || {};
  const ids = (values) => (Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean);
  const applied = new Set([
    ...ids(progress.applied_target_ids),
    ...excluded.filter((item) => item.reason === 'already_added_current_article').map((item) => item.targetId).filter(Boolean),
  ]);
  const skipped = new Set(ids(progress.skipped_target_ids).filter((id) => !applied.has(id)));
  const legacyProcessed = Math.max(0, Number(summary.processed || 0) - applied.size - skipped.size);
  const processing = candidates.filter((item) => item.application_processing).length;
  const generated = Number.isFinite(settlement.generatedItemCount)
    ? settlement.generatedItemCount : candidates.length + excluded.length;
  const filtered = excluded.filter((item) => item.reason !== 'already_added_current_article').length;
  const history = [
    ...(applied.size ? [`已加入 ${applied.size} 项`] : []),
    ...(skipped.size ? [`已跳过 ${skipped.size} 项`] : []),
    ...(legacyProcessed ? [`另有已处理旧记录 ${legacyProcessed} 项（未区分加入或跳过）`] : []),
  ].join(' · ');
  let state = 'ready';
  let message = '';
  if (settlement.loading) {
    state = 'loading';
    message = '正在读取…';
  } else if (settlement.readError) {
    state = 'error';
    message = '读取失败，请重试。';
  } else if (!candidates.length) {
    if (applied.size || skipped.size || legacyProcessed) {
      state = 'processed';
      message = '本篇暂无待整理的生词。';
    } else if (!generated) {
      state = 'unexplained';
      message = '还没有词汇解释。';
    } else {
      state = 'filtered';
      message = '暂无符合条件的生词。';
    }
  }
  return { state, message, history, filtered, processing, pending: candidates.length - processing };
}
