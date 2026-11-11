const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [], markWrites = [], editEvents = [];
  let posted = 0, available = false;
  const result = { items: [{ targetId: 'manual-mark-s-2-2', markedText: 'stable',
    sourceSentence: 'is really stable', boundary: 'really stable', type: 'phrase', meaning: '很稳定', memoryHint: '保持稳定' }] };
  const response = { status: 'ready', result, metadata: { runId: 'isolated-run', model: 'gemini-3.1-flash-lite', itemCount: 1 } };
  page.on('pageerror', e => errors.push(e.message));
  // Every API request is intercepted. This test cannot reach a user Host or AI.
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let body;
    try { body = request.postDataJSON(); } catch {}
    if (path.includes('reader-marks') || body?.operation === 'marks-commit') markWrites.push({ path, method: request.method() });
    if (path.endsWith('/credentials/gemini/status')) return route.fulfill({ json: { stored: true } });
    if (path.endsWith('/config')) return route.fulfill({ json: { model: 'gemini-3.1-flash-lite' } });
    if (path.endsWith('/annotation-backfill') && request.method() === 'POST') {
      assert.equal(body.template.items.length, 1);
      assert.equal(body.template.items[0].targetId, 'manual-mark-s-2-2');
      posted++; available = true;
      return route.fulfill({ json: { status: 'ready', response } });
    }
    if (path.endsWith('/annotation-backfill/latest') && available || path.includes('/annotation-backfill/runs/')) {
      return route.fulfill({ json: response });
    }
    return route.fulfill({ status: 404, json: { detail: 'isolated test' } });
  });
  try {
    await page.goto(process.env.READ_WEB_URL || 'http://127.0.0.1:4173/');
    await page.waitForFunction(() => window.__annotationBackfillAiController);
    await page.waitForFunction(() => {
      try { window.__annotationLightweightModule.buildManualLightweightAnnotationTemplate(); return true; }
      catch (error) { return !error.message.includes('not ready'); }
    });
    await page.evaluate(async () => {
      const { runtimeState: state } = await import('/src/composables/runtime-state-facade.js');
      const { bridgeToPinia } = await import('/src/composables/pinia-bridge-module.js');
      const words = ['is', 'really', 'stable'].map((word, globalIndex) => ({ word, globalIndex, start: globalIndex, end: globalIndex + 1 }));
      state.words = words;
      state.segments = [{ id: 's', text: 'is really stable', words }];
      state.chunkItems = [{ chunkRef: 's', rawEn: 'is really stable', words, start: 0, end: 3 }];
      state.hasAiChunkData = true; state.isChunkMode = true;
      state.currentAudioMeta = { source: 'youtube-workflow', jobId: 'isolated-ownership', textOnly: true };
      state.currentAudioKey = 'youtube-workflow::isolated-ownership';
      state.markedMap.clear();
      state.markedMap.set(2, { globalIndex: 2, word: 'stable', start: 2, sourceType: 'manual-mark', custom: 'keep' });
      bridgeToPinia();
      window.__ownershipState = state;
      window.__ownershipEvents = [];
      window.addEventListener('reader-marks-changed', e => { if (e.detail.source === 'edit') window.__ownershipEvents.push(e.detail); });
    });
    const snapshot = () => page.evaluate(() => JSON.stringify([...window.__ownershipState.markedMap]));
    const before = await snapshot();
    const controllerRun = async () => {
      await page.evaluate(() => window.__annotationBackfillAiController.run({ model: 'gemini-3.1-flash-lite' }));
      const status = await page.evaluate(() => window.__annotationBackfillAiController.getStatusSnapshot().status);
      assert.equal(status.state, 'success', status.message);
      assert.equal(await snapshot(), before);
    };
    await controllerRun(); // Fresh AI response.
    await controllerRun(); // Cached explanation restore, no new request.
    await page.evaluate(() => window.__annotationBackfillAiController.importSavedBackfillRun('isolated-run'));
    assert.equal(await snapshot(), before);
    assert.equal(posted, 1);
    await page.locator('#chunk-vue-container [data-word-index="2"]').click({ button: 'right' });
    await page.locator('#annotation-bubble').waitFor({ state: 'visible' });
    assert((await page.locator('#annotation-bubble').innerText()).includes('很稳定'));
    assert.equal(await page.locator('#chunk-vue-container .marked').count(), 1);
    assert.equal(await page.locator('#chunk-vue-container [data-word-index="1"]').evaluate(el => el.classList.contains('marked')), false);
    editEvents.push(...await page.evaluate(() => window.__ownershipEvents));
    assert.deepEqual(editEvents, []);
    assert.deepEqual(markWrites.filter(r => r.method !== 'GET'), []);
    assert.deepEqual(errors, []);
    console.log('isolated browser marks ownership passed: fresh/cache/history, marks unchanged, no marks writes, explanation visible');
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
