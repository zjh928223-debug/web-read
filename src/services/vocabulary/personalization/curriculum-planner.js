import {
  CURRICULUM_PLAN_SCHEMA_VERSION,
  CURRICULUM_QUEUE_TIERS,
  DEFAULT_CURRICULUM_AS_OF,
  MAX_COVERAGE_SEARCH_NODES,
  classifyCurriculumQueueTier,
  normalizeCurriculumCandidate,
  normalizeCurriculumPolicy,
  normalizePresentationRankings,
  normalizeSameDayLedger,
  normalizeSkillProfile,
  normalizeWeakSkillRequirements,
  evaluateCurriculumConstraints,
  isDueOrEligible,
  selectAllowedPresentation,
  clampUnitInterval,
  normalizeSignedPreferenceScore,
  CurriculumPlannerContractError,
} from './curriculum-constraints.js'

const DAY_MS = 24 * 60 * 60 * 1000
const REASON_MESSAGES = Object.freeze({
  DUE_OR_ELIGIBLE: 'The candidate is due or explicitly eligible for this session.',
  CONTENT_AVAILABLE: 'The candidate has usable content evidence.',
  PRESENTATION_AVAILABLE: 'At least one allowed presentation is available.',
  TIME_BUDGET_AVAILABLE: 'The estimated duration fits the remaining time budget.',
  SAME_DAY_LIMIT_AVAILABLE: 'The candidate fits the configured same-day item limit.',
  SAME_DAY_REVISIT_LIMIT_AVAILABLE: 'The candidate fits the per-learning-unit same-day revisit limit.',
  SAME_DAY_REVISIT_WINDOW_AVAILABLE: 'The revisit falls inside the configured 10-20 minute window.',
  SAME_DAY_REVISIT_WINDOW_NOT_APPLICABLE: 'The candidate is not a same-day revisit.',
  WEAK_SKILL_COVERAGE: 'The candidate covers a configured weak skill minimum.',
  PRESENTATION_RANKED: 'The highest-ranked allowed presentation was selected.',
  PRESENTATION_FALLBACK_ALLOWED: 'The preferred presentation was unavailable; a deterministic allowed fallback was selected.',
  PRESENTATION_DETERMINISTIC_DEFAULT: 'No compatible ranking was supplied; the allowed presentation tie-break was used.',
  PREFERENCE_WEIGHT_BOUNDED: 'Presentation preference contribution was bounded by policy.',
  CURRICULUM_SCORE: 'The candidate ranked highest among remaining hard-eligible candidates.',
  NOT_DUE_OR_ELIGIBLE: 'The candidate was not due and was not explicitly eligible.',
  CONTENT_UNAVAILABLE: 'The candidate content status is not usable.',
  NO_ALLOWED_PRESENTATION: 'The candidate has no allowed presentation.',
  TIME_BUDGET_EXCEEDED: 'The candidate duration exceeds the remaining budget.',
  SAME_DAY_ITEM_LIMIT: 'The configured same-day item limit has been reached.',
  SAME_DAY_REVISIT_LIMIT: 'The per-learning-unit same-day revisit limit has been reached.',
  SAME_DAY_REVISIT_WINDOW_UNAVAILABLE: 'No valid same-day revisit window is available.',
  SAME_DAY_REVISIT_WINDOW_NOT_OPEN: 'The same-day revisit window has not opened yet.',
  SAME_DAY_REVISIT_WINDOW_EXPIRED: 'The same-day revisit window has expired.',
  WEAK_SKILL_COVERAGE_UNMET: 'A weak-skill minimum remains uncovered.',
  LOWER_SCORE_WITHIN_CAPACITY: 'The candidate remained in backlog after higher-ranked candidates were selected.',
  NO_CANDIDATES: 'No curriculum candidates were supplied.',
  WEAK_SKILL_COVERAGE_COMPLETE: 'All configured weak-skill minimums were covered.',
  WEAK_SKILL_COVERAGE_INCOMPLETE: 'One or more configured weak-skill minimums could not be covered.',
  TIME_BUDGET_EXHAUSTED: 'The time budget prevented additional candidates from being selected.',
  SAME_DAY_LIMIT_REACHED: 'A same-day item limit prevented additional candidates from being selected.',
  SAME_DAY_REVISIT_LIMIT_REACHED: 'A same-learning-unit revisit limit prevented additional candidates from being selected.',
  DUE_REVIEW_PRIORITY: 'Due review has hard priority over lower queue tiers.',
  RELEARNING_REVISIT_PRIORITY: 'Relearning or an allowed revisit is scheduled after due review.',
  REASSESSMENT_PRIORITY: 'Reassessment is scheduled after due review and relearning/revisit.',
  ACQUISITION_PRIORITY: 'Acquisition is scheduled after higher-priority review work.',
  CONTENT_INVALID: 'All remaining candidates failed content availability.',
})

/**
 * Build a deterministic content plan from a candidate pool.
 *
 * The input is intentionally a plain object so a later adapter can construct it
 * from LearningEvent, SkillEstimate, PresentationRanker, and SessionLedger
 * outputs without coupling this function to those owners.
 *
 * Supported input fields include:
 * - candidates: CurriculumCandidate-like values;
 * - skill_profile / skill_estimates: SkillEstimate-like values;
 * - presentation_rankings / presentation_ranking: ranked variants by unit;
 * - time_budget_ms (or budget_ms), same_day_ledger, as_of (or now), policy;
 * - model_versions and optional session_id.
 */
export function planCurriculum(input) {
  const source = requirePlainObject(input, 'curriculum_planning_input')
  const asOf = normalizeAsOf(
    firstDefined(source.as_of, source.now, DEFAULT_CURRICULUM_AS_OF),
    'curriculum_planning_input.as_of',
  )
  const policyInput = source.policy == null
    ? {
      policy_version: source.policy_version,
      planner_version: source.planner_version,
    }
    : source.policy
  const policy = normalizeCurriculumPolicy(policyInput)
  const timeBudgetMs = normalizeBudget(
    firstDefined(source.time_budget_ms, source.budget_ms, policy.budget_ms),
    'curriculum_planning_input.time_budget_ms',
  )
  const rawCandidates = firstDefined(source.candidates, source.curriculum_candidates, [])
  if (!Array.isArray(rawCandidates)) {
    throw contractError(
      'INVALID_FIELD_TYPE',
      'curriculum_planning_input.candidates must be an array.',
      { field: 'curriculum_planning_input.candidates' },
    )
  }
  const candidates = rawCandidates
    .map((candidate, index) => normalizeCurriculumCandidate(candidate, index))
    .sort(compareCandidates)
  rejectDuplicateCandidateIds(candidates)

  const profile = normalizeSkillProfile(
    firstDefined(source.skill_profile, source.skill_estimates, source.profile, null),
  )
  const rankings = normalizePresentationRankings(
    firstDefined(source.presentation_rankings, source.presentation_ranking, source.presentationRanking, null),
  )
  const sameDayLedger = normalizeSameDayLedger(
    firstDefined(source.same_day_ledger, source.ledger, null),
    {
      revisit_window_min_ms: policy.same_day_revisit_window_min_ms,
      revisit_window_max_ms: policy.same_day_revisit_window_max_ms,
    },
  )
  const modelVersions = normalizeModelVersions(source, policy, profile, rankings)
  const weakRequirements = deriveWeakRequirements(source, policy, profile)
  const uncertainSkills = profile.estimates
    .filter((estimate) => !isReliableSkillEvidence(estimate, policy))
    .map((estimate) => ({
      skill_id: estimate.skill_id,
      eligible_evidence_count: estimate.eligible_evidence_count,
      uncertainty: estimate.uncertainty,
      reason: estimate.eligible_evidence_count < policy.minimum_weak_skill_evidence_count
        ? 'INSUFFICIENT_ELIGIBLE_EVIDENCE'
        : 'UNCERTAINTY_ABOVE_WEAK_SKILL_THRESHOLD',
    }))
  const requirementState = new Map(
    weakRequirements.map((requirement) => [requirement.skill_id, {
      ...requirement,
      selected: 0,
    }]),
  )

  const preparedCandidates = candidates.map((candidate) => {
    const presentation = selectAllowedPresentation(candidate, rankings)
    const score = scoreCandidate(
      candidate,
      profile,
      presentation,
      policy,
      asOf,
      sameDayLedger,
    )
    return {
      candidate,
      presentation,
      score,
      queue_priority: classifyCurriculumQueueTier(candidate, Date.parse(asOf)),
      covered_weak_skills: weakRequirements
        .filter((requirement) => candidate.skill_tags.includes(requirement.skill_id))
        .map((requirement) => requirement.skill_id),
    }
  })

  const selectedRecords = []
  const selectedIds = new Set()
  const selectedUnitCounts = new Map()
  const selectedRevisitUnitCounts = new Map()
  let plannedDurationMs = 0

  const canSelect = (prepared) => evaluateCurriculumConstraints(
    prepared.candidate,
    {
      policy,
      same_day_ledger: sameDayLedger,
      as_of_ms: Date.parse(asOf),
      budget_ms: timeBudgetMs,
      planned_duration_ms: plannedDurationMs,
      selected_count: selectedRecords.length,
      selected_unit_counts: selectedUnitCounts,
      selected_revisit_unit_counts: selectedRevisitUnitCounts,
    },
  )

  // Work is partitioned into the policy's hard queue order.  Coverage search
  // and score fill both stay inside the current tier, so a high-scoring
  // acquisition cannot consume time reserved for due review or relearning.
  const coverageSearchSummaries = []
  for (const tier of CURRICULUM_QUEUE_TIERS) {
    const tierCandidates = preparedCandidates.filter((prepared) => (
      prepared.queue_priority.tier === tier
    ))
    const coverageCandidates = tierCandidates.filter((prepared) => (
      prepared.covered_weak_skills.length > 0
    ))
    const tierCoverageSearch = findBestCoverageSelection({
      candidates: coverageCandidates,
      requirements: weakRequirements,
      coverageState: requirementState,
      policy,
      sameDayLedger,
      asOf,
      budgetMs: timeBudgetMs,
      plannedDurationMs,
      selectedCount: selectedRecords.length,
      selectedUnitCounts,
      selectedRevisitUnitCounts,
    })
    coverageSearchSummaries.push({
      tier,
      ...tierCoverageSearch.summary,
    })
    for (const chosen of tierCoverageSearch.selected) {
      if (selectedIds.has(chosen.candidate.learning_unit_id)) continue
      if (canSelect(chosen).selectable) addSelection(chosen, true)
    }

    // Fill any remaining capacity by score within this tier.  This pass is
    // deliberately allowed to skip an oversized candidate and continue
    // looking for a smaller candidate in the same priority tier.
    for (const prepared of tierCandidates.slice().sort(comparePreparedByScore)) {
      if (selectedIds.has(prepared.candidate.learning_unit_id)) continue
      const evaluation = canSelect(prepared)
      if (!evaluation.selectable) continue
      addSelection(prepared, false)
    }
  }
  const coverageSearch = summarizeCoverageSearch(coverageSearchSummaries, weakRequirements)

  function addSelection(prepared, mandatory) {
    const candidate = prepared.candidate
    const evaluation = canSelect(prepared)
    const coveredSkills = prepared.covered_weak_skills.filter((skillId) => {
      const state = requirementState.get(skillId)
      return state && state.selected < state.minimum
    })
    selectedRecords.push({
      prepared,
      mandatory,
      evaluation,
      covered_skills: coveredSkills,
    })
    selectedIds.add(candidate.learning_unit_id)
    plannedDurationMs += candidate.estimated_duration_ms
    selectedUnitCounts.set(
      candidate.learning_unit_id,
      (selectedUnitCounts.get(candidate.learning_unit_id) ?? 0) + 1,
    )
    if (candidate.is_revisit) {
      selectedRevisitUnitCounts.set(
        candidate.learning_unit_id,
        (selectedRevisitUnitCounts.get(candidate.learning_unit_id) ?? 0) + 1,
      )
    }
    for (const skillId of prepared.covered_weak_skills) {
      const state = requirementState.get(skillId)
      if (state) state.selected += 1
    }
  }

  const unmetCoverage = getCoverageDeficits(requirementState)
  const decisions = selectedRecords.map((record) => buildDecision(
    record,
    policy,
    modelVersions,
    unmetCoverage,
  ))
  const backlog = preparedCandidates
    .filter((prepared) => !selectedIds.has(prepared.candidate.learning_unit_id))
    .map((prepared) => buildBacklogItem(
      prepared,
      policy,
      sameDayLedger,
      asOf,
      timeBudgetMs,
      plannedDurationMs,
      selectedRecords.length,
      selectedUnitCounts,
      selectedRevisitUnitCounts,
      unmetCoverage,
      modelVersions,
    ))
    .sort((left, right) => left.learning_unit_id.localeCompare(right.learning_unit_id))

  const planReasons = buildPlanReasons({
    candidates,
    decisions,
    backlog,
    unmetCoverage,
    policy,
    plannedDurationMs,
    timeBudgetMs,
  })
  const backlogSummary = summarizeBacklog(backlog)
  const coverageSummary = weakRequirements.map((requirement) => {
    const state = requirementState.get(requirement.skill_id)
    return {
      skill_id: requirement.skill_id,
      minimum: requirement.minimum,
      selected: state?.selected ?? 0,
      missing: Math.max(0, requirement.minimum - (state?.selected ?? 0)),
      importance: requirement.importance,
    }
  })

  const output = {
    schema_version: CURRICULUM_PLAN_SCHEMA_VERSION,
    version: CURRICULUM_PLAN_SCHEMA_VERSION,
    planner_version: policy.planner_version,
    policy_version: policy.policy_version,
    as_of: asOf,
    session_id: source.session_id == null ? null : requireNonEmptyString(source.session_id, 'curriculum_planning_input.session_id'),
    time_budget_ms: timeBudgetMs,
    planned_duration_ms: plannedDurationMs,
    remaining_budget_ms: Math.max(0, timeBudgetMs - plannedDurationMs),
    decisions,
    entries: decisions.map((decision) => ({ ...decision })),
    backlog,
    backlog_summary: backlogSummary,
    weak_skill_coverage: coverageSummary,
    uncertain_skills: uncertainSkills,
    model_versions: modelVersions,
    reasons: planReasons.codes,
    reason_details: planReasons.codes.map((code) => ({ code, message: REASON_MESSAGES[code] ?? code })),
    constraints: {
      budget_ms: timeBudgetMs,
      same_day_max_items: policy.same_day_max_items,
      same_day_existing_count: sameDayLedger.total_count,
      same_day_existing_attempt_count: sameDayLedger.attempt_count,
      same_day_existing_revisit_count: sameDayLedger.revisit_count,
      same_day_planned_count: decisions.length,
      same_day_revisit_max_per_learning_unit: policy.same_day_revisit_max_per_learning_unit,
      same_day_revisit_rule: 'per_learning_unit',
      same_day_revisit_window_min_ms: policy.same_day_revisit_window_min_ms,
      same_day_revisit_window_max_ms: policy.same_day_revisit_window_max_ms,
      queue_priority_order: CURRICULUM_QUEUE_TIERS,
      weak_skill_requirements: coverageSummary,
      weak_skill_evidence_policy: {
        minimum_eligible_evidence_count: policy.minimum_weak_skill_evidence_count,
        maximum_uncertainty: policy.max_weak_skill_uncertainty,
      },
      coverage_search: coverageSearch,
      preference_weight: policy.weights.presentation_preference,
      preference_weight_cap: policy.max_preference_weight,
      preference_weight_capped: policy.preference_weight_capped,
    },
  }
  return output
}

function buildDecision(record, policy, modelVersions, unmetCoverage) {
  const { prepared, mandatory, evaluation, covered_skills: coveredSkills } = record
  const candidate = prepared.candidate
  const reasons = [
    ...evaluation.constraint_hits,
    ...(mandatory ? ['WEAK_SKILL_COVERAGE'] : ['CURRICULUM_SCORE']),
    prepared.queue_priority.reason_code,
    prepared.presentation.reason_code,
    'PREFERENCE_WEIGHT_BOUNDED',
  ]
  for (const skillId of coveredSkills) reasons.push(`WEAK_SKILL_COVERAGE:${skillId}`)
  if (unmetCoverage.length > 0 && coveredSkills.length === 0) reasons.push('WEAK_SKILL_COVERAGE_UNMET')
  const uniqueReasons = [...new Set(reasons)]
  return {
    schema_version: 'plan-decision.v1',
    learning_unit_id: candidate.learning_unit_id,
    due_at: candidate.due_at,
    maturity: candidate.maturity ? 'mature' : 'not_mature',
    queue_priority: { ...prepared.queue_priority },
    estimated_duration_ms: candidate.estimated_duration_ms,
    selected_presentation: prepared.presentation.selected_presentation,
    presentation: {
      selected_variant_id: prepared.presentation.selected_presentation,
      preferred_variant_id: prepared.presentation.preferred_presentation,
      fallback_used: prepared.presentation.fallback_used,
      raw_preference_score: round(prepared.presentation.raw_preference_score),
      preference_observed: prepared.presentation.preference_observed,
    },
    mandatory,
    score: prepared.score.score,
    score_components: prepared.score.components,
    covered_weak_skills: coveredSkills,
    reasons: uniqueReasons,
    reason_details: uniqueReasons.map((code) => ({ code, message: reasonMessage(code) })),
    constraint_hits: [...new Set([
      ...evaluation.constraint_hits,
      ...coveredSkills.map((skillId) => `WEAK_SKILL_COVERAGE:${skillId}`),
      prepared.queue_priority.reason_code,
      'PREFERENCE_WEIGHT_BOUNDED',
    ])],
    model_versions: { ...modelVersions },
  }
}

function buildBacklogItem(
  prepared,
  policy,
  sameDayLedger,
  asOf,
  timeBudgetMs,
  plannedDurationMs,
  selectedCount,
  selectedUnitCounts,
  selectedRevisitUnitCounts,
  unmetCoverage,
  modelVersions,
) {
  const candidate = prepared.candidate
  const evaluation = evaluateCurriculumConstraints(candidate, {
    policy,
    same_day_ledger: sameDayLedger,
    as_of: asOf,
    budget_ms: timeBudgetMs,
    planned_duration_ms: plannedDurationMs,
    selected_count: selectedCount,
    selected_unit_counts: selectedUnitCounts,
    selected_revisit_unit_counts: selectedRevisitUnitCounts,
  })
  const reasonCodes = [...evaluation.failed_constraints]
  const coversUnmetSkill = prepared.covered_weak_skills.some((skillId) => (
    unmetCoverage.some((requirement) => requirement.skill_id === skillId)
  ))
  if (coversUnmetSkill) reasonCodes.push('WEAK_SKILL_COVERAGE_UNMET')
  if (reasonCodes.length === 0) reasonCodes.push('LOWER_SCORE_WITHIN_CAPACITY')
  if (!isDueOrEligible(candidate, Date.parse(asOf))) {
    reasonCodes.push('NOT_DUE_OR_ELIGIBLE')
  }
  reasonCodes.push(prepared.queue_priority.reason_code)
  if (reasonCodes.includes('TIME_BUDGET_EXCEEDED')) reasonCodes.push('TIME_BUDGET_EXHAUSTED')
  const uniqueReasonCodes = [...new Set(reasonCodes)]
  const primaryReason = choosePrimaryBacklogReason(uniqueReasonCodes)
  return {
    schema_version: 'curriculum-backlog-item.v1',
    learning_unit_id: candidate.learning_unit_id,
    due_at: candidate.due_at,
    maturity: candidate.maturity ? 'mature' : 'not_mature',
    queue_priority: { ...prepared.queue_priority },
    estimated_duration_ms: candidate.estimated_duration_ms,
    score: prepared.score.score,
    selected_presentation: prepared.presentation.selected_presentation,
    reason: primaryReason,
    reason_codes: uniqueReasonCodes,
    reasons: uniqueReasonCodes.map((code) => reasonMessage(code)),
    reason_details: uniqueReasonCodes.map((code) => ({ code, message: reasonMessage(code) })),
    required_weak_skills: prepared.covered_weak_skills,
    model_versions: { ...modelVersions },
  }
}

function deriveWeakRequirements(source, policy, profile) {
  const explicitSource = firstDefined(
    source.weak_skill_requirements,
    source.weak_skill_quotas,
    source.weak_skills,
    undefined,
  )
  if (explicitSource !== undefined) {
    return normalizeWeakSkillRequirements(explicitSource, {
      defaultMinimum: policy.default_weak_skill_coverage,
      field: 'curriculum_planning_input.weak_skill_requirements',
    })
  }
  if (policy.weak_skill_quotas.length > 0) return policy.weak_skill_quotas.map((row) => ({ ...row }))

  const declaredWeak = new Set(profile.declared_weak_skills)
  return profile.estimates
    .filter((estimate) => isReliableSkillEvidence(estimate, policy))
    .filter((estimate) => (
      estimate.required
      || estimate.is_weak
      || declaredWeak.has(estimate.skill_id)
      || estimate.mastery_mean <= policy.weak_skill_threshold
    ))
    .map((estimate) => ({
      skill_id: estimate.skill_id,
      minimum: estimate.minimum_coverage ?? policy.default_weak_skill_coverage,
      importance: estimate.importance,
      reason: estimate.required || estimate.is_weak || declaredWeak.has(estimate.skill_id)
        ? 'profile_declared_weak'
        : 'profile_low_mastery',
    }))
    .filter((requirement) => requirement.minimum > 0)
}

function isReliableSkillEvidence(estimate, policy) {
  return estimate.eligible_evidence_count >= policy.minimum_weak_skill_evidence_count
    && estimate.uncertainty <= policy.max_weak_skill_uncertainty
}

function scoreCandidate(candidate, profile, presentation, policy, asOf, ledger) {
  const bySkill = new Map(profile.estimates.map((estimate) => [estimate.skill_id, estimate]))
  const skillEstimates = candidate.skill_tags
    .map((skillId) => bySkill.get(skillId))
    .filter(Boolean)
  const reliableSkillEstimates = skillEstimates.filter((estimate) => isReliableSkillEvidence(estimate, policy))
  const skillGap = reliableSkillEstimates.length === 0
    ? 0
    : Math.max(...reliableSkillEstimates.map((estimate) => clampUnitInterval(
      Math.max(estimate.gap, 1 - estimate.mastery_mean) + estimate.uncertainty * 0.25,
    )))
  const memoryUrgency = calculateMemoryUrgency(candidate, asOf)
  const novelty = candidate.novelty ?? ((ledger.by_learning_unit[candidate.learning_unit_id] ?? 0) > 0 ? 0.25 : 0.75)
  const fatigue = candidate.fatigue ?? clampUnitInterval(
    (ledger.by_learning_unit[candidate.learning_unit_id] ?? 0) / 2,
  )
  const noveltyFatigue = Math.max(-1, Math.min(1, novelty - fatigue))
  const boundedPresentationPreference = normalizeSignedPreferenceScore(presentation.raw_preference_score)
    * policy.weights.presentation_preference
  const components = {
    memory_urgency: round(memoryUrgency),
    skill_gap: round(skillGap),
    importance: round(candidate.importance),
    novelty_fatigue: round(noveltyFatigue),
    bounded_presentation_preference: round(boundedPresentationPreference),
    weighted_total: round(
      memoryUrgency * policy.weights.memory_urgency
      + skillGap * policy.weights.skill_gap
      + candidate.importance * policy.weights.importance
      + noveltyFatigue * policy.weights.novelty_fatigue
      + boundedPresentationPreference,
    ),
  }
  return {
    score: components.weighted_total,
    components,
  }
}

function calculateMemoryUrgency(candidate, asOf) {
  if (candidate.due_at === null) return candidate.memory_priority
  const deltaMs = Date.parse(candidate.due_at) - Date.parse(asOf)
  if (deltaMs <= 0) return 1
  return Math.max(
    candidate.memory_priority,
    clampUnitInterval(1 / (1 + deltaMs / DAY_MS)),
  )
}

function coverageGain(prepared, requirementState) {
  return prepared.covered_weak_skills.reduce((total, skillId) => {
    const state = requirementState.get(skillId)
    return total + (state && state.selected < state.minimum ? 1 : 0)
  }, 0)
}

function findBestCoverageSelection({
  candidates,
  requirements,
  coverageState,
  policy,
  sameDayLedger,
  asOf,
  budgetMs,
  plannedDurationMs,
  selectedCount,
  selectedUnitCounts,
  selectedRevisitUnitCounts,
}) {
  const requiredCoverageUnits = requirements.reduce((total, requirement) => total + requirement.minimum, 0)
  const baseCoverage = new Map(requirements.map((requirement) => [
    requirement.skill_id,
    coverageState?.get(requirement.skill_id)?.selected ?? 0,
  ]))
  if (requirements.length === 0 || candidates.length === 0) {
    return {
      selected: [],
      summary: {
        strategy: 'not_needed',
        candidate_count: candidates.length,
        searched_candidate_count: 0,
        node_count: 0,
        node_limit: policy.max_coverage_search_nodes,
        truncated: false,
        required_coverage_units: requiredCoverageUnits,
        coverage_units: coverageUnits(baseCoverage, requirements),
        selected_learning_unit_ids: [],
        feasibility_rescue: 'not_needed',
      },
    }
  }

  const orderedCandidates = candidates.slice().sort(comparePreparedById)
  const requirementBySkill = new Map(
    requirements.map((requirement) => [requirement.skill_id, requirement]),
  )
  const initialState = {
    index: 0,
    selected: [],
    coverage: baseCoverage,
    planned_duration_ms: plannedDurationMs,
    selected_count: selectedCount,
    selected_unit_counts: new Map(selectedUnitCounts),
    selected_revisit_unit_counts: new Map(selectedRevisitUnitCounts),
  }
  const rescue = findCoverageFeasibilityRescue({
    candidates: orderedCandidates,
    requirements,
    requirementBySkill,
    initialState,
    policy,
    sameDayLedger,
    asOf,
    budgetMs,
  })
  let best = rescue.snapshot
  let nodeCount = 0
  let truncated = false
  const stack = [initialState]

  while (stack.length > 0 && nodeCount < policy.max_coverage_search_nodes) {
    const state = stack.pop()
    nodeCount += 1
    considerCoverageState(state, requirements, (snapshot) => {
      if (isBetterCoverageSnapshot(snapshot, best)) best = snapshot
    })
    if (state.index >= orderedCandidates.length || isCoverageComplete(state.coverage, requirements)) continue

    const prepared = orderedCandidates[state.index]
    stack.push({
      ...state,
      index: state.index + 1,
    })
    if (coverageGainForMap(prepared, state.coverage, requirementBySkill) > 0) {
      const evaluation = evaluateCurriculumConstraints(prepared.candidate, {
        policy,
        same_day_ledger: sameDayLedger,
        as_of: asOf,
        budget_ms: budgetMs,
        planned_duration_ms: state.planned_duration_ms,
        selected_count: state.selected_count,
        selected_unit_counts: state.selected_unit_counts,
        selected_revisit_unit_counts: state.selected_revisit_unit_counts,
      })
      if (evaluation.selectable) {
        stack.push(createCoverageStateWithCandidate(state, prepared))
      }
    }
  }
  if (stack.length > 0) truncated = true
  const selected = (best?.selected ?? []).slice().sort(comparePreparedById)
  return {
    selected,
    summary: {
      strategy: 'bounded-coverage-search.v1',
      candidate_count: candidates.length,
      searched_candidate_count: orderedCandidates.length,
      node_count: nodeCount + rescue.node_count,
      node_limit: policy.max_coverage_search_nodes,
      truncated,
      required_coverage_units: requiredCoverageUnits,
      coverage_units: best?.coverage_units ?? 0,
      selected_learning_unit_ids: selected.map((prepared) => prepared.candidate.learning_unit_id),
      feasibility_rescue: rescue.snapshot && isCoverageComplete(
        rescue.snapshot.coverage,
        requirements,
      ) ? 'complete' : (rescue.truncated ? 'truncated' : 'incomplete'),
    },
  }
}

function findCoverageFeasibilityRescue({
  candidates,
  requirements,
  requirementBySkill,
  initialState,
  policy,
  sameDayLedger,
  asOf,
  budgetMs,
}) {
  const candidateFrequency = new Map()
  for (const candidate of candidates) {
    for (const skillId of candidate.covered_weak_skills) {
      candidateFrequency.set(skillId, (candidateFrequency.get(skillId) ?? 0) + 1)
    }
  }
  const rescueCandidates = candidates.slice().sort((left, right) => (
    compareCoverageRescueCandidates(left, right, candidateFrequency)
  ))
  const stack = [{ ...cloneCoverageState(initialState), index: 0 }]
  let nodeCount = 0
  let best = null
  let truncated = false
  const rescueNodeLimit = Math.min(MAX_COVERAGE_SEARCH_NODES, 100000)
  while (stack.length > 0 && nodeCount < rescueNodeLimit) {
    const state = stack.pop()
    nodeCount += 1
    const snapshot = coverageSnapshot(state, requirements)
    if (isBetterCoverageSnapshot(snapshot, best)) best = snapshot
    if (isCoverageComplete(state.coverage, requirements)) {
      return { snapshot, node_count: nodeCount, truncated: false }
    }
    if (state.index >= rescueCandidates.length) continue
    const prepared = rescueCandidates[state.index]
    stack.push({ ...state, index: state.index + 1 })
    if (coverageGainForMap(prepared, state.coverage, requirementBySkill) === 0) continue
    const evaluation = evaluateCurriculumConstraints(prepared.candidate, {
      policy,
      same_day_ledger: sameDayLedger,
      as_of: asOf,
      budget_ms: budgetMs,
      planned_duration_ms: state.planned_duration_ms,
      selected_count: state.selected_count,
      selected_unit_counts: state.selected_unit_counts,
      selected_revisit_unit_counts: state.selected_revisit_unit_counts,
    })
    if (evaluation.selectable) stack.push(createCoverageStateWithCandidate(state, prepared))
  }
  if (stack.length > 0) truncated = true
  return { snapshot: best, node_count: nodeCount, truncated }
}

function cloneCoverageState(state) {
  return {
    ...state,
    selected: state.selected.slice(),
    coverage: new Map(state.coverage),
    selected_unit_counts: new Map(state.selected_unit_counts),
    selected_revisit_unit_counts: new Map(state.selected_revisit_unit_counts),
  }
}

function createCoverageStateWithCandidate(state, prepared) {
  const next = cloneCoverageState(state)
  next.selected.push(prepared)
  next.planned_duration_ms += prepared.candidate.estimated_duration_ms
  next.selected_count += 1
  next.selected_unit_counts.set(
    prepared.candidate.learning_unit_id,
    (next.selected_unit_counts.get(prepared.candidate.learning_unit_id) ?? 0) + 1,
  )
  if (prepared.candidate.is_revisit) {
    next.selected_revisit_unit_counts.set(
      prepared.candidate.learning_unit_id,
      (next.selected_revisit_unit_counts.get(prepared.candidate.learning_unit_id) ?? 0) + 1,
    )
  }
  for (const skillId of prepared.covered_weak_skills) {
    next.coverage.set(skillId, (next.coverage.get(skillId) ?? 0) + 1)
  }
  next.index = state.index + 1
  return next
}

function compareCoverageRescueCandidates(left, right, frequency) {
  const leftRarity = left.covered_weak_skills.reduce(
    (total, skillId) => total + 1 / (frequency.get(skillId) ?? 1),
    0,
  )
  const rightRarity = right.covered_weak_skills.reduce(
    (total, skillId) => total + 1 / (frequency.get(skillId) ?? 1),
    0,
  )
  if (rightRarity !== leftRarity) return rightRarity - leftRarity
  const durationDifference = left.candidate.estimated_duration_ms - right.candidate.estimated_duration_ms
  if (durationDifference) return durationDifference
  return comparePreparedById(left, right)
}

function coverageSnapshot(state, requirements) {
  const selected = state.selected.slice().sort(comparePreparedById)
  return {
    selected,
    coverage_units: coverageUnits(state.coverage, requirements),
    score: selected.reduce((total, prepared) => total + prepared.score.score, 0),
    duration_ms: selected.reduce((total, prepared) => total + prepared.candidate.estimated_duration_ms, 0),
    id_signature: selected.map((prepared) => prepared.candidate.learning_unit_id).join('\u001f'),
    coverage: new Map(state.coverage),
  }
}

function coverageUnits(coverage, requirements) {
  return requirements.reduce((total, requirement) => total + Math.min(
    requirement.minimum,
    coverage.get(requirement.skill_id) ?? 0,
  ), 0)
}

function summarizeCoverageSearch(tierSummaries, requirements) {
  return {
    strategy: 'bounded-coverage-search.v1',
    priority_order: CURRICULUM_QUEUE_TIERS,
    tiers: tierSummaries,
    candidate_count: tierSummaries.reduce((total, summary) => total + summary.candidate_count, 0),
    searched_candidate_count: tierSummaries.reduce((total, summary) => total + summary.searched_candidate_count, 0),
    node_count: tierSummaries.reduce((total, summary) => total + summary.node_count, 0),
    node_limit_per_tier: tierSummaries[0]?.node_limit ?? null,
    truncated: tierSummaries.some((summary) => summary.truncated),
    required_coverage_units: requirements.reduce((total, requirement) => total + requirement.minimum, 0),
    selected_learning_unit_ids: tierSummaries.flatMap((summary) => summary.selected_learning_unit_ids),
    feasibility_rescue: tierSummaries.some((summary) => summary.feasibility_rescue === 'complete')
      ? 'complete'
      : tierSummaries.some((summary) => summary.feasibility_rescue === 'truncated')
        ? 'truncated'
        : 'incomplete',
  }
}

function coverageGainForMap(prepared, coverage, requirementBySkill) {
  return prepared.covered_weak_skills.reduce((total, skillId) => {
    const requirement = requirementBySkill.get(skillId)
    const selected = coverage.get(skillId) ?? 0
    return total + (requirement && selected < requirement.minimum ? 1 : 0)
  }, 0)
}

function isCoverageComplete(coverage, requirements) {
  return requirements.every((requirement) => (
    (coverage.get(requirement.skill_id) ?? 0) >= requirement.minimum
  ))
}

function considerCoverageState(state, requirements, accept) {
  accept(coverageSnapshot(state, requirements))
}

function isBetterCoverageSnapshot(candidate, current) {
  if (!current) return true
  if (candidate.coverage_units !== current.coverage_units) {
    return candidate.coverage_units > current.coverage_units
  }
  if (candidate.score !== current.score) return candidate.score > current.score
  if (candidate.duration_ms !== current.duration_ms) return candidate.duration_ms < current.duration_ms
  return candidate.id_signature.localeCompare(current.id_signature) < 0
}

function getCoverageDeficits(requirementState) {
  return [...requirementState.values()]
    .filter((state) => state.selected < state.minimum)
    .map((state) => ({
      skill_id: state.skill_id,
      minimum: state.minimum,
      selected: state.selected,
      missing: state.minimum - state.selected,
      importance: state.importance,
    }))
    .sort((left, right) => left.skill_id.localeCompare(right.skill_id))
}

function compareMandatoryOptions(left, right, requirementState) {
  const leftGain = coverageGain(left.prepared, requirementState)
  const rightGain = coverageGain(right.prepared, requirementState)
  const gainDifference = rightGain - leftGain
  if (gainDifference) return gainDifference
  const durationDifference = left.prepared.candidate.estimated_duration_ms
    - right.prepared.candidate.estimated_duration_ms
  if (durationDifference) return durationDifference
  const scoreDifference = right.prepared.score.score - left.prepared.score.score
  return scoreDifference || left.prepared.candidate.learning_unit_id.localeCompare(right.prepared.candidate.learning_unit_id)
}

function comparePreparedById(left, right) {
  return left.candidate.learning_unit_id.localeCompare(right.candidate.learning_unit_id)
}

function comparePreparedByScore(left, right) {
  const scoreDifference = right.score.score - left.score.score
  if (scoreDifference) return scoreDifference
  const leftDue = left.candidate.due_at === null
    ? Number.POSITIVE_INFINITY
    : Date.parse(left.candidate.due_at)
  const rightDue = right.candidate.due_at === null
    ? Number.POSITIVE_INFINITY
    : Date.parse(right.candidate.due_at)
  return leftDue - rightDue
    || left.candidate.learning_unit_id.localeCompare(right.candidate.learning_unit_id)
}

function compareCandidates(left, right) {
  const idDifference = left.learning_unit_id.localeCompare(right.learning_unit_id)
  if (idDifference) return idDifference
  const dueDifference = (left.due_at === null ? Number.POSITIVE_INFINITY : Date.parse(left.due_at))
    - (right.due_at === null ? Number.POSITIVE_INFINITY : Date.parse(right.due_at))
  return dueDifference
    || left.estimated_duration_ms - right.estimated_duration_ms
    || JSON.stringify(left).localeCompare(JSON.stringify(right))
}

function buildPlanReasons({ candidates, decisions, backlog, unmetCoverage, policy, plannedDurationMs, timeBudgetMs }) {
  const codes = []
  if (candidates.length === 0) codes.push('NO_CANDIDATES')
  if (unmetCoverage.length > 0) codes.push('WEAK_SKILL_COVERAGE_INCOMPLETE')
  else if (policy.weak_skill_quotas.length > 0 || decisions.some((decision) => decision.mandatory)) codes.push('WEAK_SKILL_COVERAGE_COMPLETE')
  if (plannedDurationMs >= timeBudgetMs && backlog.length > 0) codes.push('TIME_BUDGET_EXHAUSTED')
  if (backlog.some((item) => item.reason_codes.includes('SAME_DAY_ITEM_LIMIT'))) codes.push('SAME_DAY_LIMIT_REACHED')
  if (backlog.some((item) => item.reason_codes.includes('SAME_DAY_REVISIT_LIMIT'))) codes.push('SAME_DAY_REVISIT_LIMIT_REACHED')
  if (policy.preference_weight_capped) codes.push('PREFERENCE_WEIGHT_BOUNDED')
  if (backlog.length > 0 && decisions.length === 0 && candidates.length > 0) {
    if (backlog.every((item) => item.reason_codes.includes('CONTENT_UNAVAILABLE'))) codes.push('CONTENT_INVALID')
  }
  return { codes: [...new Set(codes)] }
}

function summarizeBacklog(backlog) {
  const byReason = {}
  let estimatedDurationMs = 0
  for (const item of backlog) {
    estimatedDurationMs += item.estimated_duration_ms
    for (const reason of item.reason_codes) byReason[reason] = (byReason[reason] ?? 0) + 1
  }
  return {
    count: backlog.length,
    estimated_duration_ms: estimatedDurationMs,
    by_reason: Object.fromEntries(Object.entries(byReason).sort(([left], [right]) => left.localeCompare(right))),
  }
}

function choosePrimaryBacklogReason(reasonCodes) {
  const priority = [
    'NOT_DUE_OR_ELIGIBLE',
    'CONTENT_UNAVAILABLE',
    'NO_ALLOWED_PRESENTATION',
    'SAME_DAY_ITEM_LIMIT',
    'SAME_DAY_REVISIT_LIMIT',
    'TIME_BUDGET_EXCEEDED',
    'LOWER_SCORE_WITHIN_CAPACITY',
    'WEAK_SKILL_COVERAGE_UNMET',
  ]
  return priority.find((code) => reasonCodes.includes(code)) ?? reasonCodes[0]
}

function normalizeModelVersions(source, policy, profile, rankings) {
  const supplied = source.model_versions && isPlainObject(source.model_versions)
    ? source.model_versions
    : {}
  return {
    curriculum_planner_version: policy.planner_version,
    policy_version: policy.policy_version,
    skill_estimator_version: firstDefined(
      supplied.skill_estimator_version,
      supplied.skill_estimator,
      profile.estimator_version,
      'skill-estimator.unknown',
    ),
    presentation_ranker_version: firstDefined(
      supplied.presentation_ranker_version,
      supplied.presentation_ranker,
      rankings.ranking_version,
      'presentation-ranking.unknown',
    ),
  }
}

function reasonMessage(code) {
  if (REASON_MESSAGES[code]) return REASON_MESSAGES[code]
  if (code.startsWith('WEAK_SKILL_COVERAGE:')) {
    return `The candidate covers required weak skill ${code.slice('WEAK_SKILL_COVERAGE:'.length)}.`
  }
  return code
}

function normalizeAsOf(value, field) {
  if (typeof value !== 'string' || !value.endsWith('Z') || !Number.isFinite(Date.parse(value))) {
    throw contractError('INVALID_TIMESTAMP', `${field} must be a UTC ISO-8601 timestamp.`, { field })
  }
  return new Date(Date.parse(value)).toISOString()
}

function normalizeBudget(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw contractError('INVALID_FIELD_TYPE', `${field} must be a non-negative integer.`, { field })
  }
  return value
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

function rejectDuplicateCandidateIds(candidates) {
  const seen = new Set()
  for (const candidate of candidates) {
    if (seen.has(candidate.learning_unit_id)) {
      throw contractError(
        'DUPLICATE_CANDIDATE_ID',
        'Curriculum candidates must have unique learning_unit_id values.',
        { learning_unit_id: candidate.learning_unit_id },
      )
    }
    seen.add(candidate.learning_unit_id)
  }
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined)
}

function round(value) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function contractError(code, message, details) {
  return new CurriculumPlannerContractError(code, message, details)
}
