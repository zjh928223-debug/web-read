const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..');
const port = 45000 + (process.pid % 1000);
const targetUrl = process.env.READ_WEB_URL || `http://127.0.0.1:${port}/`;
const ownsServer = !process.env.READ_WEB_URL;
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

const previewSource = read('src', 'composables', 'vocabulary-preview-module.js');
const previewStyles = read('styles.css');
const pronunciationSource = read('src', 'services', 'pronunciation', 'aria-american-pronunciation.js');
const videoSource = read('src', 'components', 'VideoPlayerFloat.vue');
const videoModuleSource = read('src', 'composables', 'media-source-module.js');

assert.match(previewSource, /previewButton\.addEventListener\('click', scanPreview\)/);
assert.match(
  previewSource,
  /ownerIntegration\s*\?\s*createVocabularyService\(\{\s*ownerIntegration,\s*acquisitionEnabled:\s*true\s*\}\)/,
  'owner-backed article settlement must use the acquisition batch path',
);
assert.match(previewSource, /vocabulary-preview-dialog__hint/);
assert.match(previewSource, /form\.append\(modelLabel, keyLabel, statusEl, dictionaryHint, listEl, footer\)/);
assert.match(previewSource, /expandedMeaningIds/);
assert.match(previewSource, /const isMeaningExpanded = .*expandedMeaningIds\.has\(targetId\)/);
assert.match(previewSource, /meaning\.hidden = !isMeaningExpanded/);
assert.match(previewSource, /let settlementOpening = false/);
assert.match(previewSource, /settlementDialog\.openLoading/);
assert.match(previewSource, /function updateSpeakingState/);
assert.match(previewSource, /正在加入/);
assert.match(previewSource, /精简中断，可重试/);
assert.match(previewSource, /addAllButton\.textContent =/);
assert.match(previewSource, /pronunciation\.prefetch/);
assert.match(pronunciationSource, /const audioCache = new Map\(\)/);
assert.match(pronunciationSource, /async function prefetch\(/);
assert.match(pronunciationSource, /waitForAudioReady/);
assert.match(previewStyles, /\.vocabulary-preview-dialog\s*\{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\)/);
assert.match(previewStyles, /\.vocabulary-preview-dialog__form\s*\{[\s\S]*?overflow: hidden/);
assert.match(previewStyles, /\.vocabulary-preview-dialog__list\s*\{[\s\S]*?max-height: none/);
assert.match(
  previewStyles,
  /\.vocabulary-preview-dialog__button:disabled\s*\{[\s\S]*?background:\s*#e2e8f0[\s\S]*?cursor:\s*not-allowed/,
  'completed settlement actions should have an unmistakable gray disabled state',
);
assert.match(videoSource, /avoidReaderControls/);
assert.match(videoModuleSource, /previous default was top-right/);

async function waitForServer(server, output) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Vite exited before startup: ${output.value}`);
    try {
      const response = await fetch(targetUrl);
      if (response.ok) return;
    } catch (_error) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Vite: ${output.value}`);
}

async function runRepeatedClickCheck() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(targetUrl, { waitUntil: 'networkidle' });
    return await page.evaluate(async () => {
      const module = await import('/src/composables/vocabulary-preview-module.js');
      const originalStorage = window.AnnotationGenerationStorage;
      window.AnnotationGenerationStorage = {
        async loadBundle() {
          return { generated: { items: [] }, status: {} };
        },
      };
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '预习生词';
      document.body.appendChild(button);
      const tokens = Array.from({ length: 25 }, (_, index) => {
        const suffix = String.fromCharCode(97 + Math.floor(index / 26)) + String.fromCharCode(97 + (index % 26));
        return `xyloph${suffix}`;
      });
      let bulkLookupCalls = 0;
      let perWordLookupCalls = 0;
      let releaseLookup;
      let markLookupStarted;
      const lookupGate = new Promise((resolve) => { releaseLookup = resolve; });
      const lookupStarted = new Promise((resolve) => { markLookupStarted = resolve; });
      const controller = module.createVocabularyPreviewController({
        previewButton: button,
        state: {
          currentAudioMeta: { source: 'youtube-workflow', jobId: 'preview-repeat-check', title: 'Preview repeat check' },
          currentAudioKey: 'preview-repeat-audio',
          segments: [{
            id: 'preview-repeat-segment',
            text: tokens.join(' '),
            words: tokens.map((word, globalIndex) => ({ word, globalIndex })),
          }],
        },
        windowObject: window,
        documentObject: document,
        vocabularyService: {
          async getWordsAndContextsByLemmas(lemmas) {
            bulkLookupCalls += 1;
            markLookupStarted();
            await lookupGate;
            return new Map(lemmas.map((lemma) => [lemma, { word: null, contexts: [] }]));
          },
          async getWordByLemma() {
            perWordLookupCalls += 1;
            return null;
          },
        },
        settlementProgressRepository: {
          async getProgress() { return null; },
        },
      });
      try {
        const first = controller.scanPreview();
        const second = controller.scanPreview();
        const third = controller.scanPreview();
        await lookupStarted;
        const whilePending = {
          bulkLookupCalls,
          buttonDisabled: button.disabled,
          sameTask: first === second && second === third,
        };
        releaseLookup();
        const results = await Promise.all([first, second, third]);
        return {
          whilePending,
          bulkLookupCalls,
          perWordLookupCalls,
          buttonDisabledAfter: button.disabled,
          sameResult: results[0] === results[1] && results[1] === results[2],
        };
      } finally {
        controller.dispose();
        button.remove();
        window.AnnotationGenerationStorage = originalStorage;
      }
    });
  } finally {
    await context.close();
    await browser.close();
  }
}

async function runPreviewAnnotationClickCheck() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(targetUrl, { waitUntil: 'networkidle' });
    return await page.evaluate(async () => {
      const module = await import('/src/composables/vocabulary-preview-module.js');
      const originalStorage = window.AnnotationGenerationStorage;
      const generatedItem = {
        id: 'preview-deliberations',
        targetId: 'preview-deliberations-target',
        markedText: 'deliberations',
        boundary: 'deliberations',
        meaning: 'careful discussion',
        source: 'preview-scan',
        occurrenceKey: 'preview::deliberations',
        occurrenceGlobalStart: 0,
        occurrenceGlobalEnd: 0,
      };
      window.AnnotationGenerationStorage = {
        async loadBundle() {
          return { generated: { items: [generatedItem] }, status: {} };
        },
      };
      window.AnnotationGeneratedResultStore.clear();
      const toggleButton = document.createElement('button');
      toggleButton.type = 'button';
      toggleButton.textContent = '显示预习词';
      document.body.appendChild(toggleButton);
      const controller = module.createVocabularyPreviewController({
        togglePreviewButton: toggleButton,
        state: {
          currentAudioMeta: { source: 'youtube-workflow', jobId: 'preview-click-check' },
          currentAudioKey: 'preview-click-audio',
        },
        windowObject: window,
        documentObject: document,
        settlementProgressRepository: {
          async getProgress() { return null; },
        },
      });
      try {
        const previewIndexes = await controller.togglePreviewWords();
        const indexedItems = window.AnnotationGeneratedResultStore.getItems();
        const hit = window.AnnotationClickResolver.resolveClick({
          span: { textContent: 'deliberations' },
          wordIndex: 0,
          words: [{ word: 'deliberations' }],
          generatedStore: window.AnnotationGeneratedResultStore,
        });
        return {
          previewIndexes,
          indexedItemCount: indexedItems.length,
          hitTargetId: hit && hit.targetId,
          hitMeaning: hit && hit.meaning,
        };
      } finally {
        controller.dispose();
        toggleButton.remove();
        window.AnnotationGeneratedResultStore.clear();
        window.AnnotationGenerationStorage = originalStorage;
      }
    });
  } finally {
    await context.close();
    await browser.close();
  }
}

async function runStaleRefinementButtonCheck() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(targetUrl, { waitUntil: 'networkidle' });
    return await page.evaluate(async () => {
      const module = await import('/src/composables/vocabulary-preview-module.js');
      const originalStorage = window.AnnotationGenerationStorage;
      window.AnnotationGenerationStorage = {
        async loadBundle() {
          return {
            generated: {
              items: [{
                targetId: 'stale-refinement-target',
                markedText: 'effort',
                boundary: 'effort',
                meaning: '为了达成某事而进行的尝试或努力。',
                sourceSentence: 'There is an effort to keep the mayor away from the ceremony.',
              }],
            },
            status: {},
          };
        },
      };
      const settleButton = document.createElement('button');
      document.body.appendChild(settleButton);
      const controller = module.createVocabularyPreviewController({
        settleButton,
        state: {
          currentAudioMeta: {
            source: 'youtube-workflow',
            jobId: 'stale-refinement-article',
            title: 'Stale refinement fixture',
          },
          currentAudioKey: 'stale-refinement-audio',
        },
        windowObject: window,
        documentObject: document,
        vocabularyService: {
          async getWordsAndContextsByLemmas(lemmas) {
            return new Map(lemmas.map((lemma) => [lemma, { word: null, contexts: [] }]));
          },
        },
        settlementProgressRepository: {
          async getProgress() {
            return {
              article_id: 'stale-refinement-article',
              refinements: [{
                target_id: 'stale-refinement-target',
                prompt_version: 3,
                status: 'pending',
                attempted_at: '2026-07-10T00:00:00.000Z',
              }],
              settlement_target_ids: [],
              removed_target_ids: [],
              applied_target_ids: [],
              skipped_target_ids: [],
              application_claims: [],
            };
          },
        },
      });
      try {
        await controller.openSettlement();
        const refineButton = document.querySelector('.vocabulary-preview-dialog--settlement .vocabulary-preview-dialog__footer button');
        return { disabled: refineButton ? refineButton.disabled : null };
      } finally {
        controller.dispose();
        settleButton.remove();
        window.AnnotationGenerationStorage = originalStorage;
      }
    });
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  let server = null;
  const output = { value: '' };
  try {
    if (ownsServer) {
      server = spawn(process.execPath, [
        path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
        '--host', '127.0.0.1',
        '--port', String(port),
        '--strictPort',
      ], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
      const capture = (chunk) => { output.value = `${output.value}${chunk}`.slice(-8000); };
      server.stdout.on('data', capture);
      server.stderr.on('data', capture);
      await waitForServer(server, output);
    }
    const result = await runRepeatedClickCheck();
    assert.equal(result.whilePending.bulkLookupCalls, 1, 'repeated preview clicks should start only one scan');
    assert.equal(result.whilePending.buttonDisabled, true, 'preview button should be disabled while scanning');
    assert.equal(result.whilePending.sameTask, true, 'repeated preview calls should reuse the in-flight task');
    assert.equal(result.bulkLookupCalls, 1);
    assert.equal(result.perWordLookupCalls, 0);
    assert.equal(result.buttonDisabledAfter, false, 'preview button should be restored after scanning');
    assert.equal(result.sameResult, true, 'all repeated callers should receive the same scan result');
    const annotationClickResult = await runPreviewAnnotationClickCheck();
    assert.deepEqual(annotationClickResult.previewIndexes, [0], 'displaying preview words should expose the persisted occurrence');
    assert.equal(annotationClickResult.indexedItemCount, 1, 'displaying preview words should refresh the generated annotation index');
    assert.equal(annotationClickResult.hitTargetId, 'preview-deliberations-target', 'a displayed preview word should resolve its persisted explanation');
    assert.equal(annotationClickResult.hitMeaning, 'careful discussion');
    const staleRefinementButtonResult = await runStaleRefinementButtonCheck();
    assert.equal(staleRefinementButtonResult.disabled, false, 'an abandoned refinement should leave the AI refinement button clickable');
    console.log('vocabulary preview UI check passed');
  } finally {
    if (server && server.exitCode === null) server.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
