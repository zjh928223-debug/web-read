const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
  const source = fs.readFileSync(filePath, 'utf8');
  const encoded = Buffer.from(source, 'utf8').toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${Date.now()}`);
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
