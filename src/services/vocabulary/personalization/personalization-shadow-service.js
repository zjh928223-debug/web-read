import {
  PREFERENCE_ESTIMATOR_VERSION,
  estimatePresentationPreferences,
} from './preference-estimator.js';
import {
  PRESENTATION_RANKER_VERSION,
  rankPresentations,
} from './presentation-ranker.js';
import {
  SKILL_ESTIMATOR_VERSION,
  estimateSkillsFromLearningEvents,
} from './skill-estimator.js';
import {
  CURRICULUM_PLANNER_VERSION,
} from './curriculum-constraints.js';
import { planCurriculum } from './curriculum-planner.js';
import {
  PERSONALIZATION_SHADOW_ADAPTER_VERSION,
  buildPersonalizationShadowInput,
  compareShadowPlanWithBaseline,
} from './personalization-shadow-adapter.js';
import {
  PERSONALIZATION_SHADOW_REPORT_SCHEMA_VERSION,
  normalizePersonalizationShadowReport,
} from './personalization-shadow-report-repository.js';

export const PERSONALIZATION_SHADOW_SERVICE_VERSION = 'personalization-shadow-service.v1';
export const VOCABULARY_PERSONALIZATION_SHADOW_FEATURE_FLAG =
  'VOCABULARY_PERSONALIZATION_SHADOW_ENABLED';

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fail(code, message, details = {}) {
  const error = new TypeError(message);
  error.name = 'PersonalizationShadowServiceError';
  error.code = code;
  error.details = { ...details };
  throw error;
}

function buildPresentationRankings(candidates, preferenceEstimate) {
  const byLearningUnit = {};
  for (const candidate of candidates) {
    const ranking = rankPresentations({
      allowed_presentations: candidate.allowed_presentations,
      preference_estimate: preferenceEstimate,
      options: {
        preference_contribution_cap: 0.1,
      },
    });
    byLearningUnit[candidate.learning_unit_id] = ranking.ranked;
  }
  return {
    schema_version: 'presentation-ranking.v1',
    ranking_version: PRESENTATION_RANKER_VERSION,
    preference_model_version: preferenceEstimate.estimator_version,
    by_learning_unit: byLearningUnit,
  };
}

function allowedVariants(candidates) {
  const values = candidates.flatMap((candidate) => candidate.allowed_presentations ?? []);
  return [...new Set(values)].sort((left, right) => String(left).localeCompare(String(right)));
}

export function createPersonalizationShadowService(options = {}) {
  if (!isPlainObject(options)) {
    fail('INVALID_FIELD_TYPE', 'options must be a plain object', { field: 'options' });
  }
  const reportRepository = options.reportRepository ?? null;
  if (reportRepository !== null && typeof reportRepository.put !== 'function') {
    fail('INVALID_FIELD_TYPE', 'reportRepository.put must be a function', {
      field: 'reportRepository.put',
    });
  }

  async function run(rawInput) {
    const input = buildPersonalizationShadowInput(rawInput);
    const skillProfile = estimateSkillsFromLearningEvents(input.skill_events);
    const preferenceEstimate = estimatePresentationPreferences({
      variants: allowedVariants(input.candidates),
      events: input.preference_events,
    });
    const presentationRankings = buildPresentationRankings(
      input.candidates,
      preferenceEstimate,
    );
    const shadowPlan = planCurriculum({
      session_id: input.session_id,
      as_of: input.as_of,
      time_budget_ms: input.time_budget_ms,
      candidates: input.candidates,
      skill_profile: skillProfile,
      presentation_rankings: presentationRankings,
      policy: {
        policy_version: 'curriculum-policy.v1:shadow',
        planner_version: CURRICULUM_PLANNER_VERSION,
        budget_ms: input.time_budget_ms,
        same_day_max_items: Math.max(100, input.candidates.length),
        minimum_weak_skill_evidence_count: 3,
        max_weak_skill_uncertainty: 0.75,
        max_preference_weight: 0.1,
        weights: {
          memory_urgency: 0.35,
          skill_gap: 0.3,
          importance: 0.2,
          novelty_fatigue: 0.1,
          presentation_preference: 0.05,
        },
      },
      model_versions: {
        adapter_version: PERSONALIZATION_SHADOW_ADAPTER_VERSION,
        skill_estimator_version: SKILL_ESTIMATOR_VERSION,
        preference_estimator_version: PREFERENCE_ESTIMATOR_VERSION,
        presentation_ranker_version: PRESENTATION_RANKER_VERSION,
      },
    });
    const report = normalizePersonalizationShadowReport({
      schema_version: PERSONALIZATION_SHADOW_REPORT_SCHEMA_VERSION,
      session_id: input.session_id,
      generated_at: input.as_of,
      source_event_count: input.skill_events.length,
      adapter_version: PERSONALIZATION_SHADOW_ADAPTER_VERSION,
      skill_estimator_version: SKILL_ESTIMATOR_VERSION,
      preference_estimator_version: PREFERENCE_ESTIMATOR_VERSION,
      curriculum_planner_version: CURRICULUM_PLANNER_VERSION,
      diagnostics: {
        ...input.diagnostics,
        skill_evidence_count: skillProfile.estimates.reduce(
          (total, estimate) => total + estimate.eligible_evidence_count,
          0,
        ),
        preference_event_count: preferenceEstimate.events_seen,
        preference_event_excluded_count: preferenceEstimate.events_excluded,
      },
      comparison: compareShadowPlanWithBaseline(input.baseline_ledger, shadowPlan),
      shadow_plan: shadowPlan,
    });
    if (reportRepository) await reportRepository.put(report);
    return report;
  }

  return {
    version: PERSONALIZATION_SHADOW_SERVICE_VERSION,
    run,
  };
}
