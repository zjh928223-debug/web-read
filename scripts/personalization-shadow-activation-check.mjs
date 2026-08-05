import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const personalizationRoot = path.join(repoRoot, 'src', 'services', 'vocabulary', 'personalization');
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'read-web-shadow-activation-'));

try {
  for (const name of [
    'personalization-shadow-settings.js',
    'personalization-shadow-control-service.js',
  ]) {
    fs.copyFileSync(
      path.join(personalizationRoot, name),
      path.join(temporaryDirectory, name.replace(/\.js$/u, '.mjs')),
    );
  }
  const [settingsApi, controlApi] = await Promise.all([
    'personalization-shadow-settings.mjs',
    'personalization-shadow-control-service.mjs',
  ].map((name) => import(`${pathToFileURL(path.join(temporaryDirectory, name)).href}?activation=1`)));

  const values = new Map();
  const storage = {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
  const settings = settingsApi.createPersonalizationShadowSettings({ storage });
  assert.equal(settings.isEnabled(), false, 'Shadow must default off');
  settings.setEnabled(true);
  assert.equal(
    settingsApi.createPersonalizationShadowSettings({ storage }).isEnabled(),
    true,
    'Shadow preference must survive service recreation',
  );

  const ledger = {
    session_id: 'srs-review-ui:2026-08-05',
    created_at: '2026-08-05T01:00:00.000Z',
    status: 'active',
    budget_ms: 3_600_000,
    entries: [{
      learning_unit_id: 'unit-1',
      queue_kind: 'due_review',
      planned_due_at: '2026-08-04T01:00:00.000Z',
      estimated_duration_ms: 36_000,
      enqueue_reason: 'SCHEDULER_DUE',
    }],
  };
  const beforeLedger = JSON.parse(JSON.stringify(ledger));
  let runnerInput = null;
  let ledgerWrites = 0;
  const control = controlApi.createPersonalizationShadowControlService({
    acquisitionRepository: {
      async loadSnapshot() {
        return { by_learning_unit_id: {} };
      },
    },
    learningEventRepository: {
      async query() {
        return [{ event_id: 'event-1' }];
      },
    },
    sessionLedgerRepository: {
      async getBySessionId(sessionId) {
        return sessionId === ledger.session_id ? ledger : null;
      },
      async put() {
        ledgerWrites += 1;
      },
    },
    reportRepository: {
      async getBySessionId() {
        return null;
      },
    },
    async shadowRunner(input) {
      runnerInput = input;
      return { session_id: input.session_id };
    },
  });
  const result = await control.rebuildCurrentReport({
    now: '2026-08-05T02:00:00.000Z',
    timezone: 'UTC',
  });
  assert.equal(result.status, 'rebuilt');
  assert.equal(runnerInput.candidates[0].learning_unit_id, 'unit-1');
  assert.equal(runnerInput.events[0].event_id, 'event-1');
  assert.deepEqual(ledger, beforeLedger, 'backfill must not mutate the frozen ledger');
  assert.equal(ledgerWrites, 0, 'backfill must never write the formal ledger');

  let noSessionRuns = 0;
  const noSessionControl = controlApi.createPersonalizationShadowControlService({
    acquisitionRepository: { async loadSnapshot() { throw new Error('must not load'); } },
    learningEventRepository: { async query() { throw new Error('must not query'); } },
    sessionLedgerRepository: { async getBySessionId() { return null; } },
    reportRepository: { async getBySessionId() { return null; } },
    async shadowRunner() { noSessionRuns += 1; },
  });
  const noSession = await noSessionControl.rebuildCurrentReport({
    now: '2026-08-05T02:00:00.000Z',
    timezone: 'UTC',
  });
  assert.equal(noSession.status, 'no_v2_session');
  assert.equal(noSessionRuns, 0, 'legacy/no-V2 state must not fabricate a report');

  const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'App.vue'), 'utf8');
  assert.match(appSource, /personalizationShadowEnabled:\s*\(\) => personalizationShadowSettings\.isEnabled\(\)/u);
  const serviceSource = fs.readFileSync(
    path.join(repoRoot, 'src', 'services', 'vocabulary', 'srs-review-service-v2.js'),
    'utf8',
  );
  assert.match(serviceSource, /typeof options\.personalizationShadowEnabled === 'function'/u);
  const pageSource = fs.readFileSync(
    path.join(repoRoot, 'src', 'features', 'personalization-shadow', 'PersonalizationShadowPage.vue'),
    'utf8',
  );
  assert.match(pageSource, /开始模型观察/u);
  assert.match(pageSource, /补建今天报告/u);
  assert.match(pageSource, /不会用旧日志伪造结果/u);

  console.log('personalization shadow activation verification passed');
  console.log('scope: persistent toggle + derived-report backfill; no formal review mutation');
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
