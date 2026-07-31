const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const REVIEW_STATE_REQUIRED_FIELDS = [
  'schema_version',
  'review_state_id',
  'learning_unit_id',
  'word_id',
  'state',
  'due_at',
  'stability',
  'difficulty',
  'elapsed_days',
  'scheduled_days',
  'reps',
  'lapses',
  'learning_steps',
  'last_review_at',
  'scheduler_version',
  'scheduler_parameters_version',
  'created_at',
  'updated_at',
  'revision',
  'extensions',
]

async function importP4Modules(repoRoot) {
  const sourceDir = path.join(repoRoot, 'src', 'features', 'srs-review')
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-web-p4-'))
  try {
    const policySource = fs.readFileSync(
      path.join(sourceDir, 'srs-review-policy.js'),
      'utf8',
    )
    const plannerSource = fs.readFileSync(
      path.join(sourceDir, 'srs-session-planner.js'),
      'utf8',
    ).replace(
      "from './srs-review-policy.js'",
      "from './srs-review-policy.mjs'",
    )
    fs.writeFileSync(path.join(tempDir, 'srs-review-policy.mjs'), policySource)
    fs.writeFileSync(path.join(tempDir, 'srs-session-planner.mjs'), plannerSource)
    return {
      policy: await import(pathToFileURL(
        path.join(tempDir, 'srs-review-policy.mjs'),
      ).href),
      planner: await import(pathToFileURL(
        path.join(tempDir, 'srs-session-planner.mjs'),
      ).href),
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

function reviewState(overrides = {}) {
  return {
    schema_version: 'review-state.v2',
    review_state_id: 'review-state-1',
    learning_unit_id: 'unit-1',
    word_id: 'word-1',
    state: 'review',
    due_at: '2026-07-27T10:15:00.000Z',
    stability: 1,
    difficulty: 5,
    elapsed_days: 1,
    scheduled_days: 1,
    reps: 1,
    lapses: 0,
    learning_steps: 0,
    last_review_at: '2026-07-27T10:00:00.000Z',
    scheduler_version: 'scheduler.v1',
    scheduler_parameters_version: 'scheduler-parameters.v1',
    created_at: '2026-07-26T10:00:00.000Z',
    updated_at: '2026-07-27T10:00:00.000Z',
    revision: 1,
    extensions: {},
    ...overrides,
  }
}

function sameDayInput(overrides = {}) {
  return {
    local_day: '2026-07-27',
    timezone: 'UTC',
    mode: 'balanced',
    review_state: reviewState(),
    rating: 'good',
    completed_revisit_count: 0,
    now: '2026-07-27T10:00:00.000Z',
    ...overrides,
  }
}

function assertContractError(action, code) {
  assert.throws(action, (error) => (
    error
    && error.code === code
    && typeof error.message === 'string'
    && error.details
    && typeof error.details === 'object'
  ))
}

function withoutField(value, field) {
  const result = { ...value }
  delete result[field]
  return result
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..')
  const fixture = JSON.parse(fs.readFileSync(
    path.join(
      repoRoot,
      'scripts',
      'fixtures',
      'srs-review-policy-planner-fixtures.json',
    ),
    'utf8',
  ))
  const { policy, planner } = await importP4Modules(repoRoot)

  assert.deepEqual(
    Object.keys(policy).sort(),
    ['normalizeReviewPolicy', 'shouldScheduleSameDayRevisit'],
  )
  assert.deepEqual(
    Object.keys(planner).sort(),
    ['estimateActiveAttemptDuration', 'planReviewSession'],
  )
  assert.equal(typeof policy.normalizeReviewPolicy, 'function')
  assert.equal(typeof policy.shouldScheduleSameDayRevisit, 'function')
  assert.equal(typeof planner.planReviewSession, 'function')
  assert.equal(typeof planner.estimateActiveAttemptDuration, 'function')

  const normalizedDefault = policy.normalizeReviewPolicy({})
  assert.deepEqual(normalizedDefault, {
    schema_version: 'review-policy.v1',
    policy_version: 'review-policy.v1',
    mode: 'balanced',
    budget_ms: 3600000,
    default_attempt_ms: 36000,
    balanced_revisit_delay_ms: 900000,
    balanced_max_revisits_per_local_day: 1,
  })
  for (const mode of ['once_daily', 'balanced', 'intensive']) {
    assert.equal(policy.normalizeReviewPolicy({ mode }).mode, mode)
  }
  assertContractError(
    () => policy.normalizeReviewPolicy({ schema_version: 'review-policy.v2' }),
    'UNSUPPORTED_SCHEMA_VERSION',
  )
  assertContractError(
    () => policy.normalizeReviewPolicy({ mode: 'unbounded' }),
    'INVALID_ENUM_VALUE',
  )
  assertContractError(
    () => policy.normalizeReviewPolicy({ balanced_revisit_delay_ms: 300000 }),
    'INVALID_FIELD_TYPE',
  )

  assertContractError(
    () => policy.shouldScheduleSameDayRevisit(sameDayInput({
      review_state: {
        state: 'learning',
        due_at: '2026-07-27T10:15:00.000Z',
      },
    })),
    'MISSING_REQUIRED_FIELD',
  )

  for (const field of REVIEW_STATE_REQUIRED_FIELDS) {
    assertContractError(
      () => policy.shouldScheduleSameDayRevisit(sameDayInput({
        review_state: withoutField(reviewState(), field),
      })),
      'MISSING_REQUIRED_FIELD',
    )
  }

  assertContractError(
    () => policy.shouldScheduleSameDayRevisit(sameDayInput({
      review_state: reviewState({ unexpected_field: true }),
    })),
    'INVALID_FIELD_TYPE',
  )
  assertContractError(
    () => policy.shouldScheduleSameDayRevisit(sameDayInput({
      review_state: reviewState({ revision: -1 }),
    })),
    'INVALID_FIELD_TYPE',
  )
  assertContractError(
    () => policy.shouldScheduleSameDayRevisit(sameDayInput({
      review_state: reviewState({
        created_at: '2026-07-27T10:00:00.000Z',
        updated_at: '2026-07-27T09:59:59.999Z',
      }),
    })),
    'INVALID_TIMESTAMP',
  )

  for (const [field, value, code] of [
    ['schema_version', 'review-state.v1', 'UNSUPPORTED_SCHEMA_VERSION'],
    ['schema_version', null, 'INVALID_FIELD_TYPE'],
    ['review_state_id', '', 'INVALID_FIELD_TYPE'],
    ['learning_unit_id', '', 'INVALID_FIELD_TYPE'],
    ['word_id', '', 'INVALID_FIELD_TYPE'],
    ['state', 'graduated', 'INVALID_ENUM_VALUE'],
    ['due_at', '2026-07-27T10:15:00+00:00', 'INVALID_TIMESTAMP'],
    ['stability', -1, 'INVALID_FIELD_TYPE'],
    ['stability', Number.POSITIVE_INFINITY, 'INVALID_FIELD_TYPE'],
    ['difficulty', 0, 'INVALID_FIELD_TYPE'],
    ['difficulty', 11, 'INVALID_FIELD_TYPE'],
    ['elapsed_days', 1.5, 'INVALID_FIELD_TYPE'],
    ['scheduled_days', -1, 'INVALID_FIELD_TYPE'],
    ['reps', -1, 'INVALID_FIELD_TYPE'],
    ['lapses', -1, 'INVALID_FIELD_TYPE'],
    ['learning_steps', -1, 'INVALID_FIELD_TYPE'],
    ['last_review_at', 'yesterday', 'INVALID_TIMESTAMP'],
    ['scheduler_version', '', 'INVALID_FIELD_TYPE'],
    ['scheduler_parameters_version', '', 'INVALID_FIELD_TYPE'],
    ['created_at', null, 'INVALID_TIMESTAMP'],
    ['updated_at', null, 'INVALID_TIMESTAMP'],
    ['revision', 1.5, 'INVALID_FIELD_TYPE'],
    ['extensions', [], 'INVALID_FIELD_TYPE'],
  ]) {
    assertContractError(
      () => policy.shouldScheduleSameDayRevisit(sameDayInput({
        review_state: reviewState({ [field]: value }),
      })),
      code,
    )
  }

  const nullableLastReviewState = reviewState({
    state: 'new',
    last_review_at: null,
  })
  const nullableLastReviewBefore = JSON.stringify(nullableLastReviewState)
  const nullableLastReviewDecision = policy.shouldScheduleSameDayRevisit(
    sameDayInput({
      review_state: nullableLastReviewState,
      rating: 'again',
    }),
  )
  assert.equal(nullableLastReviewDecision.allowed, true)
  assert.equal(JSON.stringify(nullableLastReviewState), nullableLastReviewBefore)

  const onceDaily = policy.shouldScheduleSameDayRevisit(sameDayInput({
    mode: 'once_daily',
    rating: 'again',
  }))
  assert.deepEqual(onceDaily, {
    schema_version: 'same-day-revisit-decision.v1',
    allowed: false,
    reason_code: 'ONCE_DAILY_MODE',
    eligible_at: null,
  })

  const matureCorrect = policy.shouldScheduleSameDayRevisit(sameDayInput())
  assert.equal(matureCorrect.allowed, false)
  assert.equal(matureCorrect.reason_code, 'BALANCED_MATURE_CORRECT')

  const balancedAgainInput = sameDayInput({
    rating: 'again',
  })
  const balancedAgainInputBefore = JSON.stringify(balancedAgainInput)
  const balancedAgain = policy.shouldScheduleSameDayRevisit(balancedAgainInput)
  assert.equal(balancedAgain.allowed, true)
  assert.equal(balancedAgain.eligible_at, '2026-07-27T10:15:00.000Z')
  assert.equal(JSON.stringify(balancedAgainInput), balancedAgainInputBefore)

  const balancedLearning = policy.shouldScheduleSameDayRevisit(sameDayInput({
    review_state: reviewState({ state: 'learning' }),
  }))
  assert.equal(balancedLearning.allowed, true)

  const balancedLimit = policy.shouldScheduleSameDayRevisit(sameDayInput({
    review_state: reviewState({ state: 'learning' }),
    completed_revisit_count: 1,
  }))
  assert.equal(balancedLimit.allowed, false)
  assert.equal(balancedLimit.reason_code, 'BALANCED_REVISIT_LIMIT_REACHED')

  const crossedMidnight = policy.shouldScheduleSameDayRevisit(sameDayInput({
    local_day: '2026-07-28',
    timezone: 'Asia/Shanghai',
    now: '2026-07-28T15:55:00.000Z',
    rating: 'again',
  }))
  assert.equal(crossedMidnight.allowed, false)
  assert.equal(crossedMidnight.reason_code, 'ELIGIBLE_AT_OUTSIDE_LOCAL_DAY')

  const resumedAfterMidnight = policy.shouldScheduleSameDayRevisit(sameDayInput({
    local_day: '2026-07-27',
    timezone: 'Asia/Shanghai',
    now: '2026-07-27T16:01:00.000Z',
  }))
  assert.equal(resumedAfterMidnight.allowed, false)
  assert.equal(resumedAfterMidnight.reason_code, 'LOCAL_DAY_ENDED')

  const intensive = policy.shouldScheduleSameDayRevisit(sameDayInput({
    mode: 'intensive',
  }))
  assert.equal(intensive.allowed, true)
  assert.equal(intensive.eligible_at, '2026-07-27T10:15:00.000Z')

  const intensiveSafetyLimit = policy.shouldScheduleSameDayRevisit(sameDayInput({
    mode: 'intensive',
    completed_revisit_count: 8,
  }))
  assert.equal(intensiveSafetyLimit.allowed, false)
  assert.equal(
    intensiveSafetyLimit.reason_code,
    'INTENSIVE_REVISIT_SAFETY_LIMIT_REACHED',
  )

  const planningInputBefore = JSON.stringify(fixture.planning)
  const ledger = planner.planReviewSession(fixture.planning)
  assert.equal(JSON.stringify(fixture.planning), planningInputBefore)
  assert.equal(ledger.schema_version, 'session-ledger.v1')
  assert.equal(ledger.policy_version, 'review-policy.v1:test-balanced')
  assert.equal(ledger.mode, 'balanced')
  assert.equal(ledger.budget_ms, 108000)
  assert.equal(ledger.estimated_attempt_ms, 36000)
  assert.deepEqual(
    ledger.entries.map((entry) => entry.learning_unit_id),
    ['unit-due-earlier', 'unit-due-later', 'unit-relearning'],
  )
  assert.deepEqual(
    ledger.entries.map((entry) => entry.position),
    [0, 1, 2],
  )
  assert.equal(ledger.extensions.planned_duration_ms, 108000)
  assert.equal(ledger.extensions.budget_remaining_ms, 0)
  assert.equal(ledger.extensions.budget_exhausted, true)
  assert.equal(
    ledger.extensions.estimated_completion_at,
    '2026-07-27T10:01:48.000Z',
  )
  assert.equal(ledger.backlog.relearning_count, 1)
  assert.equal(ledger.backlog.reassessment_count, 1)
  assert.equal(ledger.backlog.acquisition_count, 1)
  assert.equal(ledger.backlog.extensions.revisit_count, 1)
  assert.equal(ledger.backlog.estimated_ms, 108000)

  const fullLedger = planner.planReviewSession({
    ...fixture.planning,
    policy: {
      ...fixture.planning.policy,
      budget_ms: 216000,
    },
  })
  assert.deepEqual(
    fullLedger.entries.map((entry) => entry.queue_kind),
    [
      'due_review',
      'due_review',
      'relearning',
      'revisit',
      'reassessment',
      'acquisition',
    ],
  )
  assert.equal(fullLedger.entries[3].revisit_ordinal, 1)
  assert.equal(fullLedger.backlog.extensions.total_count, 0)

  fixture.planning.policy.mode = 'once_daily'
  fixture.planning.policy.policy_version = 'review-policy.v1:test-once-daily'
  assert.equal(ledger.mode, 'balanced')
  assert.equal(ledger.policy_version, 'review-policy.v1:test-balanced')
  const nextLedger = planner.planReviewSession(fixture.planning)
  assert.equal(nextLedger.mode, 'once_daily')
  assert.equal(nextLedger.policy_version, 'review-policy.v1:test-once-daily')

  const dueOverflow = planner.planReviewSession({
    ...fixture.planning,
    policy: {
      ...fixture.planning.policy,
      budget_ms: 36000,
    },
    candidates: [
      {
        learning_unit_id: 'oversized-due',
        queue_kind: 'due_review',
        due_at: '2026-07-27T09:00:00.000Z',
        estimated_duration_ms: 72000,
        enqueue_reason: 'overdue review',
      },
      {
        learning_unit_id: 'small-acquisition',
        queue_kind: 'acquisition',
        due_at: null,
        estimated_duration_ms: 18000,
        enqueue_reason: 'new acquisition capacity',
      },
    ],
  })
  assert.equal(dueOverflow.entries.length, 0)
  assert.equal(dueOverflow.backlog.due_review_count, 1)
  assert.equal(dueOverflow.backlog.acquisition_count, 1)
  assert.equal(dueOverflow.backlog.estimated_ms, 90000)

  const zeroBudget = planner.planReviewSession({
    ...fixture.planning,
    policy: {
      ...fixture.planning.policy,
      budget_ms: 0,
    },
    candidates: fixture.planning.candidates.slice(0, 1),
  })
  assert.equal(zeroBudget.entries.length, 0)
  assert.equal(zeroBudget.backlog.acquisition_count, 1)
  assert.equal(zeroBudget.extensions.budget_remaining_ms, 0)

  const shanghaiLedger = planner.planReviewSession({
    ...fixture.planning,
    now: '2026-07-27T16:30:00.000Z',
    local_day: '2026-07-28',
    timezone: 'Asia/Shanghai',
    candidates: [],
  })
  assert.equal(shanghaiLedger.local_day, '2026-07-28')
  assert.equal(shanghaiLedger.timezone, 'Asia/Shanghai')

  const defaultSpeed = planner.estimateActiveAttemptDuration([])
  assert.equal(defaultSpeed.estimated_attempt_ms, 36000)
  assert.equal(defaultSpeed.eligible_sample_count, 0)

  const speedInputBefore = JSON.stringify(fixture.speed_events)
  const speedEstimate = planner.estimateActiveAttemptDuration(fixture.speed_events)
  assert.equal(JSON.stringify(fixture.speed_events), speedInputBefore)
  assert.equal(speedEstimate.estimated_attempt_ms, 32000)
  assert.equal(speedEstimate.eligible_sample_count, 5)
  assert.equal(speedEstimate.excluded_sample_count, 3)
  assert.equal(
    speedEstimate.estimator_version,
    'active-duration-trimmed-moving-mean.v1',
  )

  const insufficientSpeed = planner.estimateActiveAttemptDuration(
    fixture.speed_events.slice(0, 4),
  )
  assert.equal(insufficientSpeed.estimated_attempt_ms, 36000)
  assert.equal(insufficientSpeed.eligible_sample_count, 4)

  const trimmedSpeed = planner.estimateActiveAttemptDuration(
    [20000, 25000, 29000, 30000, 31000, 32000, 33000, 34000, 39000, 40000]
      .map((activeDuration, index) => ({
        event_type: 'review_attempt_recorded',
        attempt_id: `trimmed-attempt-${index}`,
        occurred_at: new Date(
          Date.parse('2026-07-27T11:00:00.000Z') + index * 60000,
        ).toISOString(),
        duration_ms: activeDuration + 1000,
        active_duration_ms: activeDuration,
        training_eligible: true,
        is_legacy: false,
        exclusion_reasons: [],
      })),
  )
  assert.equal(trimmedSpeed.estimated_attempt_ms, 31625)
  assert.equal(trimmedSpeed.eligible_sample_count, 10)

  assertContractError(
    () => planner.planReviewSession({
      ...fixture.planning,
      timezone: 'Not/A_Timezone',
    }),
    'INVALID_FIELD_TYPE',
  )
  assertContractError(
    () => planner.planReviewSession({
      ...fixture.planning,
      local_day: '2026-07-28',
    }),
    'INVALID_TIMESTAMP',
  )

  const policySource = fs.readFileSync(
    path.join(
      repoRoot,
      'src',
      'features',
      'srs-review',
      'srs-review-policy.js',
    ),
    'utf8',
  )
  const plannerSource = fs.readFileSync(
    path.join(
      repoRoot,
      'src',
      'features',
      'srs-review',
      'srs-session-planner.js',
    ),
    'utf8',
  )
  for (const source of [policySource, plannerSource]) {
    assert.doesNotMatch(source, /indexedDB|createObjectStore|fetch\(|XMLHttpRequest/)
    assert.doesNotMatch(source, /\bsetTimeout\b|\bsetInterval\b/)
  }

  console.log('srs review policy/planner verification passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
