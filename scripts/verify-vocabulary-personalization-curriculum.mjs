import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixturePath = path.join(
  repoRoot,
  'scripts',
  'fixtures',
  'vocabulary-personalization-curriculum.fixture.json',
)
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))

async function loadModules() {
  const sourceDirectory = path.join(
    repoRoot,
    'src',
    'services',
    'vocabulary',
    'personalization',
  )
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'read-web-curriculum-'),
  )
  try {
    const constraintsSource = fs.readFileSync(
      path.join(sourceDirectory, 'curriculum-constraints.js'),
      'utf8',
    )
    const plannerSource = fs.readFileSync(
      path.join(sourceDirectory, 'curriculum-planner.js'),
      'utf8',
    ).replace(
      "from './curriculum-constraints.js'",
      "from './curriculum-constraints.mjs'",
    )
    const constraintsPath = path.join(temporaryDirectory, 'curriculum-constraints.mjs')
    const plannerPath = path.join(temporaryDirectory, 'curriculum-planner.mjs')
    fs.writeFileSync(constraintsPath, constraintsSource)
    fs.writeFileSync(plannerPath, plannerSource)
    const constraints = await import(`${pathToFileURL(constraintsPath).href}?constraints=fixture`)
    const planner = await import(`${pathToFileURL(plannerPath).href}?planner=fixture`)
    return { constraints, planner }
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function withScenario(scenario) {
  return {
    ...clone(fixture.base),
    ...clone(scenario),
    policy: {
      ...clone(fixture.base.policy),
      ...(scenario.policy ? clone(scenario.policy) : {}),
    },
  }
}

function findDecision(plan, learningUnitId) {
  return plan.decisions.find((decision) => decision.learning_unit_id === learningUnitId)
}

function findBacklog(plan, learningUnitId) {
  return plan.backlog.find((item) => item.learning_unit_id === learningUnitId)
}

function assertCode(error, code) {
  assert.equal(error?.code, code)
  assert.equal(typeof error?.message, 'string')
  assert.ok(error?.details && typeof error.details === 'object')
}

const { constraints, planner } = await loadModules()

assert.equal(typeof planner.planCurriculum, 'function')
assert.equal(typeof constraints.normalizeCurriculumPolicy, 'function')
assert.equal(typeof constraints.evaluateCurriculumConstraints, 'function')
assert.equal(typeof constraints.selectAllowedPresentation, 'function')
assert.equal(typeof constraints.normalizeSignedPreferenceScore, 'function')

const baseInput = clone(fixture.base)
const baseBefore = JSON.stringify(baseInput)
const basePlan = planner.planCurriculum(baseInput)
assert.equal(JSON.stringify(baseInput), baseBefore)
assert.equal(basePlan.schema_version, 'curriculum-plan.v1')
assert.equal(basePlan.version, 'curriculum-plan.v1')
assert.equal(basePlan.policy_version, 'curriculum-policy.v1:fixture')
assert.equal(basePlan.planner_version, 'curriculum-planner.v1:fixture')
assert.deepEqual(
  basePlan.decisions.map((decision) => decision.learning_unit_id),
  ['unit-weak-morphology', 'unit-weak-verb'],
)
assert.ok(findDecision(basePlan, 'unit-weak-morphology').mandatory)
assert.ok(findDecision(basePlan, 'unit-weak-verb').mandatory)
assert.deepEqual(basePlan.weak_skill_coverage, [
  {
    skill_id: 'morphology.inflection',
    minimum: 1,
    selected: 1,
    missing: 0,
    importance: 0,
  },
  {
    skill_id: 'pos.verb',
    minimum: 1,
    selected: 1,
    missing: 0,
    importance: 0,
  },
])
assert.equal(basePlan.constraints.preference_weight_capped, true)
assert.equal(basePlan.constraints.preference_weight, 0.1)
for (const decision of basePlan.decisions) {
  assert.ok(decision.score_components)
  assert.ok(
    decision.score_components.bounded_presentation_preference <= 0.1,
  )
  assert.ok(Array.isArray(decision.reasons))
  assert.ok(Array.isArray(decision.constraint_hits))
  assert.equal(decision.model_versions.policy_version, basePlan.policy_version)
}
assert.equal(
  findDecision(basePlan, 'unit-weak-morphology').selected_presentation,
  'context',
)
assert.equal(
  findDecision(basePlan, 'unit-weak-morphology').presentation.fallback_used,
  true,
)
assert.ok(
  findDecision(basePlan, 'unit-weak-morphology').reasons.includes(
    'PRESENTATION_FALLBACK_ALLOWED',
  ),
)
assert.equal(findDecision(basePlan, 'unit-optional-important'), undefined)
assert.ok(findBacklog(basePlan, 'unit-optional-important').reason_codes.includes('TIME_BUDGET_EXCEEDED'))
assert.ok(findBacklog(basePlan, 'unit-not-due').reason_codes.includes('NOT_DUE_OR_ELIGIBLE'))
assert.ok(findBacklog(basePlan, 'unit-invalid-content').reason_codes.includes('CONTENT_UNAVAILABLE'))
assert.ok(findBacklog(basePlan, 'unit-mature').reason_codes.includes('TIME_BUDGET_EXCEEDED'))
assert.equal('mature_same_day_max_items' in basePlan.constraints, false)
assert.equal(basePlan.constraints.same_day_revisit_rule, 'per_learning_unit')

// Candidate, skill, and ledger order is not a hidden tie-break.
const reorderedInput = clone(fixture.base)
reorderedInput.candidates.reverse()
reorderedInput.skill_profile.estimates.reverse()
const reorderedPlan = planner.planCurriculum(reorderedInput)
assert.deepEqual(reorderedPlan, basePlan)

const budgetPlan = planner.planCurriculum(withScenario(fixture.scenarios.budget))
assert.deepEqual(
  budgetPlan.decisions.map((decision) => decision.learning_unit_id),
  ['unit-short'],
)
assert.ok(findBacklog(budgetPlan, 'unit-long').reason_codes.includes('TIME_BUDGET_EXCEEDED'))
assert.equal(budgetPlan.remaining_budget_ms, 20000)

const duePriorityPlan = planner.planCurriculum(withScenario(fixture.scenarios.due_priority_competition))
assert.deepEqual(
  duePriorityPlan.decisions.map((decision) => decision.learning_unit_id),
  ['unit-due-review'],
)
assert.equal(duePriorityPlan.decisions[0].queue_priority.tier, 'due_review')
assert.ok(findBacklog(duePriorityPlan, 'unit-high-acquisition').reason_codes.includes('TIME_BUDGET_EXCEEDED'))

const queuePriorityPlan = planner.planCurriculum(withScenario(fixture.scenarios.queue_priority_order))
assert.deepEqual(
  queuePriorityPlan.decisions.map((decision) => decision.learning_unit_id),
  ['unit-due-order', 'unit-relearning', 'unit-reassessment'],
)
assert.deepEqual(
  queuePriorityPlan.decisions.map((decision) => decision.queue_priority.tier),
  ['due_review', 'relearning_revisit', 'reassessment'],
)

const quotaConflictPlan = planner.planCurriculum(withScenario(fixture.scenarios.quota_conflict))
assert.deepEqual(
  quotaConflictPlan.decisions.map((decision) => decision.learning_unit_id),
  ['unit-alpha'],
)
assert.deepEqual(
  quotaConflictPlan.weak_skill_coverage.map((row) => [row.skill_id, row.missing]),
  [['skill.alpha', 0], ['skill.beta', 1]],
)
assert.ok(findBacklog(quotaConflictPlan, 'unit-beta').reason_codes.includes('WEAK_SKILL_COVERAGE_UNMET'))
assert.ok(quotaConflictPlan.reasons.includes('WEAK_SKILL_COVERAGE_INCOMPLETE'))

const quotaSearchPlan = planner.planCurriculum(withScenario(fixture.scenarios.quota_search_counterexample))
assert.deepEqual(
  quotaSearchPlan.decisions.map((decision) => decision.learning_unit_id).sort(),
  ['unit-A1', 'unit-A2', 'unit-B1'],
)
assert.equal(quotaSearchPlan.planned_duration_ms, 100)
assert.deepEqual(
  quotaSearchPlan.weak_skill_coverage.map((row) => [row.skill_id, row.selected, row.missing]),
  [['skill.A', 2, 0], ['skill.B', 1, 0]],
)
assert.equal(quotaSearchPlan.constraints.coverage_search.strategy, 'bounded-coverage-search.v1')
assert.ok(quotaSearchPlan.constraints.coverage_search.node_count > 0)

const quotaTwentyFifthPlan = planner.planCurriculum(
  withScenario(fixture.scenarios.quota_search_25th_unique),
)
assert.deepEqual(
  quotaTwentyFifthPlan.decisions.map((decision) => decision.learning_unit_id),
  ['unit-coverage-25'],
)
assert.deepEqual(
  quotaTwentyFifthPlan.weak_skill_coverage.map((row) => [row.skill_id, row.selected, row.missing]),
  [['skill.A', 1, 0], ['skill.B', 1, 0]],
)
assert.ok(quotaTwentyFifthPlan.constraints.coverage_search.searched_candidate_count >= 25)
assert.equal(quotaTwentyFifthPlan.constraints.coverage_search.truncated, false)

const stackSafeCandidates = Array.from({ length: 5000 }, (_, index) => ({
  learning_unit_id: `unit-safe-${String(index + 1).padStart(4, '0')}`,
  eligible: true,
  skill_tags: ['skill.A'],
  estimated_duration_ms: 1,
  allowed_presentations: ['context'],
  content_status: 'available',
}))
stackSafeCandidates[4999].skill_tags = ['skill.A', 'skill.B']
const stackSafePlan = planner.planCurriculum({
  as_of: '2026-08-05T00:00:00.000Z',
  time_budget_ms: 1,
  policy: {
    policy_version: 'curriculum-policy.v1:stack-safe',
    same_day_max_items: 10000,
    max_coverage_search_nodes: 1,
    weak_skill_quotas: { 'skill.A': 1, 'skill.B': 1 },
  },
  skill_profile: {
    estimates: [
      { skill_id: 'skill.A', mastery_mean: 0.2, uncertainty: 0.1, eligible_evidence_count: 3 },
      { skill_id: 'skill.B', mastery_mean: 0.2, uncertainty: 0.1, eligible_evidence_count: 3 },
    ],
  },
  candidates: stackSafeCandidates,
})
assert.deepEqual(
  stackSafePlan.decisions.map((decision) => decision.learning_unit_id),
  ['unit-safe-5000'],
)
assert.equal(stackSafePlan.constraints.coverage_search.truncated, true)
assert.equal(stackSafePlan.constraints.coverage_search.feasibility_rescue, 'complete')

const coldStartPlan = planner.planCurriculum(withScenario(fixture.scenarios.cold_start_uncertain))
assert.equal(coldStartPlan.decisions.length, 1)
assert.equal(coldStartPlan.decisions[0].mandatory, false)
assert.deepEqual(coldStartPlan.weak_skill_coverage, [])
assert.deepEqual(coldStartPlan.uncertain_skills, [{
  skill_id: 'skill.cold',
  eligible_evidence_count: 0,
  uncertainty: 0.98,
  reason: 'INSUFFICIENT_ELIGIBLE_EVIDENCE',
}])
assert.ok(!coldStartPlan.reasons.includes('WEAK_SKILL_COVERAGE_INCOMPLETE'))

const eligibleOverridePlan = planner.planCurriculum(withScenario(fixture.scenarios.eligible_overrides_not_due))
assert.deepEqual(
  eligibleOverridePlan.decisions.map((decision) => decision.learning_unit_id),
  ['unit-explicitly-eligible'],
)
assert.ok(eligibleOverridePlan.decisions[0].reasons.includes('DUE_OR_ELIGIBLE'))

const invalidContentPlan = planner.planCurriculum(withScenario(fixture.scenarios.all_invalid_content))
assert.equal(invalidContentPlan.decisions.length, 0)
assert.ok(invalidContentPlan.reasons.includes('CONTENT_INVALID'))
assert.ok(invalidContentPlan.backlog.every((item) => item.reason_codes.includes('CONTENT_UNAVAILABLE')))

const singleWeakInvalidPlan = planner.planCurriculum(
  withScenario(fixture.scenarios.single_weak_candidate_invalid),
)
assert.equal(singleWeakInvalidPlan.decisions.length, 0)
assert.equal(singleWeakInvalidPlan.weak_skill_coverage[0].missing, 1)
assert.ok(
  findBacklog(singleWeakInvalidPlan, 'unit-only-verb').reason_codes.includes(
    'WEAK_SKILL_COVERAGE_UNMET',
  ),
)

const revisitAllowedPlan = planner.planCurriculum(
  withScenario(fixture.scenarios.same_day_revisit_allowed),
)
assert.deepEqual(
  revisitAllowedPlan.decisions.map((decision) => decision.learning_unit_id),
  ['unit-current-revisit'],
)
assert.equal(revisitAllowedPlan.constraints.same_day_existing_attempt_count, 1)
assert.equal(revisitAllowedPlan.constraints.same_day_existing_revisit_count, 0)
assert.ok(revisitAllowedPlan.decisions[0].constraint_hits.includes('SAME_DAY_REVISIT_WINDOW_AVAILABLE'))

const revisitLimitPlan = planner.planCurriculum(
  withScenario(fixture.scenarios.same_day_revisit_limit),
)
assert.equal(revisitLimitPlan.decisions.length, 0)
assert.ok(findBacklog(revisitLimitPlan, 'unit-current-revisit').reason_codes.includes('SAME_DAY_REVISIT_LIMIT'))
assert.ok(findBacklog(revisitLimitPlan, 'unit-current-revisit').reason_codes.includes('SAME_DAY_REVISIT_WINDOW_EXPIRED'))
assert.ok(revisitLimitPlan.reasons.includes('SAME_DAY_REVISIT_LIMIT_REACHED'))

const matureOtherUnitPlan = planner.planCurriculum(
  withScenario(fixture.scenarios.mature_other_unit_allowed),
)
assert.deepEqual(
  matureOtherUnitPlan.decisions.map((decision) => decision.learning_unit_id),
  ['unit-current-mature'],
)

const signedPreferencePlan = planner.planCurriculum(withScenario(fixture.scenarios.signed_preference))
assert.equal(signedPreferencePlan.decisions[0].presentation.raw_preference_score, -0.75)
assert.equal(signedPreferencePlan.decisions[0].score_components.bounded_presentation_preference, -0.15)
assert.equal(constraints.normalizeSignedPreferenceScore(-0.75), -0.75)
assert.equal(constraints.normalizeSignedPreferenceScore(2), 1)

const rankerScorePlan = planner.planCurriculum(withScenario(fixture.scenarios.ranker_score_not_preference))
const rankerScoreWithoutRankingInput = withScenario(fixture.scenarios.ranker_score_not_preference)
rankerScoreWithoutRankingInput.presentation_rankings = null
const rankerScoreWithoutRankingPlan = planner.planCurriculum(rankerScoreWithoutRankingInput)
assert.deepEqual(
  rankerScorePlan.decisions.map((decision) => decision.learning_unit_id),
  ['unit-high-content'],
)
assert.deepEqual(
  rankerScoreWithoutRankingPlan.decisions.map((decision) => decision.learning_unit_id),
  ['unit-high-content'],
)
assert.equal(rankerScorePlan.decisions[0].presentation.preference_observed, false)
assert.equal(rankerScorePlan.decisions[0].score_components.bounded_presentation_preference, 0)

const tiePlan = planner.planCurriculum(withScenario(fixture.scenarios.tie_break))
assert.deepEqual(
  tiePlan.decisions.map((decision) => decision.learning_unit_id),
  ['unit-tie-a'],
)

// A high preference weight is explicitly capped and cannot suppress a weak
// skill requirement.  The base fixture's weak candidates are selected before
// the highly preferred important candidate.
assert.ok(basePlan.decisions.every((decision) => decision.mandatory))
assert.ok(basePlan.backlog.some((item) => item.learning_unit_id === 'unit-optional-important'))

const defaultPlan = planner.planCurriculum({ candidates: [] })
assert.equal(defaultPlan.as_of, '1970-01-01T00:00:00.000Z')
assert.deepEqual(defaultPlan.decisions, [])
assert.deepEqual(defaultPlan.backlog, [])
assert.ok(defaultPlan.reasons.includes('NO_CANDIDATES'))

const policyWithCap = constraints.normalizeCurriculumPolicy({
  max_preference_weight: 0.1,
  weights: { presentation_preference: 0.9 },
})
assert.equal(policyWithCap.weights.presentation_preference, 0.1)
assert.equal(policyWithCap.preference_weight_capped, true)
const policyWithSearchCap = constraints.normalizeCurriculumPolicy({
  max_coverage_search_nodes: Number.MAX_SAFE_INTEGER,
})
assert.equal(policyWithSearchCap.max_coverage_search_nodes, 250000)
assert.equal(policyWithSearchCap.max_coverage_search_nodes_capped, true)

const separatedLedger = constraints.normalizeSameDayLedger({
  by_learning_unit_attempts: { 'unit-ledger': 1 },
  by_learning_unit_revisits: { 'unit-ledger': 1 },
})
assert.equal(separatedLedger.total_count, 2)
assert.equal(separatedLedger.attempt_count, 1)
assert.equal(separatedLedger.revisit_count, 1)
assert.equal(separatedLedger.by_learning_unit['unit-ledger'], 2)

assert.throws(
  () => planner.planCurriculum({
    ...clone(fixture.base),
    candidates: [{
      ...clone(fixture.base.candidates[0]),
      estimated_duration_ms: 0,
    }],
  }),
  (error) => {
    assertCode(error, 'INVALID_FIELD_TYPE')
    return true
  },
)
assert.throws(
  () => planner.planCurriculum({
    ...clone(fixture.base),
    policy: { schema_version: 'curriculum-policy.v2' },
  }),
  (error) => {
    assertCode(error, 'UNSUPPORTED_SCHEMA_VERSION')
    return true
  },
)

const sourcePaths = [
  path.join(repoRoot, 'src', 'services', 'vocabulary', 'personalization', 'curriculum-constraints.js'),
  path.join(repoRoot, 'src', 'services', 'vocabulary', 'personalization', 'curriculum-planner.js'),
]
for (const sourcePath of sourcePaths) {
  const source = fs.readFileSync(sourcePath, 'utf8')
  assert.doesNotMatch(source, /\b(document|indexedDB|createObjectStore|fetch|XMLHttpRequest|ReviewState)\b/i)
  assert.doesNotMatch(source, /(^|[^\w$])window\s*\.\s*[A-Za-z_$]/im)
  assert.doesNotMatch(source, /\b(setTimeout|setInterval|Math\.random)\b/)
}
assert.doesNotMatch(JSON.stringify(fixture), /original sentence|copyrighted|IELTS|剑雅|受版权/u)
assert.doesNotMatch(JSON.stringify(basePlan), /ReviewState|review_state|due date rewrite|create card/i)

console.log('vocabulary personalization curriculum verification passed')
console.log('algorithm: due/relearning/reassessment/acquisition tiers, explicit-stack bounded coverage search, deterministic feasibility rescue, then score fill')
console.log('complexity: O(B + n log n + n * (k + p)) time, O(n + s + l) space (B = bounded search/rescue nodes)')
console.log('public planner API: planCurriculum(input)')
console.log('wave B adapter: map LearningEvent/SkillEstimate/PresentationRanker/SessionLedger snapshots into the plain input; keep this module shadow-only')
