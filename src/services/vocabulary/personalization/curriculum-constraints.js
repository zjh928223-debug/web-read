/**
 * Pure contracts and hard-constraint helpers for the personalized curriculum.
 *
 * This module deliberately knows nothing about FSRS, persistence, the DOM, or
 * presentation rendering.  It accepts ordinary JSON-compatible values and
 * returns newly-created values so a planner can be replayed from the same
 * event snapshot and policy version.
 */

export const CURRICULUM_POLICY_SCHEMA_VERSION = 'curriculum-policy.v1'
export const CURRICULUM_PLAN_SCHEMA_VERSION = 'curriculum-plan.v1'
export const CURRICULUM_PLANNER_VERSION = 'curriculum-planner.v1'
export const DEFAULT_CURRICULUM_POLICY_VERSION = 'curriculum-policy.v1'
export const DEFAULT_CURRICULUM_AS_OF = '1970-01-01T00:00:00.000Z'
export const DEFAULT_SAME_DAY_REVISIT_WINDOW_MIN_MS = 10 * 60 * 1000
export const DEFAULT_SAME_DAY_REVISIT_WINDOW_MAX_MS = 20 * 60 * 1000
export const MAX_COVERAGE_SEARCH_NODES = 250000
export const CURRICULUM_QUEUE_TIERS = Object.freeze([
  'due_review',
  'relearning_revisit',
  'reassessment',
  'acquisition',
])

export const DEFAULT_CURRICULUM_POLICY = deepFreeze({
  schema_version: CURRICULUM_POLICY_SCHEMA_VERSION,
  policy_version: DEFAULT_CURRICULUM_POLICY_VERSION,
  planner_version: CURRICULUM_PLANNER_VERSION,
  budget_ms: 60 * 60 * 1000,
  same_day_max_items: 100,
  same_day_revisit_max_per_learning_unit: 1,
  per_learning_unit_same_day_max_items: 1,
  weak_skill_threshold: 0.55,
  important_skill_threshold: 0.7,
  default_weak_skill_coverage: 1,
  minimum_weak_skill_evidence_count: 1,
  max_weak_skill_uncertainty: 0.75,
  max_coverage_search_nodes: 100000,
  same_day_revisit_window_min_ms: DEFAULT_SAME_DAY_REVISIT_WINDOW_MIN_MS,
  same_day_revisit_window_max_ms: DEFAULT_SAME_DAY_REVISIT_WINDOW_MAX_MS,
  max_preference_weight: 0.1,
  weights: {
    memory_urgency: 0.35,
    skill_gap: 0.3,
    importance: 0.2,
    novelty_fatigue: 0.1,
    presentation_preference: 0.05,
  },
  weak_skill_quotas: [],
})

export const CONTENT_AVAILABLE_STATUSES = Object.freeze([
  'available',
  'ready',
  'validated',
  'valid',
  'ok',
])

const CONTENT_AVAILABLE_STATUS_SET = new Set(CONTENT_AVAILABLE_STATUSES)
const DEFAULT_WEIGHTS = DEFAULT_CURRICULUM_POLICY.weights

export class CurriculumPlannerContractError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'CurriculumPlannerContractError'
    this.code = code
    this.details = cloneJson(details)
  }
}

export function normalizeCurriculumPolicy(input) {
  const source = input == null ? {} : requirePlainObject(input, 'policy')
  const nestedConstraints = source.constraints == null
    ? {}
    : requirePlainObject(source.constraints, 'policy.constraints')
  const nestedWeights = source.weights == null
    ? (source.score_weights == null ? {} : requirePlainObject(source.score_weights, 'policy.score_weights'))
    : requirePlainObject(source.weights, 'policy.weights')

  const schemaVersion = source.schema_version ?? CURRICULUM_POLICY_SCHEMA_VERSION
  if (schemaVersion !== CURRICULUM_POLICY_SCHEMA_VERSION) {
    throw contractError(
      'UNSUPPORTED_SCHEMA_VERSION',
      'Curriculum policy schema version is not supported.',
      { field: 'policy.schema_version', actual: printable(schemaVersion) },
    )
  }

  const policyVersion = firstDefined(
    source.policy_version,
    source.version,
    DEFAULT_CURRICULUM_POLICY_VERSION,
  )
  const plannerVersion = firstDefined(
    source.planner_version,
    source.curriculum_planner_version,
    CURRICULUM_PLANNER_VERSION,
  )
  requireNonEmptyString(policyVersion, 'policy.policy_version')
  requireNonEmptyString(plannerVersion, 'policy.planner_version')

  const budgetMs = requireNonNegativeInteger(
    firstDefined(
      source.budget_ms,
      source.time_budget_ms,
      nestedConstraints.budget_ms,
      nestedConstraints.time_budget_ms,
      DEFAULT_CURRICULUM_POLICY.budget_ms,
    ),
    'policy.budget_ms',
  )
  const sameDayMaxItems = requireNonNegativeInteger(
    firstDefined(
      source.same_day_max_items,
      source.same_day_limit,
      source.max_items_per_local_day,
      nestedConstraints.same_day_max_items,
      nestedConstraints.same_day_limit,
      DEFAULT_CURRICULUM_POLICY.same_day_max_items,
    ),
    'policy.same_day_max_items',
  )
  const sameDayRevisitMaxPerLearningUnit = requireNonNegativeInteger(
    firstDefined(
      source.same_day_revisit_max_per_learning_unit,
      source.per_learning_unit_same_day_max_items,
      source.same_day_per_unit_max_items,
      nestedConstraints.same_day_revisit_max_per_learning_unit,
      nestedConstraints.per_learning_unit_same_day_max_items,
      nestedConstraints.same_day_per_unit_max_items,
      DEFAULT_CURRICULUM_POLICY.same_day_revisit_max_per_learning_unit,
    ),
    'policy.same_day_revisit_max_per_learning_unit',
  )
  const weakSkillThreshold = requireUnitInterval(
    firstDefined(
      source.weak_skill_threshold,
      source.weak_threshold,
      DEFAULT_CURRICULUM_POLICY.weak_skill_threshold,
    ),
    'policy.weak_skill_threshold',
  )
  const importantSkillThreshold = requireUnitInterval(
    firstDefined(
      source.important_skill_threshold,
      source.important_threshold,
      DEFAULT_CURRICULUM_POLICY.important_skill_threshold,
    ),
    'policy.important_skill_threshold',
  )
  const defaultWeakSkillCoverage = requireNonNegativeInteger(
    firstDefined(
      source.default_weak_skill_coverage,
      source.minimum_weak_skill_coverage,
      DEFAULT_CURRICULUM_POLICY.default_weak_skill_coverage,
    ),
    'policy.default_weak_skill_coverage',
  )
  const minimumWeakSkillEvidenceCount = requireNonNegativeInteger(
    firstDefined(
      source.minimum_weak_skill_evidence_count,
      source.weak_skill_min_evidence_count,
      nestedConstraints.minimum_weak_skill_evidence_count,
      DEFAULT_CURRICULUM_POLICY.minimum_weak_skill_evidence_count,
    ),
    'policy.minimum_weak_skill_evidence_count',
  )
  const maxWeakSkillUncertainty = requireUnitInterval(
    firstDefined(
      source.max_weak_skill_uncertainty,
      source.weak_skill_max_uncertainty,
      source.max_weak_uncertainty,
      nestedConstraints.max_weak_skill_uncertainty,
      DEFAULT_CURRICULUM_POLICY.max_weak_skill_uncertainty,
    ),
    'policy.max_weak_skill_uncertainty',
  )
  const requestedMaxCoverageSearchNodes = requirePositiveInteger(
    firstDefined(
      source.max_coverage_search_nodes,
      source.coverage_search_node_limit,
      nestedConstraints.max_coverage_search_nodes,
      DEFAULT_CURRICULUM_POLICY.max_coverage_search_nodes,
    ),
    'policy.max_coverage_search_nodes',
  )
  const maxCoverageSearchNodes = Math.min(requestedMaxCoverageSearchNodes, MAX_COVERAGE_SEARCH_NODES)
  const revisitWindowMinMs = requirePositiveInteger(
    firstDefined(
      source.same_day_revisit_window_min_ms,
      source.revisit_window_min_ms,
      source.revisit_min_delay_ms,
      nestedConstraints.same_day_revisit_window_min_ms,
      DEFAULT_CURRICULUM_POLICY.same_day_revisit_window_min_ms,
    ),
    'policy.same_day_revisit_window_min_ms',
  )
  const revisitWindowMaxMs = requirePositiveInteger(
    firstDefined(
      source.same_day_revisit_window_max_ms,
      source.revisit_window_max_ms,
      source.revisit_max_delay_ms,
      nestedConstraints.same_day_revisit_window_max_ms,
      DEFAULT_CURRICULUM_POLICY.same_day_revisit_window_max_ms,
    ),
    'policy.same_day_revisit_window_max_ms',
  )
  if (revisitWindowMaxMs < revisitWindowMinMs) {
    throw contractError(
      'INVALID_FIELD_VALUE',
      'policy.same_day_revisit_window_max_ms must be at least the minimum window.',
      {
        field: 'policy.same_day_revisit_window_max_ms',
        minimum: revisitWindowMinMs,
        maximum: revisitWindowMaxMs,
      },
    )
  }
  const maxPreferenceWeight = requireUnitInterval(
    firstDefined(
      source.max_preference_weight,
      source.preference_weight_cap,
      DEFAULT_CURRICULUM_POLICY.max_preference_weight,
    ),
    'policy.max_preference_weight',
  )

  const rawWeights = {
    ...DEFAULT_WEIGHTS,
    ...nestedWeights,
  }
  const rawPreferenceWeight = requireNonNegativeFiniteNumber(
    firstDefined(
      nestedWeights.presentation_preference,
      nestedWeights.presentation_preference_weight,
      source.presentation_preference_weight,
      source.preference_weight,
      DEFAULT_WEIGHTS.presentation_preference,
    ),
    'policy.weights.presentation_preference',
  )
  const weights = {
    memory_urgency: requireNonNegativeFiniteNumber(
      firstDefined(rawWeights.memory_urgency, rawWeights.memory, DEFAULT_WEIGHTS.memory_urgency),
      'policy.weights.memory_urgency',
    ),
    skill_gap: requireNonNegativeFiniteNumber(
      firstDefined(rawWeights.skill_gap, rawWeights.skill, DEFAULT_WEIGHTS.skill_gap),
      'policy.weights.skill_gap',
    ),
    importance: requireNonNegativeFiniteNumber(
      firstDefined(rawWeights.importance, rawWeights.important, DEFAULT_WEIGHTS.importance),
      'policy.weights.importance',
    ),
    novelty_fatigue: requireNonNegativeFiniteNumber(
      firstDefined(rawWeights.novelty_fatigue, rawWeights.novelty, DEFAULT_WEIGHTS.novelty_fatigue),
      'policy.weights.novelty_fatigue',
    ),
    presentation_preference: Math.min(rawPreferenceWeight, maxPreferenceWeight),
  }

  const quotaSource = firstDefined(
    source.weak_skill_quotas,
    source.weak_skill_requirements,
    nestedConstraints.weak_skill_quotas,
    nestedConstraints.weak_skill_requirements,
    [],
  )

  return {
    schema_version: CURRICULUM_POLICY_SCHEMA_VERSION,
    policy_version: policyVersion,
    planner_version: plannerVersion,
    budget_ms: budgetMs,
    same_day_max_items: sameDayMaxItems,
    same_day_revisit_max_per_learning_unit: sameDayRevisitMaxPerLearningUnit,
    // Keep the historical field as an input/output alias, but its meaning is
    // explicitly per-learning-unit revisit capacity, never a global mature cap.
    per_learning_unit_same_day_max_items: sameDayRevisitMaxPerLearningUnit,
    weak_skill_threshold: weakSkillThreshold,
    important_skill_threshold: importantSkillThreshold,
    default_weak_skill_coverage: defaultWeakSkillCoverage,
    minimum_weak_skill_evidence_count: minimumWeakSkillEvidenceCount,
    max_weak_skill_uncertainty: maxWeakSkillUncertainty,
    max_coverage_search_nodes: maxCoverageSearchNodes,
    max_coverage_search_nodes_capped: requestedMaxCoverageSearchNodes > MAX_COVERAGE_SEARCH_NODES,
    same_day_revisit_window_min_ms: revisitWindowMinMs,
    same_day_revisit_window_max_ms: revisitWindowMaxMs,
    max_preference_weight: maxPreferenceWeight,
    weights,
    raw_preference_weight: rawPreferenceWeight,
    preference_weight_capped: rawPreferenceWeight > maxPreferenceWeight,
    weak_skill_quotas: normalizeWeakSkillRequirements(quotaSource, {
      defaultMinimum: defaultWeakSkillCoverage,
      field: 'policy.weak_skill_quotas',
    }),
  }
}

export function normalizeCurriculumCandidate(input, index = 0) {
  const field = `candidates[${index}]`
  const source = requirePlainObject(input, field)
  const learningUnitId = requireNonEmptyString(
    firstDefined(source.learning_unit_id, source.id),
    `${field}.learning_unit_id`,
  )
  const dueAt = source.due_at == null
    ? null
    : normalizeUtcTimestamp(source.due_at, `${field}.due_at`)
  const explicitEligible = firstDefined(
    source.eligible,
    source.is_eligible,
    source.isEligible,
    null,
  )
  if (explicitEligible !== null && typeof explicitEligible !== 'boolean') {
    throw contractError(
      'INVALID_FIELD_TYPE',
      `${field}.eligible must be a boolean when supplied.`,
      { field: `${field}.eligible` },
    )
  }
  const explicitDue = firstDefined(source.is_due, source.due, null)
  if (explicitDue !== null && typeof explicitDue !== 'boolean') {
    throw contractError(
      'INVALID_FIELD_TYPE',
      `${field}.is_due must be a boolean when supplied.`,
      { field: `${field}.is_due` },
    )
  }

  const skillTags = normalizeStringArray(
    firstDefined(source.skill_tags, source.skills, []),
    `${field}.skill_tags`,
  )
  const allowedPresentations = normalizeAllowedPresentations(
    firstDefined(source.allowed_presentations, source.presentations, []),
    `${field}.allowed_presentations`,
  )
  const contentStatus = normalizeContentStatus(
    firstDefined(source.content_status, source.contentState, null),
  )
  const estimatedDurationMs = requirePositiveInteger(
    firstDefined(source.estimated_duration_ms, source.duration_ms),
    `${field}.estimated_duration_ms`,
  )
  const sameDayCount = requireNonNegativeInteger(
    firstDefined(source.same_day_count, 0),
    `${field}.same_day_count`,
  )
  const sameDayRevisitCount = requireNonNegativeInteger(
    firstDefined(source.same_day_revisit_count, source.revisit_count, 0),
    `${field}.same_day_revisit_count`,
  )
  const queueKind = source.queue_kind == null ? null : normalizeText(source.queue_kind, `${field}.queue_kind`)
  const isRevisit = source.is_revisit === true
    || source.revisit === true
    || (queueKind !== null && ['revisit', 'review_revisit'].includes(queueKind.toLowerCase()))
  const isReassessment = source.is_reassessment === true
    || source.reassessment === true
    || (queueKind !== null && ['reassessment', 'legacy_reassessment'].includes(queueKind.toLowerCase()))

  return {
    learning_unit_id: learningUnitId,
    due_at: dueAt,
    eligible: explicitEligible,
    is_due: explicitDue,
    memory_priority: normalizeScore(
      firstDefined(source.memory_priority, source.memoryUrgency, 0),
      `${field}.memory_priority`,
    ),
    skill_tags: skillTags,
    importance: normalizeScore(
      firstDefined(source.importance, source.priority, 0),
      `${field}.importance`,
    ),
    estimated_duration_ms: estimatedDurationMs,
    allowed_presentations: allowedPresentations,
    presentation_ranking: cloneJson(
      firstDefined(source.presentation_ranking, source.presentationRanking, null),
    ),
    content_status: contentStatus,
    maturity: normalizeMaturity(source),
    is_mature: normalizeMaturity(source),
    same_day_count: sameDayCount,
    same_day_revisit_count: sameDayRevisitCount,
    is_revisit: isRevisit,
    is_reassessment: isReassessment,
    revisit_anchor_at: source.revisit_anchor_at == null
      ? null
      : normalizeUtcTimestamp(source.revisit_anchor_at, `${field}.revisit_anchor_at`),
    revisit_window: normalizeRevisitWindow(
      firstDefined(source.revisit_window, source.revisitWindow, null),
      `${field}.revisit_window`,
    ),
    novelty: normalizeNullableScore(firstDefined(source.novelty, source.novelty_score, null), `${field}.novelty`),
    fatigue: normalizeNullableScore(firstDefined(source.fatigue, source.fatigue_score, null), `${field}.fatigue`),
    queue_kind: queueKind,
    candidate_extensions: cloneJson(firstDefined(source.extensions, {})),
  }
}

export function normalizeSkillProfile(input) {
  if (input == null) {
    return {
      schema_version: 'skill-profile.v1',
      estimator_version: 'skill-estimator.unknown',
      estimates: [],
      declared_weak_skills: [],
    }
  }
  const source = Array.isArray(input)
    ? { skills: input }
    : requirePlainObject(input, 'skill_profile')
  const rawEstimates = Array.isArray(source)
    ? source
    : firstDefined(source.estimates, source.skill_estimates, source.skills, null)
  let estimates
  if (Array.isArray(rawEstimates)) {
    estimates = rawEstimates.map((estimate, index) => normalizeSkillEstimate(estimate, index))
  } else if (rawEstimates && isPlainObject(rawEstimates)) {
    estimates = Object.entries(rawEstimates).map(([skillId, estimate], index) => (
      normalizeSkillEstimate(
        isPlainObject(estimate) ? { ...estimate, skill_id: estimate.skill_id ?? skillId } : {
          skill_id: skillId,
          mastery_mean: estimate,
        },
        index,
      )
    ))
  } else if (source.by_skill && isPlainObject(source.by_skill)) {
    estimates = Object.entries(source.by_skill).map(([skillId, estimate], index) => (
      normalizeSkillEstimate(
        isPlainObject(estimate) ? { ...estimate, skill_id: estimate.skill_id ?? skillId } : {
          skill_id: skillId,
          mastery_mean: estimate,
        },
        index,
      )
    ))
  } else {
    const metadataKeys = new Set([
      'schema_version',
      'profile_version',
      'skill_profile_version',
      'estimator_version',
      'skill_estimator_version',
      'weak_skills',
      'declared_weak_skills',
      'estimates',
      'skill_estimates',
      'skills',
      'by_skill',
    ])
    const directEntries = Object.entries(source).filter(([key]) => !metadataKeys.has(key))
    estimates = directEntries.map(([skillId, estimate], index) => (
      normalizeSkillEstimate(
        isPlainObject(estimate) ? { ...estimate, skill_id: estimate.skill_id ?? skillId } : {
          skill_id: skillId,
          mastery_mean: estimate,
        },
        index,
      )
    ))
  }

  const declaredWeakRaw = firstDefined(source.weak_skills, source.declared_weak_skills, [])
  const declaredWeakSkills = Array.isArray(declaredWeakRaw)
    ? declaredWeakRaw.map((item, index) => {
      if (typeof item === 'string') return normalizeText(item, `skill_profile.weak_skills[${index}]`)
      const itemObject = requirePlainObject(item, `skill_profile.weak_skills[${index}]`)
      return requireNonEmptyString(
        firstDefined(itemObject.skill_id, itemObject.id),
        `skill_profile.weak_skills[${index}].skill_id`,
      )
    })
    : []

  const bySkill = new Map()
  for (const estimate of estimates) bySkill.set(estimate.skill_id, estimate)
  for (const skillId of declaredWeakSkills) {
    if (!bySkill.has(skillId)) {
      bySkill.set(skillId, normalizeSkillEstimate({ skill_id: skillId, is_weak: true }, estimates.length))
    }
  }

  return {
    schema_version: firstDefined(source.schema_version, 'skill-profile.v1'),
    estimator_version: firstDefined(
      source.estimator_version,
      source.skill_estimator_version,
      'skill-estimator.unknown',
    ),
    estimates: [...bySkill.values()].sort(compareSkillEstimates),
    declared_weak_skills: [...new Set(declaredWeakSkills)].sort((left, right) => left.localeCompare(right)),
  }
}

export function normalizeWeakSkillRequirements(input, options = {}) {
  const defaultMinimum = options.defaultMinimum ?? 1
  const field = options.field ?? 'weak_skill_requirements'
  if (input == null) return []
  const rows = []
  if (Array.isArray(input)) {
    input.forEach((item, index) => {
      if (typeof item === 'string') {
        rows.push({
          skill_id: normalizeText(item, `${field}[${index}]`),
          minimum: defaultMinimum,
          importance: 0,
          reason: null,
        })
        return
      }
      const object = requirePlainObject(item, `${field}[${index}]`)
      rows.push({
        skill_id: requireNonEmptyString(
          firstDefined(object.skill_id, object.id),
          `${field}[${index}].skill_id`,
        ),
        minimum: requireNonNegativeInteger(
          firstDefined(object.minimum, object.min_count, object.min_coverage, object.coverage, defaultMinimum),
          `${field}[${index}].minimum`,
        ),
        importance: normalizeScore(
          firstDefined(object.importance, 0),
          `${field}[${index}].importance`,
        ),
        reason: object.reason == null ? null : normalizeText(object.reason, `${field}[${index}].reason`),
      })
    })
  } else if (isPlainObject(input)) {
    for (const [skillId, value] of Object.entries(input)) {
      if (isPlainObject(value)) {
        rows.push({
          skill_id: requireNonEmptyString(skillId, `${field}.${skillId}`),
          minimum: requireNonNegativeInteger(
            firstDefined(value.minimum, value.min_count, value.min_coverage, value.coverage, defaultMinimum),
            `${field}.${skillId}.minimum`,
          ),
          importance: normalizeScore(firstDefined(value.importance, 0), `${field}.${skillId}.importance`),
          reason: value.reason == null ? null : normalizeText(value.reason, `${field}.${skillId}.reason`),
        })
      } else {
        rows.push({
          skill_id: requireNonEmptyString(skillId, `${field}.${skillId}`),
          minimum: requireNonNegativeInteger(value, `${field}.${skillId}`),
          importance: 0,
          reason: null,
        })
      }
    }
  } else {
    throw contractError('INVALID_FIELD_TYPE', `${field} must be an array or object.`, { field })
  }

  const bySkill = new Map()
  for (const row of rows) {
    const previous = bySkill.get(row.skill_id)
    if (!previous || row.minimum > previous.minimum) {
      bySkill.set(row.skill_id, row)
    }
  }
  return [...bySkill.values()].sort((left, right) => left.skill_id.localeCompare(right.skill_id))
}

export function normalizeSameDayLedger(input, options = {}) {
  const revisitWindowMinMs = normalizeWindowDurationOption(
    options.revisit_window_min_ms,
    DEFAULT_SAME_DAY_REVISIT_WINDOW_MIN_MS,
    'same_day_ledger.revisit_window_min_ms',
  )
  const revisitWindowMaxMs = normalizeWindowDurationOption(
    options.revisit_window_max_ms,
    DEFAULT_SAME_DAY_REVISIT_WINDOW_MAX_MS,
    'same_day_ledger.revisit_window_max_ms',
  )
  if (revisitWindowMaxMs < revisitWindowMinMs) {
    throw contractError(
      'INVALID_FIELD_VALUE',
      'same_day_ledger revisit window maximum must be at least the minimum.',
      {
        field: 'same_day_ledger.revisit_window_max_ms',
        minimum: revisitWindowMinMs,
        maximum: revisitWindowMaxMs,
      },
    )
  }
  if (input == null) {
    return {
      schema_version: 'same-day-ledger.v1',
      local_day: null,
      total_count: 0,
      attempt_count: 0,
      revisit_count: 0,
      mature_count: 0,
      by_learning_unit: {},
      by_learning_unit_attempts: {},
      by_learning_unit_revisits: {},
      revisit_windows: {},
      revisit_window_policy: {
        min_ms: revisitWindowMinMs,
        max_ms: revisitWindowMaxMs,
      },
      entries: [],
    }
  }
  if (Array.isArray(input)) {
    return normalizeSameDayLedger({ entries: input }, options)
  }
  const source = requirePlainObject(input, 'same_day_ledger')
  const rawEntries = firstDefined(source.entries, source.items, source.records, [])
  if (!Array.isArray(rawEntries)) {
    throw contractError(
      'INVALID_FIELD_TYPE',
      'same_day_ledger.entries must be an array.',
      { field: 'same_day_ledger.entries' },
    )
  }

  const entries = rawEntries
    .map((entry, index) => normalizeLedgerEntry(entry, index))
    .filter((entry) => entry.counted)
    .sort(compareLedgerEntries)
  const byLearningUnit = {}
  const byLearningUnitAttempts = {}
  const byLearningUnitRevisits = {}
  const revisitWindows = {}
  let derivedMatureCount = 0
  let derivedAttemptCount = 0
  let derivedRevisitCount = 0
  for (const entry of entries) {
    const learningUnitId = entry.learning_unit_id
    byLearningUnit[learningUnitId] = (byLearningUnit[learningUnitId] ?? 0) + 1
    if (entry.is_revisit) {
      derivedRevisitCount += 1
      byLearningUnitRevisits[learningUnitId] = (byLearningUnitRevisits[learningUnitId] ?? 0) + 1
    } else {
      derivedAttemptCount += 1
      byLearningUnitAttempts[learningUnitId] = (byLearningUnitAttempts[learningUnitId] ?? 0) + 1
      const window = entry.revisit_window ?? deriveRevisitWindow(
        entry.occurred_at,
        revisitWindowMinMs,
        revisitWindowMaxMs,
      )
      if (window) appendRevisitWindow(revisitWindows, learningUnitId, window)
    }
    if (entry.is_mature) derivedMatureCount += 1
  }

  const explicitCounts = source.counts && isPlainObject(source.counts) ? source.counts : {}
  const explicitByUnit = explicitCounts.by_learning_unit && isPlainObject(explicitCounts.by_learning_unit)
    ? explicitCounts.by_learning_unit
    : source.by_learning_unit && isPlainObject(source.by_learning_unit)
      ? source.by_learning_unit
      : {}
  mergeLedgerCounts(byLearningUnit, explicitByUnit, 'same_day_ledger.by_learning_unit')
  const explicitByUnitAttempts = firstDefined(
    explicitCounts.by_learning_unit_attempts,
    source.by_learning_unit_attempts,
    {},
  )
  if (!isPlainObject(explicitByUnitAttempts)) {
    throw contractError(
      'INVALID_FIELD_TYPE',
      'same_day_ledger.by_learning_unit_attempts must be an object.',
      { field: 'same_day_ledger.by_learning_unit_attempts' },
    )
  }
  mergeLedgerCounts(
    byLearningUnitAttempts,
    explicitByUnitAttempts,
    'same_day_ledger.by_learning_unit_attempts',
  )
  const explicitByUnitRevisits = firstDefined(
    explicitCounts.by_learning_unit_revisits,
    source.by_learning_unit_revisits,
    {},
  )
  if (!isPlainObject(explicitByUnitRevisits)) {
    throw contractError(
      'INVALID_FIELD_TYPE',
      'same_day_ledger.by_learning_unit_revisits must be an object.',
      { field: 'same_day_ledger.by_learning_unit_revisits' },
    )
  }
  mergeLedgerCounts(
    byLearningUnitRevisits,
    explicitByUnitRevisits,
    'same_day_ledger.by_learning_unit_revisits',
  )

  // Typed attempt/revisit maps are disjoint ledger views.  Reconstruct the
  // per-unit total from them so a caller cannot accidentally under-count the
  // daily limit by omitting the legacy aggregate map.
  const typedLearningUnitIds = new Set([
    ...Object.keys(byLearningUnitAttempts),
    ...Object.keys(byLearningUnitRevisits),
  ])
  for (const learningUnitId of typedLearningUnitIds) {
    const typedTotal = (byLearningUnitAttempts[learningUnitId] ?? 0)
      + (byLearningUnitRevisits[learningUnitId] ?? 0)
    byLearningUnit[learningUnitId] = Math.max(byLearningUnit[learningUnitId] ?? 0, typedTotal)
  }

  const explicitWindows = firstDefined(
    source.revisit_windows,
    source.revisitWindows,
    {},
  )
  if (!isPlainObject(explicitWindows)) {
    throw contractError(
      'INVALID_FIELD_TYPE',
      'same_day_ledger.revisit_windows must be an object.',
      { field: 'same_day_ledger.revisit_windows' },
    )
  }
  for (const [learningUnitId, rawWindows] of Object.entries(explicitWindows)) {
    const normalizedId = requireNonEmptyString(learningUnitId, 'same_day_ledger.revisit_windows')
    const windows = Array.isArray(rawWindows) ? rawWindows : [rawWindows]
    for (const [index, rawWindow] of windows.entries()) {
      const window = normalizeRevisitWindow(
        rawWindow,
        `same_day_ledger.revisit_windows.${learningUnitId}[${index}]`,
      )
      if (window) appendRevisitWindow(revisitWindows, normalizedId, window)
    }
  }

  const derivedTotalCount = Object.values(byLearningUnit).reduce((total, count) => total + count, 0)
  const derivedAttemptCountFromUnits = Object.values(byLearningUnitAttempts)
    .reduce((total, count) => total + count, 0)
  const derivedRevisitCountFromUnits = Object.values(byLearningUnitRevisits)
    .reduce((total, count) => total + count, 0)
  const explicitTotalCount = firstDefined(explicitCounts.total_count, source.total_count, null)
  const explicitAttemptCount = firstDefined(explicitCounts.attempt_count, source.attempt_count, null)
  const explicitRevisitCount = firstDefined(explicitCounts.revisit_count, source.revisit_count, null)
  const explicitMatureCount = firstDefined(explicitCounts.mature_count, source.mature_count, null)
  const normalizedExplicitTotalCount = explicitTotalCount == null
    ? null
    : requireNonNegativeInteger(explicitTotalCount, 'same_day_ledger.total_count')
  const normalizedExplicitAttemptCount = explicitAttemptCount == null
    ? null
    : requireNonNegativeInteger(explicitAttemptCount, 'same_day_ledger.attempt_count')
  const normalizedExplicitRevisitCount = explicitRevisitCount == null
    ? null
    : requireNonNegativeInteger(explicitRevisitCount, 'same_day_ledger.revisit_count')
  const normalizedExplicitMatureCount = explicitMatureCount == null
    ? null
    : requireNonNegativeInteger(explicitMatureCount, 'same_day_ledger.mature_count')
  const totalCount = explicitTotalCount == null
    ? Math.max(
      entries.length,
      derivedTotalCount,
      normalizedExplicitAttemptCount ?? 0,
      normalizedExplicitRevisitCount ?? 0,
      (normalizedExplicitAttemptCount ?? 0) + (normalizedExplicitRevisitCount ?? 0),
    )
    : Math.max(
      derivedTotalCount,
      normalizedExplicitTotalCount,
      (normalizedExplicitAttemptCount ?? 0) + (normalizedExplicitRevisitCount ?? 0),
    )
  const attemptCount = explicitAttemptCount == null
    ? Math.max(derivedAttemptCount, derivedAttemptCountFromUnits)
    : Math.max(
      derivedAttemptCount,
      derivedAttemptCountFromUnits,
      normalizedExplicitAttemptCount,
    )
  const revisitCount = explicitRevisitCount == null
    ? Math.max(derivedRevisitCount, derivedRevisitCountFromUnits)
    : Math.max(
      derivedRevisitCount,
      derivedRevisitCountFromUnits,
      normalizedExplicitRevisitCount,
    )
  const matureCount = explicitMatureCount == null
    ? derivedMatureCount
    : Math.max(
      derivedMatureCount,
      normalizedExplicitMatureCount,
    )

  return {
    schema_version: firstDefined(source.schema_version, 'same-day-ledger.v1'),
    local_day: source.local_day == null ? null : normalizeLocalDay(source.local_day, 'same_day_ledger.local_day'),
    total_count: totalCount,
    attempt_count: attemptCount,
    revisit_count: revisitCount,
    mature_count: matureCount,
    by_learning_unit: sortCountObject(byLearningUnit),
    by_learning_unit_attempts: sortCountObject(byLearningUnitAttempts),
    by_learning_unit_revisits: sortCountObject(byLearningUnitRevisits),
    revisit_windows: sortWindowObject(revisitWindows),
    revisit_window_policy: {
      min_ms: revisitWindowMinMs,
      max_ms: revisitWindowMaxMs,
    },
    entries,
  }
}

export function normalizePresentationRankings(input) {
  if (input == null) {
    return { schema_version: 'presentation-ranking.v1', ranking_version: 'presentation-ranking.unknown', by_learning_unit: {} }
  }
  const source = Array.isArray(input) ? { rankings: input } : requirePlainObject(input, 'presentation_rankings')
  const rankingVersion = firstDefined(
    source.ranking_version,
    source.preference_model_version,
    source.version,
    'presentation-ranking.unknown',
  )
  const map = {}
  const rawByUnit = firstDefined(source.by_learning_unit, source.rankings, null)
  if (Array.isArray(rawByUnit)) {
    for (const [index, row] of rawByUnit.entries()) {
      if (!isPlainObject(row)) continue
      const learningUnitId = firstDefined(row.learning_unit_id, row.id)
      if (typeof learningUnitId !== 'string' || !learningUnitId.trim()) continue
      map[learningUnitId] = normalizeRankingEntries(
        firstDefined(
          row.ranked_presentations,
          row.ranked,
          row.ranking,
          row.presentations,
          row.allowed_presentations,
          [],
        ),
        `presentation_rankings[${index}]`,
      )
    }
  } else if (isPlainObject(rawByUnit)) {
    for (const [learningUnitId, ranking] of Object.entries(rawByUnit)) {
      map[learningUnitId] = normalizeRankingEntries(ranking, `presentation_rankings.${learningUnitId}`)
    }
  } else {
    for (const [learningUnitId, ranking] of Object.entries(source)) {
      if (['schema_version', 'ranking_version', 'preference_model_version', 'version'].includes(learningUnitId)) continue
      if (Array.isArray(ranking) || isPlainObject(ranking)) {
        map[learningUnitId] = normalizeRankingEntries(ranking, `presentation_rankings.${learningUnitId}`)
      }
    }
  }

  return {
    schema_version: firstDefined(source.schema_version, 'presentation-ranking.v1'),
    ranking_version: rankingVersion,
    by_learning_unit: Object.fromEntries(
      Object.entries(map).sort(([left], [right]) => left.localeCompare(right)),
    ),
  }
}

export function selectAllowedPresentation(candidate, rankings) {
  const allowed = candidate.allowed_presentations.slice().sort(compareAllowedPresentations)
  if (allowed.length === 0) {
    return {
      selected_presentation: null,
      preferred_presentation: null,
      raw_preference_score: 0,
      preference_observed: false,
      fallback_used: false,
      reason_code: 'NO_ALLOWED_PRESENTATION',
    }
  }

  const rankingSource = rankings?.by_learning_unit?.[candidate.learning_unit_id]
    ?? normalizeRankingEntries(candidate.presentation_ranking, 'candidate.presentation_ranking')
  const candidatePreferenceRanking = rankingSource.length === 0
    ? allowed
      .filter((entry) => entry.ranker_score !== null || entry.preference_contribution !== null)
      .map((entry) => ({
        variant_id: entry.variant_id,
        ranker_score: entry.ranker_score,
        preference_contribution: entry.preference_contribution,
        rank: null,
      }))
    : rankingSource
  const ranking = Array.isArray(candidatePreferenceRanking) ? candidatePreferenceRanking : []
  const preferredPresentation = ranking[0]?.variant_id ?? null
  const allowedIds = new Set(allowed.map((entry) => entry.variant_id))
  const rankedAllowed = ranking.find((entry) => allowedIds.has(entry.variant_id))
  const selected = rankedAllowed?.variant_id ?? allowed[0].variant_id
  const selectedRanking = ranking.find((entry) => entry.variant_id === selected)
  const selectedAllowed = allowed.find((entry) => entry.variant_id === selected)
  const preferenceObserved = selectedRanking?.preference_contribution != null
    || selectedAllowed?.preference_contribution != null
  const fallbackUsed = preferredPresentation !== null && !allowedIds.has(preferredPresentation)
  return {
    selected_presentation: selected,
    preferred_presentation: preferredPresentation,
    raw_preference_score: selectedRanking?.preference_contribution
      ?? selectedAllowed?.preference_contribution
      ?? 0,
    preference_observed: preferenceObserved,
    fallback_used: fallbackUsed,
    reason_code: fallbackUsed
      ? 'PRESENTATION_FALLBACK_ALLOWED'
      : (selectedRanking ? 'PRESENTATION_RANKED' : 'PRESENTATION_DETERMINISTIC_DEFAULT'),
  }
}

export function evaluateCurriculumConstraints(candidate, context = {}) {
  const policy = context.policy ?? normalizeCurriculumPolicy({})
  const ledger = context.same_day_ledger ?? normalizeSameDayLedger(null)
  const asOfMs = Number.isFinite(context.as_of_ms)
    ? context.as_of_ms
    : Date.parse(context.as_of ?? DEFAULT_CURRICULUM_AS_OF)
  const plannedDurationMs = Number.isInteger(context.planned_duration_ms)
    ? context.planned_duration_ms
    : 0
  const selectedCount = Number.isInteger(context.selected_count) ? context.selected_count : 0
  const selectedUnitCounts = context.selected_unit_counts instanceof Map
    ? context.selected_unit_counts
    : new Map()
  const selectedRevisitUnitCounts = context.selected_revisit_unit_counts instanceof Map
    ? context.selected_revisit_unit_counts
    : new Map()
  const budgetMs = Number.isInteger(context.budget_ms) ? context.budget_ms : policy.budget_ms

  const dueOrEligible = isDueOrEligible(candidate, asOfMs)
  const contentAvailable = isContentAvailable(candidate.content_status)
  const presentationAvailable = candidate.allowed_presentations.length > 0
  const timeBudgetAvailable = plannedDurationMs + candidate.estimated_duration_ms <= budgetMs
  const dailyCount = ledger.total_count + selectedCount
  const sameDayAvailable = dailyCount < policy.same_day_max_items
  const existingUnitCount = ledger.by_learning_unit[candidate.learning_unit_id] ?? 0
  const existingAttemptCount = ledger.by_learning_unit_attempts?.[candidate.learning_unit_id] ?? 0
  const existingRevisitCount = ledger.by_learning_unit_revisits?.[candidate.learning_unit_id] ?? 0
  const selectedForUnit = selectedUnitCounts.get(candidate.learning_unit_id) ?? 0
  const selectedRevisitForUnit = selectedRevisitUnitCounts.get(candidate.learning_unit_id) ?? 0
  const candidateRevisitCount = Number.isInteger(candidate.same_day_revisit_count)
    ? candidate.same_day_revisit_count
    : 0
  const revisitRequested = candidate.is_revisit === true
    || candidateRevisitCount > 0
  const revisitCount = existingRevisitCount + candidateRevisitCount + selectedRevisitForUnit
  const revisitLimitAvailable = !revisitRequested
    || revisitCount < policy.same_day_revisit_max_per_learning_unit
  const revisitWindowEvaluation = revisitRequested
    ? evaluateRevisitWindow(candidate, ledger, asOfMs, policy)
    : {
      available: true,
      status: 'not_applicable',
      window: null,
    }

  const failures = []
  const hits = []
  addConstraintResult(failures, hits, dueOrEligible, 'DUE_OR_ELIGIBLE', 'NOT_DUE_OR_ELIGIBLE')
  addConstraintResult(failures, hits, contentAvailable, 'CONTENT_AVAILABLE', 'CONTENT_UNAVAILABLE')
  addConstraintResult(failures, hits, presentationAvailable, 'PRESENTATION_AVAILABLE', 'NO_ALLOWED_PRESENTATION')
  addConstraintResult(failures, hits, timeBudgetAvailable, 'TIME_BUDGET_AVAILABLE', 'TIME_BUDGET_EXCEEDED')
  addConstraintResult(failures, hits, sameDayAvailable, 'SAME_DAY_LIMIT_AVAILABLE', 'SAME_DAY_ITEM_LIMIT')
  addConstraintResult(failures, hits, revisitLimitAvailable, 'SAME_DAY_REVISIT_LIMIT_AVAILABLE', 'SAME_DAY_REVISIT_LIMIT')
  addConstraintResult(
    failures,
    hits,
    revisitWindowEvaluation.available,
    revisitWindowEvaluation.status === 'not_applicable'
      ? 'SAME_DAY_REVISIT_WINDOW_NOT_APPLICABLE'
      : 'SAME_DAY_REVISIT_WINDOW_AVAILABLE',
    revisitWindowEvaluation.status === 'not_open'
      ? 'SAME_DAY_REVISIT_WINDOW_NOT_OPEN'
      : revisitWindowEvaluation.status === 'expired'
        ? 'SAME_DAY_REVISIT_WINDOW_EXPIRED'
        : 'SAME_DAY_REVISIT_WINDOW_UNAVAILABLE',
  )

  return {
    selectable: failures.length === 0,
    constraint_hits: hits,
    failed_constraints: failures,
    details: {
      due_or_eligible: dueOrEligible,
      content_available: contentAvailable,
      presentation_available: presentationAvailable,
      time_budget_available: timeBudgetAvailable,
      same_day_available: sameDayAvailable,
      same_day_revisit_requested: revisitRequested,
      same_day_revisit_available: revisitLimitAvailable && revisitWindowEvaluation.available,
      same_day_revisit_limit_available: revisitLimitAvailable,
      same_day_revisit_window_status: revisitWindowEvaluation.status,
      same_day_revisit_window: revisitWindowEvaluation.window,
      same_day_revisit_window_min_ms: policy.same_day_revisit_window_min_ms,
      same_day_revisit_window_max_ms: policy.same_day_revisit_window_max_ms,
      remaining_budget_ms: budgetMs - plannedDurationMs,
      existing_same_day_count: ledger.total_count,
      existing_learning_unit_same_day_count: existingUnitCount,
      existing_learning_unit_attempt_count: existingAttemptCount,
      existing_learning_unit_revisit_count: existingRevisitCount,
      planned_learning_unit_same_day_count: selectedForUnit,
      planned_learning_unit_revisit_count: selectedRevisitForUnit,
      candidate_revisit_count: candidateRevisitCount,
    },
  }
}

export function isContentAvailable(contentStatus) {
  if (typeof contentStatus === 'string') {
    return CONTENT_AVAILABLE_STATUS_SET.has(contentStatus.toLowerCase())
  }
  if (contentStatus === true) return true
  if (!isPlainObject(contentStatus)) return false
  if (contentStatus.available === true) return true
  const nestedStatus = firstDefined(contentStatus.status, contentStatus.quality_status, contentStatus.state, null)
  return typeof nestedStatus === 'string' && CONTENT_AVAILABLE_STATUS_SET.has(nestedStatus.toLowerCase())
}

export function isDueOrEligible(candidate, asOfMs) {
  if (candidate.eligible === true || candidate.is_due === true) return true
  if (candidate.eligible === false || candidate.is_due === false) return false
  return candidate.due_at !== null && Date.parse(candidate.due_at) <= asOfMs
}

export function classifyCurriculumQueueTier(candidate, asOfMs) {
  const queueKind = typeof candidate.queue_kind === 'string'
    ? candidate.queue_kind.toLowerCase()
    : null
  if (['due', 'due_review', 'review_due', 'due_review_item'].includes(queueKind)) {
    return {
      tier: 'due_review',
      priority: 0,
      reason_code: 'DUE_REVIEW_PRIORITY',
    }
  }
  if (candidate.is_due === true) {
    return {
      tier: 'due_review',
      priority: 0,
      reason_code: 'DUE_REVIEW_PRIORITY',
    }
  }
  if (
    ['relearning', 'revisit', 'review_revisit', 'relearning_revisit'].includes(queueKind)
    || candidate.is_revisit === true
  ) {
    return {
      tier: 'relearning_revisit',
      priority: 1,
      reason_code: 'RELEARNING_REVISIT_PRIORITY',
    }
  }
  if (
    ['reassessment', 'legacy_reassessment', 'review_reassessment'].includes(queueKind)
    || candidate.is_reassessment === true
  ) {
    return {
      tier: 'reassessment',
      priority: 2,
      reason_code: 'REASSESSMENT_PRIORITY',
    }
  }
  if (candidate.due_at !== null && Date.parse(candidate.due_at) <= asOfMs) {
    return {
      tier: 'due_review',
      priority: 0,
      reason_code: 'DUE_REVIEW_PRIORITY',
    }
  }
  return {
    tier: 'acquisition',
    priority: 3,
    reason_code: 'ACQUISITION_PRIORITY',
  }
}

function evaluateRevisitWindow(candidate, ledger, asOfMs, policy) {
  const explicitWindow = candidate.revisit_window
  const ledgerWindows = ledger.revisit_windows?.[candidate.learning_unit_id] ?? []
  const windows = explicitWindow ? [explicitWindow] : ledgerWindows
  if (windows.length === 0) {
    return {
      available: false,
      status: 'unavailable',
      window: null,
    }
  }
  const normalizedWindows = windows
    .filter((revisitWindow) => isWindowWithinPolicy(revisitWindow, candidate, ledger, policy))
    .sort((left, right) => (
      left.start_at.localeCompare(right.start_at)
      || left.end_at.localeCompare(right.end_at)
    ))
  const activeWindow = normalizedWindows.find((revisitWindow) => {
    const startAtMs = Date.parse(revisitWindow.start_at)
    const endAtMs = Date.parse(revisitWindow.end_at)
    return asOfMs >= startAtMs && asOfMs <= endAtMs
  })
  if (activeWindow) {
    return {
      available: true,
      status: 'available',
      window: activeWindow,
    }
  }
  const nextWindow = normalizedWindows.find((revisitWindow) => asOfMs < Date.parse(revisitWindow.start_at))
  if (nextWindow) {
    return {
      available: false,
      status: 'not_open',
      window: nextWindow,
    }
  }
  return {
    available: false,
    status: 'expired',
    window: normalizedWindows[normalizedWindows.length - 1] ?? null,
  }
}

function isWindowWithinPolicy(revisitWindow, candidate, ledger, policy) {
  const startAtMs = Date.parse(revisitWindow.start_at)
  const endAtMs = Date.parse(revisitWindow.end_at)
  if (!Number.isFinite(startAtMs) || !Number.isFinite(endAtMs) || endAtMs < startAtMs) return false
  const anchorCandidates = [
    candidate.revisit_anchor_at,
    ...((ledger.entries ?? [])
      .filter((entry) => entry.learning_unit_id === candidate.learning_unit_id && !entry.is_revisit)
      .map((entry) => entry.occurred_at)
      .filter(Boolean)),
  ]
  const anchorAt = anchorCandidates.length > 0 ? Date.parse(anchorCandidates[anchorCandidates.length - 1]) : null
  if (!Number.isFinite(anchorAt)) {
    // Explicit windows are already an authoritative scheduler snapshot.  A
    // derived ledger window has an anchor encoded by its exact duration.  In
    // either case, reject a window that cannot express the configured range.
    const windowDurationMs = endAtMs - startAtMs
    return windowDurationMs >= policy.same_day_revisit_window_min_ms
      && windowDurationMs <= policy.same_day_revisit_window_max_ms
  }
  return startAtMs >= anchorAt + policy.same_day_revisit_window_min_ms
    && endAtMs <= anchorAt + policy.same_day_revisit_window_max_ms
}

/**
 * Normalize a signed presentation preference without erasing dislikes.
 * PL-C may provide any finite signed score; the planner contract uses [-1, 1]
 * so negative preference remains negative and can lower the bounded component.
 */
export function normalizeSignedPreferenceScore(value, field = 'preference_score') {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw contractError('INVALID_FIELD_TYPE', `${field} must be a finite number.`, { field })
  }
  return Math.min(1, Math.max(-1, value))
}

export function clampUnitInterval(value) {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function normalizeSkillEstimate(input, index) {
  const field = `skill_profile.estimates[${index}]`
  if (typeof input === 'string') {
    return {
      skill_id: normalizeText(input, field),
      mastery_mean: 0.5,
      uncertainty: 1,
      eligible_evidence_count: 0,
      importance: 0,
      is_weak: false,
      required: false,
      minimum_coverage: null,
      gap: 0.5,
      last_observed_at: null,
    }
  }
  const source = requirePlainObject(input, field)
  const skillId = requireNonEmptyString(firstDefined(source.skill_id, source.id), `${field}.skill_id`)
  const masteryMean = normalizeScore(firstDefined(source.mastery_mean, source.mastery, 0.5), `${field}.mastery_mean`)
  const uncertainty = normalizeScore(firstDefined(source.uncertainty, source.uncertainty_mean, 1), `${field}.uncertainty`)
  const gap = normalizeScore(firstDefined(source.gap, 1 - masteryMean), `${field}.gap`)
  const lastObservedAt = source.last_observed_at == null
    ? null
    : normalizeUtcTimestamp(source.last_observed_at, `${field}.last_observed_at`)
  const minimumCoverage = firstDefined(source.minimum_coverage, source.min_coverage, source.required_coverage, null)
  return {
    skill_id: skillId,
    mastery_mean: masteryMean,
    uncertainty,
    eligible_evidence_count: requireNonNegativeInteger(
      firstDefined(source.eligible_evidence_count, source.evidence_count, 0),
      `${field}.eligible_evidence_count`,
    ),
    importance: normalizeScore(firstDefined(source.importance, 0), `${field}.importance`),
    is_weak: source.is_weak === true || source.weak === true,
    required: source.required === true,
    minimum_coverage: minimumCoverage == null
      ? null
      : requireNonNegativeInteger(minimumCoverage, `${field}.minimum_coverage`),
    gap,
    last_observed_at: lastObservedAt,
  }
}

function normalizeAllowedPresentations(input, field) {
  if (!Array.isArray(input)) {
    throw contractError('INVALID_FIELD_TYPE', `${field} must be an array.`, { field })
  }
  const byId = new Map()
  for (const [index, item] of input.entries()) {
    const value = typeof item === 'string'
      ? { variant_id: item }
      : requirePlainObject(item, `${field}[${index}]`)
    const variantId = requireNonEmptyString(
      firstDefined(value.variant_id, value.id),
      `${field}[${index}].variant_id`,
    )
    const preferenceContribution = firstDefined(
      value.preference_contribution,
      value.preference_score,
      value.user_preference,
      value.preference,
      null,
    ) == null
      ? null
      : normalizeSignedPreferenceScore(
        firstDefined(
          value.preference_contribution,
          value.preference_score,
          value.user_preference,
          value.preference,
        ),
        `${field}[${index}].preference_contribution`,
      )
    const rankerScore = value.ranker_score == null && value.base_score == null && value.score == null
      ? null
      : normalizeScore(
        firstDefined(value.ranker_score, value.base_score, value.score),
        `${field}[${index}].ranker_score`,
      )
    const normalized = {
      variant_id: variantId,
      ranker_score: rankerScore,
      preference_contribution: preferenceContribution,
      features: cloneJson(value.features ?? {}),
    }
    if (!byId.has(variantId) || compareAllowedPresentations(normalized, byId.get(variantId)) < 0) {
      byId.set(variantId, normalized)
    }
  }
  return [...byId.values()].sort(compareAllowedPresentations)
}

function normalizeRankingEntries(input, field) {
  if (input == null) return []
  if (isPlainObject(input)) {
    const nested = firstDefined(
      input.ranked_presentations,
      input.ranked,
      input.ranking,
      input.presentations,
      input.variants,
      undefined,
    )
    if (nested !== undefined) return normalizeRankingEntries(nested, `${field}.ranking`)
  }
  let rows
  if (Array.isArray(input)) {
    rows = input
  } else if (isPlainObject(input)) {
    rows = Object.entries(input).map(([variantId, value]) => (
      isPlainObject(value) ? { ...value, variant_id: value.variant_id ?? variantId } : {
        variant_id: variantId,
        ranker_score: value,
      }
    ))
  } else {
    throw contractError('INVALID_FIELD_TYPE', `${field} must be an array or object.`, { field })
  }
  const normalized = rows.map((row, index) => {
    const object = typeof row === 'string' ? { variant_id: row } : requirePlainObject(row, `${field}[${index}]`)
    const variantId = requireNonEmptyString(firstDefined(object.variant_id, object.id), `${field}[${index}].variant_id`)
    const rankerScoreInput = firstDefined(
      object.ranker_score,
      object.base_score,
      object.score,
      object.rank_score,
      null,
    )
    const preferenceInput = firstDefined(
      object.preference_contribution,
      object.preference_score,
      object.user_preference,
      object.preference,
      null,
    )
    const rankInput = firstDefined(object.rank, object.position, null)
    const rankerScore = rankerScoreInput == null
      ? (rankInput == null ? null : clampUnitInterval(1 - Math.max(0, Number(rankInput) - 1) / 100))
      : normalizeScore(rankerScoreInput, `${field}[${index}].ranker_score`)
    const preferenceContribution = preferenceInput == null
      ? null
      : normalizeSignedPreferenceScore(preferenceInput, `${field}[${index}].preference_contribution`)
    return {
      variant_id: variantId,
      ranker_score: rankerScore,
      preference_contribution: preferenceContribution,
      rank: rankInput == null ? null : requirePositiveInteger(rankInput, `${field}[${index}].rank`),
    }
  })
  const byId = new Map()
  for (const row of normalized) {
    const previous = byId.get(row.variant_id)
    if (!previous || compareRankingEntries(row, previous) < 0) byId.set(row.variant_id, row)
  }
  const unique = [...byId.values()]
  const hasExplicitRankerScore = unique.some((row) => row.ranker_score !== null)
  if (!hasExplicitRankerScore) {
    unique.forEach((row, index) => {
      row.ranker_score = unique.length === 1 ? 1 : 1 - index / (unique.length - 1)
    })
  }
  return unique.sort(compareRankingEntries)
}

function normalizeLedgerEntry(input, index) {
  const field = `same_day_ledger.entries[${index}]`
  if (typeof input === 'string') {
    return {
      learning_unit_id: normalizeText(input, field),
      entry_kind: 'attempt',
      is_attempt: true,
      is_revisit: false,
      is_mature: false,
      counted: true,
      occurred_at: null,
      revisit_window: null,
    }
  }
  const source = requirePlainObject(input, field)
  const status = firstDefined(source.status, source.state, null)
  const counted = source.counted !== false && status !== 'cancelled' && status !== 'canceled'
  const rawKind = firstDefined(
    source.entry_kind,
    source.kind,
    source.attempt_kind,
    source.record_kind,
    source.queue_kind,
    null,
  )
  const normalizedKind = rawKind == null ? null : normalizeText(rawKind, `${field}.entry_kind`).toLowerCase()
  const isRevisit = source.is_revisit === true
    || source.revisit === true
    || ['revisit', 'review_revisit', 'same_day_revisit'].includes(normalizedKind)
  const isAttempt = source.is_attempt !== false && !isRevisit
  return {
    learning_unit_id: requireNonEmptyString(
      firstDefined(source.learning_unit_id, source.id),
      `${field}.learning_unit_id`,
    ),
    entry_kind: isRevisit ? 'revisit' : 'attempt',
    is_attempt: isAttempt,
    is_revisit: isRevisit,
    is_mature: normalizeMaturity(source),
    counted,
    occurred_at: source.occurred_at == null ? null : normalizeUtcTimestamp(source.occurred_at, `${field}.occurred_at`),
    revisit_window: normalizeRevisitWindow(
      firstDefined(source.revisit_window, source.revisitWindow, null),
      `${field}.revisit_window`,
    ),
  }
}

function normalizeRevisitWindow(input, field) {
  if (input == null) return null
  const source = requirePlainObject(input, field)
  const startAt = firstDefined(
    source.start_at,
    source.window_start_at,
    source.revisit_window_start_at,
    source.revisit_available_at,
    source.available_at,
    null,
  )
  const endAt = firstDefined(
    source.end_at,
    source.window_end_at,
    source.revisit_window_end_at,
    source.revisit_expires_at,
    source.expires_at,
    null,
  )
  if (startAt == null || endAt == null) {
    throw contractError(
      'INVALID_FIELD_VALUE',
      `${field} must contain both start_at and end_at.`,
      { field },
    )
  }
  const normalizedStartAt = normalizeUtcTimestamp(startAt, `${field}.start_at`)
  const normalizedEndAt = normalizeUtcTimestamp(endAt, `${field}.end_at`)
  if (Date.parse(normalizedEndAt) < Date.parse(normalizedStartAt)) {
    throw contractError(
      'INVALID_FIELD_VALUE',
      `${field}.end_at must not precede start_at.`,
      { field },
    )
  }
  return {
    start_at: normalizedStartAt,
    end_at: normalizedEndAt,
  }
}

function deriveRevisitWindow(occurredAt, minimumMs, maximumMs) {
  if (occurredAt == null) return null
  const occurredAtMs = Date.parse(occurredAt)
  return {
    start_at: new Date(occurredAtMs + minimumMs).toISOString(),
    end_at: new Date(occurredAtMs + maximumMs).toISOString(),
  }
}

function appendRevisitWindow(revisitWindows, learningUnitId, revisitWindow) {
  if (!revisitWindows[learningUnitId]) revisitWindows[learningUnitId] = []
  const duplicate = revisitWindows[learningUnitId].some((existing) => (
    existing.start_at === revisitWindow.start_at && existing.end_at === revisitWindow.end_at
  ))
  if (!duplicate) revisitWindows[learningUnitId].push({ ...revisitWindow })
}

function mergeLedgerCounts(target, input, field) {
  for (const [learningUnitId, count] of Object.entries(input)) {
    const normalizedId = requireNonEmptyString(learningUnitId, field)
    const normalizedCount = requireNonNegativeInteger(count, `${field}.${learningUnitId}`)
    target[normalizedId] = Math.max(target[normalizedId] ?? 0, normalizedCount)
  }
}

function sortCountObject(counts) {
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  )
}

function sortWindowObject(windows) {
  return Object.fromEntries(
    Object.entries(windows)
      .map(([learningUnitId, entries]) => [
        learningUnitId,
        entries.slice().sort((left, right) => (
          left.start_at.localeCompare(right.start_at)
          || left.end_at.localeCompare(right.end_at)
        )),
      ])
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

function normalizeWindowDurationOption(value, fallback, field) {
  return value == null ? fallback : requirePositiveInteger(value, field)
}

function normalizeContentStatus(value) {
  if (typeof value === 'string') return normalizeText(value, 'content_status').toLowerCase()
  if (value === true) return 'available'
  if (isPlainObject(value)) {
    return cloneJson(value)
  }
  return null
}

function normalizeMaturity(source) {
  if (source.is_mature === true || source.mature === true) return true
  if (typeof source.maturity === 'string') return source.maturity.toLowerCase() === 'mature'
  if (typeof source.status === 'string' && source.status.toLowerCase() === 'mature') return true
  if (typeof source.state === 'string' && ['review', 'mature'].includes(source.state.toLowerCase())) return true
  if (typeof source.review_state === 'string' && source.review_state.toLowerCase() === 'mature') return true
  if (
    isPlainObject(source.review_state)
    && ['review', 'mature'].includes(String(source.review_state.state).toLowerCase())
  ) return true
  return false
}

function normalizeText(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw contractError('INVALID_FIELD_TYPE', `${field} must be a non-empty string.`, { field })
  }
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
}

function normalizeUtcTimestamp(value, field) {
  if (typeof value !== 'string' || !value.endsWith('Z') || !Number.isFinite(Date.parse(value))) {
    throw contractError('INVALID_TIMESTAMP', `${field} must be a UTC ISO-8601 timestamp.`, { field })
  }
  return new Date(Date.parse(value)).toISOString()
}

function normalizeLocalDay(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw contractError('INVALID_FIELD_TYPE', `${field} must use YYYY-MM-DD.`, { field })
  }
  const [year, month, day] = value.split('-').map(Number)
  const roundTrip = new Date(Date.UTC(year, month - 1, day))
  if (
    roundTrip.getUTCFullYear() !== year
    || roundTrip.getUTCMonth() + 1 !== month
    || roundTrip.getUTCDate() !== day
  ) {
    throw contractError('INVALID_FIELD_TYPE', `${field} must be a real calendar day.`, { field })
  }
  return value
}

function normalizeStringArray(value, field) {
  if (!Array.isArray(value)) {
    throw contractError('INVALID_FIELD_TYPE', `${field} must be an array.`, { field })
  }
  return [...new Set(value.map((item, index) => normalizeText(item, `${field}[${index}]`)))].sort((left, right) => left.localeCompare(right))
}

function normalizeScore(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw contractError('INVALID_FIELD_TYPE', `${field} must be a finite number.`, { field })
  }
  return clampUnitInterval(value)
}

function normalizeNullableScore(value, field) {
  return value == null ? null : normalizeScore(value, field)
}

function requirePlainObject(value, field) {
  if (!isPlainObject(value)) {
    throw contractError('INVALID_FIELD_TYPE', `${field} must be a plain object.`, { field })
  }
  return value
}

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw contractError('INVALID_FIELD_TYPE', `${field} must be a non-empty string.`, { field })
  }
  return value.normalize('NFKC').trim()
}

function requireNonNegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw contractError('INVALID_FIELD_TYPE', `${field} must be a non-negative integer.`, { field })
  }
  return value
}

function requirePositiveInteger(value, field) {
  if (!Number.isInteger(value) || value <= 0) {
    throw contractError('INVALID_FIELD_TYPE', `${field} must be a positive integer.`, { field })
  }
  return value
}

function requireNonNegativeFiniteNumber(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw contractError('INVALID_FIELD_TYPE', `${field} must be a non-negative finite number.`, { field })
  }
  return value
}

function requireUnitInterval(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw contractError('INVALID_FIELD_TYPE', `${field} must be between 0 and 1.`, { field })
  }
  return value
}

function addConstraintResult(failures, hits, ok, hitCode, failureCode) {
  if (ok) hits.push(hitCode)
  else failures.push(failureCode)
}

function compareAllowedPresentations(left, right) {
  const rankerDifference = (right.ranker_score ?? Number.NEGATIVE_INFINITY)
    - (left.ranker_score ?? Number.NEGATIVE_INFINITY)
  if (rankerDifference) return rankerDifference
  const preferenceDifference = (right.preference_contribution ?? Number.NEGATIVE_INFINITY)
    - (left.preference_contribution ?? Number.NEGATIVE_INFINITY)
  return preferenceDifference || left.variant_id.localeCompare(right.variant_id)
}

function compareRankingEntries(left, right) {
  const rankerDifference = (right.ranker_score ?? Number.NEGATIVE_INFINITY)
    - (left.ranker_score ?? Number.NEGATIVE_INFINITY)
  if (rankerDifference) return rankerDifference
  const leftRank = left.rank ?? Number.POSITIVE_INFINITY
  const rightRank = right.rank ?? Number.POSITIVE_INFINITY
  if (leftRank !== rightRank) return leftRank - rightRank
  const preferenceDifference = (right.preference_contribution ?? Number.NEGATIVE_INFINITY)
    - (left.preference_contribution ?? Number.NEGATIVE_INFINITY)
  return preferenceDifference || left.variant_id.localeCompare(right.variant_id)
}

function compareSkillEstimates(left, right) {
  return left.skill_id.localeCompare(right.skill_id)
}

function compareLedgerEntries(left, right) {
  return left.learning_unit_id.localeCompare(right.learning_unit_id)
    || String(left.occurred_at).localeCompare(String(right.occurred_at))
    || left.entry_kind.localeCompare(right.entry_kind)
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined)
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function cloneJson(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

function contractError(code, message, details) {
  return new CurriculumPlannerContractError(code, message, details)
}

function printable(value) {
  if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) return value ?? null
  return String(value)
}
