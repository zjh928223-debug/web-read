import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createServer as createViteServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'

import {
  readOwnerModeCheckpoint,
  readOwnerModeFreeze,
  revokeOwnerModeCheckpoint,
  writeIsolatedBrowserProfile,
} from './lib/read-web-production-backup.mjs'
import {
  createWindowsOwnerProductionHostClient,
  runWindowsOwnerProductionCutover,
} from './lib/windows-owner-cutover.mjs'
import { listenOnBrowserSafePort } from './lib/browser-port-policy.mjs'
import { resolveSelectedPython } from './lib/python-runtime.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DOMAIN = 'vocabulary-srs'
const PROFILE_ID = 'c2c-vocabulary-profile'
const INSTANCE_ID = 'c2c-vocabulary-instance'
const ACCESS_TOKEN = 'c2c-vocabulary-token'
const FIXTURE_TIME = '2026-08-29T12:00:00.000Z'
const EVENT_SHARD_ID = 'vocabulary.learning-events.v1.2026-08.0001'
const SETTLEMENT_ROW_ID = 'vocabulary-article-srs-settlement-progress:fixture-article-1'
const RECEIPT_PREFIX = 'vocabulary.learning-command-receipt.v1:'
const ALL_OWNER_DOMAINS = [
  'reader-session',
  'vocabulary-srs',
  'passage-preview',
  'annotation',
  'marks-activity',
  'workflow',
]

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function canonical(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}

function checksum(value) {
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`
}

function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function makeLayout(root, name) {
  const instanceRoot = path.join(root, `${name}-instance`)
  const authorityIsolationRoot = path.join(root, `${name}-authority`)
  return {
    isolationRoot: instanceRoot,
    profileDir: path.join(instanceRoot, 'profile'),
    pythonStateDir: path.join(instanceRoot, 'python-state'),
    pythonOutputDir: path.join(instanceRoot, 'python-output'),
    profileAuthorityIsolationRoot: authorityIsolationRoot,
    profileAuthorityRoot: path.join(authorityIsolationRoot, 'profile-authority'),
  }
}

function makeHealth(frozenDomains = [], authoritativeDomains = []) {
  const frozen = new Set(frozenDomains)
  const authoritative = new Set(authoritativeDomains)
  return {
    profileId: PROFILE_ID,
    instanceId: INSTANCE_ID,
    liveness: { ready: true },
    contractValid: true,
    profileEvidenceReady: true,
    ownerRegistry: { valid: true },
    ownerMode: {
      status: frozen.size ? 'frozen' : authoritative.size ? 'authoritative' : 'pre-cutover',
      authoritativeDomains: [...authoritative],
      frozenDomains: [...frozen],
    },
    domains: ALL_OWNER_DOMAINS.map((domain) => ({
      domain,
      authority: authoritative.has(domain) ? 'authoritative' : 'pre-cutover',
      queryCapability: 'read-only',
      commandCapability: authoritative.has(domain) ? 'writable' : 'not-ready',
      writerFrozen: frozen.has(domain),
    })),
  }
}

function ownerProfileEvidence(profileId) {
  const verified = {
    bound: true,
    status: 'verified',
    source: 'read-web-production-backup.composition',
  }
  const bindings = {
    backupAdapterRegistry: { ...verified, requiredDomains: [...ALL_OWNER_DOMAINS] },
    applicationLease: { ...verified, source: 'read-web-production-backup.application-profile-lease' },
    transaction: { ...verified },
    revision: { ...verified },
    recovery: { ...verified },
    domains: {},
  }
  for (const domain of ALL_OWNER_DOMAINS) {
    bindings.domains[domain] = {
      backupAdapter: { ...verified, key: domain, schemaVersion: 1, supportedSchemaVersions: [1] },
      revision: { ...verified },
      recovery: { ...verified },
    }
  }
  return {
    schemaVersion: 1,
    source: 'read-web-production-backup.composition',
    ready: true,
    profileChecksum: `sha256:${'a'.repeat(64)}`,
    inventory: {
      present: true,
      status: 'verified',
      source: 'browser-profile.json + application_backup.py',
      indexedDbRowCount: 0,
      localStorageKeyCount: 0,
      pythonSourceCount: 2,
    },
    collection: {
      status: 'verified',
      source: 'createReadWebApplicationBackupService.createBackup',
      artifactChecksum: `sha256:${'b'.repeat(64)}`,
    },
    rows: [],
    bindings,
    profileLease: {
      schemaVersion: 1,
      status: 'held',
      profileId,
      profileKeyHash: `sha256:${'c'.repeat(64)}`,
      leaseIdHash: `sha256:${'d'.repeat(64)}`,
      ownerTokenHash: `sha256:${'e'.repeat(64)}`,
      pid: process.pid,
    },
    ownerMode: {
      schemaVersion: 1,
      status: 'pre-cutover',
      authoritativeDomains: [],
      invalidDomains: [],
    },
  }
}

async function unusedPort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = address?.port
  await new Promise((resolve) => server.close(resolve))
  return port
}

function send(response, status, contentType, body) {
  response.writeHead(status, { 'content-type': `${contentType}; charset=utf-8` })
  response.end(body)
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

async function startLocalAppHost(layout) {
  const port = await unusedPort()
  const distDir = path.join(layout.isolationRoot, 'host-dist')
  await mkdir(distDir, { recursive: true })
  await writeFile(path.join(distDir, 'index.html'), '<main>isolated vocabulary C2c Host</main>', 'utf8')
  const python = await resolveSelectedPython({
    repoRoot: repositoryRoot,
    configPath: path.join(repositoryRoot, 'config', 'runtime.optimization.json'),
  })
  const script = `
import json, os
from pathlib import Path
from fastapi import FastAPI
import uvicorn
from youtube_workflow.production_host_prototype import create_local_app_host
from youtube_workflow.windows_owner_registry import load_owner_registry

registry = load_owner_registry(Path(os.environ['C2C_REGISTRY']))
app = create_local_app_host(
    dist_dir=Path(os.environ['C2C_DIST']),
    workflow_app=FastAPI(),
    access_token=os.environ['C2C_TOKEN'],
    profile_id=os.environ['C2C_PROFILE_ID'],
    instance_id=os.environ['C2C_INSTANCE_ID'],
    owner_registry=registry,
    owner_profile_evidence=json.loads(os.environ['C2C_OWNER_EVIDENCE']),
    owner_repository_root=Path(os.environ['C2C_AUTHORITY_ROOT']),
    owner_receipt_root=Path(os.environ['C2C_AUTHORITY_ROOT']),
    owner_freeze_root=Path(os.environ['C2C_AUTHORITY_ROOT']),
    owner_migration_mode='optimization',
    owner_migration_domains=['vocabulary-srs'],
    config_compatibility={'schemaVersion': 1, 'minimum': 1, 'maximum': 1},
)
uvicorn.run(app, host='127.0.0.1', port=int(os.environ['C2C_PORT']), log_level='warning', access_log=False)
`
  const child = spawn(python.executable, ['-c', script], {
    cwd: path.join(repositoryRoot, 'tools', 'subtitle-workflow'),
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PYTHONPATH: path.join(repositoryRoot, 'tools', 'subtitle-workflow'),
      C2C_DIST: distDir,
      C2C_REGISTRY: path.join(repositoryRoot, 'docs', 'architecture', 'windows-local-owner-thin-reader', 'owner-registry.json'),
      C2C_TOKEN: ACCESS_TOKEN,
      C2C_PROFILE_ID: PROFILE_ID,
      C2C_INSTANCE_ID: INSTANCE_ID,
      C2C_OWNER_EVIDENCE: JSON.stringify(ownerProfileEvidence(PROFILE_ID)),
      C2C_AUTHORITY_ROOT: layout.profileAuthorityRoot,
      C2C_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let stderr = ''
  child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
  const baseUrl = `http://127.0.0.1:${port}`
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Local App Host exited before ready: ${stderr.trim() || child.exitCode}`)
    try {
      const response = await fetch(`${baseUrl}/api/app/health`, {
        headers: { 'X-Read-Web-Token': ACCESS_TOKEN },
      })
      if (response.ok) return { child, baseUrl, accessToken: ACCESS_TOKEN, profileId: PROFILE_ID, instanceId: INSTANCE_ID, health: await response.json() }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  child.kill()
  await once(child, 'exit').catch(() => {})
  throw new Error(`Local App Host did not become ready: ${stderr.trim() || 'timeout'}`)
}

async function stopLocalAppHost(host) {
  if (!host?.child || host.child.exitCode !== null) return
  host.child.kill()
  await once(host.child, 'exit').catch(() => {})
}

async function loadBrowserCutoverModule() {
  const source = await readFile(path.join(repositoryRoot, 'src/services/windows-owner-domain-cutover.js'), 'utf8')
  const resolved = source
    .replace(
      "import { createWindowsOwnerApiClient } from './windows-owner-api-client.js'\n",
      'const createWindowsOwnerApiClient = () => null\n',
    )
    .replace(
      "import { readWindowsOwnerHealth } from './windows-owner-reader-session-composition.js'\n",
      `const readWindowsOwnerHealth = async (fetchImpl, healthPath) => {
        try {
          const response = await fetchImpl(healthPath, { method: 'GET', credentials: 'same-origin' })
          return response?.ok === false || typeof response?.json !== 'function' ? null : response.json()
        } catch (_error) {
          return null
        }
      }
`,
    )
  return import(`data:text/javascript;base64,${Buffer.from(resolved, 'utf8').toString('base64')}`)
}

function word(id, lemma, meaning, createdAt) {
  return {
    id,
    word: lemma,
    lemma,
    lookup_key: lemma,
    entry_type: 'word',
    language: 'en',
    phonetic: null,
    meaning,
    general_meaning: null,
    dictionary_definition: null,
    dictionary_source: null,
    dictionary_fetched_at: null,
    note: null,
    status: 'learning',
    tags: [],
    created_at: createdAt,
    updated_at: createdAt,
  }
}

function legacyReviewState(wordId, dueAt) {
  return {
    word_id: wordId,
    due_at: dueAt,
    stability: 2,
    difficulty: 5,
    elapsed_days: 1,
    scheduled_days: 2,
    reps: 1,
    lapses: 0,
    state: 'review',
    last_review_at: '2026-08-27T08:00:00.000Z',
    learning_steps: 0,
  }
}

function vocabularySnapshot() {
  return {
    schemaVersion: 1,
    words: [
      word('fixture-word-alpha', 'alpha', 'first fixture meaning', '2026-08-25T08:00:00.000Z'),
      word('fixture-word-beta', 'beta', 'second fixture meaning', '2026-08-25T08:01:00.000Z'),
    ],
    contexts: [
      {
        id: 'fixture-legacy-context-alpha',
        word_id: 'fixture-word-alpha',
        sentence: 'Alpha appears in the first fixture sentence.',
        meaning: 'first fixture meaning',
        simple_meaning: 'first',
        source_id: 'fixture-article-1',
        source_title: 'Fixture article',
        source_url: null,
        surrounding_text: 'The first fixture sentence contains alpha.',
        created_at: '2026-08-25T08:00:00.000Z',
      },
      {
        id: 'fixture-legacy-context-beta',
        word_id: 'fixture-word-beta',
        sentence: 'Beta appears in the second fixture sentence.',
        meaning: 'second fixture meaning',
        simple_meaning: 'second',
        source_id: 'fixture-article-1',
        source_title: 'Fixture article',
        source_url: null,
        surrounding_text: 'The second fixture sentence contains beta.',
        created_at: '2026-08-25T08:01:00.000Z',
      },
    ],
    reviewStates: [
      legacyReviewState('fixture-word-alpha', '2026-08-29T08:00:00.000Z'),
      legacyReviewState('fixture-word-beta', '2026-08-29T08:00:00.000Z'),
    ],
    reviewLogs: [
      {
        id: 'fixture-legacy-review-alpha',
        word_id: 'fixture-word-alpha',
        rating: 'good',
        reviewed_at: '2026-08-27T08:00:00.000Z',
        before_state: null,
        after_state: null,
      },
      {
        id: 'fixture-legacy-review-beta',
        word_id: 'fixture-word-beta',
        rating: 'hard',
        reviewed_at: '2026-08-27T08:01:00.000Z',
        before_state: null,
        after_state: null,
      },
    ],
  }
}

function learningUnit(id, wordId, lemma, senseId, contextId) {
  return {
    learning_unit: {
      schema_version: 'learning-unit.v1',
      learning_unit_id: id,
      word_id: wordId,
      normalized_form: lemma,
      language: 'en',
      target_sense_id: senseId,
      target_sense_key: `en\u001fnoun\u001f${lemma} fixture meaning`,
      target_sense: {
        gloss: `${lemma} fixture meaning`,
        normalized_gloss: `${lemma} fixture meaning`,
        part_of_speech: 'noun',
        definition: null,
        language: 'en',
      },
      created_at: '2026-08-25T08:00:00.000Z',
      updated_at: '2026-08-28T08:00:00.000Z',
      archived_at: null,
      revision: 1,
      extensions: { source: 'fixture-article' },
    },
    acquisition_state: {
      schema_version: 'acquisition-state.v1',
      learning_unit_id: id,
      status: 'graduated',
      context_evidence_ids: [contextId],
      validated_anchor_id: contextId,
      last_acquisition_attempt_id: null,
      introduction_episode_id: `fixture-episode-${id}`,
      introduced_at: '2026-08-25T08:00:00.000Z',
      last_exposure_at: '2026-08-27T08:00:00.000Z',
      ready_for_check_at: '2026-08-28T08:00:00.000Z',
      graduated_at: '2026-08-28T08:01:00.000Z',
      skipped_at: null,
      revision: 4,
      extensions: { source: 'fixture-article' },
    },
  }
}

function acquisitionStore() {
  const pairs = [
    learningUnit('fixture-unit-alpha', 'fixture-word-alpha', 'alpha', 'fixture-sense-alpha', 'fixture-context-alpha'),
    learningUnit('fixture-unit-beta', 'fixture-word-beta', 'beta', 'fixture-sense-beta', 'fixture-context-beta'),
  ]
  return {
    schema_version: 'acquisition-store.v1',
    by_learning_unit_id: Object.fromEntries(pairs.map((pair) => [pair.learning_unit.learning_unit_id, pair])),
    acquisition_attempts_by_id: {},
  }
}

function reviewState(id, wordId) {
  return {
    schema_version: 'review-state.v2',
    review_state_id: `fixture-review-${id}`,
    learning_unit_id: id,
    word_id: wordId,
    state: 'review',
    due_at: '2026-08-29T08:00:00.000Z',
    stability: 3,
    difficulty: 5,
    elapsed_days: 2,
    scheduled_days: 3,
    reps: 2,
    lapses: 0,
    learning_steps: 0,
    last_review_at: '2026-08-26T08:00:00.000Z',
    scheduler_version: 'fsrs.v1',
    scheduler_parameters_version: 'fsrs-parameters.v1',
    created_at: '2026-08-25T08:00:00.000Z',
    updated_at: '2026-08-26T08:00:00.000Z',
    revision: 2,
    extensions: {},
  }
}

function reviewStore() {
  return {
    schema_version: 'review-store.v2',
    by_learning_unit_id: {
      'fixture-unit-alpha': reviewState('fixture-unit-alpha', 'fixture-word-alpha'),
      'fixture-unit-beta': reviewState('fixture-unit-beta', 'fixture-word-beta'),
    },
  }
}

function ledger() {
  return {
    schema_version: 'session-ledger.v1',
    session_id: 'fixture-old-session',
    created_at: '2026-08-28T08:00:00.000Z',
    local_day: '2026-08-28',
    timezone: 'UTC',
    policy_version: 'fixture-policy.v1',
    mode: 'balanced',
    budget_ms: 3600000,
    estimated_attempt_ms: 60000,
    entries: [],
    cursor: 0,
    status: 'completed',
    backlog: {
      due_review_count: 0,
      relearning_count: 0,
      reassessment_count: 0,
      acquisition_count: 0,
      estimated_ms: 0,
      extensions: {},
    },
    revision: 0,
    extensions: {
      completed_item_ids: [],
      attempt_ids: [],
      attempt_fingerprints_by_id: {},
      attempt_results_by_id: {},
      revisit_counts_by_learning_unit_id: {},
      active_duration_ms: 0,
    },
  }
}

function contextEvidence(id, learningUnitId, sentence, sentenceIndex) {
  const surroundingText = `Fixture context surrounding ${sentenceIndex}.`
  return {
    schema_version: 'context-evidence.v1',
    context_evidence_id: id,
    learning_unit_id: learningUnitId,
    sentence,
    surrounding_text: surroundingText,
    content_sha256: sha256Hex(canonical({ sentence, surrounding_text: surroundingText })),
    source_kind: 'article',
    source_id: 'fixture-article-1',
    source_title: 'Fixture article',
    source_locator: { locator_version: 'source-locator.v1', sentence_index: sentenceIndex },
    license_kind: 'unknown',
    ownership: 'third_party',
    quality_status: 'pending',
    quality_reason: 'fixture-source-awaiting-validation',
    created_at: '2026-08-25T08:00:00.000Z',
    validated_at: null,
    revision: 0,
    extensions: {},
  }
}

function learningEvent(eventId, learningUnitId, wordId, eventType, occurredAt, contextId = null) {
  return {
    schema_version: 'learning-event.v1',
    event_id: eventId,
    command_id: `fixture-command-${eventId}`,
    correlation_id: `fixture-correlation-${eventId}`,
    event_type: eventType,
    attempt_id: null,
    occurred_at: occurredAt,
    recorded_at: occurredAt,
    session_id: null,
    session_position: null,
    learning_unit_id: learningUnitId,
    word_id: wordId,
    target_sense_id: eventType === 'context_attached' ? `fixture-sense-${learningUnitId.slice(-5)}` : null,
    policy_version: null,
    scheduler_version: null,
    content_version: null,
    prompt_mode: null,
    cue_level: null,
    rating: null,
    answer_revealed_before_rating: null,
    graduation_eligibility: null,
    duration_ms: null,
    active_duration_ms: null,
    before_state: null,
    after_state: null,
    source_kind: 'article',
    context_evidence_id: contextId,
    is_legacy: false,
    training_eligible: false,
    exclusion_reasons: [],
    payload: { fixture: true, source: 'c2c' },
    extensions: {},
  }
}

function eventManifest() {
  return {
    schema_version: 'learning-event-manifest.v1',
    revision: 2,
    partitions: {
      '2026-08': {
        shard_ids: [EVENT_SHARD_ID],
        active_shard_id: EVENT_SHARD_ID,
        event_count: 2,
      },
    },
    event_locations: {
      'fixture-event-alpha': EVENT_SHARD_ID,
      'fixture-event-beta': EVENT_SHARD_ID,
    },
  }
}

function eventShard() {
  return {
    schema_version: 'learning-event-shard.v1',
    partition: '2026-08',
    shard_index: 1,
    events: [
      learningEvent('fixture-event-alpha', 'fixture-unit-alpha', 'fixture-word-alpha', 'candidate_queued', '2026-08-25T08:00:00.000Z'),
      learningEvent('fixture-event-beta', 'fixture-unit-beta', 'fixture-word-beta', 'context_attached', '2026-08-25T08:01:00.000Z', 'fixture-context-beta'),
    ],
  }
}

function settlementProgress() {
  return {
    article_id: 'fixture-article-1',
    refinements: [
      {
        target_id: 'fixture-target-alpha',
        simple_meaning: 'first',
        prompt_version: 1,
        status: 'completed',
        attempt_token: 'fixture-refinement-alpha',
        attempted_at: '2026-08-27T08:00:00.000Z',
        completed_at: '2026-08-27T08:01:00.000Z',
        failed_at: null,
        error: null,
      },
      {
        target_id: 'fixture-target-beta',
        simple_meaning: 'second',
        prompt_version: 1,
        status: 'completed',
        attempt_token: 'fixture-refinement-beta',
        attempted_at: '2026-08-27T08:02:00.000Z',
        completed_at: '2026-08-27T08:03:00.000Z',
        failed_at: null,
        error: null,
      },
    ],
    application_claims: [],
    settlement_target_ids: ['fixture-target-alpha', 'fixture-target-beta'],
    removed_target_ids: [],
    applied_target_ids: ['fixture-target-alpha'],
    skipped_target_ids: [],
    last_apply_mode: 'all',
    refined_at: '2026-08-27T08:03:00.000Z',
    applied_at: '2026-08-28T08:00:00.000Z',
    skipped_at: null,
    updated_at: '2026-08-28T08:00:00.000Z',
  }
}

function receipt(commandId, result, payload, eventId) {
  const commandType = 'fixture_seed'
  const contractVersion = 'vocabulary-learning-contracts.v1'
  return {
    schema_version: 'command-receipt.v1',
    command_id: commandId,
    command_type: commandType,
    contract_version: contractVersion,
    payload_fingerprint: sha256Hex(canonical({
      command_type: commandType,
      contract_version: contractVersion,
      payload,
    })),
    status: 'committed',
    result,
    result_sha256: sha256Hex(canonical(result)),
    correlation_id: `fixture-correlation-${commandId}`,
    touched_row_ids: ['vocabulary.acquisition.store.v1', 'vocabulary.learning-events.manifest.v1'],
    event_ids: [eventId],
    committed_at: FIXTURE_TIME,
    extensions: {},
  }
}

function personalizationReport(sessionId, generatedAt) {
  return {
    schema_version: 'personalization-shadow-report.v1',
    session_id: sessionId,
    generated_at: generatedAt,
    source_event_count: 2,
    adapter_version: 'fixture-adapter.v1',
    skill_estimator_version: 'fixture-skill.v1',
    preference_estimator_version: 'fixture-preference.v1',
    curriculum_planner_version: 'fixture-curriculum.v1',
    diagnostics: { fixture: true },
    comparison: { baseline: { due_count: 1 }, shadow: { due_count: 1 } },
    shadow_plan: { items: [{ learning_unit_id: 'fixture-unit-alpha', rank: 1 }] },
    model_snapshot: {
      schema_version: 'personalization-shadow-model-snapshot.v1',
      skill_profile: { fixture: 'steady' },
      presentation_preference: { fixture: 'context' },
      presentation_rankings: {},
      unit_labels: {},
      recent_presentations: {},
    },
  }
}

function pendingStore() {
  return {
    schemaVersion: 1,
    groups: {
      'fixture-scope-alpha': {
        scopeKey: 'fixture-scope-alpha',
        candidates: [
          { target_id: 'fixture-target-alpha', targetId: 'fixture-target-alpha', lemma: 'alpha', word: 'alpha' },
          { target_id: 'fixture-target-beta', targetId: 'fixture-target-beta', lemma: 'beta', word: 'beta' },
        ],
        excluded: [],
        created_at: '2026-08-27T08:00:00.000Z',
        updated_at: '2026-08-28T08:00:00.000Z',
      },
      'fixture-scope-beta': {
        scopeKey: 'fixture-scope-beta',
        candidates: [{ target_id: 'fixture-target-gamma', targetId: 'fixture-target-gamma', lemma: 'gamma', word: 'gamma' }],
        excluded: [{ target_id: 'fixture-target-delta', targetId: 'fixture-target-delta', reason: 'fixture-excluded' }],
        created_at: '2026-08-27T08:01:00.000Z',
        updated_at: '2026-08-28T08:01:00.000Z',
      },
    },
  }
}

function fixtureRows() {
  const contextStore = {
    schema_version: 'context-evidence-store.v1',
    by_context_evidence_id: {
      'fixture-context-alpha': contextEvidence(
        'fixture-context-alpha',
        'fixture-unit-alpha',
        'Alpha appears in the first evidence sentence.',
        0,
      ),
      'fixture-context-beta': contextEvidence(
        'fixture-context-beta',
        'fixture-unit-beta',
        'Beta appears in the second evidence sentence.',
        1,
      ),
    },
  }
  const resultOne = { schema_version: 'fixture-result.v1', ok: true, record_count: 2 }
  const resultTwo = { schema_version: 'fixture-result.v1', ok: true, record_count: 2, second: true }
  const receiptOne = receipt('fixture-receipt-alpha', resultOne, { seed: 'alpha' }, 'fixture-event-alpha')
  const receiptTwo = receipt('fixture-receipt-beta', resultTwo, { seed: 'beta' }, 'fixture-event-beta')
  const acquisition = acquisitionStore()
  const backupSourceRow = {
    id: 'vocabulary.acquisition.store.v1',
    content: clone(acquisition),
    revision: 7,
    timestamp: FIXTURE_TIME,
  }
  const backupRowId = 'vocabulary.acquisition.store.v1.backup:7'
  const backupContent = {
    schema_version: 'vocabulary-backup.v1',
    sourceId: backupSourceRow.id,
    sourceRow: backupSourceRow,
    createdAt: FIXTURE_TIME,
  }
  const quarantineSourceRow = {
    id: 'vocabulary.srs.store.v1',
    content: { schemaVersion: 99, corrupt_fixture: true },
    revision: 8,
    timestamp: FIXTURE_TIME,
    checksum: `sha256:${'0'.repeat(64)}`,
  }
  const quarantineReason = 'checksum-mismatch'
  const quarantineRowId = `vocabulary.corrupt.quarantine.v1:${sha256Hex(canonical({
    sourceId: quarantineSourceRow.id,
    sourceRow: quarantineSourceRow,
    reason: quarantineReason,
  }))}`
  const quarantineContent = {
    schema_version: 'vocabulary-corrupt-quarantine.v1',
    sourceId: quarantineSourceRow.id,
    sourceRow: quarantineSourceRow,
    reason: quarantineReason,
    detectedAt: FIXTURE_TIME,
    details: { code: 'CORRUPT', operation: 'vocabulary-learning-uow' },
  }
  const contents = {
    'vocabulary.srs.store.v1': vocabularySnapshot(),
    'vocabulary.acquisition.store.v1': acquisition,
    'vocabulary.review.store.v2': reviewStore(),
    'vocabulary.review-session-ledgers.v1': {
      schema_version: 'review-session-ledger-store.v1',
      by_session_id: { 'fixture-old-session': ledger() },
    },
    'vocabulary.learning-events.manifest.v1': eventManifest(),
    [EVENT_SHARD_ID]: eventShard(),
    'vocabulary.context-evidence.store.v1': contextStore,
    'vocabulary.personalization.shadow-reports.v1': {
      schema_version: 'personalization-shadow-report-store.v1',
      by_session_id: {
        'fixture-shadow-alpha': personalizationReport('fixture-shadow-alpha', '2026-08-27T08:00:00.000Z'),
        'fixture-shadow-beta': personalizationReport('fixture-shadow-beta', '2026-08-28T08:00:00.000Z'),
      },
    },
    'vocabulary-srs-pending-candidates': pendingStore(),
    [SETTLEMENT_ROW_ID]: settlementProgress(),
    'vocabulary.revision-watermark.v1': {
      schema_version: 'vocabulary-revision-watermark.v1',
      revision: 2,
    },
    [`${RECEIPT_PREFIX}fixture-receipt-alpha`]: receiptOne,
    [`${RECEIPT_PREFIX}fixture-receipt-beta`]: receiptTwo,
    [backupRowId]: backupContent,
    [quarantineRowId]: quarantineContent,
  }
  return Object.entries(contents).map(([id, content]) => ({
    id,
    schemaVersion: 1,
    revision: 1,
    timestamp: FIXTURE_TIME,
    content,
  }))
}

async function seedProfile(layout, rows) {
  await mkdir(layout.profileDir, { recursive: true })
  await mkdir(layout.pythonStateDir, { recursive: true })
  await mkdir(layout.pythonOutputDir, { recursive: true })
  await mkdir(layout.profileAuthorityRoot, { recursive: true })
  await writeIsolatedBrowserProfile(layout.profileDir, {
    localStorage: {},
    indexedDbRows: rows,
  })
}

function contentFromRecord(record) {
  return clone(record?.content ?? record?.payload ?? record)
}

async function assertHostSnapshot(client, expectedRows, stage) {
  const response = await client.query({ domain: DOMAIN, operation: 'snapshot', payload: {} })
  assert.equal(response.outcome, 'read', `${stage}: Host snapshot must be readable`)
  const records = response.payload?.records || {}
  const expectedKeys = Object.keys(expectedRows).sort()
  assert.deepEqual(Object.keys(records).sort(), expectedKeys, `${stage}: complete durable key set`)
  assert.equal(Object.keys(records).length, expectedKeys.length, `${stage}: complete record count`)
  for (const id of expectedKeys) {
    const content = contentFromRecord(records[id])
    assert.deepEqual(content, expectedRows[id], `${stage}: content preserved for ${id}`)
    assert.equal(checksum(content), checksum(expectedRows[id]), `${stage}: checksum preserved for ${id}`)
  }
  const documentCore = {
    schemaVersion: 'vocabulary-srs-owner.v1',
    profileId: PROFILE_ID,
    revision: response.payload.revision,
    records,
  }
  assert.equal(response.payload.checksum, checksum(documentCore), `${stage}: Host document checksum`)
  return response
}

async function startBrowserServer(host) {
  const vite = await createViteServer({
    root: repositoryRoot,
    configFile: false,
    plugins: [vue()],
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false, fs: { allow: [repositoryRoot] } },
  })
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1')
      if (url.pathname === '/') return send(response, 200, 'text/html', '<!doctype html><title>C2c vocabulary owner fixture</title>')
      if (url.pathname === '/api/app/owner' && request.method === 'POST') {
        const body = await readBody(request)
        const upstream = await fetch(`${host.baseUrl}/api/app/owner`, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'X-Read-Web-Token': ACCESS_TOKEN,
          },
          body,
        })
        const responseBody = await upstream.text()
        response.writeHead(upstream.status, {
          'content-type': upstream.headers.get('content-type') || 'application/json',
        })
        response.end(responseBody)
        return
      }
      return vite.middlewares(request, response, () => send(response, 404, 'text/plain', 'not found'))
    } catch (error) {
      if (!response.headersSent) send(response, 500, 'text/plain', error?.stack || String(error))
      else response.destroy()
    }
  })
  const port = await listenOnBrowserSafePort(server)
  return {
    origin: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await vite.close()
    },
  }
}

async function runBrowserCoreJourney(origin) {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded' })
    return await page.evaluate(async ({ profileId, instanceId, fixtureTime }) => {
      const { createWindowsOwnerApiClient } = await import('/src/services/windows-owner-api-client.js')
      const { createVocabularyService } = await import('/src/services/vocabulary/vocabulary-service.js')
      const { createSrsReviewUiService } = await import('/src/features/srs-review/srs-review-ui-service.js')
      const { createIndexedDbSrsPendingCandidatesRepository } = await import('/src/services/vocabulary/srs-pending-candidates.js')
      const {
        createWindowsOwnerDomainCutover,
        initializeWindowsOwnerDomainCutoverComposition,
      } = await import('/src/services/windows-owner-domain-cutover.js')
      const {
        createWindowsOwnerVocabularySrsIntegration,
        getWindowsOwnerVocabularySrsIntegration,
      } = await import('/src/services/vocabulary/windows-owner-vocabulary-srs.js')
      const { canonicalJson, sha256Utf8 } = await import('/src/services/vocabulary/vocabulary-learning-uow.js')

      const routedOwnerQueries = []
      const routingOwner = {
        isAuthoritative(domain) { return domain === 'vocabulary-srs' },
        async query(request) {
          routedOwnerQueries.push(request.operation)
          return {
            outcome: 'read',
            revision: 7,
            payload: { revision: 7, records: {} },
          }
        },
        async command() {
          throw new Error('query routing fixture must not issue a command')
        },
      }
      const routingIntegration = createWindowsOwnerVocabularySrsIntegration({
        owner: routingOwner,
        now: () => fixtureTime,
      })
      await routingIntegration.vocabularyRepository.loadSnapshot()
      await routingIntegration.acquisitionRepository.loadSnapshot()
      await routingIntegration.contextEvidenceRepository.loadSnapshot()
      await routingIntegration.learningEventRepository.query()
      await routingIntegration.reviewStateRepository.loadSnapshot()
      await routingIntegration.sessionLedgerRepository.getBySessionId('missing-session')
      await routingIntegration.personalizationShadowReportRepository.list({ limit: 2 })
      const expectedRoutedOwnerQueries = [
        'entry',
        'acquisition',
        'context-evidence',
        'learning-events',
        'review-queue',
        'review-queue',
        'personalization',
      ]
      if (JSON.stringify(routedOwnerQueries) !== JSON.stringify(expectedRoutedOwnerQueries)) {
        throw new Error(`owner query routing regression: ${JSON.stringify(routedOwnerQueries)}`)
      }

      const recoveryRecordKey = 'vocabulary-article-srs-settlement-progress:receipt-recovery'
      let recoveryCommand = null
      let recoveryCommandCalls = 0
      let recoveryReceiptCalls = 0
      const recoveryOwner = {
        isAuthoritative(domain) { return domain === 'vocabulary-srs' },
        async query() {
          return {
            outcome: 'read',
            revision: 0,
            payload: { revision: 0, records: {} },
          }
        },
        async command(request) {
          recoveryCommandCalls += 1
          recoveryCommand = request
          return {
            outcome: 'commit-unknown',
            commitStatus: 'commit-unknown',
            revision: null,
            payload: {},
          }
        },
        async receipt(request) {
          recoveryReceiptCalls += 1
          if (!recoveryCommand || request.idempotencyKey !== recoveryCommand.idempotencyKey) {
            throw new Error('receipt recovery queried the wrong idempotency key')
          }
          const record = recoveryCommand.payload.records[recoveryRecordKey]
          return {
            outcome: 'committed',
            commitStatus: 'committed',
            revision: 1,
            receipt: {
              domain: 'vocabulary-srs',
              operation: recoveryCommand.operation,
              idempotencyKey: recoveryCommand.idempotencyKey,
              expectedRevision: recoveryCommand.expectedRevision,
              requestFingerprint: `sha256:${sha256Utf8(canonicalJson({
                domain: 'vocabulary-srs',
                operation: recoveryCommand.operation,
                capability: 'vocabulary-srs.learning-command',
                expectedRevision: recoveryCommand.expectedRevision,
                payload: { records: Object.fromEntries(Object.entries(recoveryCommand.payload.records)
                  .map(([id, row]) => [id, { ...row, checksum: `sha256:${sha256Utf8(canonicalJson(row.content))}` }])) },
              }))}`,
              revision: 1,
              commitStatus: 'committed',
              recordChecksums: [`sha256:${sha256Utf8(canonicalJson(record.content))}`],
            },
          }
        },
      }
      const recoveryIntegration = createWindowsOwnerVocabularySrsIntegration({
        owner: recoveryOwner,
        now: () => fixtureTime,
      })
      const recoveredSettlementProgress = await recoveryIntegration.settlementProgressRepository.recordSettlementTargets(
        'receipt-recovery',
        ['fixture-target-recovery'],
        { appliedTargetIds: ['fixture-target-recovery'], updatedAt: fixtureTime },
      )
      if (!recoveredSettlementProgress.applied_target_ids.includes('fixture-target-recovery')
        || recoveryCommandCalls !== 1
        || recoveryReceiptCalls !== 1) {
        throw new Error('unknown vocabulary Host commit was not reconciled through its durable receipt')
      }

      const ownerClient = createWindowsOwnerApiClient({ profileId, instanceId, timeoutMs: 3000 })
      const setupDatabase = () => new Promise((resolve, reject) => {
        const request = indexedDB.open('SeekPlayerDB', 1)
        request.onupgradeneeded = (event) => {
          const database = event.target.result
          if (!database.objectStoreNames.contains('files')) database.createObjectStore('files', { keyPath: 'id' })
        }
        request.onerror = () => reject(request.error || new Error('failed to create frozen-writer fixture database'))
        request.onsuccess = () => {
          request.result.close()
          resolve()
        }
      })
      await setupDatabase()
      const preCutoverPendingRepository = createIndexedDbSrsPendingCandidatesRepository()
      await preCutoverPendingRepository.loadStore()

      const originalOpen = IDBFactory.prototype.open
      const originalPut = IDBObjectStore.prototype.put
      const originalGetItem = Storage.prototype.getItem
      const originalSetItem = Storage.prototype.setItem
      let indexedDbOpenCalls = 0
      let indexedDbWrites = 0
      let storageReads = 0
      let storageWrites = 0
      IDBFactory.prototype.open = function blockedIndexedDbOpen(...args) {
        indexedDbOpenCalls += 1
        throw new Error(`authoritative vocabulary path opened IndexedDB: ${String(args[0])}`)
      }
      IDBObjectStore.prototype.put = function countedIndexedDbWrite(...args) {
        indexedDbWrites += 1
        return originalPut.apply(this, args)
      }
      Storage.prototype.getItem = function countedStorageRead(...args) {
        storageReads += 1
        return originalGetItem.apply(this, args)
      }
      Storage.prototype.setItem = function countedStorageWrite(...args) {
        storageWrites += 1
        return originalSetItem.apply(this, args)
      }

      try {
        // This is a real first-load path: the old repository was created and
        // loaded before the new window installed any owner guard.  Persisted
        // authority is recognizable even while the Host is degraded, so the
        // browser must retain the selection and fail closed.
        if (window.__windowsOwnerDomainCutover !== undefined
          && window.__windowsOwnerDomainCutover !== null) {
          throw new Error('first-load fixture unexpectedly had a previous owner guard')
        }
        window.__windowsOwnerDomainCutover = null
        const degradedPersistedAuthorityHealth = {
          profileId,
          instanceId,
          status: 'degraded',
          liveness: { status: 'degraded', ready: false },
          contractValid: true,
          profileEvidenceReady: true,
          ownerRegistry: { valid: true },
          ownerMode: {
            status: 'authoritative',
            authoritativeDomains: ['vocabulary-srs'],
            frozenDomains: [],
          },
          domains: [
            { domain: 'reader-session', authority: 'pre-cutover', queryCapability: 'unavailable', commandCapability: 'unavailable', writerFrozen: false },
            { domain: 'vocabulary-srs', authority: 'unavailable', queryCapability: 'unavailable', commandCapability: 'unavailable', writerFrozen: false },
            { domain: 'passage-preview', authority: 'pre-cutover', queryCapability: 'unavailable', commandCapability: 'unavailable', writerFrozen: false },
            { domain: 'annotation', authority: 'pre-cutover', queryCapability: 'unavailable', commandCapability: 'unavailable', writerFrozen: false },
            { domain: 'marks-activity', authority: 'pre-cutover', queryCapability: 'unavailable', commandCapability: 'unavailable', writerFrozen: false },
            { domain: 'workflow', authority: 'pre-cutover', queryCapability: 'unavailable', commandCapability: 'unavailable', writerFrozen: false },
          ],
        }
        const firstLoadComposition = await initializeWindowsOwnerDomainCutoverComposition({
          windowObject: window,
          health: degradedPersistedAuthorityHealth,
          fetchImpl: async () => ({ ok: false }),
          healthPath: '/api/app/health',
          healthTimeoutMs: 500,
        })
        if (!firstLoadComposition.cutover
          || window.__windowsOwnerDomainCutover !== firstLoadComposition.cutover
          || !firstLoadComposition.authoritativeDomains.includes('vocabulary-srs')
          || firstLoadComposition.cutover.ownerReady !== false) {
          throw new Error('first-load degraded persisted authority did not install an owner-not-ready guard')
        }
        let firstLoadQueryRejected = false
        try {
          await firstLoadComposition.cutover.query({ domain: 'vocabulary-srs', operation: 'snapshot', payload: {} })
        } catch (error) {
          firstLoadQueryRejected = error?.code === 'owner-not-ready'
        }
        let firstLoadCommandRejected = false
        try {
          await firstLoadComposition.cutover.command({ domain: 'vocabulary-srs', operation: 'mutation', payload: {} })
        } catch (error) {
          firstLoadCommandRejected = error?.code === 'owner-not-ready'
        }
        const firstLoadIntegration = getWindowsOwnerVocabularySrsIntegration(window)
        const firstLoadIntegrationRetained = firstLoadIntegration?.owner === firstLoadComposition.cutover
          && firstLoadIntegration.owner.ownerReady === false
        let firstLoadWriterBlocked = false
        try {
          await preCutoverPendingRepository.saveStore({ schemaVersion: 1, groups: {} })
        } catch (error) {
          firstLoadWriterBlocked = error?.code === 'windows-owner-writer-frozen'
        }
        if (!firstLoadQueryRejected
          || !firstLoadCommandRejected
          || !firstLoadIntegrationRetained
          || !firstLoadWriterBlocked
          || indexedDbWrites !== 0) {
          throw new Error('first-load degraded persisted authority did not fail closed before IndexedDB write')
        }

        const ordinaryPreCutoverWindow = {}
        const ordinaryPreCutoverHealth = {
          ...degradedPersistedAuthorityHealth,
          ownerMode: { status: 'pre-cutover', authoritativeDomains: [], frozenDomains: [] },
          domains: degradedPersistedAuthorityHealth.domains.map((item) => ({
            ...item,
            authority: 'pre-cutover',
          })),
        }
        const ordinaryPreCutoverComposition = await initializeWindowsOwnerDomainCutoverComposition({
          windowObject: ordinaryPreCutoverWindow,
          health: ordinaryPreCutoverHealth,
          fetchImpl: async () => ({ ok: false }),
        })
        if (ordinaryPreCutoverComposition.cutover !== null
          || ordinaryPreCutoverComposition.authoritativeDomains.length) {
          throw new Error('ordinary degraded pre-cutover health was incorrectly frozen')
        }
        let vocabularyAuthoritative = false
        const writerFrozenError = (operation) => {
          const error = new Error(`The vocabulary-srs browser writer is frozen for ${operation}`)
          error.name = 'WindowsOwnerWriterFrozenError'
          error.code = 'windows-owner-writer-frozen'
          return error
        }
        window.__windowsOwnerDomainCutover = {
          isAuthoritative: (domain) => domain === 'vocabulary-srs' && vocabularyAuthoritative,
          assertBrowserWriterAllowed: (domain, operation) => {
            if (domain === 'vocabulary-srs' && vocabularyAuthoritative) throw writerFrozenError(operation)
          },
          query: (request) => ownerClient.query(request),
          command: (request) => ownerClient.command(request),
        }
        vocabularyAuthoritative = true
        const integration = getWindowsOwnerVocabularySrsIntegration(window)
        if (!integration) throw new Error('vocabulary Host integration was not selected')
        let existingWriterBlocked = false
        try {
          await preCutoverPendingRepository.saveStore({ schemaVersion: 1, groups: {} })
        } catch (error) {
          existingWriterBlocked = error?.code === 'windows-owner-writer-frozen'
        }
        if (!existingWriterBlocked || indexedDbWrites !== 0) {
          throw new Error('pre-cutover IndexedDB repository was not frozen before its first write')
        }

        const unavailableWindow = {}
        const unavailableCutover = createWindowsOwnerDomainCutover({
          windowObject: unavailableWindow,
          health: {
            profileId,
            liveness: { ready: true },
            contractValid: true,
            profileEvidenceReady: true,
            ownerRegistry: { valid: true },
            domains: [{
              domain: 'vocabulary-srs',
              authority: 'authoritative',
              queryCapability: 'read-only',
              commandCapability: 'writable',
            }],
          },
          authoritativeDomains: ['vocabulary-srs'],
          ownerClient,
          fetchImpl: async () => ({ ok: false }),
        })
        unavailableWindow.__windowsOwnerDomainCutover = unavailableCutover
        const unavailableRefresh = await unavailableCutover.refresh()
        if (!unavailableRefresh.authoritativeDomains.includes('vocabulary-srs')
          || unavailableCutover.ownerReady !== false
          || unavailableRefresh.status !== 'not-ready') {
          throw new Error('authoritative owner health loss did not retain the freeze guard fail-closed')
        }
        const unavailableIntegration = getWindowsOwnerVocabularySrsIntegration(unavailableWindow)
        const unavailableRetained = unavailableIntegration?.owner === unavailableCutover
          && unavailableIntegration.owner.ownerReady === false
        if (!unavailableRetained) throw new Error('authoritative-but-unavailable reload fell back to IndexedDB')

        const vocabulary = createVocabularyService({
          ownerIntegration: integration,
          acquisitionEnabled: true,
          now: () => new Date(fixtureTime),
        })
        const beforeWord = await vocabulary.getWordByLemma('alpha', { language: 'en' })
        const beforeAcquisition = await integration.acquisitionRepository.loadSnapshot()
        const pending = await integration.srsPendingCandidatesRepository.getPendingCandidates('fixture-scope-alpha')
        const personalization = await integration.personalizationShadowReportRepository.list({ limit: 2 })
        const settlementBefore = await integration.settlementProgressRepository.getProgress('fixture-article-1')
        if (beforeWord?.id !== 'fixture-word-alpha'
          || Object.keys(beforeAcquisition.by_learning_unit_id || {}).length !== 2
          || pending?.candidates?.length !== 2
          || personalization.length !== 2
          || settlementBefore?.article_id !== 'fixture-article-1') {
          throw new Error('authoritative vocabulary/SRS reads did not hydrate all fixture records')
        }

        const added = await vocabulary.addWord({
          word: 'gamma',
          lemma: 'gamma',
          language: 'en',
          meaning: 'third fixture meaning',
        })
        const queued = await vocabulary.queuePreviewVocabularyAcquisition({
          word: 'gamma',
          lemma: 'gamma',
          language: 'en',
          meaning: 'third fixture meaning',
          part_of_speech: 'noun',
          target_id: 'fixture-target-gamma',
          preview_item_id: 'fixture-preview-gamma',
          context: {
            sentence: 'Gamma appears in the browser fixture sentence.',
            surrounding_text: 'The browser fixture sentence contains gamma.',
            source_kind: 'user_local_exam_material',
            source_id: 'fixture-preview-source',
            source_title: 'Browser fixture',
            source_locator: {
              locator_version: 'source-locator.v1',
              local_locator: 'fixture-preview-gamma',
            },
            license_kind: 'user_owned',
            ownership: 'private',
            quality_status: 'validated',
            quality_reason: 'fixture-source-validated',
            validated_at: fixtureTime,
          },
        })
        const settlementAfter = await integration.settlementProgressRepository.recordSettlementTargets(
          'fixture-article-1',
          ['fixture-target-gamma'],
          { appliedTargetIds: ['fixture-target-gamma'], updatedAt: fixtureTime },
        )

        const srs = createSrsReviewUiService({
          ownerIntegration: integration,
          now: () => '2026-08-29T12:02:00.000Z',
        })
        const session = await srs.startReviewSession({
          session_id: 'c2c-browser-session',
          now: fixtureTime,
          local_day: '2026-08-29',
          timezone: 'UTC',
          policy: {
            schema_version: 'review-policy.v1',
            policy_version: 'c2c-policy.v1',
            mode: 'balanced',
            budget_ms: 3600000,
            default_attempt_ms: 60000,
            balanced_revisit_delay_ms: 900000,
            balanced_max_revisits_per_local_day: 1,
          },
        })
        if (!session.entries?.length) throw new Error('authoritative SRS session did not plan fixture cards')
        const entry = session.entries[session.cursor]
        const attempt = await srs.recordReviewAttempt({
          command_id: 'c2c-browser-review-command',
          attempt_id: 'c2c-browser-review-attempt',
          event_id: 'c2c-browser-review-event',
          correlation_id: 'c2c-browser-review-correlation',
          session_id: session.session_id,
          ledger_item_id: entry.ledger_item_id,
          occurred_at: '2026-08-29T12:01:00.000Z',
          event_partition: '2026-08',
          rating: 'good',
          prompt_mode: 'original_context',
          cue_level: 'target_sentence',
          answer_revealed_before_rating: false,
          duration_ms: 1000,
          active_duration_ms: 1000,
          context_evidence_id: entry.learning_unit_id === 'fixture-unit-alpha' ? 'fixture-context-alpha' : 'fixture-context-beta',
          source_kind: 'article',
          content_version: 'c2c-fixture-content.v1',
        })

        const openCallsBeforeFailure = indexedDbOpenCalls
        const failingOwner = {
          isAuthoritative: (domain) => domain === 'vocabulary-srs',
          async query() { throw new Error('simulated Host outage') },
          async command() { throw new Error('simulated Host outage') },
        }
        const failingIntegration = createWindowsOwnerVocabularySrsIntegration({
          owner: failingOwner,
          now: () => fixtureTime,
        })
        const failingService = createVocabularyService({
          ownerIntegration: failingIntegration,
          acquisitionEnabled: true,
          now: () => new Date(fixtureTime),
        })
        let failedClosed = false
        try {
          await failingService.addWord({ word: 'host-failure', lemma: 'host-failure', language: 'en' })
        } catch (error) {
          failedClosed = /Host outage/u.test(String(error?.message || error))
        }
        if (!failedClosed || indexedDbOpenCalls !== openCallsBeforeFailure) {
          throw new Error('Host failure did not fail closed without a browser durable fallback')
        }

        return {
          indexedDbOpenCalls,
          indexedDbWrites,
          storageReads,
          storageWrites,
          beforeWordId: beforeWord.id,
          beforeAcquisitionCount: Object.keys(beforeAcquisition.by_learning_unit_id || {}).length,
          pendingCandidateCount: pending.candidates.length,
          personalizationCount: personalization.length,
          queuedLearningUnitId: queued.learningUnit?.learning_unit_id || null,
          settlementAppliedCount: settlementAfter.applied_target_ids.length,
          receiptRecovery: true,
          sessionEntryCount: session.entries.length,
          recordedRating: attempt.attempt.rating,
          addedWordId: added.id,
          failedClosed,
          existingWriterBlocked,
          unavailableRetained,
          firstLoadQueryRejected,
          firstLoadCommandRejected,
          firstLoadIntegrationRetained,
          firstLoadWriterBlocked,
          ordinaryPreCutoverUnfrozen: ordinaryPreCutoverComposition.cutover === null,
          routedOwnerQueries,
        }
      } finally {
        IDBFactory.prototype.open = originalOpen
        IDBObjectStore.prototype.put = originalPut
        Storage.prototype.getItem = originalGetItem
        Storage.prototype.setItem = originalSetItem
      }
    }, { profileId: PROFILE_ID, instanceId: INSTANCE_ID, fixtureTime: FIXTURE_TIME })
  } finally {
    await context.close()
    await browser.close()
  }
}

async function runAppOwnerRecoveryJourney(origin) {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error?.message || String(error)))
  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded' })
    const result = await page.evaluate(async () => {
      document.body.innerHTML = [
        '<div id="youtube-reader-controls-root"></div>',
        '<div id="srs-review-entry-root"></div>',
        '<div id="vue-root"></div>',
      ].join('')

      let hostReady = false
      let refreshCount = 0
      function ownerNotReadyError(operation) {
        const error = new Error(`owner is not ready for ${operation}`)
        error.code = 'owner-not-ready'
        return error
      }
      const cutover = {
        get ownerReady() { return hostReady },
        isAuthoritative(domain) { return domain === 'vocabulary-srs' },
        get authoritativeDomains() { return ['vocabulary-srs'] },
        get frozenDomains() { return [] },
        assertBrowserWriterAllowed() {},
        async query() {
          if (!hostReady) throw ownerNotReadyError('query')
          return {
            outcome: 'read',
            revision: 0,
            payload: { revision: 0, records: {} },
          }
        },
        async command() {
          if (!hostReady) throw ownerNotReadyError('command')
          return {
            outcome: 'committed',
            commitStatus: 'committed',
            revision: 1,
            payload: { records: {} },
          }
        },
        async refresh() {
          refreshCount += 1
          hostReady = true
          return { status: 'authoritative', authoritativeDomains: ['vocabulary-srs'] }
        },
      }
      window.__windowsOwnerDomainCutover = cutover

      const { default: App } = await import('/src/App.vue')
      const dependencyUrl = (dependency) => performance.getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((url) => {
          try { return new URL(url).pathname.endsWith(`/node_modules/.vite/deps/${dependency}.js`) } catch (_error) { return false }
        }) || `/node_modules/.vite/deps/${dependency}.js`
      const { createApp } = await import(dependencyUrl('vue'))
      const { createPinia } = await import(dependencyUrl('pinia'))
      const app = createApp(App)
      app.use(createPinia())
      app.mount('#vue-root')

      const hasNotReadyStatus = () => Boolean(
        document.querySelector('[data-vocabulary-owner-status="not-ready"]'),
      )
      async function waitFor(predicate, timeoutMs = 2000) {
        const deadline = Date.now() + timeoutMs
        while (!predicate()) {
          if (Date.now() >= deadline) throw new Error('timed out waiting for App owner recovery')
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
      }

      await waitFor(hasNotReadyStatus)
      const initialNotReady = hasNotReadyStatus()
      const integration = (await import('/src/services/vocabulary/windows-owner-vocabulary-srs.js'))
        .getWindowsOwnerVocabularySrsIntegration(window)
      const recoveredSnapshot = await integration.reviewStateRepository.loadSnapshot()
      await waitFor(() => !hasNotReadyStatus())
      const recovered = !hasNotReadyStatus()
      const ownerReadyAfterRecovery = integration?.owner?.ownerReady === true
      app.unmount()
      return {
        initialNotReady,
        recovered,
        ownerReadyAfterRecovery,
        refreshCount,
        recoveredSnapshotSchema: recoveredSnapshot?.schema_version,
      }
    })
    return { ...result, pageErrors }
  } finally {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

const rows = fixtureRows()
const expectedRows = Object.fromEntries(rows.map((row) => [row.id, clone(row.content)]))
const workRoot = await mkdtemp(path.join(os.tmpdir(), 'read-web-owner-c2c-vocabulary-'))
let host = null
let browserServer = null
let browserGuard = null
try {
  const source = makeLayout(workRoot, 'source')
  const target = makeLayout(workRoot, 'target')
  await seedProfile(source, rows)
  await seedProfile(target, [])

  host = await startLocalAppHost(target)
  assert.deepEqual(host.health.ownerMode?.authoritativeDomains || [], [])
  const preCutoverClient = await createWindowsOwnerProductionHostClient({
    baseUrl: host.baseUrl,
    accessToken: host.accessToken,
    profileId: host.profileId,
    instanceId: host.instanceId,
  })
  const preCutover = await preCutoverClient.query({ domain: DOMAIN, operation: 'snapshot', payload: {} })
  assert.equal(preCutover.outcome, 'not-ready', 'Host must remain not-ready before authority switch')

  const frozenDomains = new Set()
  const windowObject = {}
  const browserCutoverModule = await loadBrowserCutoverModule()
  const browserComposition = await browserCutoverModule.initializeWindowsOwnerDomainCutoverComposition({
    windowObject,
    health: makeHealth(),
    fetchImpl: async () => ({ ok: true, async json() { return makeHealth([...frozenDomains]) } }),
    healthPath: '/api/app/health',
    healthTimeoutMs: 500,
  })
  assert.equal(browserComposition.status, 'not-ready')
  assert.ok(browserComposition.cutover)
  browserGuard = browserComposition.cutover

  const refreshes = []
  const result = await runWindowsOwnerProductionCutover({
    mode: 'optimization',
    explicitOptIn: true,
    profileId: PROFILE_ID,
    source,
    target,
    domains: [DOMAIN],
    sourceIdsByDomain: { [DOMAIN]: ['SeekPlayerDB/files'] },
    hostBaseUrl: host.baseUrl,
    hostAccessToken: host.accessToken,
    hostInstanceId: host.instanceId,
    browserGuard,
    refreshBrowserGuard: async ({ domain }) => {
      frozenDomains.clear()
      frozenDomains.add(domain)
      const marker = await readOwnerModeFreeze({ ...target, profileId: PROFILE_ID, domain })
      assert.equal(marker?.status, 'frozen', 'freeze marker must exist before final source read')
      const refreshed = await browserGuard.refresh()
      assert.ok(refreshed.frozenDomains.includes(domain), 'open browser must observe the frozen domain')
      refreshes.push(domain)
      return { ok: true, observedFrozen: true, frozenDomains: refreshed.frozenDomains }
    },
  })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.deepEqual(refreshes, [DOMAIN])
  assert.equal(result.domains[0].steps.dryRun.sourceIds[0], 'SeekPlayerDB/files')
  assert.equal(
    result.domains[0].steps.finalBackup.finalBackup.artifact.domains[DOMAIN].records.length,
    rows.length,
    'final backup must include all registered vocabulary/SRS rows',
  )
  const checkpoint = await readOwnerModeCheckpoint({ ...target, profileId: PROFILE_ID, domain: DOMAIN })
  assert.equal(checkpoint?.authorityMode, 'host-api=authoritative')
  assert.equal(await readOwnerModeFreeze({ ...target, profileId: PROFILE_ID, domain: DOMAIN }), null)

  await stopLocalAppHost(host)
  host = null
  host = await startLocalAppHost(target)
  assert.deepEqual(host.health.ownerMode?.authoritativeDomains, [DOMAIN])
  let ownerClient = await createWindowsOwnerProductionHostClient({
    baseUrl: host.baseUrl,
    accessToken: host.accessToken,
    profileId: host.profileId,
    instanceId: host.instanceId,
  })
  await assertHostSnapshot(ownerClient, expectedRows, 'Host reopen')
  const recoveryRows = Object.keys(expectedRows).filter((id) => (
    /\.backup:\d+$/u.test(id) || /^vocabulary\.corrupt\.quarantine\.v1:/u.test(id)
  ))
  assert.equal(recoveryRows.length, 2, 'fixture must contain backup and quarantine recovery artifacts')
  const reopenedSnapshot = await ownerClient.query({ domain: DOMAIN, operation: 'snapshot', payload: {} })
  assert.deepEqual(
    recoveryRows.map((id) => reopenedSnapshot.payload.records[id]?.content),
    recoveryRows.map((id) => expectedRows[id]),
    'Host reopen must preserve recovery artifact content',
  )
  const activeAcquisition = await ownerClient.query({ domain: DOMAIN, operation: 'acquisition', payload: {} })
  assert.equal(
    Object.keys(activeAcquisition.payload.records).some((id) => recoveryRows.includes(id)),
    false,
    'recovery artifacts must not be exposed as active acquisition state',
  )

  browserServer = await startBrowserServer(host)
  const browserResult = await runBrowserCoreJourney(browserServer.origin)
  assert.equal(browserResult.indexedDbOpenCalls, 0, 'authoritative browser vocabulary/SRS path must not open IndexedDB')
  assert.equal(browserResult.storageReads, 0, 'authoritative browser vocabulary/SRS path must not read localStorage')
  assert.equal(browserResult.storageWrites, 0, 'authoritative browser vocabulary/SRS path must not write localStorage')
  assert.equal(browserResult.beforeAcquisitionCount, 2)
  assert.equal(browserResult.pendingCandidateCount, 2)
  assert.equal(browserResult.personalizationCount, 2)
  assert.equal(browserResult.sessionEntryCount, 2)
  assert.equal(browserResult.recordedRating, 'good')
  assert.equal(browserResult.failedClosed, true)
  assert.equal(browserResult.receiptRecovery, true, 'unknown vocabulary Host commits must reconcile through receipt-query')
  assert.equal(browserResult.existingWriterBlocked, true)
  assert.equal(browserResult.unavailableRetained, true)
  assert.equal(browserResult.indexedDbWrites, 0, 'authoritative browser vocabulary/SRS path must not write IndexedDB')
  assert.equal(browserResult.firstLoadQueryRejected, true)
  assert.equal(browserResult.firstLoadCommandRejected, true)
  assert.equal(browserResult.firstLoadIntegrationRetained, true)
  assert.equal(browserResult.firstLoadWriterBlocked, true)
  assert.equal(browserResult.ordinaryPreCutoverUnfrozen, true)
  assert.ok(browserResult.queuedLearningUnitId)

  const appRecoveryResult = await runAppOwnerRecoveryJourney(browserServer.origin)
  assert.equal(appRecoveryResult.initialNotReady, true, 'App must retain a visible not-ready state while Host is unavailable')
  assert.equal(appRecoveryResult.recovered, true, 'App must recover its owner-backed vocabulary integration after Host readiness')
  assert.equal(appRecoveryResult.ownerReadyAfterRecovery, true, 'App recovery must observe the ready Host owner')
  assert.equal(appRecoveryResult.refreshCount, 1, 'first vocabulary/SRS query must refresh a temporarily unavailable authoritative owner once')
  assert.equal(appRecoveryResult.recoveredSnapshotSchema, 'review-store.v2', 'recovered query must return the review snapshot')
  assert.deepEqual(appRecoveryResult.pageErrors, [], 'App owner recovery must not throw during mount or readiness transition')

  const finalResponse = await ownerClient.query({ domain: DOMAIN, operation: 'snapshot', payload: {} })
  assert.equal(finalResponse.outcome, 'read')
  const finalRecords = finalResponse.payload.records
  const finalVocabulary = contentFromRecord(finalRecords['vocabulary.srs.store.v1'])
  const finalAcquisition = contentFromRecord(finalRecords['vocabulary.acquisition.store.v1'])
  const finalReview = contentFromRecord(finalRecords['vocabulary.review.store.v2'])
  const finalEvents = contentFromRecord(finalRecords[EVENT_SHARD_ID])
  const finalSettlement = contentFromRecord(finalRecords[SETTLEMENT_ROW_ID])
  assert.equal(finalVocabulary.words.length, 3, 'browser addWord must be Host-backed')
  assert.equal(Object.keys(finalAcquisition.by_learning_unit_id).length, 3, 'browser acquisition must be Host-backed')
  assert.equal(Object.keys(finalReview.by_learning_unit_id).length, 2, 'review state records remain complete')
  assert.ok(finalEvents.events.length >= 3, 'browser acquisition/review events must append through Host')
  assert.ok(finalSettlement.applied_target_ids.includes('fixture-target-gamma'), 'settlement mutation must use its dynamic Host row')
  for (const [id, record] of Object.entries(finalRecords)) {
    assert.match(checksum(contentFromRecord(record)), /^sha256:[a-f0-9]{64}$/u, `final checksum is computable for ${id}`)
  }

  const rollback = await revokeOwnerModeCheckpoint({
    ...target,
    profileId: PROFILE_ID,
    domain: DOMAIN,
    expectedRevision: checkpoint.repository.revision,
    expectedRevisionEvidence: checkpoint.repository.revisionEvidence,
  })
  assert.equal(rollback.status, 'revoked', 'owner authority rollback must revoke the checkpoint')
  assert.equal(
    await readOwnerModeCheckpoint({ ...target, profileId: PROFILE_ID, domain: DOMAIN }),
    null,
    'owner authority rollback must remove the authoritative checkpoint',
  )

  console.log('Windows owner C2c vocabulary/SRS cutover checks passed.')
} finally {
  await browserServer?.close().catch(() => {})
  browserGuard?.dispose?.()
  await stopLocalAppHost(host)
  await rm(workRoot, { recursive: true, force: true })
}
