const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const STORE_KEY = 'vocabulary.srs.store.v1'
const METHOD_VERSION = 'vocabulary-srs-snapshot-inspector.v3'
const DEFAULT_FIXTURE = path.resolve(__dirname, '..', 'fixtures', `${STORE_KEY}.test-snapshot.json`)
const TEST_ONLY_HMAC_KEY = Buffer.from('p0-synthetic-fixture-key-not-for-personal-data-v2', 'utf8')
const EXPECTED_FIXTURE_SHA256 = 'd66511eb2778552fe39088236d04b2fc3d5ad7abdad92965fbf44dd75367d932'
const REVIEW_STATES = new Set(['new', 'learning', 'review', 'relearning'])
const RATINGS = new Set(['again', 'hard', 'good', 'easy'])
const STATE_FIELDS = new Set([
  'review_state_id', 'learning_unit_id', 'word_id', 'due_at', 'stability', 'difficulty',
  'elapsed_days', 'scheduled_days', 'reps', 'lapses', 'state', 'last_review_at',
  'learning_steps', 'scheduler_version', 'scheduler_parameters_version', 'created_at',
  'updated_at', 'revision',
])

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest('hex')
const token = (kind, value, key) => value === null || value === undefined || value === ''
  ? null
  : `${kind}_${hmac(key, `${kind}\0${String(value)}`).slice(0, 24)}`
const redact = (field, value, key) => value === null || value === undefined || value === ''
  ? null
  : `[redacted:hmac-sha256:${hmac(key, `${field}\0${String(value)}`)}]`
const safeNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : 0
const safeIso = (value) => {
  if (value === null || value === undefined || value === '') return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
}
const stableJson = (value) => JSON.stringify(canonicalize(value))

function sanitizeState(state, key, scope, omitted, invalidStates) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null
  Object.keys(state).filter((field) => !STATE_FIELDS.has(field))
    .forEach((field) => omitted.add(`${scope}.${field}`))
  const knownState = REVIEW_STATES.has(state.state)
  if (!knownState) invalidStates.add(`${scope}.state`)
  return {
    review_state_id: token('review_state', state.review_state_id, key),
    learning_unit_id: token('learning_unit', state.learning_unit_id, key),
    word_id: token('word', state.word_id, key),
    due_at: safeIso(state.due_at),
    stability: safeNumber(state.stability),
    difficulty: safeNumber(state.difficulty),
    elapsed_days: safeNumber(state.elapsed_days),
    scheduled_days: safeNumber(state.scheduled_days),
    reps: safeNumber(state.reps),
    lapses: safeNumber(state.lapses),
    state: knownState ? state.state : null,
    last_review_at: safeIso(state.last_review_at),
    learning_steps: safeNumber(state.learning_steps),
    scheduler_version: redact('scheduler_version', state.scheduler_version, key),
    scheduler_parameters_version: redact(
      'scheduler_parameters_version',
      state.scheduler_parameters_version,
      key,
    ),
    created_at: safeIso(state.created_at),
    updated_at: safeIso(state.updated_at),
    revision: safeNumber(state.revision),
  }
}

function sanitizeSnapshot(snapshot, key) {
  const omitted = new Set()
  const invalidStates = new Set()
  const words = Array.isArray(snapshot.words) ? snapshot.words : []
  const contexts = Array.isArray(snapshot.contexts) ? snapshot.contexts : []
  const states = Array.isArray(snapshot.reviewStates) ? snapshot.reviewStates : []
  const logs = Array.isArray(snapshot.reviewLogs) ? snapshot.reviewLogs : []
  return {
    omitted,
    invalidStates,
    value: {
      schemaVersion: 1,
      words: words.map((word) => ({
        id: token('word', word.id, key),
        word: redact('word', word.word, key),
        lemma: redact('lemma', word.lemma, key),
        lookup_key: redact('lookup_key', word.lookup_key, key),
        entry_type: ['word', 'phrase'].includes(word.entry_type) ? word.entry_type : null,
        language: /^[a-z0-9-]{1,20}$/i.test(word.language || '') ? word.language.toLowerCase() : null,
        meaning: redact('meaning', word.meaning, key),
        status: ['new', 'learning', 'known', 'ignored'].includes(word.status) ? word.status : null,
        tags: Array.isArray(word.tags) ? word.tags.map((tag) => redact('tag', tag, key)) : [],
        created_at: safeIso(word.created_at),
        updated_at: safeIso(word.updated_at),
      })),
      contexts: contexts.map((context) => ({
        id: token('context', context.id, key),
        word_id: token('word', context.word_id, key),
        sentence: redact('sentence', context.sentence, key),
        meaning: redact('context_meaning', context.meaning, key),
        simple_meaning: redact('simple_meaning', context.simple_meaning, key),
        source_id: token('source', context.source_id, key),
        source_title: redact('source_title', context.source_title, key),
        source_url: redact('source_url', context.source_url, key),
        surrounding_text: redact('surrounding_text', context.surrounding_text, key),
        created_at: safeIso(context.created_at),
      })),
      reviewStates: states.map((state, index) => sanitizeState(
        state,
        key,
        `reviewStates[${index}]`,
        omitted,
        invalidStates,
      )),
      reviewLogs: logs.map((log, index) => ({
        id: token('review_log', log.id, key),
        word_id: token('word', log.word_id, key),
        rating: RATINGS.has(log.rating) ? log.rating : null,
        reviewed_at: safeIso(log.reviewed_at),
        before_state: sanitizeState(
          log.before_state,
          key,
          `reviewLogs[${index}].before_state`,
          omitted,
          invalidStates,
        ),
        after_state: sanitizeState(
          log.after_state,
          key,
          `reviewLogs[${index}].after_state`,
          omitted,
          invalidStates,
        ),
      })),
    },
  }
}

const selfTestOmitted = new Set()
const selfTestInvalidStates = new Set()
const selfTestState = sanitizeState(
  { state: 'future-state', private_note: 'must-not-appear' },
  TEST_ONLY_HMAC_KEY,
  'selfTest.state',
  selfTestOmitted,
  selfTestInvalidStates,
)
assert.equal(selfTestState.state, null)
assert.deepEqual([...selfTestInvalidStates], ['selfTest.state.state'])
assert.deepEqual([...selfTestOmitted], ['selfTest.state.private_note'])

function main() {
  const inputPath = path.resolve(process.argv[2] || DEFAULT_FIXTURE)
  const synthetic = inputPath === DEFAULT_FIXTURE
  const beforeStat = fs.statSync(inputPath)
  const before = fs.readFileSync(inputPath)
  const rawSha256 = sha256(before)
  if (synthetic) {
    assert.equal(
      rawSha256,
      EXPECTED_FIXTURE_SHA256,
      'DEFAULT_FIXTURE_HASH_MISMATCH: public test key is allowed only for the pinned synthetic fixture bytes',
    )
  }
  const key = synthetic
    ? TEST_ONLY_HMAC_KEY
    : Buffer.from(process.env.P0_SNAPSHOT_HMAC_KEY || '', 'utf8')
  if (!synthetic) assert.ok(key.byteLength >= 32, 'P0_SNAPSHOT_HMAC_KEY must contain at least 32 UTF-8 bytes')
  const parsed = JSON.parse(before.toString('utf8'))
  const row = parsed && parsed.id === STORE_KEY ? parsed : { id: STORE_KEY, content: parsed }
  assert.equal(row.id, STORE_KEY)
  assert.equal(Number(row.content.schemaVersion), 1)
  for (const field of ['words', 'contexts', 'reviewStates', 'reviewLogs']) {
    assert.ok(Array.isArray(row.content[field]), `expected ${field} array`)
  }
  const sanitized = sanitizeSnapshot(row.content, key)
  assert.equal(
    sanitized.invalidStates.size,
    0,
    `UNKNOWN_REVIEW_STATE: refused at ${[...sanitized.invalidStates].sort().join(', ')}`,
  )
  const after = fs.readFileSync(inputPath)
  const afterStat = fs.statSync(inputPath)
  assert.deepEqual(after, before)
  assert.equal(afterStat.size, beforeStat.size)
  assert.equal(afterStat.mtimeMs, beforeStat.mtimeMs)
  const report = {
    method_version: METHOD_VERSION,
    storage_key: STORE_KEY,
    source_kind: synthetic ? 'synthetic_test_fixture' : 'explicit_offline_json',
    source_file_name: path.basename(inputPath),
    fixture_sha256_pinned: synthetic ? EXPECTED_FIXTURE_SHA256 : null,
    source_hmac_sha256: hmac(key, before),
    sanitized_sha256: sha256(stableJson(sanitized.value)),
    pseudonymization: 'hmac-sha256',
    hmac_key_disclosed: false,
    input_mutated: false,
    indexeddb_accessed: false,
    unknown_review_state_fields_omitted: [...sanitized.omitted].sort(),
    unknown_review_states_rejected: true,
    self_tests: [
      'default fixture bytes pinned before public test key use',
      'unknown ReviewState maps to null and rejects report',
      'unknown ReviewState fields are omitted',
    ],
    counts: {
      words: sanitized.value.words.length,
      contexts: sanitized.value.contexts.length,
      review_states: sanitized.value.reviewStates.length,
      review_logs: sanitized.value.reviewLogs.length,
    },
    sanitized_snapshot: sanitized.value,
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

main()
