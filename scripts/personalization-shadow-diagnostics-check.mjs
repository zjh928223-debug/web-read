import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const featureRoot = path.join(repoRoot, 'src', 'features', 'personalization-shadow');
const repositorySource = path.join(
  repoRoot,
  'src',
  'services',
  'vocabulary',
  'personalization',
  'personalization-shadow-report-repository.js',
);
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'read-web-shadow-ui-'));

try {
  for (const file of [
    ['personalization-shadow-view-model.js', path.join(featureRoot, 'personalization-shadow-view-model.js')],
    ['personalization-shadow-demo.js', path.join(featureRoot, 'personalization-shadow-demo.js')],
    ['personalization-shadow-report-repository.js', repositorySource],
  ]) {
    fs.copyFileSync(file[1], path.join(temporaryDirectory, file[0].replace(/\.js$/u, '.mjs')));
  }
  const [viewModel, demo, repository] = await Promise.all([
    'personalization-shadow-view-model.mjs',
    'personalization-shadow-demo.mjs',
    'personalization-shadow-report-repository.mjs',
  ].map((file) => import(`${pathToFileURL(path.join(temporaryDirectory, file)).href}?diagnostic=1`)));

  const reports = demo.createPersonalizationShadowDemoReports();
  const before = JSON.parse(JSON.stringify(reports));
  const diagnostic = viewModel.buildPersonalizationShadowDiagnostics(reports);
  assert.deepEqual(reports, before, 'diagnostic view-model must be pure');
  assert.deepEqual(diagnostic.summary, { total: 12, sameOrder: 7, changed: 4, insufficient: 1 });
  assert.equal(diagnostic.sessions[0].defaultSelectedId, 'unit.plausible');
  assert.equal(diagnostic.sessions[0].skillRows[0].state.label, '需要更多练习');
  assert.equal(diagnostic.sessions[0].preferenceRows[0].label, '只看单词');

  const inMemory = repository.createInMemoryPersonalizationShadowReportRepository(reports);
  const latestTwo = await inMemory.list({ limit: 2 });
  assert.equal(latestTwo.length, 2);
  assert.ok(latestTwo[0].generated_at > latestTwo[1].generated_at);
  await assert.rejects(() => inMemory.list({ limit: 0 }), /between 1 and 200/u);

  const legacy = { ...reports[0] };
  delete legacy.model_snapshot;
  const normalizedLegacy = repository.normalizePersonalizationShadowReport(legacy);
  assert.equal(normalizedLegacy.model_snapshot.skill_profile, null);
  assert.deepEqual(normalizedLegacy.model_snapshot.unit_labels, {});

  const component = fs.readFileSync(
    path.join(featureRoot, 'PersonalizationShadowPage.vue'),
    'utf8',
  );
  assert.match(component, /reportRepository\.list/u);
  assert.doesNotMatch(component, /reportRepository\.(?:put|clear)|flushPersonalizationShadow|publishPlan/u);
  assert.match(component, /只读分析，不会改变正式复习安排/u);

  const viteConfig = fs.readFileSync(path.join(repoRoot, 'vite.config.js'), 'utf8');
  assert.match(viteConfig, /personalizationShadow:\s*resolve\(__dirname, 'personalization-shadow\.html'\)/u);
  const reviewPage = fs.readFileSync(
    path.join(repoRoot, 'src', 'features', 'srs-review', 'SrsReviewPage.vue'),
    'utf8',
  );
  assert.match(reviewPage, /href="\/personalization-shadow\.html"/u);
  const appPage = fs.readFileSync(path.join(repoRoot, 'src', 'App.vue'), 'utf8');
  assert.match(appPage, /class="small-btn learning-model-entry"/u);
  assert.match(appPage, /href="\/personalization-shadow\.html"/u);
  const html = fs.readFileSync(path.join(repoRoot, 'personalization-shadow.html'), 'utf8');
  assert.match(html, /src="\/src\/personalization-shadow-main\.js"/u);

  console.log('personalization shadow diagnostics verification passed');
  console.log('mode: read-only report inspection; no queue or schedule write surface');
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
