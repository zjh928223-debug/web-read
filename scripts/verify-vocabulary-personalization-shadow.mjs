import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(
  repoRoot,
  'src',
  'services',
  'vocabulary',
  'personalization',
);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function loadModules() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'read-web-shadow-'));
  const files = fs.readdirSync(sourceRoot)
    .filter((file) => file.endsWith('.js') && file !== 'index.js');
  try {
    for (const file of files) {
      const source = fs.readFileSync(path.join(sourceRoot, file), 'utf8')
        .replaceAll(/from '(.+?)\.js'/g, "from '$1.mjs'");
      fs.writeFileSync(
        path.join(temporaryDirectory, file.replace(/\.js$/u, '.mjs')),
        source,
        'utf8',
      );
    }
    const [adapter, repository, service] = await Promise.all([
      'personalization-shadow-adapter.mjs',
      'personalization-shadow-report-repository.mjs',
      'personalization-shadow-service.mjs',
    ].map((file) => import(`${pathToFileURL(path.join(temporaryDirectory, file)).href}?shadow=1`)));
    return { adapter, repository, service };
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function pair(id, partOfSpeech) {
  return {
    learning_unit: {
      learning_unit_id: id,
      normalized_form: id.replace('unit-', ''),
      target_sense: { part_of_speech: partOfSpeech },
      extensions: {},
    },
    acquisition_state: {
      status: 'graduated',
      validated_anchor_id: `context-${id}`,
      extensions: {},
    },
  };
}

function event(id, learningUnitId, rating, promptMode, occurredAt) {
  return {
    schema_version: 'learning-event.v1',
    event_id: id,
    event_type: 'review_attempt_recorded',
    learning_unit_id: learningUnitId,
    target_sense_id: `sense-${learningUnitId}`,
    occurred_at: occurredAt,
    prompt_mode: promptMode,
    cue_level: 'none',
    rating,
    answer_revealed_before_rating: false,
    duration_ms: 4000,
    active_duration_ms: 3500,
    before_state: { state: 'review' },
    after_state: { state: 'review' },
    policy_version: 'review-policy.v1',
    scheduler_version: 'scheduler.v1',
    is_legacy: false,
    training_eligible: true,
    exclusion_reasons: [],
    payload: { active_duration_reliable: true },
    extensions: {},
  };
}

const { adapter, repository, service } = await loadModules();

assert.equal(adapter.PERSONALIZATION_SHADOW_ADAPTER_VERSION, 'personalization-shadow-adapter.v1');
assert.equal(repository.PERSONALIZATION_SHADOW_REPORT_ROW_ID, 'vocabulary.personalization.shadow-reports.v1');
assert.equal(service.PERSONALIZATION_SHADOW_SERVICE_VERSION, 'personalization-shadow-service.v1');
assert.equal(service.VOCABULARY_PERSONALIZATION_SHADOW_FEATURE_FLAG,
  'VOCABULARY_PERSONALIZATION_SHADOW_ENABLED');

const input = {
  session_id: 'session-shadow-fixture',
  now: '2026-08-05T08:00:00.000Z',
  events: [
    event('event-verb', 'unit-verb', 'good', 'word_only', '2026-08-04T08:00:00.000Z'),
    event('event-noun', 'unit-noun', 'hard', 'original_context', '2026-08-04T09:00:00.000Z'),
  ],
  acquisition_snapshot: {
    by_learning_unit_id: {
      'unit-verb': pair('unit-verb', 'verb'),
      'unit-noun': pair('unit-noun', 'noun'),
    },
  },
  candidates: [
    {
      learning_unit_id: 'unit-verb',
      queue_kind: 'due_review',
      due_at: '2026-08-05T07:00:00.000Z',
      estimated_duration_ms: 3500,
      enqueue_reason: 'SCHEDULER_DUE',
    },
    {
      learning_unit_id: 'unit-noun',
      queue_kind: 'due_review',
      due_at: '2026-08-05T07:30:00.000Z',
      estimated_duration_ms: 3500,
      enqueue_reason: 'SCHEDULER_DUE',
    },
  ],
  baseline_ledger: {
    session_id: 'session-shadow-fixture',
    created_at: '2026-08-05T08:00:00.000Z',
    budget_ms: 60000,
    entries: [
      { learning_unit_id: 'unit-verb' },
      { learning_unit_id: 'unit-noun' },
    ],
  },
};

const before = clone(input);
const reportRepository = repository.createInMemoryPersonalizationShadowReportRepository();
const shadowService = service.createPersonalizationShadowService({ reportRepository });
const report = await shadowService.run(input);
assert.deepEqual(input, before, 'shadow service must not mutate its snapshots');
assert.equal(report.schema_version, 'personalization-shadow-report.v1');
assert.equal(report.session_id, input.session_id);
assert.equal(report.source_event_count, 2);
assert.equal(report.shadow_plan.schema_version, 'curriculum-plan.v1');
assert.equal(report.comparison.baseline_count, 2);
assert.equal(report.comparison.shadow_count, 2);
assert.deepEqual(
  new Set(report.comparison.shadow_learning_unit_ids),
  new Set(report.comparison.baseline_learning_unit_ids),
);
assert.ok(report.diagnostics.skill_evidence_count >= 2);
assert.equal(report.diagnostics.preference_event_excluded_count, 0);
assert.equal(report.model_snapshot.schema_version, 'personalization-shadow-model-snapshot.v1');
assert.equal(report.model_snapshot.unit_labels['unit-verb'], 'verb');
assert.equal(report.model_snapshot.recent_presentations['unit-noun'], 'original_context');
assert.ok(report.model_snapshot.skill_profile.estimates.length > 0);
assert.deepEqual(await reportRepository.getBySessionId(input.session_id), report);
assert.deepEqual(await reportRepository.list({ limit: 1 }), [report]);

const replay = await shadowService.run(clone(input));
assert.deepEqual(replay, report, 'same snapshots must rebuild the same shadow report');
await reportRepository.clear();
assert.equal(await reportRepository.getBySessionId(input.session_id), null);
assert.deepEqual(await reportRepository.list(), []);

const coldInput = clone(input);
coldInput.session_id = 'session-shadow-cold';
coldInput.baseline_ledger.session_id = coldInput.session_id;
coldInput.events = [];
coldInput.acquisition_snapshot.by_learning_unit_id['unit-verb'] = pair('unit-verb', 'preposition');
const adaptedCold = adapter.buildPersonalizationShadowInput(coldInput);
assert.deepEqual(
  adaptedCold.candidates.find((candidate) => candidate.learning_unit_id === 'unit-verb').skill_tags,
  [],
  'unknown POS must not be fabricated into a known weakness',
);
const coldReport = await shadowService.run(coldInput);
assert.equal(coldReport.source_event_count, 0);
assert.equal(coldReport.diagnostics.preference_event_count, 0);

const newModuleFiles = [
  'personalization-shadow-adapter.js',
  'personalization-shadow-report-repository.js',
  'personalization-shadow-service.js',
];
for (const file of newModuleFiles) {
  const source = fs.readFileSync(path.join(sourceRoot, file), 'utf8');
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|OpenAI|ChatGPT)\b/u);
  assert.doesNotMatch(source, /Math\.random\s*\(/u);
}
const reportSource = fs.readFileSync(
  path.join(sourceRoot, 'personalization-shadow-report-repository.js'),
  'utf8',
);
assert.match(reportSource, /indexedDBApi\.open\('SeekPlayerDB', 1\)/u);
assert.match(reportSource, /transaction\(\['files'\]/u);
assert.doesNotMatch(reportSource, /createObjectStore\s*\(/u);

const serviceSource = fs.readFileSync(
  path.join(repoRoot, 'src', 'services', 'vocabulary', 'srs-review-service-v2.js'),
  'utf8',
);
assert.match(serviceSource, /personalizationShadowEnabled/u);
assert.match(serviceSource, /flushPersonalizationShadow/u);
assert.match(serviceSource, /shadow diagnostics must never affect the review session/u);

execFileSync(process.execPath, [
  path.join(repoRoot, 'scripts', 'srs-review-service-v2-check.cjs'),
], { cwd: repoRoot, stdio: 'pipe' });

console.log('vocabulary personalization shadow verification passed');
console.log('queue: baseline ledger is immutable; shadow changes and failures are isolated');
console.log('cache: rebuildable row in SeekPlayerDB v1 files store');
