const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

class FakeButton {
  constructor() {
    this.disabled = false;
    this.textContent = 'AI解释标注';
    this.title = '';
    this.listeners = {};
  }

  addEventListener(type, handler) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(handler);
  }

  async click() {
    for (const handler of this.listeners.click || []) {
      await handler({ target: this });
    }
  }
}

class FakeStorage {
  constructor(seed = {}) {
    this.values = new Map(Object.entries(seed));
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

function createWindowObject(options = {}) {
  return {
    localStorage: options.localStorage || new FakeStorage(),
    confirm: typeof options.confirm === 'function' ? options.confirm : () => true,
  };
}

async function importModule(filePath) {
  const repoRoot = path.resolve(__dirname, '..');
  const tempRoot = path.join(repoRoot, 'node_modules', '.tmp-annotation-backfill');
  fs.mkdirSync(tempRoot, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(tempRoot, `${process.pid}-`));
  try {
    const tempComposables = path.join(tempDir, 'src', 'composables');
    const tempVocabulary = path.join(tempDir, 'src', 'services', 'vocabulary');
    const tempPersonalization = path.join(tempVocabulary, 'personalization');
    const tempReviewFeatures = path.join(tempDir, 'src', 'features', 'srs-review');
    const tempRuntime = path.join(tempDir, 'src', 'services', 'runtime');
    fs.mkdirSync(tempComposables, { recursive: true });
    fs.mkdirSync(tempVocabulary, { recursive: true });
    fs.mkdirSync(tempPersonalization, { recursive: true });
    fs.mkdirSync(tempReviewFeatures, { recursive: true });
    fs.mkdirSync(tempRuntime, { recursive: true });
    const rewriteSource = (source) => source
      .replace(/from '\.\.\/services\/vocabulary\/([^']+)\.js'/g, "from '../services/vocabulary/$1.mjs'")
      .replace(/from '\.\/([^']+)\.js'/g, "from './$1.mjs'")
      .replace(/from \"\.\/([^\"]+)\.js\"/g, 'from "./$1.mjs"')
      .replace(/from ['"]\.\.\/\.\.\/\.\.\/config\/ielts-learning-pools\.json['"]/g, "from './ielts-learning-pools-config.mjs'")
      .replace(/from '\.\.\/\.\.\/features\/srs-review\/srs-review-policy\.js'/g, "from '../../features/srs-review/srs-review-policy.mjs'")
      .replace(/from '\.\.\/\.\.\/features\/srs-review\/srs-session-planner\.js'/g, "from '../../features/srs-review/srs-session-planner.mjs'");
    fs.writeFileSync(
      path.join(tempComposables, 'annotation-backfill-ai-module.mjs'),
      rewriteSource(fs.readFileSync(filePath, 'utf8'))
    );
    ['vocabulary-models.js', 'vocabulary-repository.js', 'srs-candidates.js', 'srs-pending-candidates.js', 'preview-scan.js', 'article-srs-settlement.js', 'article-srs-settlement-progress.js', 'settlement-meaning-refinement.js', 'srs-scheduler.js', 'ielts-learning-pools.js', 'vocabulary-learning-models.js', 'vocabulary-acquisition-repository.js', 'vocabulary-context-evidence.js', 'vocabulary-learning-events.js', 'legacy-vocabulary-audit.js', 'vocabulary-learning-uow.js', 'vocabulary-acquisition-service.js', 'srs-review-session-ledger.js', 'srs-review-service-v2.js', 'exam-vocabulary-importer.js', 'exam-vocabulary-context-matcher.js', 'legacy-vocabulary-reassessment.js', 'legacy-vocabulary-migration.js', 'vocabulary-service.js', 'index.js'].forEach((file) => {
      const sourcePath = path.join(repoRoot, 'src', 'services', 'vocabulary', file);
      if (fs.existsSync(sourcePath)) {
        fs.writeFileSync(path.join(tempVocabulary, file.replace(/\.js$/, '.mjs')), rewriteSource(fs.readFileSync(sourcePath, 'utf8')));
      }
    });
    for (const file of fs.readdirSync(path.join(repoRoot, 'src', 'services', 'vocabulary', 'personalization'))) {
      if (!file.endsWith('.js')) continue;
      const sourcePath = path.join(repoRoot, 'src', 'services', 'vocabulary', 'personalization', file);
      fs.writeFileSync(
        path.join(tempPersonalization, file.replace(/\.js$/, '.mjs')),
        rewriteSource(fs.readFileSync(sourcePath, 'utf8')),
      );
    }
    const ieltsPoolConfig = JSON.parse(fs.readFileSync(
      path.join(repoRoot, 'config', 'ielts-learning-pools.json'),
      'utf8',
    ));
    fs.writeFileSync(
      path.join(tempVocabulary, 'ielts-learning-pools-config.mjs'),
      `export default ${JSON.stringify(ieltsPoolConfig)}\n`,
    );
    fs.writeFileSync(
      path.join(tempReviewFeatures, 'srs-review-policy.mjs'),
      fs.readFileSync(path.join(repoRoot, 'src', 'features', 'srs-review', 'srs-review-policy.js'), 'utf8'),
    );
    fs.writeFileSync(
      path.join(tempReviewFeatures, 'srs-session-planner.mjs'),
      fs.readFileSync(path.join(repoRoot, 'src', 'features', 'srs-review', 'srs-session-planner.js'), 'utf8')
        .replace(/from '\.\/srs-review-policy\.js'/g, "from './srs-review-policy.mjs'"),
    );
    fs.copyFileSync(
      path.join(repoRoot, 'src', 'services', 'runtime', 'dialog-controller.js'),
      path.join(tempRuntime, 'dialog-controller.js'),
    );
    return await import(`${pathToFileURL(path.join(tempComposables, 'annotation-backfill-ai-module.mjs')).href}#${Date.now()}`);
  } finally {
    const resolvedTemp = path.resolve(tempDir);
    const resolvedTempRoot = path.resolve(tempRoot);
    if (resolvedTemp.startsWith(resolvedTempRoot + path.sep)) {
      try {
        fs.rmSync(resolvedTemp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      } catch (_error) {}
    }
  }
}

function createTemplate(ids) {
  return {
    schemaVersion: 2,
    articleId: 'article-1',
    articleText: 'Reading workflows make durable memory.',
    articleSentences: ['Reading workflows make durable memory.'],
    items: ids.map((id, index) => ({
      targetId: id,
      markedText: id.replace('target-', 'word-'),
      sourceSentence: 'Reading workflows make durable memory.',
      occurrenceIndex: index,
    })),
  };
}

function createResult(ids) {
  return {
    schemaVersion: 1,
    items: ids.map((id) => ({
      targetId: id,
      markedText: id.replace('target-', 'word-'),
      boundary: id.replace('target-', 'word-'),
      type: 'word',
      meaning: `meaning:${id}`,
      memoryHint: `hint:${id}`,
    })),
  };
}

function createProgressiveTemplate() {
  return {
    schemaVersion: 2,
    articleId: 'article-long',
    articleText: [
      'Opening sentence gives context.',
      'First reading section marks workflow.',
      'Second reading section marks memory.',
      'Unread ending should not be sent.',
    ].join(' '),
    articleSentences: [
      'Opening sentence gives context.',
      'First reading section marks workflow.',
      'Second reading section marks memory.',
      'Unread ending should not be sent.',
    ],
    items: [{
      targetId: 'target-1',
      markedText: 'workflow',
      sourceSentence: 'First reading section marks workflow.',
      occurrenceIndex: 0,
    }, {
      targetId: 'target-2',
      markedText: 'memory',
      sourceSentence: 'Second reading section marks memory.',
      occurrenceIndex: 0,
    }],
  };
}

function createSrsTemplate() {
  return {
    schemaVersion: 2,
    articleId: 'article-srs',
    articleText: [
      'Dinner starts soon.',
      'The chef will grill the fish.',
      'People take clean water for granted.',
      'This is a very long selected passage that should stay out of SRS.',
    ].join(' '),
    articleSentences: [
      'Dinner starts soon.',
      'The chef will grill the fish.',
      'People take clean water for granted.',
      'This is a very long selected passage that should stay out of SRS.',
    ],
    items: [{
      targetId: 'target-word',
      markedText: 'Grill',
      sourceSentence: 'The chef will grill the fish.',
      sentenceBefore: 'Dinner starts soon.',
      sentenceAfter: 'People take clean water for granted.',
      occurrenceIndex: 0,
    }, {
      targetId: 'target-phrase',
      markedText: 'take it for granted',
      sourceSentence: 'People take clean water for granted.',
      sentenceBefore: 'The chef will grill the fish.',
      sentenceAfter: 'This is a very long selected passage that should stay out of SRS.',
      occurrenceIndex: 0,
    }, {
      targetId: 'target-long',
      markedText: 'this is a very long selected passage that should stay out of srs',
      sourceSentence: 'This is a very long selected passage that should stay out of SRS.',
      occurrenceIndex: 0,
    }],
  };
}

function createSrsResult(ids = ['target-word', 'target-phrase', 'target-long']) {
  const texts = {
    'target-word': 'Grill',
    'target-phrase': 'take it for granted',
    'target-long': 'this is a very long selected passage that should stay out of srs',
    'target-old': 'old',
  };
  return {
    schemaVersion: 1,
    items: ids.map((id) => ({
      targetId: id,
      markedText: texts[id],
      boundary: texts[id],
      type: 'word',
      meaning: `meaning:${id}`,
      memoryHint: `hint:${id}`,
    })),
  };
}

function createFakeSrsDeps(existingByLemma = {}) {
  const pendingGroups = new Map();
  const added = [];
  const vocabularyService = {
    async getWordByLemma(lemma) {
      return existingByLemma[lemma] || null;
    },
    isAcquisitionEnabled() {
      return false;
    },
    async addWordLegacy(input) {
      added.push(input);
      return existingByLemma[input.lemma] || {
        id: `word-${input.lemma}`,
        lemma: input.lemma,
        status: 'new',
      };
    },
    async upsertVocabularyEntry(input) {
      return this.addWordLegacy(input);
    },
  };
  const srsPendingRepository = {
    async getPendingCandidates(scopeKey) {
      return pendingGroups.get(scopeKey) || null;
    },
    async setPendingCandidates(scopeKey, group) {
      const next = { ...group, scopeKey, candidates: [...(group.candidates || [])] };
      pendingGroups.set(scopeKey, next);
      return next;
    },
    async clearPendingCandidates(scopeKey) {
      pendingGroups.delete(scopeKey);
    },
  };
  return { vocabularyService, srsPendingRepository, pendingGroups, added };
}

async function readJsonFileLike(file) {
  return JSON.parse(await file.text());
}

function createController(api, overrides = {}) {
  const button = overrides.button || new FakeButton();
  const state = overrides.state || {
    currentAudioMeta: { source: 'youtube-workflow', jobId: 'job-1' },
    currentAudioKey: 'audio-1',
  };
  const imported = [];
  const calls = [];
  const notices = [];
  const template = overrides.template || createTemplate(['target-1']);
  const result = overrides.result || createResult(['target-1']);
  const client = overrides.client || {
    getConfig: async () => ({ model: 'gemini-2.5-pro' }),
    credentialStatus: async () => ({ stored: true, provider: 'test-vault' }),
    maintenance: async () => ({ jobStatuses: { ready: 2 } }),
    getAnnotationBackfillResult: async () => {
      throw new Error('not found');
    },
    getAnnotationBackfillRunResult: async () => {
      throw new Error('not found');
    },
    runAnnotationBackfill: async (jobId, payload) => {
      calls.push({ jobId, payload });
      return { result, itemCount: result.items.length };
    },
  };
  const controller = api.createAnnotationBackfillAiController({
    button,
    state,
    annotationLightweightModule: overrides.annotationLightweightModule || {
      buildManualLightweightAnnotationTemplate: () => template,
      importManualLightweightAnnotations: async (file) => {
        imported.push(await readJsonFileLike(file));
        return { importedCount: imported.at(-1).items.length, skippedCount: 0 };
      },
    },
    client,
    refreshAfterImport: overrides.refreshAfterImport || (() => {}),
    showToast: (message, type) => notices.push({ message, type }),
    showError: (code, message) => notices.push({ code, message, type: 'error' }),
    windowObject: overrides.windowObject || createWindowObject(),
    vocabularyService: overrides.vocabularyService,
    srsPendingRepository: overrides.srsPendingRepository,
    enableInlineSrs: overrides.enableInlineSrs,
  });
  return { button, controller, imported, calls, notices, client, state };
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const modulePath = path.join(repoRoot, 'src', 'composables', 'annotation-backfill-ai-module.js');
  const source = fs.readFileSync(modulePath, 'utf8');
  const api = await importModule(modulePath);
  assert.equal(typeof api.createAnnotationBackfillAiController, 'function');
  assert.ok(source.includes('function createAnnotationBackfillDialog'), 'AI annotation backfill should provide a configuration/progress dialog');
  assert.ok(source.includes('annotation-backfill-dialog'), 'AI annotation backfill dialog should have scoped CSS hooks');
  assert.ok(source.includes('annotation-backfill-dialog__records'), 'AI annotation dialog should include a compact current-article annotation record list');
  assert.ok(source.includes('annotation-backfill-dialog__record-tab'), 'AI annotation dialog should render saved explanation runs as selectable tabs');
  assert.ok(source.includes('annotation-backfill-dialog__record-current'), 'AI annotation dialog should mark which saved model is currently imported');
  assert.ok(source.includes('row.disabled = busy'), 'saved explanation run tabs should be disabled while AI explanation is running');
  assert.ok(source.includes('cancelButton.disabled = busy'), 'the in-dialog cancel button should be disabled while AI explanation is running');
  assert.ok(source.includes('apiKey: runOptions.apiKey'), 'AI annotation backfill should pass per-run API key without relying on queue credentials');
  assert.ok(source.includes('ANNOTATION_BACKFILL_MODEL_STORAGE_KEY'), 'AI annotation model should persist in localStorage');
  assert.ok(source.includes('mergeWithLatest'), 'incremental AI backfill should ask the backend to merge new items with latest saved result');
  assert.ok(source.includes('addSrsCandidates'), 'AI annotation backfill should expose SRS candidate actions');

  {
    const { button, controller } = createController(api);
    controller.refreshAvailability();
    assert.equal(button.disabled, false);
    await button.click();
    assert.equal(typeof controller.isDialogOpen, 'function');
    assert.equal(controller.isDialogOpen(), true, 'button click should open the configuration dialog before running');
  }

  {
    const storage = new FakeStorage();
    const windowObject = createWindowObject({ localStorage: storage });
    const { controller, calls, imported } = createController(api, { windowObject });
    controller.openDialog();
    assert.equal(controller.isDialogOpen(), true);
    await controller.run({ model: 'gemini-annotation-test', apiKey: 'SECRET-RUN-ONLY' });
    assert.equal(controller.isDialogOpen(), false, 'starting a successful AI run should close the configuration dialog');
    controller.openDialog();
    assert.equal(controller.isDialogOpen(), true, 'opening after success should show the last run status');
    assert.equal(controller.getStatusSnapshot().steps.request.state, 'done');
    assert.equal(controller.getStatusSnapshot().steps.import.state, 'done');
    assert.equal(controller.getStatusSnapshot().status.state, 'success');
    controller.closeDialog();
    assert.deepEqual(calls, [{
      jobId: 'job-1',
      payload: { template: createTemplate(['target-1']), model: 'gemini-annotation-test', apiKey: 'SECRET-RUN-ONLY' },
    }]);
    assert.deepEqual(imported, [createResult(['target-1'])]);
    assert.equal(storage.getItem('annotationBackfillAi.model'), 'gemini-annotation-test');
    assert.equal(storage.getItem('annotationBackfillAi.apiKey'), null);

    const next = createController(api, {
      windowObject,
      client: {
        getConfig: async () => ({ model: 'gemini-default' }),
        credentialStatus: async () => ({ stored: false }),
        maintenance: async () => ({ jobStatuses: {} }),
        getAnnotationBackfillResult: async () => {
          throw new Error('not found');
        },
        runAnnotationBackfill: async (jobId, payload) => {
          next.calls.push({ jobId, payload });
          return { result: createResult(['target-1']) };
        },
      },
    });
    await next.controller.run();
    assert.equal(next.calls[0].payload.model, 'gemini-annotation-test', 'stored model should be reused across articles');
    assert.equal(next.calls[0].payload.apiKey, 'SECRET-RUN-ONLY', 'API key should be reused in memory for this reader session');
  }

  {
    const { controller, notices } = createController(api, {
      client: {
        getConfig: async () => ({ model: 'gemini-2.5-flash' }),
        credentialStatus: async () => ({ stored: true }),
        maintenance: async () => ({ jobStatuses: {} }),
        getAnnotationBackfillResult: async () => {
          throw new Error('not found');
        },
        runAnnotationBackfill: async () => {
          throw new Error('503 UNAVAILABLE');
        },
      },
    });
    controller.openDialog();
    assert.equal(controller.isDialogOpen(), true);
    await controller.run({ model: 'gemini-3.5-flash', apiKey: 'SECRET-RUN-ONLY' });
    assert.equal(controller.isDialogOpen(), false, 'failed AI runs should keep the configuration dialog closed and report an error');
    assert.deepEqual(notices.at(-1), { code: 'ANNOTATION_BACKFILL_AI', message: '503 UNAVAILABLE', type: 'error' });
    controller.openDialog();
    assert.equal(controller.isDialogOpen(), true, 'opening after failure should show where the last run failed');
    assert.equal(controller.getStatusSnapshot().steps.request.state, 'error');
    assert.equal(controller.getStatusSnapshot().steps.import.state, 'idle');
    assert.equal(controller.getStatusSnapshot().status.state, 'error');
  }

  {
    const template = createTemplate(['target-1', 'target-2']);
    const cached = createResult(['target-1', 'target-2']);
    const { controller, calls, imported, notices } = createController(api, {
      template,
      client: {
        getConfig: async () => ({ model: 'gemini-2.5-flash' }),
        credentialStatus: async () => ({ stored: true }),
        maintenance: async () => ({ jobStatuses: {} }),
        getAnnotationBackfillResult: async () => ({
          result: cached,
          metadata: {
            model: 'gemini-history-model',
            itemCount: 2,
            templateItemCount: 2,
            generatedAt: '2026-06-26T03:00:00Z',
          },
          history: [{
            model: 'gemini-history-model',
            itemCount: 2,
            templateItemCount: 2,
            generatedAt: '2026-06-26T03:00:00Z',
          }],
        }),
        runAnnotationBackfill: async (jobId, payload) => {
          calls.push({ jobId, payload });
          return { result: createResult(['target-1', 'target-2']) };
        },
      },
    });
    await controller.openDialog();
    const summary = controller.getStatusSnapshot().annotationSummary;
    assert.equal(summary.totalCount, 2);
    assert.equal(summary.coveredCount, 2);
    assert.equal(summary.records[0].model, 'gemini-history-model');
    assert.equal(summary.records[0].itemCount, 2);
    await controller.run({ model: 'gemini-history-model', apiKey: 'SECRET-RUN-ONLY' });
    assert.deepEqual(calls, [], 'fully covered saved result from the selected model should be imported without calling Gemini');
    assert.deepEqual(imported, [cached]);
    assert.ok(notices.some((notice) => notice.type === 'success' && /未调用/.test(notice.message)));
  }

  {
    const template = createTemplate(Array.from({ length: 89 }, (_, index) => `target-${index + 1}`));
    const markedMap = new Map(Array.from({ length: 108 }, (_, index) => [
      index,
      { globalIndex: index, word: `word-${index + 1}`, sourceType: 'manual-mark' },
    ]));
    const { controller } = createController(api, {
      template,
      state: {
        currentAudioMeta: { source: 'youtube-workflow', jobId: 'job-1' },
        currentAudioKey: 'audio-1',
        markedMap,
      },
    });
    await controller.openDialog();
    const summary = controller.getStatusSnapshot().annotationSummary;
    assert.equal(summary.markedWordCount, 108);
    assert.equal(summary.totalCount, 89);
  }

  {
    const template = createTemplate(['target-1', 'target-2']);
    const cached = createResult(['target-1', 'target-2']);
    const latestResult = createResult(['target-1', 'target-2']);
    latestResult.items[0].meaning = 'latest-model-meaning';
    const oldResult = createResult(['target-1']);
    oldResult.items[0].meaning = 'old-model-meaning';
    const runResultCalls = [];
    const { controller, calls, imported } = createController(api, {
      template,
      client: {
        getConfig: async () => ({ model: 'gemini-latest-model' }),
        credentialStatus: async () => ({ stored: true }),
        maintenance: async () => ({ jobStatuses: {} }),
        getAnnotationBackfillResult: async () => ({
          result: latestResult,
          metadata: {
            runId: 'new-run',
            model: 'gemini-latest-model',
            itemCount: 2,
            templateItemCount: 2,
            generatedAt: '2026-06-26T03:10:00Z',
          },
          history: [{
            runId: 'new-run',
            model: 'gemini-latest-model',
            itemCount: 2,
            templateItemCount: 2,
            generatedAt: '2026-06-26T03:10:00Z',
          }, {
            runId: 'old-run',
            model: 'gemini-old-model',
            itemCount: 1,
            templateItemCount: 1,
            generatedAt: '2026-06-26T03:00:00Z',
          }],
        }),
        getAnnotationBackfillRunResult: async (jobId, runId) => {
          runResultCalls.push({ jobId, runId });
          return {
            result: runId === 'old-run' ? oldResult : latestResult,
            metadata: {
              runId,
              model: runId === 'old-run' ? 'gemini-old-model' : 'gemini-latest-model',
              itemCount: runId === 'old-run' ? 1 : 2,
              templateItemCount: runId === 'old-run' ? 1 : 2,
              generatedAt: runId === 'old-run' ? '2026-06-26T03:00:00Z' : '2026-06-26T03:10:00Z',
            },
          };
        },
        runAnnotationBackfill: async (jobId, payload) => {
          calls.push({ jobId, payload });
          return { result: latestResult };
        },
      },
    });
    await controller.openDialog();
    const summary = controller.getStatusSnapshot().annotationSummary;
    assert.deepEqual(summary.records.map((record) => record.runId), ['new-run', 'old-run']);
    assert.deepEqual(summary.records.map((record) => record.model), ['gemini-latest-model', 'gemini-old-model']);
    assert.equal(summary.records[0].generatedAt, '2026-06-26T03:10:00Z');
    assert.equal(typeof controller.importSavedBackfillRun, 'function');
    await controller.importSavedBackfillRun('old-run');
    assert.deepEqual(runResultCalls, [{ jobId: 'job-1', runId: 'old-run' }]);
    assert.deepEqual(imported, [oldResult]);
    assert.deepEqual(calls, [], 'selecting a saved explanation tab should not call Gemini');
    assert.equal(controller.getStatusSnapshot().annotationSummary.selectedRunId, 'old-run');
    assert.equal(controller.getStatusSnapshot().annotationSummary.records[1].current, true);
  }

  {
    const template = createTemplate(['target-1', 'target-2']);
    const cached = createResult(['target-1', 'target-2']);
    const regenerated = createResult(['target-1', 'target-2']);
    regenerated.items[0].meaning = 'new-model-meaning';
    const { controller, calls, imported } = createController(api, {
      template,
      result: regenerated,
      client: {
        getConfig: async () => ({ model: 'gemini-new-model' }),
        credentialStatus: async () => ({ stored: true }),
        maintenance: async () => ({ jobStatuses: {} }),
        getAnnotationBackfillResult: async () => ({
          result: cached,
          metadata: {
            model: 'gemini-old-model',
            itemCount: 2,
            templateItemCount: 2,
            generatedAt: '2026-06-26T03:00:00Z',
          },
        }),
        runAnnotationBackfill: async (jobId, payload) => {
          calls.push({ jobId, payload });
          return {
            result: regenerated,
            metadata: {
              model: payload.model,
              itemCount: 2,
              templateItemCount: 2,
              generatedAt: '2026-06-26T03:10:00Z',
            },
          };
        },
      },
    });
    await controller.run({ model: 'gemini-new-model', apiKey: 'SECRET-RUN-ONLY' });
    assert.equal(calls.length, 1, 'saved explanations from a different model should not block regeneration');
    assert.equal(calls[0].payload.model, 'gemini-new-model');
    assert.deepEqual(calls[0].payload.template.items.map((item) => item.targetId), ['target-1', 'target-2']);
    assert.equal(calls[0].payload.mergeWithLatest, undefined);
    assert.deepEqual(imported, [regenerated]);
  }

  {
    const storage = new FakeStorage({ 'annotationBackfillAi.model': 'gemini-3.5-flash' });
    const windowObject = createWindowObject({ localStorage: storage });
    const { controller, calls, notices } = createController(api, {
      windowObject,
      template: createTemplate(['target-1', 'target-2']),
      client: {
        getConfig: async () => ({ model: 'gemini-3.5-flash' }),
        credentialStatus: async () => ({ stored: true }),
        maintenance: async () => ({ jobStatuses: {} }),
        getAnnotationBackfillResult: async () => {
          throw new Error('not found');
        },
        runAnnotationBackfill: async (jobId, payload) => {
          calls.push({ jobId, payload });
          return { result: createResult(['target-1', 'target-2']) };
        },
      },
    });
    await controller.run({ model: 'gemini-3.5-flash', apiKey: 'SECRET-RUN-ONLY' });
    assert.equal(calls[0].payload.model, 'gemini-3.1-flash-lite', 'bulk annotation should avoid gemini-3.5-flash high-demand failures');
    assert.equal(storage.getItem('annotationBackfillAi.model'), 'gemini-3.1-flash-lite');
    assert.ok(notices.some((notice) => notice.type === 'warning' && /gemini-3\.1-flash-lite/.test(notice.message)));
  }

  {
    const template = createTemplate(['target-1', 'target-2']);
    const latestOtherModelResult = createResult(['target-1']);
    const selectedModelResult = createResult(['target-1', 'target-2']);
    selectedModelResult.items[0].meaning = 'selected-model-existing-meaning';
    const runResultCalls = [];
    const { controller, calls, imported } = createController(api, {
      template,
      client: {
        getConfig: async () => ({ model: 'gemini-other-model' }),
        credentialStatus: async () => ({ stored: true }),
        maintenance: async () => ({ jobStatuses: {} }),
        getAnnotationBackfillResult: async () => ({
          result: latestOtherModelResult,
          metadata: {
            runId: 'latest-other-run',
            model: 'gemini-other-model',
            itemCount: 1,
            templateItemCount: 2,
            generatedAt: '2026-06-26T03:20:00Z',
          },
          history: [{
            runId: 'latest-other-run',
            model: 'gemini-other-model',
            itemCount: 1,
            templateItemCount: 2,
            generatedAt: '2026-06-26T03:20:00Z',
          }, {
            runId: 'selected-model-run',
            model: 'gemini-selected-model',
            itemCount: 2,
            templateItemCount: 2,
            generatedAt: '2026-06-26T03:00:00Z',
          }],
        }),
        getAnnotationBackfillRunResult: async (jobId, runId) => {
          runResultCalls.push({ jobId, runId });
          return {
            result: selectedModelResult,
            metadata: {
              runId,
              model: 'gemini-selected-model',
              itemCount: 2,
              templateItemCount: 2,
              generatedAt: '2026-06-26T03:00:00Z',
            },
          };
        },
        runAnnotationBackfill: async (jobId, payload) => {
          calls.push({ jobId, payload });
          return { result: createResult(['target-1', 'target-2']) };
        },
      },
    });
    await controller.run({ model: 'gemini-selected-model', apiKey: 'SECRET-RUN-ONLY' });
    assert.deepEqual(runResultCalls, [{ jobId: 'job-1', runId: 'selected-model-run' }]);
    assert.deepEqual(calls, [], 'existing explanations for the selected model should not be sent again');
    assert.deepEqual(imported, [selectedModelResult]);
  }

  {
    const template = createTemplate(['target-1', 'target-2']);
    const cached = createResult(['target-1']);
    const confirmMessages = [];
    const { controller, calls, imported } = createController(api, {
      template,
      windowObject: createWindowObject({
        confirm(message) {
          confirmMessages.push(message);
          return false;
        },
      }),
      client: {
        getConfig: async () => ({ model: 'gemini-2.5-flash' }),
        credentialStatus: async () => ({ stored: true }),
        maintenance: async () => ({ jobStatuses: {} }),
        getAnnotationBackfillResult: async () => ({
          result: cached,
          metadata: {
            model: 'gemini-2.5-flash',
            itemCount: 1,
            templateItemCount: 2,
          },
        }),
        runAnnotationBackfill: async (jobId, payload) => {
          calls.push({ jobId, payload });
          return { result: createResult(['target-2']) };
        },
      },
    });
    await controller.run({ model: 'gemini-2.5-flash', apiKey: 'SECRET-RUN-ONLY' });
    assert.equal(confirmMessages.length, 1);
    assert.match(confirmMessages[0], /已有 1 个/);
    assert.match(confirmMessages[0], /新增 1 个/);
    assert.deepEqual(imported, [cached], 'existing explanations should still be restored before cancellation');
    assert.deepEqual(calls, [], 'canceling the confirmation should avoid Gemini');
  }

  {
    const template = createTemplate(['target-1', 'target-2', 'target-3']);
    const cached = createResult(['target-1', 'target-2']);
    const { controller, calls, imported } = createController(api, {
      template,
      windowObject: createWindowObject({ confirm: () => true }),
      result: createResult(['target-3']),
      client: {
        getConfig: async () => ({ model: 'gemini-2.5-flash' }),
        credentialStatus: async () => ({ stored: true }),
        maintenance: async () => ({ jobStatuses: {} }),
        getAnnotationBackfillResult: async () => ({
          result: cached,
          metadata: {
            model: 'gemini-2.5-flash',
            itemCount: 2,
            templateItemCount: 3,
          },
        }),
        runAnnotationBackfill: async (jobId, payload) => {
          calls.push({ jobId, payload });
          return { result: createResult(['target-3']) };
        },
      },
    });
    await controller.run({ model: 'gemini-2.5-flash', apiKey: 'SECRET-RUN-ONLY' });
    assert.deepEqual(imported[0], cached);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].payload.template.items.map((item) => item.targetId), ['target-3']);
    assert.equal(calls[0].payload.mergeWithLatest, true);
  }

  {
    const srsDeps = createFakeSrsDeps();
    const { controller, calls } = createController(api, {
      template: createSrsTemplate(),
      state: {
        currentAudioMeta: { source: 'youtube-workflow', jobId: 'job-1', name: 'Article SRS.audio' },
        currentAudioKey: 'audio-1',
      },
      result: createSrsResult(['target-word', 'target-phrase', 'target-long', 'target-old']),
      vocabularyService: srsDeps.vocabularyService,
      srsPendingRepository: srsDeps.srsPendingRepository,
      enableInlineSrs: true,
    });
    await controller.run({ model: 'gemini-2.5-flash', apiKey: 'SECRET-RUN-ONLY' });
    assert.equal(calls.length, 1);
    const pending = srsDeps.pendingGroups.get('job-1');
    assert.deepEqual(pending.candidates.map((candidate) => [candidate.lemma, candidate.entry_type]), [
      ['grill', 'word'],
      ['take it for granted', 'phrase'],
    ]);
    assert.equal(controller.getStatusSnapshot().srsSummary.wordCandidates, 1);
    assert.equal(controller.getStatusSnapshot().srsSummary.phraseCandidates, 1);
    assert.equal(controller.getStatusSnapshot().srsSummary.excludedLongText, 1);
    assert.equal(srsDeps.added.length, 0, 'AI explanation should not automatically write SRS entries');

    await controller.addSrsCandidates('words');
    assert.deepEqual(srsDeps.added.map((item) => [item.lemma, item.entry_type]), [['grill', 'word']]);
    assert.deepEqual(srsDeps.pendingGroups.get('job-1').candidates.map((candidate) => candidate.lemma), ['take it for granted']);

    await controller.addSrsCandidates('all');
    assert.deepEqual(srsDeps.added.map((item) => [item.lemma, item.entry_type]), [
      ['grill', 'word'],
      ['take it for granted', 'phrase'],
    ]);
    assert.equal(srsDeps.pendingGroups.has('job-1'), false);
  }

  {
    const srsDeps = createFakeSrsDeps();
    const { controller } = createController(api, {
      template: createSrsTemplate(),
      state: {
        currentAudioMeta: { source: 'youtube-workflow', jobId: 'job-1', name: 'Article SRS.audio' },
        currentAudioKey: 'audio-1',
      },
      result: createSrsResult(['target-word', 'target-phrase']),
      vocabularyService: srsDeps.vocabularyService,
      srsPendingRepository: srsDeps.srsPendingRepository,
    });
    await controller.run({ model: 'gemini-2.5-flash', apiKey: 'SECRET-RUN-ONLY' });
    assert.equal(srsDeps.pendingGroups.has('job-1'), false, 'AI explanation should not create inline SRS pending candidates by default');
    assert.equal(srsDeps.added.length, 0, 'AI explanation should not write SRS entries by default');
    assert.equal(controller.getStatusSnapshot().srsSummary.visible, false, 'inline SRS panel should remain hidden unless explicitly enabled');
  }

  {
    const srsDeps = createFakeSrsDeps();
    const template = createSrsTemplate();
    const cached = createSrsResult(['target-word']);
    const { controller, calls } = createController(api, {
      template,
      windowObject: createWindowObject({ confirm: () => true }),
      result: createSrsResult(['target-word', 'target-phrase']),
      vocabularyService: srsDeps.vocabularyService,
      srsPendingRepository: srsDeps.srsPendingRepository,
      enableInlineSrs: true,
      client: {
        getConfig: async () => ({ model: 'gemini-2.5-flash' }),
        credentialStatus: async () => ({ stored: true }),
        maintenance: async () => ({ jobStatuses: {} }),
        getAnnotationBackfillResult: async () => ({
          result: cached,
          metadata: {
            model: 'gemini-2.5-flash',
            itemCount: 1,
            templateItemCount: 3,
          },
        }),
        runAnnotationBackfill: async (jobId, payload) => {
          calls.push({ jobId, payload });
          return { result: createSrsResult(['target-word', 'target-phrase']) };
        },
      },
    });
    await controller.run({ model: 'gemini-2.5-flash', apiKey: 'SECRET-RUN-ONLY' });
    assert.deepEqual(calls[0].payload.template.items.map((item) => item.targetId), ['target-phrase', 'target-long']);
    assert.deepEqual(srsDeps.pendingGroups.get('job-1').candidates.map((candidate) => candidate.targetId), ['target-phrase']);
  }

  {
    const srsDeps = createFakeSrsDeps();
    const template = createSrsTemplate();
    const cached = createSrsResult(['target-word', 'target-phrase', 'target-long']);
    const { controller, calls } = createController(api, {
      template,
      vocabularyService: srsDeps.vocabularyService,
      srsPendingRepository: srsDeps.srsPendingRepository,
      enableInlineSrs: true,
      client: {
        getConfig: async () => ({ model: 'gemini-2.5-flash' }),
        credentialStatus: async () => ({ stored: true }),
        maintenance: async () => ({ jobStatuses: {} }),
        getAnnotationBackfillResult: async () => ({
          result: cached,
          metadata: {
            model: 'gemini-2.5-flash',
            itemCount: 3,
            templateItemCount: 3,
          },
        }),
        runAnnotationBackfill: async (jobId, payload) => {
          calls.push({ jobId, payload });
          return { result: cached };
        },
      },
    });
    await controller.openDialog();
    assert.equal(controller.getStatusSnapshot().srsSummary.pending, false);
    assert.equal(controller.getStatusSnapshot().srsSummary.canBuildFromExisting, true);
    assert.equal(controller.getStatusSnapshot().srsSummary.visible, true);
    assert.equal(controller.getStatusSnapshot().srsSummary.compact, true);
    await controller.run({ model: 'gemini-2.5-flash', apiKey: 'SECRET-RUN-ONLY' });
    assert.deepEqual(calls, [], 'fully covered restore should not call Gemini');
    assert.equal(srsDeps.pendingGroups.has('job-1'), false, 'restoring old explanations should not create new SRS pending candidates');
    assert.equal(controller.getStatusSnapshot().srsSummary.wordCandidates, 0);
    await controller.generateSrsCandidatesFromExistingAnnotations();
    assert.deepEqual(calls, [], 'cold-start candidate generation should read saved explanations without calling Gemini');
    assert.equal(srsDeps.added.length, 0, 'cold-start candidate generation should not write vocabulary entries');
    assert.deepEqual(srsDeps.pendingGroups.get('job-1').candidates.map((candidate) => [candidate.lemma, candidate.entry_type]), [
      ['grill', 'word'],
      ['take it for granted', 'phrase'],
    ]);
    assert.equal(controller.getStatusSnapshot().srsSummary.wordCandidates, 1);
    assert.equal(controller.getStatusSnapshot().srsSummary.phraseCandidates, 1);
    assert.equal(controller.getStatusSnapshot().srsSummary.compact, false);
  }

  {
    const srsDeps = createFakeSrsDeps();
    const { controller } = createController(api, {
      template: createSrsTemplate(),
      vocabularyService: srsDeps.vocabularyService,
      srsPendingRepository: srsDeps.srsPendingRepository,
      enableInlineSrs: true,
    });
    await controller.openDialog();
    assert.equal(controller.getStatusSnapshot().srsSummary.visible, false, 'current article without saved AI explanations should not show the cold-start SRS entry');
    assert.equal(controller.getStatusSnapshot().srsSummary.canBuildFromExisting, false);
  }

  {
    const template = createProgressiveTemplate();
    const cached = createResult(['target-1']);
    const { controller, calls } = createController(api, {
      template,
      windowObject: createWindowObject({ confirm: () => true }),
      result: createResult(['target-2']),
      client: {
        getConfig: async () => ({ model: 'gemini-2.5-flash' }),
        credentialStatus: async () => ({ stored: true }),
        maintenance: async () => ({ jobStatuses: {} }),
        getAnnotationBackfillResult: async () => ({
          result: cached,
          metadata: {
            model: 'gemini-2.5-flash',
            itemCount: 1,
            templateItemCount: 1,
          },
        }),
        runAnnotationBackfill: async (jobId, payload) => {
          calls.push({ jobId, payload });
          return {
            result: {
              schemaVersion: 1,
              items: [...cached.items, ...createResult(['target-2']).items],
            },
          };
        },
      },
    });
    await controller.run({ model: 'gemini-2.5-flash', apiKey: 'SECRET-RUN-ONLY' });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].payload.template.items.map((item) => item.targetId), ['target-2']);
    assert.equal(calls[0].payload.template.items.some((item) => item.targetId === 'target-1'), false);
    assert.equal(calls[0].payload.template.articleText, [
      'Opening sentence gives context.',
      'First reading section marks workflow.',
      'Second reading section marks memory.',
    ].join(' '));
    assert.deepEqual(calls[0].payload.template.articleSentences, [
      'Opening sentence gives context.',
      'First reading section marks workflow.',
      'Second reading section marks memory.',
    ]);
    assert.equal(calls[0].payload.template.articleText.includes('Unread ending should not be sent.'), false);
  }

  {
    const manualButton = new FakeButton();
    const manualErrors = [];
    const manualController = api.createAnnotationBackfillAiController({
      button: manualButton,
      state: { currentAudioMeta: { name: 'manual.mp3' }, currentAudioKey: 'manual' },
      annotationLightweightModule: {},
      client: {},
      showError: (code, message) => manualErrors.push({ code, message }),
      windowObject: createWindowObject(),
    });
    manualController.refreshAvailability();
    assert.equal(manualButton.disabled, true);
    await manualController.run();
    assert.equal(manualErrors[0].code, 'ANNOTATION_BACKFILL_AI');
  }

  {
    let resolveBackfill;
    const switchedState = {
      currentAudioMeta: { source: 'youtube-workflow', jobId: 'job-a' },
      currentAudioKey: 'audio-a',
    };
    const runningButton = new FakeButton();
    const switchedImports = [];
    const switchedNotices = [];
    const switchController = api.createAnnotationBackfillAiController({
      button: runningButton,
      state: switchedState,
      annotationLightweightModule: {
        buildManualLightweightAnnotationTemplate: () => createTemplate(['target-a']),
        importManualLightweightAnnotations: async (file) => switchedImports.push(await file.text()),
      },
      client: {
        getConfig: async () => ({ model: 'gemini-2.5-flash' }),
        credentialStatus: async () => ({ stored: true }),
        maintenance: async () => ({ jobStatuses: {} }),
        getAnnotationBackfillResult: async () => {
          throw new Error('not found');
        },
        runAnnotationBackfill: () => new Promise((resolve) => {
          resolveBackfill = resolve;
        }),
      },
      showToast: (message, type) => switchedNotices.push({ message, type }),
      showError: (code, message) => switchedNotices.push({ code, message, type: 'error' }),
      windowObject: createWindowObject(),
    });
    const pending = switchController.run();
    for (let index = 0; index < 20 && !resolveBackfill; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.equal(typeof resolveBackfill, 'function');
    assert.equal(switchController.isRunning(), true);
    assert.equal(runningButton.disabled, false, 'running AI explanation button should stay clickable for progress');
    assert.equal(switchController.getStatusSnapshot().steps.request.state, 'active');
    await runningButton.click();
    assert.equal(switchController.isDialogOpen(), true, 'clicking/opening while running should show live progress');
    assert.equal(switchController.getStatusSnapshot().steps.request.state, 'active');
    switchedState.currentAudioMeta = { source: 'youtube-workflow', jobId: 'job-b' };
    resolveBackfill({ result: createResult(['target-a']) });
    await pending;
    assert.deepEqual(switchedImports, []);
    assert.equal(switchedNotices.at(-1).type, 'warning');
  }

  console.log('annotation backfill AI module check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
