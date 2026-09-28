import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { resolveSelectedPython } from './lib/python-runtime.mjs'

const root = path.resolve(import.meta.dirname, '..')
const temp = await mkdtemp(path.join(root, '.tmp-host-01-'))
const TIME = '2026-09-26T08:00:00.000Z'
const DOMAIN = 'vocabulary-srs'
const ACQUISITION = 'vocabulary.acquisition.store.v1'
const RECEIPT = 'vocabulary.learning-command-receipt.v1:'

try {
  const staged = new Set()
  async function load(relative) {
    const target = path.join(temp, relative.replace(/\.js$/u, '.mjs'))
    if (!staged.has(relative)) {
      staged.add(relative)
      const moduleCode = await readFile(path.join(root, relative), 'utf8')
      for (const match of moduleCode.matchAll(/from ['"](\.[^'"]+\.js)['"]/gu)) {
        await load(path.relative(root, path.resolve(root, path.dirname(relative), match[1])))
      }
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, moduleCode.replace(/(from ['"]\.[^'"]+)\.js(['"])/gu, '$1.mjs$2'))
    }
    return target
  }
  const modulePaths = []
  for (const name of [
    'windows-owner-vocabulary-srs', 'vocabulary-acquisition-service',
    'srs-review-service-v2', 'vocabulary-learning-uow', 'vocabulary-service',
  ]) modulePaths.push(await load(`src/services/vocabulary/${name}.js`))
  const api = Object.assign({}, ...await Promise.all(modulePaths.map((file) => import(pathToFileURL(file).href))))
  await race(api, createMemoryOwner(api), false)
  await race(api, createMemoryOwner(api), true)
  await boundaries(api)
  await reviewRace(api, createMemoryOwner(api))
  await articleBatchClock(api, createMemoryOwner(api))
  console.log('HOST-01 simulation passed: races, stable rating time, deduplication, bounded/unknown failures')
  const python = await startPythonOwner()
  try {
    await race(api, python.owner('single'), false)
    await race(api, python.owner('batch'), true)
    await reviewRace(api, python.owner('review'))
    await articleBatchClock(api, python.owner('article-batch'))
    const unknown = python.owner('unknown')
    let mutations = 0
    let receipts = 0
    await service(api, {
      ...unknown,
      async command(request) {
        mutations += 1
        assert.equal((await unknown.command(request)).outcome, 'committed')
        return { outcome: 'commit-unknown', commitStatus: 'commit-unknown' }
      },
      async receipt(request) { receipts += 1; return unknown.receipt(request) },
    }).queueCandidate(candidate('real-lost-response'))
    assert.equal(mutations, 1)
    assert.equal(receipts, 1)
    assert.ok((await unknown.reload()).payload.records[`${RECEIPT}queue-real-lost-response`])
    console.log('HOST-01 real Python storage passed: single/batch/rating races and reloaded records/receipts')
  } finally {
    await python.close()
  }
} finally {
  await rm(temp, { recursive: true, force: true, maxRetries: 5 })
}

function candidate(id) {
  return {
    command_id: `queue-${id}`, command_type: 'queue_candidate',
    correlation_id: `correlation-${id}`, event_partition: '2026-09',
    payload: {
      event_id: `event-${id}`,
      learning_unit: {
        schema_version: 'learning-unit.v1', learning_unit_id: id,
        word_id: `word-${id}`, normalized_form: id, language: 'en',
        target_sense_id: null, target_sense_key: null, target_sense: null,
        created_at: TIME, updated_at: TIME, archived_at: null,
        revision: 0, extensions: {},
      },
    },
  }
}

function service(api, owner, now = () => TIME) {
  const integration = api.createWindowsOwnerVocabularySrsIntegration({ owner, now })
  return api.createVocabularyAcquisitionService({
    enabled: true, now,
    runUnitOfWork: integration.runVocabularyLearningUnitOfWork,
    runBatchSession: integration.runVocabularyLearningBatchSession,
  })
}

function fingerprint(api, request) {
  return `sha256:${api.sha256Utf8(api.canonicalJson({
    domain: DOMAIN, operation: request.operation,
    capability: 'vocabulary-srs.learning-command',
    expectedRevision: request.expectedRevision,
    payload: { records: Object.fromEntries(Object.entries(request.payload.records).map(([id, record]) => (
      [id, { ...record, checksum: `sha256:${api.sha256Utf8(api.canonicalJson(record.content))}` }]
    ))) },
  }))}`
}

function createMemoryOwner(api) {
  let revision = 0
  let records = {}
  const receipts = new Map()
  return {
    async query() {
      return { outcome: 'read', revision, payload: { records: structuredClone(records) } }
    },
    async command(request) {
      const prior = receipts.get(request.idempotencyKey)
      if (prior) {
        if (prior.receipt.requestFingerprint === fingerprint(api, request)) return structuredClone(prior)
        return { outcome: 'conflict', commitStatus: 'conflict', error: { code: 'conflict' } }
      }
      const committed = request.expectedRevision === revision
      if (committed) {
        records = { ...records, ...structuredClone(request.payload.records) }
        revision += 1
      }
      const status = committed ? 'committed' : 'conflict'
      const response = {
        outcome: status, commitStatus: status, revision,
        error: committed ? null : { code: 'conflict', currentRevision: revision },
        receipt: {
          domain: DOMAIN, operation: request.operation,
          idempotencyKey: request.idempotencyKey, expectedRevision: request.expectedRevision,
          requestFingerprint: fingerprint(api, request), revision, commitStatus: status,
          recordChecksums: committed ? [...new Set(Object.values(request.payload.records)
            .map((record) => `sha256:${api.sha256Utf8(api.canonicalJson(record.content))}`))].sort() : [],
        },
      }
      receipts.set(request.idempotencyKey, response)
      return structuredClone(response)
    },
    async receipt({ idempotencyKey }) { return structuredClone(receipts.get(idempotencyKey)) },
  }
}

async function race(api, shared, batch) {
  const requests = []
  const writerB = service(api, shared.peer || shared)
  let ticks = 0
  const writerA = service(api, {
    ...shared,
    async command(request) {
      requests.push(structuredClone(request))
      if (requests.length === 1) await writerB.queueCandidate(candidate('writer-b'))
      return shared.command(request)
    },
  }, () => new Date(Date.parse(TIME) + ticks++ * 1000).toISOString())
  const execute = () => batch
    ? writerA.runBatch(async (bound) => {
      await bound.queueCandidate(candidate('writer-a'))
      return bound.queueCandidate(candidate('writer-a-two'))
    })
    : writerA.queueCandidate(candidate('writer-a'))
  const result = await execute()
  assert.equal(requests.length, 2, 'A must recompute once after B commits')
  assert.deepEqual(requests.map((request) => request.expectedRevision), [0, 1])
  assert.notEqual(requests[0].idempotencyKey, requests[1].idempotencyKey)
  for (const key of Object.keys(requests[0].payload.records).filter((id) => id.startsWith(RECEIPT))) {
    assert.equal(requests[0].payload.records[key].content.committed_at,
      requests[1].payload.records[key].content.committed_at, 'logical command times must survive recomputation')
  }
  const saved = await shared.query({ operation: 'snapshot' })
  const pairs = saved.payload.records[ACQUISITION].content.by_learning_unit_id
  assert.deepEqual(Object.keys(pairs).sort(), batch
    ? ['writer-a', 'writer-a-two', 'writer-b'] : ['writer-a', 'writer-b'])
  assert.deepEqual(await execute(), result, 'completed business commands must replay their results')
  assert.equal(requests.length, 2, 'completed business commands must not send another mutation')
  assert.equal((await shared.query({ operation: 'snapshot' })).revision, saved.revision)
  const receipts = Object.keys(saved.payload.records).filter((key) => key.startsWith(RECEIPT))
  assert.equal(receipts.length, batch ? 3 : 2)
  const events = Object.values(saved.payload.records).flatMap((row) => row.content?.events || [])
  assert.equal(events.length, batch ? 3 : 2)
  const changed = candidate('writer-a')
  changed.payload.learning_unit.normalized_form = 'different-content'
  await assert.rejects(writerA.queueCandidate(changed), (error) => error.code === 'IDEMPOTENCY_CONFLICT')
  if (batch) await assert.rejects(writerA.runBatch((bound) => bound.queueCandidate(changed)),
    (error) => error.code === 'IDEMPOTENCY_CONFLICT')
  assert.equal(requests.length, 2)
  if (shared.reload) {
    const reloaded = await shared.reload()
    assert.equal(reloaded.revision, saved.revision)
    assert.deepEqual(reloaded.payload, saved.payload)
    const receipt = await shared.receipt({ idempotencyKey: requests[1].idempotencyKey })
    assert.equal(receipt.receipt.requestFingerprint, fingerprint(api, requests[1]))
    assert.equal(receipt.receipt.commitStatus, 'committed')
    const conflict = await shared.receipt({ idempotencyKey: requests[0].idempotencyKey })
    assert.equal(conflict.receipt.commitStatus, 'conflict')
    assert.equal(conflict.receipt.requestFingerprint, fingerprint(api, requests[0]))
    const reused = await shared.command({ ...requests[1], expectedRevision: saved.revision })
    assert.equal(reused.outcome, 'conflict', 'transport key remains bound to its original request')
    assert.equal((await shared.query({ operation: 'snapshot' })).revision, saved.revision)
  }
}

async function reviewRace(api, shared) {
  const id = 'review-unit'
  const unit = {
    ...candidate(id).payload.learning_unit,
    target_sense_id: 'review-sense', target_sense_key: 'en\u001fnoun\u001freview meaning',
    target_sense: { gloss: 'review meaning', normalized_gloss: 'review meaning', part_of_speech: 'noun', definition: null, language: 'en' },
  }
  const state = {
    schema_version: 'acquisition-state.v1', learning_unit_id: id, status: 'graduated',
    context_evidence_ids: [], validated_anchor_id: null, last_acquisition_attempt_id: null,
    introduction_episode_id: 'review-episode', introduced_at: TIME, last_exposure_at: TIME,
    ready_for_check_at: TIME, graduated_at: TIME, skipped_at: null, revision: 0, extensions: {},
  }
  const review = {
    schema_version: 'review-state.v2', review_state_id: 'review-state', learning_unit_id: id,
    word_id: unit.word_id, state: 'review', due_at: TIME, stability: 3, difficulty: 5,
    elapsed_days: 2, scheduled_days: 3, reps: 2, lapses: 0, learning_steps: 0,
    last_review_at: '2026-09-23T08:00:00.000Z', scheduler_version: 'fsrs.v1',
    scheduler_parameters_version: 'fsrs-parameters.v1', created_at: TIME, updated_at: TIME,
    revision: 0, extensions: {},
  }
  const REVIEW = 'vocabulary.review.store.v2'
  const seed = {
    domain: DOMAIN, operation: 'learning-unit-of-work', expectedRevision: 0, idempotencyKey: 'review-seed',
    payload: { records: {
      [ACQUISITION]: { id: ACQUISITION, content: { schema_version: 'acquisition-store.v1',
        by_learning_unit_id: { [id]: { learning_unit: unit, acquisition_state: state } }, acquisition_attempts_by_id: {} } },
      [REVIEW]: { id: REVIEW, content: { schema_version: 'review-store.v2', by_learning_unit_id: { [id]: review } } },
    } },
  }
  assert.equal((await shared.command(seed)).outcome, 'committed')
  const requests = []
  const writerB = service(api, shared.peer || shared)
  const integration = api.createWindowsOwnerVocabularySrsIntegration({
    now: () => TIME,
    owner: {
      ...shared,
      async command(request) {
        if (request.operation === 'learning-unit-of-work' && request.payload.records[REVIEW]) {
          requests.push(structuredClone(request))
          if (requests.length === 1) await writerB.queueCandidate(candidate('background-during-rating'))
        }
        return shared.command(request)
      },
    },
  })
  let ticks = 0
  const reviewService = api.createSrsReviewServiceV2({
    ...integration, runUnitOfWork: integration.runVocabularyLearningUnitOfWork,
    now: () => new Date(Date.parse(TIME) + ticks++ * 1000).toISOString(),
  })
  const ledger = await reviewService.startReviewSession({
    session_id: 'host-01-session', now: TIME, local_day: '2026-09-26', timezone: 'UTC',
    policy: { schema_version: 'review-policy.v1', policy_version: 'host-01-policy.v1',
      mode: 'balanced', budget_ms: 3600000, default_attempt_ms: 36000,
      balanced_revisit_delay_ms: 900000, balanced_max_revisits_per_local_day: 1 },
  })
  const input = {
    command_id: 'rating-command', attempt_id: 'rating-attempt', event_id: 'rating-event',
    correlation_id: 'rating-correlation', session_id: ledger.session_id,
    ledger_item_id: ledger.entries[ledger.cursor].ledger_item_id, occurred_at: TIME, event_partition: '2026-09',
    rating: 'good', prompt_mode: 'word_only', cue_level: 'none', answer_revealed_before_rating: true,
    duration_ms: 12000, active_duration_ms: 12000, context_evidence_id: null,
  }
  const result = await reviewService.recordReviewAttempt(input)
  assert.equal(requests.length, 2)
  assert.notEqual(requests[0].idempotencyKey, requests[1].idempotencyKey)
  const first = requests[0].payload.records[`${RECEIPT}rating-command`].content.result
  assert.equal(first.attempt.recorded_at, result.attempt.recorded_at)
  assert.equal(first.event_id, result.event_id)
  assert.equal(first.attempt.occurred_at, result.attempt.occurred_at)
  await reviewService.recordReviewAttempt(input)
  assert.equal(requests.length, 2, 'duplicate rating must not mutate storage')
  const saved = await shared.query({ operation: 'snapshot' })
  const events = Object.values(saved.payload.records).flatMap((row) => row.content?.events || [])
  assert.equal(events.filter((event) => event.event_id === 'rating-event').length, 1)
  assert.equal(saved.payload.records[REVIEW].content.by_learning_unit_id[id].reps, 3)
  assert.ok(saved.payload.records[ACQUISITION].content.by_learning_unit_id['background-during-rating'])
  if (shared.reload) {
    const reloaded = await shared.reload()
    assert.equal(reloaded.revision, saved.revision)
    assert.deepEqual(reloaded.payload, saved.payload)
  }
}

async function articleBatchClock(api, shared) {
  const requests = []
  const writerB = service(api, shared.peer || shared)
  const integration = api.createWindowsOwnerVocabularySrsIntegration({ owner: {
    ...shared,
    async command(request) {
      if (request.operation === 'learning-unit-of-work') {
        requests.push(structuredClone(request))
        if (requests.length === 1) await writerB.queueCandidate(candidate('article-background'))
      }
      return shared.command(request)
    },
  } })
  let ticks = 0
  const vocabulary = api.createVocabularyService({
    ownerIntegration: integration, acquisitionEnabled: true,
    now: () => new Date(Date.parse(TIME) + ticks++ * 1000),
  })
  await vocabulary.queueVocabularyAcquisitions([
    { word: 'articlealpha', language: 'en', meaning: 'alpha meaning',
      context: { sentence: 'Articlealpha is a synthetic word.', source_id: 'host-01-article', source_title: 'Synthetic article' } },
    { word: 'articlebeta', language: 'en', meaning: 'beta meaning',
      context: { sentence: 'Articlebeta is another synthetic word.', source_id: 'host-01-article', source_title: 'Synthetic article' } },
  ])
  assert.equal(requests.length, 2)
  const pairs = (request) => request.payload.records[ACQUISITION].content.by_learning_unit_id
  for (const [id, pair] of Object.entries(pairs(requests[0]))) {
    assert.equal(pair.learning_unit.created_at, pairs(requests[1])[id].learning_unit.created_at,
      'article batch occurrence time must survive recomputation')
  }
  const saved = await shared.query({ operation: 'snapshot' })
  assert.equal(Object.keys(saved.payload.records[ACQUISITION].content.by_learning_unit_id).length, 3)
}

async function boundaries(api) {
  for (const batch of [false, true]) {
    const shared = createMemoryOwner(api)
    const writerB = service(api, shared)
    let mutations = 0
    const writerA = service(api, {
      ...shared,
      async command(request) {
        mutations += 1
        await writerB.queueCandidate(candidate(`busy-${mutations}`))
        return shared.command(request)
      },
    })
    await assert.rejects(batch
      ? writerA.runBatch((bound) => bound.queueCandidate(candidate('never-saved')))
      : writerA.queueCandidate(candidate('never-saved')),
    (error) => error.code === 'REVISION_CONFLICT' && error.outcome === 'conflict'
      && error.message.includes('REVISION_CONFLICT'))
    assert.equal(mutations, 3)
    const rows = (await shared.query()).payload.records
    assert.equal(rows[ACQUISITION].content.by_learning_unit_id['never-saved'], undefined)
    assert.equal(Object.keys(rows).filter((key) => key.startsWith(RECEIPT)).length, 3)
  }
  for (const mode of ['matching', 'missing', 'fingerprint', 'domain', 'revision', 'keys', 'row-ids', 'receipt-error']) {
    const shared = createMemoryOwner(api)
    let mutations = 0
    let receipts = 0
    let sent
    const writer = service(api, {
      ...shared,
      async command(request) {
        mutations += 1
        sent = request
        await shared.command(request)
        return { outcome: 'commit-unknown', commitStatus: 'commit-unknown' }
      },
      async receipt(request) {
        receipts += 1
        if (mode === 'receipt-error') throw new Error('receipt unavailable')
        if (mode === 'missing') return { outcome: 'commit-unknown' }
        const response = await shared.receipt(request)
        if (mode === 'fingerprint') response.receipt.requestFingerprint = `sha256:${'0'.repeat(64)}`
        if (mode === 'domain') response.receipt.domain = 'reader-session'
        if (mode === 'revision') response.receipt.expectedRevision += 1
        if (mode === 'keys') response.receipt.idempotencyKey = 'another-request'
        if (mode === 'row-ids') response.receipt.requestFingerprint = fingerprint(api, {
          ...sent, payload: { records: Object.fromEntries(Object.entries(sent.payload.records)
            .map(([id, record]) => [`${id}-another`, { ...record, id: `${id}-another` }])) },
        })
        return response
      },
    })
    const pending = writer.queueCandidate(candidate(`unknown-${mode}`))
    if (mode === 'matching') await pending
    else await assert.rejects(pending, (error) => error.outcome === 'commit-unknown')
    assert.equal(mutations, 1, 'unknown outcomes must never resend mutations')
    assert.equal(receipts, 1)
  }
  for (const mode of ['key-collision', 'thrown-conflict', 'not-ready', 'read-failure', 'business-failure']) {
    let queries = 0
    let mutations = 0
    const integration = api.createWindowsOwnerVocabularySrsIntegration({
      now: () => TIME,
      owner: {
        async query() {
          queries += 1
          return mode === 'read-failure' ? { outcome: 'offline' }
            : { outcome: 'read', revision: 0, payload: { records: {} } }
        },
        async command() {
          mutations += 1
          if (mode === 'not-ready' || mode === 'thrown-conflict') {
            throw Object.assign(new Error(mode), { code: mode === 'not-ready' ? 'owner-not-ready' : 'REVISION_CONFLICT' })
          }
          return { outcome: 'conflict', commitStatus: 'conflict', error: { code: 'conflict' } }
        },
      },
    })
    await assert.rejects(integration.runVocabularyLearningUnitOfWork({}, candidate(mode), async (uow) => {
      if (mode === 'business-failure') throw Object.assign(new Error('invalid operation'), { code: 'INVALID_STATE_TRANSITION' })
      await uow.acquisition.putLearningUnit(candidate(mode).payload.learning_unit, null)
      return { ok: true }
    }))
    assert.equal(queries, 1)
    assert.equal(mutations, ['read-failure', 'business-failure'].includes(mode) ? 0 : 1)
  }
}

async function startPythonOwner() {
  const selected = await resolveSelectedPython({ repoRoot: root, configPath: 'config/runtime.optimization.json' })
  const script = `
import json, sys
from pathlib import Path
from youtube_workflow.vocabulary_srs_owner import VocabularySrsOwner
owners = {}
for line in sys.stdin:
    item = json.loads(line)
    key = (item['space'], item['side'])
    if item['method'] == 'reload':
        owners.pop(key, None)
    owner = owners.setdefault(key, VocabularySrsOwner(Path(sys.argv[1]) / item['space'], 'host-01-profile', 'host-01-instance'))
    request = item['request']
    ids = dict(request_id=item['id'], correlation_id=item['id'])
    try:
        if item['method'] in ('query', 'reload'):
            response = owner.query(request.get('operation', 'snapshot'), **ids)
        elif item['method'] == 'receipt':
            response = owner.receipt(idempotency_key=request['idempotencyKey'], **ids)
        else:
            response = owner.command(request['operation'], payload=request['payload'], expected_revision=request['expectedRevision'], idempotency_key=request['idempotencyKey'], **ids)
        print(json.dumps(response), flush=True)
    except Exception as error:
        print(json.dumps({'bridgeError': type(error).__name__}), flush=True)
`
  const child = spawn(selected.executable, ['-u', '-c', script, path.join(temp, 'storage')], {
    cwd: path.join(root, 'tools', 'subtitle-workflow'), windowsHide: true,
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const exited = once(child, 'exit')
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
  let sequence = 0
  function owner(space, side = 'a') {
    async function call(method, request = {}) {
      child.stdin.write(`${JSON.stringify({ space, side, method, request, id: `host-01-${++sequence}` })}\n`)
      const line = await lines.next()
      assert.equal(line.done, false, 'Python bridge must return a response')
      const response = JSON.parse(line.value)
      assert.equal(response.bridgeError, undefined)
      return response
    }
    const client = {
      query: (request) => call('query', request),
      command: (request) => call('command', request),
      receipt: (request) => call('receipt', request),
      reload: async () => {
        const response = await call('reload', { operation: 'snapshot' })
        // Request metadata changes on reload; compare durable state only.
        const current = await call('query', { operation: 'snapshot' })
        assert.deepEqual(response.payload, current.payload)
        return current
      },
    }
    if (side === 'a') client.peer = owner(space, 'b')
    return client
  }
  return { owner, async close() { child.stdin.end(); const [code] = await exited; assert.equal(code, 0) } }
}
