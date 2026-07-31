import { normalizeReviewPolicy } from './srs-review-policy.js'

const QUEUE_PRIORITY = Object.freeze([
  'due_review',
  'relearning',
  'revisit',
  'reassessment',
  'acquisition',
])
const QUEUE_PRIORITY_INDEX = new Map(
  QUEUE_PRIORITY.map((queueKind, index) => [queueKind, index]),
)
const MAX_RECENT_SPEED_SAMPLES = 50
const MIN_PERSONAL_SPEED_SAMPLES = 5
const MIN_ACTIVE_DURATION_MS = 500
const MAX_ACTIVE_DURATION_MS = 15 * 60 * 1000
const ESTIMATOR_VERSION = 'active-duration-trimmed-moving-mean.v1'
const DEFAULT_ATTEMPT_DURATION_MS = 36 * 1000
const PLANNING_INPUT_FIELDS = new Set([
  'now',
  'local_day',
  'timezone',
  'policy',
  'session_id',
  'candidates',
])
const PLANNING_CANDIDATE_FIELDS = new Set([
  'learning_unit_id',
  'queue_kind',
  'due_at',
  'estimated_duration_ms',
  'enqueue_reason',
])

export function planReviewSession(input) {
  const source = requirePlainObject(input, 'review_planning_input')
  rejectUnknownFields(
    source,
    PLANNING_INPUT_FIELDS,
    'review_planning_input',
  )
  const now = requireUtcTimestamp(source.now, 'review_planning_input.now')
  const localDay = requireLocalDay(
    source.local_day,
    'review_planning_input.local_day',
  )
  const timezone = requireTimezone(
    source.timezone,
    'review_planning_input.timezone',
  )
  if (localDayAt(now, timezone) !== localDay) {
    throw contractError(
      'INVALID_TIMESTAMP',
      'Planning local_day must match now in the supplied timezone.',
      { field: 'review_planning_input.local_day' },
    )
  }

  const policy = normalizeReviewPolicy(source.policy)
  const sessionId = requireNonEmptyString(
    source.session_id,
    'review_planning_input.session_id',
  )
  if (!Array.isArray(source.candidates)) {
    throw contractError(
      'INVALID_FIELD_TYPE',
      'review_planning_input.candidates must be an array.',
      { field: 'review_planning_input.candidates' },
    )
  }

  const candidates = source.candidates
    .map((candidate, index) => normalizeCandidate(candidate, index))
    .sort(compareCandidates)
  const entries = []
  const plannedCandidateIndexes = new Set()
  let plannedDurationMs = 0
  let budgetBlocked = false

  for (const candidate of candidates) {
    if (
      budgetBlocked
      || plannedDurationMs + candidate.estimated_duration_ms > policy.budget_ms
    ) {
      budgetBlocked = true
      continue
    }
    const position = entries.length
    entries.push({
      ledger_item_id: [
        sessionId,
        position,
        candidate.queue_kind,
        candidate.learning_unit_id,
      ].join(':'),
      position,
      queue_kind: candidate.queue_kind,
      learning_unit_id: candidate.learning_unit_id,
      enqueue_reason: candidate.enqueue_reason,
      estimated_duration_ms: candidate.estimated_duration_ms,
      planned_due_at: candidate.due_at,
      revisit_ordinal: candidate.queue_kind === 'revisit' ? 1 : 0,
      extensions: {},
    })
    plannedCandidateIndexes.add(candidate.original_index)
    plannedDurationMs += candidate.estimated_duration_ms
  }

  const unplanned = candidates.filter(
    (candidate) => !plannedCandidateIndexes.has(candidate.original_index),
  )
  const backlog = buildBacklog(unplanned)
  const totalCandidateEstimatedMs = candidates.reduce(
    (total, candidate) => total + candidate.estimated_duration_ms,
    0,
  )

  return {
    schema_version: 'session-ledger.v1',
    session_id: sessionId,
    created_at: now,
    local_day: localDay,
    timezone,
    policy_version: policy.policy_version,
    mode: policy.mode,
    budget_ms: policy.budget_ms,
    estimated_attempt_ms: policy.default_attempt_ms,
    entries,
    cursor: 0,
    status: 'planned',
    backlog,
    revision: 0,
    extensions: {
      planned_duration_ms: plannedDurationMs,
      budget_remaining_ms: policy.budget_ms - plannedDurationMs,
      budget_exhausted: unplanned.length > 0,
      estimated_completion_at: addMilliseconds(now, plannedDurationMs),
      estimated_all_work_completion_at: addMilliseconds(
        now,
        totalCandidateEstimatedMs,
      ),
      total_candidate_estimated_ms: totalCandidateEstimatedMs,
    },
  }
}

export function estimateActiveAttemptDuration(events) {
  if (!Array.isArray(events)) {
    throw contractError(
      'INVALID_FIELD_TYPE',
      'events must be an array.',
      { field: 'events' },
    )
  }

  const basicEligible = events
    .map((event, index) => toSpeedSample(event, index))
    .filter(Boolean)
    .sort((left, right) => {
      const timestampDifference = right.occurred_at_ms - left.occurred_at_ms
      return timestampDifference || right.original_index - left.original_index
    })
    .slice(0, MAX_RECENT_SPEED_SAMPLES)

  const durations = basicEligible.map((sample) => sample.active_duration_ms)
  const robustDurations = removeDurationOutliers(durations)
  const eligibleSampleCount = robustDurations.length
  const excludedSampleCount = events.length - eligibleSampleCount

  if (eligibleSampleCount < MIN_PERSONAL_SPEED_SAMPLES) {
    return {
      schema_version: 'active-speed-estimate.v1',
      estimated_attempt_ms: DEFAULT_ATTEMPT_DURATION_MS,
      eligible_sample_count: eligibleSampleCount,
      excluded_sample_count: excludedSampleCount,
      estimator_version: ESTIMATOR_VERSION,
    }
  }

  const sortedDurations = robustDurations.slice().sort((left, right) => left - right)
  const trimCount = sortedDurations.length >= 10
    ? Math.floor(sortedDurations.length * 0.1)
    : 0
  const trimmedDurations = sortedDurations.slice(
    trimCount,
    sortedDurations.length - trimCount,
  )
  const estimatedAttemptMs = Math.round(
    trimmedDurations.reduce((total, duration) => total + duration, 0)
      / trimmedDurations.length,
  )

  return {
    schema_version: 'active-speed-estimate.v1',
    estimated_attempt_ms: estimatedAttemptMs,
    eligible_sample_count: eligibleSampleCount,
    excluded_sample_count: excludedSampleCount,
    estimator_version: ESTIMATOR_VERSION,
  }
}

function normalizeCandidate(input, originalIndex) {
  const field = `review_planning_input.candidates[${originalIndex}]`
  const source = requirePlainObject(
    input,
    field,
  )
  rejectUnknownFields(source, PLANNING_CANDIDATE_FIELDS, field)
  const queueKind = requireEnum(
    source.queue_kind,
    QUEUE_PRIORITY,
    `review_planning_input.candidates[${originalIndex}].queue_kind`,
  )
  const dueAt = source.due_at == null
    ? null
    : requireUtcTimestamp(
      source.due_at,
      `review_planning_input.candidates[${originalIndex}].due_at`,
    )
  return {
    learning_unit_id: requireNonEmptyString(
      source.learning_unit_id,
      `review_planning_input.candidates[${originalIndex}].learning_unit_id`,
    ),
    queue_kind: queueKind,
    due_at: dueAt,
    estimated_duration_ms: requirePositiveInteger(
      source.estimated_duration_ms,
      `review_planning_input.candidates[${originalIndex}].estimated_duration_ms`,
    ),
    enqueue_reason: requireNonEmptyString(
      source.enqueue_reason,
      `review_planning_input.candidates[${originalIndex}].enqueue_reason`,
    ),
    original_index: originalIndex,
  }
}

function compareCandidates(left, right) {
  const priorityDifference = QUEUE_PRIORITY_INDEX.get(left.queue_kind)
    - QUEUE_PRIORITY_INDEX.get(right.queue_kind)
  if (priorityDifference) return priorityDifference

  const leftDue = left.due_at == null ? Number.POSITIVE_INFINITY : Date.parse(left.due_at)
  const rightDue = right.due_at == null ? Number.POSITIVE_INFINITY : Date.parse(right.due_at)
  if (leftDue !== rightDue) return leftDue - rightDue

  const idDifference = left.learning_unit_id.localeCompare(right.learning_unit_id)
  return idDifference || left.original_index - right.original_index
}

function buildBacklog(candidates) {
  const backlog = {
    due_review_count: 0,
    relearning_count: 0,
    reassessment_count: 0,
    acquisition_count: 0,
    estimated_ms: 0,
    extensions: {
      revisit_count: 0,
      total_count: candidates.length,
    },
  }
  for (const candidate of candidates) {
    backlog.estimated_ms += candidate.estimated_duration_ms
    if (candidate.queue_kind === 'due_review') backlog.due_review_count += 1
    if (candidate.queue_kind === 'relearning') backlog.relearning_count += 1
    if (candidate.queue_kind === 'revisit') {
      backlog.relearning_count += 1
      backlog.extensions.revisit_count += 1
    }
    if (candidate.queue_kind === 'reassessment') backlog.reassessment_count += 1
    if (candidate.queue_kind === 'acquisition') backlog.acquisition_count += 1
  }
  return backlog
}

function toSpeedSample(event, originalIndex) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null
  if (
    event.event_type !== 'review_attempt_recorded'
    && event.event_type !== 'acquisition_attempt_recorded'
  ) {
    return null
  }
  if (event.training_eligible !== true || event.is_legacy === true) return null
  if (
    Array.isArray(event.exclusion_reasons)
    && event.exclusion_reasons.length > 0
  ) {
    return null
  }
  if (
    !Number.isInteger(event.active_duration_ms)
    || event.active_duration_ms < MIN_ACTIVE_DURATION_MS
    || event.active_duration_ms > MAX_ACTIVE_DURATION_MS
    || !Number.isInteger(event.duration_ms)
    || event.duration_ms < event.active_duration_ms
  ) {
    return null
  }
  const occurredAtMs = Date.parse(event.occurred_at)
  if (!Number.isFinite(occurredAtMs)) return null
  return {
    active_duration_ms: event.active_duration_ms,
    occurred_at_ms: occurredAtMs,
    original_index: originalIndex,
  }
}

function removeDurationOutliers(durations) {
  if (durations.length < MIN_PERSONAL_SPEED_SAMPLES) return durations.slice()
  const center = median(durations)
  const absoluteDeviations = durations.map((duration) => Math.abs(duration - center))
  const medianAbsoluteDeviation = median(absoluteDeviations)
  const tolerance = Math.max(5000, center * 0.5, medianAbsoluteDeviation * 6)
  return durations.filter((duration) => Math.abs(duration - center) <= tolerance)
}

function median(values) {
  const sorted = values.slice().sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

function addMilliseconds(timestamp, milliseconds) {
  return new Date(Date.parse(timestamp) + milliseconds).toISOString()
}

function contractError(code, message, details) {
  return { code, message, details }
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
  if (!allowedValues.includes(value)) {
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

function requireUtcTimestamp(value, field) {
  if (
    typeof value !== 'string'
    || !value.endsWith('Z')
    || !Number.isFinite(Date.parse(value))
  ) {
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
