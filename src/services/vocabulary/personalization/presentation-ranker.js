import {
  DEFAULT_PRESENTATION_PRIORITIES,
  getPresentationDefaultPriority,
  normalizePresentationVariants,
} from './presentation-features.js';

export const PRESENTATION_RANKER_VERSION = 'presentation-ranker.v1';
export const PREFERENCE_CONTRIBUTION_HARD_CAP = 0.20;

export const DEFAULT_PRESENTATION_RANKER_OPTIONS = Object.freeze({
  preference_contribution_cap: PREFERENCE_CONTRIBUTION_HARD_CAP,
  minimum_samples_for_confidence: 3,
  default_priorities: DEFAULT_PRESENTATION_PRIORITIES,
});

const REASON_MESSAGES = Object.freeze({
  DEFAULT_PRIORITY: 'The deterministic default presentation priority was used.',
  LOW_SAMPLE_DEFAULT_WEIGHT: 'Low sample size and uncertainty reduced preference influence.',
  PREFERENCE_EVIDENCE_APPLIED: 'Observed presentation preference contributed within the bounded cap.',
  PREFERENCE_CONTRIBUTION_CAPPED: 'Preference contribution reached the hard safety cap.',
  UNSEEN_VARIANT_DEFAULT: 'No variant-specific evidence was observed; deterministic fallback applies.',
  NO_ALLOWED_PRESENTATIONS: 'No allowed presentation candidates were supplied.',
  RANKED_ALLOWED_ONLY: 'Ranking preserves the supplied allowed presentation set and does not filter learning content.',
});

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function safeVersion(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function featureKey(candidate) {
  return `${candidate.variant_id}\u0000${JSON.stringify(candidate.features)}`;
}

function resolveRankInput(input, preferences, options) {
  if (Array.isArray(input)) {
    return {
      allowed: input,
      preferenceEstimate: preferences ?? {},
      options: isPlainObject(options) ? options : {},
    };
  }
  if (!isPlainObject(input)) {
    throw new TypeError('rankPresentations input must be an allowed array or plain object');
  }
  return {
    allowed: input.allowed_presentations
      ?? input.allowedPresentations
      ?? input.presentations
      ?? input.candidates
      ?? [],
    preferenceEstimate: input.preferences
      ?? input.preference_estimate
      ?? input.preference_estimates
      ?? input.preferenceEstimate
      ?? input.preferenceEstimates
      ?? preferences
      ?? {},
    options: {
      ...(isPlainObject(input.options) ? input.options : {}),
      ...(isPlainObject(options) ? options : {}),
    },
  };
}

function estimateMap(preferences) {
  if (Array.isArray(preferences)) {
    return new Map(preferences.map((estimate) => [estimate?.variant_id, estimate]));
  }
  if (!isPlainObject(preferences)) return new Map();
  const source = isPlainObject(preferences.by_variant)
    ? preferences.by_variant
    : (isPlainObject(preferences.byVariant) ? preferences.byVariant : null);
  if (source) return new Map(Object.entries(source));
  if (Array.isArray(preferences.estimates)) {
    return new Map(preferences.estimates.map((estimate) => [estimate?.variant_id, estimate]));
  }
  return new Map();
}

function readEstimate(preferences, variantId) {
  const estimate = estimateMap(preferences).get(variantId);
  if (!isPlainObject(estimate)) {
    return {
      raw_preference: 0,
      sample_count: 0,
      effective_sample_count: 0,
      uncertainty: 1,
      observed: false,
      version: null,
      reason_codes: ['UNSEEN_VARIANT_DEFAULT'],
    };
  }
  const rawPreference = finiteNumber(
    estimate.preference_score
      ?? estimate.preference
      ?? estimate.relative_preference
      ?? estimate.mean,
  ) ?? 0;
  const sampleCount = finiteNumber(
    estimate.sample_count
      ?? estimate.eligible_sample_count
      ?? estimate.observation_count,
  ) ?? 0;
  const effectiveSampleCount = finiteNumber(estimate.effective_sample_count) ?? sampleCount;
  const uncertainty = finiteNumber(estimate.uncertainty) === null
    ? (sampleCount > 0 ? 0.5 : 1)
    : clamp(estimate.uncertainty, 0, 1);
  const observed = estimate.observed === undefined
    ? sampleCount > 0
    : estimate.observed === true;
  return {
    raw_preference: clamp(rawPreference, -1, 1),
    sample_count: Math.max(0, sampleCount),
    effective_sample_count: Math.max(0, effectiveSampleCount),
    uncertainty,
    observed,
    version: safeVersion(
      estimate.version ?? estimate.estimator_version ?? preferences?.version ?? null,
    ),
    reason_codes: Array.isArray(estimate.reason_codes) ? [...estimate.reason_codes] : [],
  };
}

function cappedPreferenceLimit(options) {
  const configured = finiteNumber(
    options.preference_contribution_cap
      ?? options.preferenceContributionCap,
  );
  if (configured === null) return PREFERENCE_CONTRIBUTION_HARD_CAP;
  return clamp(configured, 0, PREFERENCE_CONTRIBUTION_HARD_CAP);
}

function mergeReasonCodes(codes) {
  return [...new Set(codes)].sort(compareStrings);
}

function reasonObjects(codes, details = {}) {
  return codes.map((code) => ({
    code,
    message: Object.prototype.hasOwnProperty.call(REASON_MESSAGES, code)
      ? REASON_MESSAGES[code]
      : 'A deterministic ranking rule was applied.',
    ...(Object.prototype.hasOwnProperty.call(details, code) && details[code]
      ? { details: details[code] }
      : {}),
  }));
}

function calculateReliability(estimate, options) {
  if (!estimate.observed || estimate.sample_count <= 0) return 0;
  const minimumSamples = Math.max(
    0.001,
    finiteNumber(options.minimum_samples_for_confidence
      ?? options.minimumSamplesForConfidence) ?? 3,
  );
  const sampleConfidence = estimate.effective_sample_count
    / (estimate.effective_sample_count + minimumSamples);
  const certainty = 1 - clamp(estimate.uncertainty, 0, 1);
  return clamp(sampleConfidence * certainty, 0, 1);
}

function rankCandidate(candidate, preferenceEstimate, options) {
  const estimate = readEstimate(preferenceEstimate, candidate.variant_id);
  const defaultPriority = getPresentationDefaultPriority(
    candidate.variant_id,
    options.default_priorities ?? options.defaultPriorities,
  );
  const reliability = calculateReliability(estimate, options);
  const preferenceLimit = cappedPreferenceLimit(options);
  const uncappedContribution = estimate.raw_preference * reliability;
  const preferenceContribution = clamp(
    uncappedContribution,
    -preferenceLimit,
    preferenceLimit,
  );
  const reasonCodes = ['DEFAULT_PRIORITY'];
  const details = {
    DEFAULT_PRIORITY: { base_score: defaultPriority },
  };
  if (estimate.observed && estimate.sample_count > 0) {
    reasonCodes.push('PREFERENCE_EVIDENCE_APPLIED');
    details.PREFERENCE_EVIDENCE_APPLIED = {
      raw_preference: estimate.raw_preference,
      reliability,
      uncertainty: estimate.uncertainty,
    };
    if (estimate.sample_count < (options.minimum_samples_for_confidence ?? 3)) {
      reasonCodes.push('LOW_SAMPLE_DEFAULT_WEIGHT');
    }
  } else {
    reasonCodes.push('UNSEEN_VARIANT_DEFAULT');
  }
  if (preferenceContribution !== uncappedContribution) {
    reasonCodes.push('PREFERENCE_CONTRIBUTION_CAPPED');
    details.PREFERENCE_CONTRIBUTION_CAPPED = { cap: preferenceLimit };
  }
  const canonicalReasonCodes = mergeReasonCodes(reasonCodes);
  const score = defaultPriority + preferenceContribution;
  return {
    rank: 0,
    variant_id: candidate.variant_id,
    presentation: candidate,
    features: { ...candidate.features },
    base_score: defaultPriority,
    preference_score: estimate.raw_preference,
    preference_reliability: reliability,
    preference_contribution: preferenceContribution,
    score,
    score_components: {
      base_score: defaultPriority,
      preference_contribution: preferenceContribution,
      score,
    },
    sample_count: estimate.sample_count,
    effective_sample_count: estimate.effective_sample_count,
    uncertainty: estimate.uncertainty,
    observed: estimate.observed && estimate.sample_count > 0,
    preference_model_version: estimate.version,
    reason_codes: canonicalReasonCodes,
    reasons: reasonObjects(canonicalReasonCodes, details),
  };
}

/**
 * Rank only the presentations supplied by the caller.  The function has no
 * knowledge of learning units, due dates, curriculum constraints, or content
 * validity and therefore cannot silently remove curriculum work.
 */
export function rankPresentations(input, preferences, options) {
  const resolved = resolveRankInput(input, preferences, options);
  const mergedOptions = {
    ...DEFAULT_PRESENTATION_RANKER_OPTIONS,
    ...(isPlainObject(resolved.options) ? resolved.options : {}),
  };
  if (!Array.isArray(resolved.allowed)) {
    throw new TypeError('allowed presentations must be an array');
  }

  const allowed = normalizePresentationVariants(resolved.allowed);
  const ranked = allowed
    .map((candidate) => rankCandidate(candidate, resolved.preferenceEstimate, mergedOptions))
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      if (left.base_score !== right.base_score) return right.base_score - left.base_score;
      if (left.preference_contribution !== right.preference_contribution) {
        return right.preference_contribution - left.preference_contribution;
      }
      const idOrder = compareStrings(left.variant_id, right.variant_id);
      if (idOrder !== 0) return idOrder;
      return compareStrings(featureKey(left.presentation), featureKey(right.presentation));
    })
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  const topLevelCodes = ['RANKED_ALLOWED_ONLY'];
  if (allowed.length === 0) topLevelCodes.push('NO_ALLOWED_PRESENTATIONS');
  else topLevelCodes.push('DEFAULT_PRIORITY');
  const preferenceVersion = isPlainObject(resolved.preferenceEstimate)
    ? safeVersion(
      resolved.preferenceEstimate.version
        ?? resolved.preferenceEstimate.estimator_version
        ?? null,
    )
    : null;
  const canonicalTopLevelCodes = mergeReasonCodes(topLevelCodes);
  return {
    version: PRESENTATION_RANKER_VERSION,
    ranker_version: PRESENTATION_RANKER_VERSION,
    preference_model_version: preferenceVersion,
    constraint_scope: 'allowed_presentations_only',
    allowed_count: allowed.length,
    allowed_variant_ids: allowed.map((candidate) => candidate.variant_id),
    ranked,
    selected_variant_id: ranked[0]?.variant_id ?? null,
    selected_presentation: ranked[0]?.presentation ?? null,
    reason_codes: canonicalTopLevelCodes,
    reasons: reasonObjects(canonicalTopLevelCodes),
  };
}

export const rankPresentationCandidates = rankPresentations;

/**
 * Stable adapter seam for a future ranker (for example constrained LinUCB).
 * The current implementation remains a pure deterministic baseline.
 */
export function createPresentationRanker(defaultOptions = {}) {
  const capturedOptions = isPlainObject(defaultOptions) ? { ...defaultOptions } : {};
  return (input, preferences, options = {}) => rankPresentations(
    input,
    preferences,
    { ...capturedOptions, ...(isPlainObject(options) ? options : {}) },
  );
}
