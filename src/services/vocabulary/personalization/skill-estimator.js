import {
  SKILL_TAXONOMY,
  compareSkillIds,
  getSkillDefinition,
  normalizeSkillTags,
} from './skill-taxonomy.js';
import {
  eventsToSkillEvidence,
  isTrainingExclusionReason,
  normalizeSkillEvidence,
  SKILL_EVIDENCE_REASON_ORDER,
} from './skill-evidence.js';

export const SKILL_ESTIMATE_SCHEMA_VERSION = 'skill-estimate.v1';
export const SKILL_ESTIMATOR_VERSION = 'skill-estimator.beta.v1';
export const SKILL_ESTIMATOR_METHOD = 'weighted_beta_baseline';

export const DEFAULT_SKILL_BETA_PRIOR = Object.freeze({
  alpha: 1,
  beta: 1,
});

// A partial result adds information but does not claim a binary success.
export const SKILL_OUTCOME_BETA_CONTRIBUTIONS = Object.freeze({
  success: Object.freeze({ alpha: 1, beta: 0 }),
  partial: Object.freeze({ alpha: 0.5, beta: 0.5 }),
  failure: Object.freeze({ alpha: 0, beta: 1 }),
  skip: Object.freeze({ alpha: 0, beta: 0 }),
});

export const SKILL_UNCERTAINTY_METHOD = 'sqrt(beta_variance / uniform_beta_1_1_variance)';

const ESTIMATE_REASON_ORDER = Object.freeze([
  ...SKILL_EVIDENCE_REASON_ORDER,
  'BETA_PRIOR_SMOOTHING',
  'PRIOR_ONLY',
  'NO_ELIGIBLE_EVIDENCE',
  'LOW_EVIDENCE',
  'EXCLUDED_EVIDENCE',
  'DOWNWEIGHTED_EVIDENCE',
  'MIXED_OUTCOMES',
  'UNKNOWN_SKILL_IGNORED',
  'DETERMINISTIC_SKILL_ORDER',
]);
const REASON_ORDER = new Map(ESTIMATE_REASON_ORDER.map((reason, index) => [reason, index]));

const MIN_EFFECTIVE_EVIDENCE_FOR_STABLE_SIGNAL = 3;
const EPSILON = 1e-12;

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function compareText(left, right) {
  return left < right ? -1 : (left > right ? 1 : 0);
}

function roundNumber(value, digits = 12) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function addReason(reasons, reason) {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function sortReasons(reasons) {
  return [...new Set(reasons)].sort((left, right) => (
    (REASON_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (REASON_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER)
    || compareText(left, right)
  ));
}

function normalizePrior(prior, reasons) {
  if (prior === undefined || prior === null) return { ...DEFAULT_SKILL_BETA_PRIOR };
  const source = asObject(prior);
  const alpha = Number(source.alpha);
  const beta = Number(source.beta);
  if (Number.isFinite(alpha) && alpha > 0 && Number.isFinite(beta) && beta > 0) {
    return { alpha, beta };
  }
  addReason(reasons, 'INVALID_PRIOR_FALLBACK');
  return { ...DEFAULT_SKILL_BETA_PRIOR };
}

function normalizeTaxonomy(options) {
  return options?.taxonomy && Array.isArray(options.taxonomy.skills)
    ? options.taxonomy
    : SKILL_TAXONOMY;
}

function isValidEvidenceArray(value) {
  return Array.isArray(value) ? value : [];
}

function maxTimestamp(current, candidate) {
  if (!candidate) return current;
  if (!current || candidate > current) return candidate;
  return current;
}

function betaUncertainty(alpha, beta) {
  const total = alpha + beta;
  const variance = (alpha * beta) / ((total ** 2) * (total + 1));
  const normalized = Math.sqrt(Math.max(0, variance) / (1 / 12));
  return roundNumber(Math.max(0, Math.min(1, normalized)), 10);
}

function skillEvidenceForId(skillId, evidence, taxonomy) {
  const aggregate = {
    alpha: 0,
    beta: 0,
    eligibleEvidenceCount: 0,
    effectiveEvidenceWeight: 0,
    lastObservedAt: null,
    reasons: [],
    outcomes: new Set(),
  };

  for (const rawEvidence of evidence) {
    const normalized = normalizeSkillEvidence(rawEvidence, { taxonomy });
    if (!normalized.skill_tags.includes(skillId)) continue;

    for (const reason of normalized.exclusions) addReason(aggregate.reasons, reason);

    if (normalized.outcome === 'skip') continue;
    const contribution = SKILL_OUTCOME_BETA_CONTRIBUTIONS[normalized.outcome];
    const weight = Number(normalized.weight);
    if (!contribution || !Number.isFinite(weight) || weight <= 0) continue;

    aggregate.lastObservedAt = maxTimestamp(aggregate.lastObservedAt, normalized.occurred_at);
    aggregate.outcomes.add(normalized.outcome);
    aggregate.eligibleEvidenceCount += 1;
    aggregate.effectiveEvidenceWeight += weight;
    aggregate.alpha += contribution.alpha * weight;
    aggregate.beta += contribution.beta * weight;
  }

  return aggregate;
}

function makeEstimate(skillId, evidence, options = {}) {
  const sourceOptions = asObject(options);
  const taxonomy = normalizeTaxonomy(sourceOptions);
  const definition = getSkillDefinition(skillId, taxonomy);
  if (!definition) return null;

  const topLevelReasons = [];
  const prior = normalizePrior(sourceOptions.prior, topLevelReasons);
  const aggregate = skillEvidenceForId(skillId, isValidEvidenceArray(evidence), taxonomy);
  const alpha = prior.alpha + aggregate.alpha;
  const beta = prior.beta + aggregate.beta;
  const total = alpha + beta;
  const masteryMean = roundNumber(alpha / total, 10);
  const reasons = [...aggregate.reasons];

  addReason(reasons, 'BETA_PRIOR_SMOOTHING');
  if (aggregate.eligibleEvidenceCount === 0) {
    addReason(reasons, 'NO_ELIGIBLE_EVIDENCE');
    addReason(reasons, 'PRIOR_ONLY');
  } else if (aggregate.effectiveEvidenceWeight < MIN_EFFECTIVE_EVIDENCE_FOR_STABLE_SIGNAL) {
    addReason(reasons, 'LOW_EVIDENCE');
  }
  if (reasons.some((reason) => isTrainingExclusionReason(reason))) {
    addReason(reasons, 'EXCLUDED_EVIDENCE');
  }
  if (
    aggregate.effectiveEvidenceWeight + EPSILON < aggregate.eligibleEvidenceCount
    || reasons.includes('STRONG_CUE')
  ) {
    addReason(reasons, 'DOWNWEIGHTED_EVIDENCE');
  }
  if (aggregate.outcomes.size > 1) addReason(reasons, 'MIXED_OUTCOMES');

  return {
    skill_id: definition.id,
    mastery_mean: masteryMean,
    uncertainty: betaUncertainty(alpha, beta),
    eligible_evidence_count: aggregate.eligibleEvidenceCount,
    last_observed_at: aggregate.lastObservedAt,
    estimator_version: SKILL_ESTIMATOR_VERSION,
    reasons: sortReasons(reasons),
  };
}

/** Estimate one known skill from already converted SkillEvidence rows. */
export function estimateSkill(skillId, evidence = [], options = {}) {
  return makeEstimate(skillId, evidence, options);
}

export const estimateSkillMastery = estimateSkill;

/**
 * Estimate every skill in the supplied taxonomy. The output envelope carries
 * the model contract; each estimate repeats its estimator version for storage
 * beside an individual derived row.
 */
export function estimateSkills(evidence = [], options = {}) {
  const sourceOptions = asObject(options);
  const taxonomy = normalizeTaxonomy(sourceOptions);
  const topLevelReasons = ['BETA_PRIOR_SMOOTHING', 'DETERMINISTIC_SKILL_ORDER'];
  const values = isValidEvidenceArray(evidence);
  const unknownSkillSeen = new Set();

  for (const rawEvidence of values) {
    const raw = asObject(rawEvidence);
    const tags = normalizeSkillTags(raw.skill_tags ?? raw.skillTags, taxonomy);
    for (const unknown of tags.unknown_skill_tags) unknownSkillSeen.add(unknown);
  }
  if (unknownSkillSeen.size > 0) addReason(topLevelReasons, 'UNKNOWN_SKILL_IGNORED');

  const estimates = [...taxonomy.skills]
    .sort((left, right) => compareSkillIds(left.id, right.id, taxonomy))
    .map((skill) => makeEstimate(skill.id, values, sourceOptions));

  return {
    schema_version: SKILL_ESTIMATE_SCHEMA_VERSION,
    estimator_version: SKILL_ESTIMATOR_VERSION,
    taxonomy_version: taxonomy.version ?? taxonomy.schema_version ?? 'unknown',
    method: SKILL_ESTIMATOR_METHOD,
    prior: normalizePrior(sourceOptions.prior, topLevelReasons),
    uncertainty_method: SKILL_UNCERTAINTY_METHOD,
    estimates,
    reasons: sortReasons(topLevelReasons),
  };
}

export const estimateSkillSet = estimateSkills;

/** Convert ordinary events and immediately run the same pure estimator. */
export function estimateSkillsFromLearningEvents(events = [], options = {}) {
  const sourceOptions = asObject(options);
  const taxonomy = normalizeTaxonomy(sourceOptions);
  const evidence = eventsToSkillEvidence(events, { taxonomy });
  return estimateSkills(evidence, { ...sourceOptions, taxonomy });
}

export const buildSkillEstimates = estimateSkillsFromLearningEvents;

export function getSkillEstimatorConfig(options = {}) {
  const sourceOptions = asObject(options);
  const taxonomy = normalizeTaxonomy(sourceOptions);
  const reasons = [];
  const prior = normalizePrior(sourceOptions.prior, reasons);
  return {
    schema_version: SKILL_ESTIMATE_SCHEMA_VERSION,
    estimator_version: SKILL_ESTIMATOR_VERSION,
    taxonomy_version: taxonomy.version ?? taxonomy.schema_version ?? 'unknown',
    method: SKILL_ESTIMATOR_METHOD,
    prior,
    outcome_contributions: SKILL_OUTCOME_BETA_CONTRIBUTIONS,
    uncertainty_method: SKILL_UNCERTAINTY_METHOD,
    reasons: sortReasons(reasons),
  };
}
