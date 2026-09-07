const REVIEW_POLICY_SCHEMA_VERSION = 'review-policy.v1'
const DEFAULT_REVIEW_POLICY_VERSION = 'review-policy.v1'
const REVIEW_POLICY_MODES = Object.freeze([
  'once_daily',
  'balanced',
  'intensive',
])

const DEFAULT_REVIEW_BUDGET_MS = 15 * 60 * 1000
const DEFAULT_ATTEMPT_DURATION_MS = 36 * 1000
const DEFAULT_BALANCED_REVISIT_DELAY_MS = 15 * 60 * 1000
const BALANCED_MAX_REVISITS_PER_LOCAL_DAY = 1
const INTENSIVE_MAX_REVISITS_PER_LOCAL_DAY = 8

const REVIEW_STATES = new Set(['new', 'learning', 'review', 'relearning'])
const REVIEW_RATINGS = new Set(['again', 'hard', 'good', 'easy'])
const BALANCED_REVISIT_STATES = new Set(['new', 'learning', 'relearning'])
const POLICY_FIELDS = new Set([
  'schema_version',
  'policy_version',
  'mode',
  'budget_ms',
  'default_attempt_ms',
  'balanced_revisit_delay_ms',
  'balanced_max_revisits_per_local_day',
])
const SAME_DAY_REVISIT_INPUT_FIELDS = new Set([
  'local_day',
  'timezone',
  'mode',
  'review_state',
  'rating',
  'completed_revisit_count',
  'now',
])
const REVIEW_STATE_FIELDS = Object.freeze([
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
])
const REVIEW_STATE_FIELD_SET = new Set(REVIEW_STATE_FIELDS)

export function normalizeReviewPolicy(input) {
  const source = input == null ? {} : requirePlainObject(input, 'policy')
  rejectUnknownFields(source, POLICY_FIELDS, 'policy')

  const schemaVersion = source.schema_version ?? REVIEW_POLICY_SCHEMA_VERSION
  if (schemaVersion !== REVIEW_POLICY_SCHEMA_VERSION) {
    throw contractError(
      'UNSUPPORTED_SCHEMA_VERSION',
      'Review policy schema version is not supported.',
      { schema_version: printable(schemaVersion) },
    )
  }

  const policyVersion = source.policy_version ?? DEFAULT_REVIEW_POLICY_VERSION
  const mode = source.mode ?? 'once_daily'
  const budgetMs = source.budget_ms ?? DEFAULT_REVIEW_BUDGET_MS
  const defaultAttemptMs = source.default_attempt_ms ?? DEFAULT_ATTEMPT_DURATION_MS
  const revisitDelayMs = source.balanced_revisit_delay_ms
    ?? DEFAULT_BALANCED_REVISIT_DELAY_MS
  const maxBalancedRevisits = source.balanced_max_revisits_per_local_day
    ?? BALANCED_MAX_REVISITS_PER_LOCAL_DAY

  requireNonEmptyString(policyVersion, 'policy.policy_version')
  requireEnum(mode, REVIEW_POLICY_MODES, 'policy.mode')
  requireNonNegativeInteger(budgetMs, 'policy.budget_ms')
  requirePositiveInteger(defaultAttemptMs, 'policy.default_attempt_ms')
  requirePositiveInteger(revisitDelayMs, 'policy.balanced_revisit_delay_ms')
  if (revisitDelayMs < 10 * 60 * 1000 || revisitDelayMs > 20 * 60 * 1000) {
    throw contractError(
      'INVALID_FIELD_TYPE',
      'Balanced revisit delay must be between 10 and 20 minutes.',
      { field: 'policy.balanced_revisit_delay_ms' },
    )
  }
  if (maxBalancedRevisits !== BALANCED_MAX_REVISITS_PER_LOCAL_DAY) {
    throw contractError(
      'INVALID_FIELD_TYPE',
      'Balanced mode allows exactly one revisit per local day.',
      { field: 'policy.balanced_max_revisits_per_local_day' },
    )
  }

  return {
    schema_version: REVIEW_POLICY_SCHEMA_VERSION,
    policy_version: policyVersion,
    mode,
    budget_ms: budgetMs,
    default_attempt_ms: defaultAttemptMs,
    balanced_revisit_delay_ms: revisitDelayMs,
    balanced_max_revisits_per_local_day: BALANCED_MAX_REVISITS_PER_LOCAL_DAY,
  }
}

export function shouldScheduleSameDayRevisit(input) {
  const source = requirePlainObject(input, 'same_day_revisit_input')
  rejectUnknownFields(
    source,
    SAME_DAY_REVISIT_INPUT_FIELDS,
    'same_day_revisit_input',
  )
  const localDay = requireLocalDay(source.local_day, 'same_day_revisit_input.local_day')
  const timezone = requireTimezone(source.timezone, 'same_day_revisit_input.timezone')
  const mode = requireEnum(
    source.mode,
    REVIEW_POLICY_MODES,
    'same_day_revisit_input.mode',
  )
  const rating = requireEnum(
    source.rating,
    REVIEW_RATINGS,
    'same_day_revisit_input.rating',
  )
  const completedRevisitCount = requireNonNegativeInteger(
    source.completed_revisit_count,
    'same_day_revisit_input.completed_revisit_count',
  )
  const now = requireUtcTimestamp(source.now, 'same_day_revisit_input.now')
  const reviewState = assertReviewStateV2(
    source.review_state,
    'same_day_revisit_input.review_state',
  )
  const { state, due_at: dueAt } = reviewState

  if (localDayAt(now, timezone) !== localDay) {
    return decision(false, 'LOCAL_DAY_ENDED')
  }
  if (mode === 'once_daily') {
    return decision(false, 'ONCE_DAILY_MODE')
  }

  if (mode === 'balanced') {
    if (completedRevisitCount >= BALANCED_MAX_REVISITS_PER_LOCAL_DAY) {
      return decision(false, 'BALANCED_REVISIT_LIMIT_REACHED')
    }
    if (rating !== 'again' && !BALANCED_REVISIT_STATES.has(state)) {
      return decision(false, 'BALANCED_MATURE_CORRECT')
    }

    const eligibleAt = new Date(
      Date.parse(now) + DEFAULT_BALANCED_REVISIT_DELAY_MS,
    ).toISOString()
    if (localDayAt(eligibleAt, timezone) !== localDay) {
      return decision(false, 'ELIGIBLE_AT_OUTSIDE_LOCAL_DAY')
    }
    return decision(true, 'BALANCED_REVISIT_ALLOWED', eligibleAt)
  }

  if (completedRevisitCount >= INTENSIVE_MAX_REVISITS_PER_LOCAL_DAY) {
    return decision(false, 'INTENSIVE_REVISIT_SAFETY_LIMIT_REACHED')
  }
  if (Date.parse(dueAt) <= Date.parse(now)) {
    return decision(false, 'SCHEDULER_SHORT_STEP_NOT_FUTURE')
  }
  if (localDayAt(dueAt, timezone) !== localDay) {
    return decision(false, 'SCHEDULER_DUE_OUTSIDE_LOCAL_DAY')
  }
  return decision(true, 'INTENSIVE_SHORT_STEP_ALLOWED', dueAt)
}

function decision(allowed, reasonCode, eligibleAt = null) {
  return {
    schema_version: 'same-day-revisit-decision.v1',
    allowed,
    reason_code: reasonCode,
    eligible_at: eligibleAt,
  }
}

function contractError(code, message, details) {
  return { code, message, details }
}

function assertReviewStateV2(input, field) {
  const state = requirePlainObject(input, field)
  const missingFields = REVIEW_STATE_FIELDS.filter(
    (key) => !Object.prototype.hasOwnProperty.call(state, key),
  )
  if (missingFields.length) {
    throw contractError(
      'MISSING_REQUIRED_FIELD',
      `${field} is missing required fields.`,
      { field, missing_fields: missingFields },
    )
  }
  rejectUnknownFields(state, REVIEW_STATE_FIELD_SET, field)

  if (typeof state.schema_version !== 'string') {
    throw contractError(
      'INVALID_FIELD_TYPE',
      `${field}.schema_version must be a string.`,
      { field: `${field}.schema_version` },
    )
  }
  if (state.schema_version !== 'review-state.v2') {
    throw contractError(
      'UNSUPPORTED_SCHEMA_VERSION',
      'Review state schema version is not supported.',
      { schema_version: printable(state.schema_version) },
    )
  }

  requireNonEmptyString(state.review_state_id, `${field}.review_state_id`)
  requireNonEmptyString(state.learning_unit_id, `${field}.learning_unit_id`)
  requireNonEmptyString(state.word_id, `${field}.word_id`)
  requireEnum(state.state, REVIEW_STATES, `${field}.state`)
  requireUtcTimestamp(state.due_at, `${field}.due_at`)
  requireNonNegativeFiniteNumber(state.stability, `${field}.stability`)
  requireFiniteNumberInRange(state.difficulty, 1, 10, `${field}.difficulty`)
  requireNonNegativeInteger(state.elapsed_days, `${field}.elapsed_days`)
  requireNonNegativeInteger(state.scheduled_days, `${field}.scheduled_days`)
  requireNonNegativeInteger(state.reps, `${field}.reps`)
  requireNonNegativeInteger(state.lapses, `${field}.lapses`)
  requireNonNegativeInteger(state.learning_steps, `${field}.learning_steps`)
  if (state.last_review_at !== null) {
    requireUtcTimestamp(state.last_review_at, `${field}.last_review_at`)
  }
  requireNonEmptyString(state.scheduler_version, `${field}.scheduler_version`)
  requireNonEmptyString(
    state.scheduler_parameters_version,
    `${field}.scheduler_parameters_version`,
  )
  const createdAt = requireUtcTimestamp(state.created_at, `${field}.created_at`)
  const updatedAt = requireUtcTimestamp(state.updated_at, `${field}.updated_at`)
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw contractError(
      'INVALID_TIMESTAMP',
      `${field}.updated_at must not be earlier than created_at.`,
      { field: `${field}.updated_at` },
    )
  }
  requireNonNegativeInteger(state.revision, `${field}.revision`)
  requireRecordObject(state.extensions, `${field}.extensions`)
  return state
}

function requirePlainObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw contractError(
      'INVALID_FIELD_TYPE',
      `${field} must be an object.`,
      { field },
    )
  }
  return value
}

function requireRecordObject(value, field) {
  requirePlainObject(value, field)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw contractError(
      'INVALID_FIELD_TYPE',
      `${field} must be a plain object.`,
      { field },
    )
  }
  return value
}

function rejectUnknownFields(source, allowedFields, field) {
  const unknownFields = Object.keys(source).filter((key) => !allowedFields.has(key))
  if (unknownFields.length) {
    throw contractError(
      'INVALID_FIELD_TYPE',
      `${field} contains unsupported fields.`,
      { field, unknown_fields: unknownFields.sort() },
    )
  }
}

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw contractError(
      'INVALID_FIELD_TYPE',
      `${field} must be a non-empty string.`,
      { field },
    )
  }
  return value
}

function requireEnum(value, allowedValues, field) {
  const isAllowed = typeof allowedValues.has === 'function'
    ? allowedValues.has(value)
    : allowedValues.includes(value)
  if (!isAllowed) {
    throw contractError(
      'INVALID_ENUM_VALUE',
      `${field} is not an allowed value.`,
      { field, value: printable(value) },
    )
  }
  return value
}

function requirePositiveInteger(value, field) {
  if (!Number.isInteger(value) || value <= 0) {
    throw contractError(
      'INVALID_FIELD_TYPE',
      `${field} must be a positive integer.`,
      { field },
    )
  }
  return value
}

function requireNonNegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw contractError(
      'INVALID_FIELD_TYPE',
      `${field} must be a non-negative integer.`,
      { field },
    )
  }
  return value
}

function requireNonNegativeFiniteNumber(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw contractError(
      'INVALID_FIELD_TYPE',
      `${field} must be a non-negative finite number.`,
      { field },
    )
  }
  return value
}

function requireFiniteNumberInRange(value, minimum, maximum, field) {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < minimum
    || value > maximum
  ) {
    throw contractError(
      'INVALID_FIELD_TYPE',
      `${field} must be a finite number between ${minimum} and ${maximum}.`,
      { field },
    )
  }
  return value
}

function requireUtcTimestamp(value, field) {
  const match = typeof value === 'string'
    ? value.match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/,
    )
    : null
  const timestamp = match ? Date.parse(value) : Number.NaN
  const parsed = Number.isFinite(timestamp) ? new Date(timestamp) : null
  const hasMatchingComponents = parsed && (
    parsed.getUTCFullYear() === Number(match[1])
    && parsed.getUTCMonth() + 1 === Number(match[2])
    && parsed.getUTCDate() === Number(match[3])
    && parsed.getUTCHours() === Number(match[4])
    && parsed.getUTCMinutes() === Number(match[5])
    && parsed.getUTCSeconds() === Number(match[6])
  )
  if (!hasMatchingComponents) {
    throw contractError(
      'INVALID_TIMESTAMP',
      `${field} must be a UTC ISO-8601 timestamp.`,
      { field },
    )
  }
  return value
}

function requireLocalDay(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw contractError(
      'INVALID_FIELD_TYPE',
      `${field} must use YYYY-MM-DD.`,
      { field },
    )
  }
  const [year, month, day] = value.split('-').map(Number)
  const roundTrip = new Date(Date.UTC(year, month - 1, day))
  if (
    roundTrip.getUTCFullYear() !== year
    || roundTrip.getUTCMonth() !== month - 1
    || roundTrip.getUTCDate() !== day
  ) {
    throw contractError(
      'INVALID_FIELD_TYPE',
      `${field} must be a real calendar day.`,
      { field },
    )
  }
  return value
}

function requireTimezone(value, field) {
  requireNonEmptyString(value, field)
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
  } catch {
    throw contractError(
      'INVALID_FIELD_TYPE',
      `${field} must be an IANA timezone.`,
      { field },
    )
  }
  return value
}

function localDayAt(timestamp, timezone) {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp))
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${byType.year}-${byType.month}-${byType.day}`
}

function printable(value) {
  return value == null || ['string', 'number', 'boolean'].includes(typeof value)
    ? value ?? null
    : String(value)
}
