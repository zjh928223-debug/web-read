const SKILL_LABELS = Object.freeze({
  'pos.noun': '名词',
  'pos.verb': '动词',
  'pos.adjective': '形容词',
  'pos.adverb': '副词',
  'morphology.inflection': '词形变化',
  'morphology.derivation': '派生词',
  'morphology.irregular': '不规则变化',
  'sense.primary': '主要词义',
  'sense.secondary': '次要词义',
  'usage.collocation': '搭配',
  'usage.context_transfer': '语境迁移',
});

const PRESENTATION_LABELS = Object.freeze({
  word_only: '只看单词',
  minimal_sentence: '简短真实句',
  original_context: '原文语境',
  definition_first: '释义优先',
  audio_first: '听音优先',
});

const REASON_LABELS = Object.freeze({
  DUE_REVIEW_PRIORITY: '正式到期优先级仍然有效',
  RELEARNING_PRIORITY: '需要重新巩固，保持较高优先级',
  PREFERENCE_WEIGHT_BOUNDED: '喜好只做小幅调整，不会覆盖学习需要',
  WEAK_SKILL_COVERAGE_UNMET: '薄弱项证据不足，暂不强行调整',
  PRESENTATION_DEFAULT_USED: '展示形式使用稳定默认值',
  PRESENTATION_PREFERENCE_USED: '展示形式参考了你的使用反馈',
  PRESENTATION_FALLBACK_USED: '首选内容不可用，已回退到可用形式',
});

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function number(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function percent(value) {
  return `${Math.round(number(value) * 100)}%`;
}

function labelForUnit(id, snapshot) {
  return object(snapshot.unit_labels)[id] || id;
}

function skillLabel(id) {
  return SKILL_LABELS[id] || id;
}

function presentationLabel(id) {
  return PRESENTATION_LABELS[id] || id || '未记录';
}

function explainReason(code) {
  if (typeof code !== 'string') return '模型提供了一条可解释信号';
  if (code.startsWith('WEAK_SKILL_COVERAGE:')) {
    return `覆盖薄弱项：${skillLabel(code.split(':').slice(1).join(':'))}`;
  }
  return REASON_LABELS[code] || code.replaceAll('_', ' ').toLowerCase();
}

function evidenceState(estimate) {
  const count = number(estimate.eligible_evidence_count);
  const mastery = number(estimate.mastery_mean, 0.5);
  const uncertainty = number(estimate.uncertainty, 1);
  if (count < 3 || uncertainty > 0.75) return { label: '证据不足', tone: 'quiet' };
  if (mastery < 0.56) return { label: '需要更多练习', tone: 'attention' };
  return { label: '继续巩固', tone: 'steady' };
}

function buildSkillRows(snapshot) {
  return array(object(snapshot.skill_profile).estimates)
    .map((estimate) => ({
      id: estimate.skill_id,
      label: skillLabel(estimate.skill_id),
      evidenceCount: number(estimate.eligible_evidence_count),
      mastery: number(estimate.mastery_mean, 0.5),
      masteryLabel: percent(estimate.mastery_mean),
      uncertainty: number(estimate.uncertainty, 1),
      uncertaintyLabel: percent(estimate.uncertainty),
      state: evidenceState(estimate),
    }))
    .sort((left, right) => left.mastery - right.mastery || left.label.localeCompare(right.label, 'zh-CN'));
}

function buildPreferenceRows(snapshot) {
  return array(object(snapshot.presentation_preference).estimates)
    .map((estimate) => ({
      id: estimate.variant_id,
      label: presentationLabel(estimate.variant_id),
      score: number(estimate.preference_score),
      scoreLabel: `${number(estimate.preference_score) >= 0 ? '+' : ''}${number(estimate.preference_score).toFixed(2)}`,
      sampleCount: number(estimate.sample_count),
      uncertainty: number(estimate.uncertainty, 1),
      confidence: Math.max(0, Math.min(1, 1 - number(estimate.uncertainty, 1))),
      state: number(estimate.sample_count) < 3 ? '证据不足' : '可供参考',
    }))
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label, 'zh-CN'));
}

function buildQueueRows(report, kind) {
  const comparison = object(report.comparison);
  const snapshot = object(report.model_snapshot);
  const ids = kind === 'official'
    ? array(comparison.baseline_learning_unit_ids)
    : array(comparison.shadow_learning_unit_ids);
  const otherIds = kind === 'official'
    ? array(comparison.shadow_learning_unit_ids)
    : array(comparison.baseline_learning_unit_ids);
  const otherPositions = new Map(otherIds.map((id, index) => [id, index]));
  const decisions = new Map(array(object(report.shadow_plan).decisions)
    .map((decision) => [decision.learning_unit_id, decision]));
  return ids.map((id, index) => {
    const otherPosition = otherPositions.has(id) ? otherPositions.get(id) : null;
    const delta = otherPosition === null ? null : index - otherPosition;
    return {
      id,
      position: index + 1,
      label: labelForUnit(id, snapshot),
      otherPosition: otherPosition === null ? null : otherPosition + 1,
      moved: otherPosition !== index,
      direction: delta === 0 ? 'same' : delta > 0 ? 'up' : 'down',
      delta: delta === null ? null : Math.abs(delta),
      decision: decisions.get(id) || null,
    };
  });
}

export function buildPersonalizationShadowReportView(report) {
  const source = object(report);
  const snapshot = object(source.model_snapshot);
  const officialRows = buildQueueRows(source, 'official');
  const shadowRows = buildQueueRows(source, 'shadow');
  const shadowById = new Map(shadowRows.map((row) => [row.id, row]));
  const officialById = new Map(officialRows.map((row) => [row.id, row]));
  const connectors = officialRows
    .filter((row) => shadowById.has(row.id))
    .map((row) => ({
      id: row.id,
      from: row.position,
      to: shadowById.get(row.id).position,
      moved: row.moved,
    }));
  const defaultSelectedId = shadowRows.find((row) => row.moved)?.id || shadowRows[0]?.id || null;
  const decisions = Object.fromEntries(shadowRows.map((row) => {
    const official = officialById.get(row.id);
    const decision = object(row.decision);
    const recentPresentation = object(snapshot.recent_presentations)[row.id];
    return [row.id, {
      id: row.id,
      label: row.label,
      officialPosition: official?.position ?? null,
      shadowPosition: row.position,
      moved: row.moved,
      positionChange: official && official.position !== row.position
        ? `从第 ${official.position} 位调整到第 ${row.position} 位`
        : '位置保持不变',
      presentationFrom: presentationLabel(recentPresentation),
      presentationTo: presentationLabel(decision.selected_presentation),
      reasons: array(decision.reasons).map(explainReason),
      coveredSkills: array(decision.covered_weak_skills).map(skillLabel),
      score: Number.isFinite(decision.score) ? decision.score.toFixed(3) : '—',
    }];
  }));
  const sourceEventCount = number(source.source_event_count);
  const skillRows = buildSkillRows(snapshot);
  const preferenceRows = buildPreferenceRows(snapshot);
  const insufficient = sourceEventCount === 0
    || (skillRows.length > 0 && skillRows.every((row) => row.state.tone === 'quiet'));
  return {
    id: source.session_id,
    generatedAt: source.generated_at,
    generatedAtLabel: source.generated_at
      ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(source.generated_at))
      : '时间未知',
    sourceEventCount,
    sameOrder: object(source.comparison).same_order === true,
    insufficient,
    officialRows,
    shadowRows,
    connectors,
    decisions,
    defaultSelectedId,
    skillRows,
    preferenceRows,
    diagnostics: object(source.diagnostics),
  };
}

export function buildPersonalizationShadowDiagnostics(reports) {
  const sessions = array(reports)
    .map(buildPersonalizationShadowReportView)
    .sort((left, right) => String(right.generatedAt).localeCompare(String(left.generatedAt)));
  return {
    sessions,
    summary: {
      total: sessions.length,
      sameOrder: sessions.filter((session) => session.sameOrder && !session.insufficient).length,
      changed: sessions.filter((session) => !session.sameOrder && !session.insufficient).length,
      insufficient: sessions.filter((session) => session.insufficient).length,
    },
  };
}

