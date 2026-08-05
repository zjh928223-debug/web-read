const WORDS = ['suspicion', 'plausible', 'consequently', 'expertise', 'disbelief'];

function skillEstimate(skillId, mastery, evidence, uncertainty) {
  return {
    skill_id: skillId,
    mastery_mean: mastery,
    eligible_evidence_count: evidence,
    uncertainty,
    reasons: evidence < 3 ? ['LOW_EVIDENCE'] : [],
  };
}

function preferenceEstimate(variantId, score, samples, uncertainty) {
  return {
    variant_id: variantId,
    preference_score: score,
    sample_count: samples,
    uncertainty,
  };
}

function makeReport(index) {
  const insufficient = index === 11;
  const changed = index <= 3;
  const officialIds = WORDS.map((word) => `unit.${word}`);
  const shadowIds = changed
    ? [officialIds[1], officialIds[0], officialIds[2], officialIds[4], officialIds[3]]
    : [...officialIds];
  const positions = new Map(officialIds.map((id, position) => [id, position]));
  const moved = shadowIds.map((id, shadowPosition) => ({
    learning_unit_id: id,
    baseline_position: positions.get(id),
    shadow_position: shadowPosition,
  })).filter((row) => row.baseline_position !== row.shadow_position);
  return {
    schema_version: 'personalization-shadow-report.v1',
    session_id: `demo-session-${String(index + 1).padStart(2, '0')}`,
    generated_at: new Date(Date.UTC(2026, 7, 5, 3, 40 - index)).toISOString(),
    source_event_count: insufficient ? 0 : 27 + index,
    adapter_version: 'personalization-shadow-adapter.v1',
    skill_estimator_version: 'skill-estimator.beta.v1',
    preference_estimator_version: 'presentation-preference.v1',
    curriculum_planner_version: 'curriculum-planner.v1',
    diagnostics: { skill_evidence_count: insufficient ? 0 : 23, preference_event_count: insufficient ? 0 : 18 },
    comparison: {
      schema_version: 'personalization-shadow-comparison.v1',
      baseline_learning_unit_ids: officialIds,
      shadow_learning_unit_ids: shadowIds,
      same_membership: true,
      same_order: !changed,
      moved,
      baseline_count: officialIds.length,
      shadow_count: shadowIds.length,
    },
    shadow_plan: {
      schema_version: 'curriculum-plan.v1',
      decisions: shadowIds.map((id, position) => ({
        schema_version: 'plan-decision.v1',
        learning_unit_id: id,
        selected_presentation: id.endsWith('plausible') ? 'minimal_sentence' : 'word_only',
        score: 0.83 - position * 0.07,
        covered_weak_skills: id.endsWith('plausible') ? ['pos.adjective'] : [],
        reasons: [
          'DUE_REVIEW_PRIORITY',
          ...(id.endsWith('plausible') ? ['WEAK_SKILL_COVERAGE:pos.adjective'] : []),
          'PREFERENCE_WEIGHT_BOUNDED',
        ],
      })),
    },
    model_snapshot: {
      schema_version: 'personalization-shadow-model-snapshot.v1',
      unit_labels: Object.fromEntries(WORDS.map((word) => [`unit.${word}`, word])),
      recent_presentations: Object.fromEntries(WORDS.map((word) => [`unit.${word}`, 'original_context'])),
      skill_profile: {
        estimates: insufficient ? [] : [
          skillEstimate('pos.adjective', 0.42, 8, 0.31),
          skillEstimate('morphology.inflection', 0.49, 6, 0.38),
          skillEstimate('pos.verb', 0.58, 9, 0.29),
          skillEstimate('pos.noun', 0.69, 11, 0.24),
          skillEstimate('sense.primary', 0.74, 13, 0.21),
        ],
      },
      presentation_preference: {
        estimates: insufficient ? [] : [
          preferenceEstimate('word_only', 0.08, 8, 0.34),
          preferenceEstimate('minimal_sentence', 0.05, 6, 0.39),
          preferenceEstimate('original_context', -0.07, 4, 0.48),
        ],
      },
      presentation_rankings: null,
    },
  };
}

export function createPersonalizationShadowDemoReports() {
  return Array.from({ length: 12 }, (_, index) => makeReport(index));
}
