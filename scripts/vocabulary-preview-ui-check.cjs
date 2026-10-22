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
const dialogSource = read('src', 'features', 'vocabulary-preview', 'create-article-settlement-dialog.js');
assert.match(previewSource, /import \{ createSettlementDialog \} from '\.\.\/features\/vocabulary-preview\/create-article-settlement-dialog\.js'/);
assert.equal(previewSource.includes('function createSettlementDialog'), false);
const previewStyles = read('styles.css');
const learningStyles = read('src', 'features', 'learning-ui', 'learning-ui.css');
const workflowStyles = read('src', 'styles', 'workflow-ui.css');
const pronunciationSource = read('src', 'services', 'pronunciation', 'aria-american-pronunciation.js');
const videoSource = read('src', 'components', 'VideoPlayerFloat.vue');
const videoModuleSource = read('src', 'composables', 'media-source-module.js');
const transcriptStoreSource = read('src', 'pinia-stores', 'transcript.js');
const transcriptComponentSource = read('src', 'components', 'TranscriptContainer.vue');
const chunkComponentSource = read('src', 'components', 'ChunkModeView.vue');

assert.match(dialogSource, /applyNativeControlStyles\(closeButton, \{ owner: 'learning', variant: 'ghost', size: 'icon' \}\)/);
assert.match(dialogSource, /root\.dataset\.uiTheme = 'light'/);
assert.match(previewSource, /settlementDialog\.openLoading\('正在整理本篇生词…', restoreFocusTarget\)/);
assert.match(previewSource, /settlementDialog\.open\(settlement, restoreFocusTarget\)/);
assert.match(
  previewSource,
  /ownerIntegration\s*\?\s*createVocabularyService\(\{\s*ownerIntegration,\s*acquisitionEnabled:\s*true\s*\}\)/,
  'owner-backed article settlement must use the acquisition batch path',
);
assert.match(dialogSource, /expandedMeaningIds/);
assert.match(dialogSource, /const isMeaningExpanded = .*expandedMeaningIds\.has\(targetId\)/);
// N5-03 always shows both meanings; expansion now controls only long-original clamping.
assert.match(previewSource, /let settlementOpening = false/);
assert.match(previewSource, /settlementDialog\.openLoading/);
assert.match(dialogSource, /function updateSpeakingState/);
assert.match(dialogSource, /正在加入/);
assert.match(previewSource, /精简中断，可重试/);
assert.match(dialogSource, /addAllButton\.textContent =/);
assert.match(dialogSource, /pronunciation\.prefetch/);
assert.match(pronunciationSource, /const audioCache = new Map\(\)/);
assert.match(pronunciationSource, /async function prefetch\(/);
assert.match(pronunciationSource, /waitForAudioReady/);
assert.match(previewStyles, /\.vocabulary-preview-dialog\s*\{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\)/);
assert.match(previewStyles, /\.vocabulary-preview-dialog__list\s*\{[\s\S]*?max-height: none/);
assert.match(learningStyles, /\.vocabulary-preview-dialog\[data-ui-theme="light"\]/);
assert.match(workflowStyles, /@source "\.\.\/composables\/vocabulary-preview-module\.js"/);
assert.match(workflowStyles, /@source "\.\.\/features\/vocabulary-preview\/create-article-settlement-dialog\.js"/);
assert.match(previewStyles, /\.vocabulary-preview-dialog--settlement \.vocabulary-preview-dialog__footer\s*\{[\s\S]*?flex-wrap: wrap/);
assert.match(previewStyles, /\.vocabulary-preview-dialog--settlement \.vocabulary-preview-dialog__button\s*\{[\s\S]*?white-space: normal/);
assert.match(
  previewStyles,
  /\.vocabulary-preview-dialog__button\[data-ui-owner="learning"\]:disabled\s*\{[\s\S]*?background:\s*color-mix\([\s\S]*?cursor:\s*not-allowed[\s\S]*?opacity:\s*1/,
  'completed settlement actions should have a distinct semantic disabled state without reduced opacity',
);
assert.match(videoSource, /avoidReaderControls/);
assert.match(videoModuleSource, /previous default was top-right/);
assert.match(transcriptStoreSource, /import \{ ref \} from 'vue'/);

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


async function runPreviewAnnotationClickCheck() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(targetUrl, { waitUntil: 'networkidle' });
    return await page.evaluate(async () => {
      const module = await import('/src/composables/session-facades.js');
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
      try {
        await module.scheduleGeneratedAnnotationIndexRefresh();
        const indexedItems = window.AnnotationGeneratedResultStore.getItems();
        const hit = window.AnnotationClickResolver.resolveClick({
          span: { textContent: 'deliberations' },
          wordIndex: 0,
          words: [{ word: 'deliberations' }],
          generatedStore: window.AnnotationGeneratedResultStore,
        });
        return {
          indexedItemCount: indexedItems.length,
          hitTargetId: hit && hit.targetId,
          hitMeaning: hit && hit.meaning,
        };
      } finally {
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
    const annotationClickResult = await runPreviewAnnotationClickCheck();
    assert.equal(annotationClickResult.indexedItemCount, 1, 'the retained session refresh should index persisted historical explanations');
    assert.equal(annotationClickResult.hitTargetId, 'preview-deliberations-target', 'a historical preview item should resolve its persisted explanation');
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
