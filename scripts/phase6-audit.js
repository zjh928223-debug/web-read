const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const rootDir = 'E:/read-web';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [], pageErrs = [], all500s = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().substring(0, 150)); });
  page.on('pageerror', e => pageErrs.push(e.message.substring(0, 150)));
  page.on('response', r => { if (r.status() === 500) all500s.push(r.url().split('/').pop()); });

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // ==========================================
  // 1. VERIFY DELETED FILES (should NOT exist)
  // ==========================================
  console.log('=== 1. DELETED FILES CHECK ===');
  const shouldBeDeleted = [
    '__tmp_read26_check.js',
    'CODE_REVIEW.md',
    'CLEANUP_CANDIDATES.md',
    'FIRST_SAFE_SPLIT_PLAN.md',
    'scripts/phase1-check.js',
    'scripts/phase1-load-check.js',
    'scripts/phase1-self-audit.js',
    'scripts/phase2-check-theme.js',
    'scripts/phase2-check-ui.js',
    'scripts/phase2-full-audit.js',
    'scripts/phase3-audit.js',
    'scripts/phase4-audit.js',
    'scripts/phase5-audit.js',
    'vite-stderr.txt',
    'vite-stdout.txt',
    'vite-out.txt',
    'vite-err.txt',
  ];
  var stillExist = shouldBeDeleted.filter(f => fs.existsSync(path.join(rootDir, f)));
  console.log('  Should be deleted (' + shouldBeDeleted.length + '): ' + (stillExist.length === 0 ? 'PASS' : 'FAIL'));
  stillExist.forEach(f => console.log('    STILL EXISTS: ' + f));

  // ==========================================
  // 2. VERIFY RETAINED FILES (should exist)
  // ==========================================
  console.log('\n=== 2. RETAINED FILES CHECK ===');
  const mustExist = [
    'index.html', 'vite.config.js', 'package.json', '.gitignore',
    'src/main.js', 'src/App.vue', 'styles.css',
    'src/stores/theme.js', 'src/stores/ui.js', 'src/stores/audio.js',
    'src/stores/marks.js', 'src/stores/cloze.js', 'src/stores/transcript.js',
    'src/stores/chunk.js', 'src/stores/notes.js', 'src/stores/annotation.js',
    'src/components/ToastMessage.vue', 'src/components/ClozeQuizView.vue',
    'src/components/ClozeCard.vue', 'src/components/TranscriptContainer.vue',
    'src/components/ChunkModeView.vue', 'src/components/SentenceNoteSidebar.vue',
    'AGENTS.md', 'README.md', 'PROJECT_MAP.md',
    'app.js', 'read-26.html',
    'scripts/read26-verify.js', 'scripts/read26-load-check.js', 'scripts/vite-verify.js',
  ];
  var missing = mustExist.filter(f => !fs.existsSync(path.join(rootDir, f)));
  console.log('  Required files (' + mustExist.length + '): ' + (missing.length === 0 ? 'PASS' : 'FAIL'));
  missing.forEach(f => console.log('    MISSING: ' + f));

  // ==========================================
  // 3. VERIFY 28 LEGACY IIFE SCRIPTS INTACT
  // ==========================================
  console.log('\n=== 3. LEGACY SCRIPTS INTACT ===');
  const legacyScripts = [
    'data-utils.js','identity-and-storage-keys.js','import-export-shared-helpers.js',
    'sentence-notes-persistence-utils.js','cloze-utils.js','cloze-view-model-helpers.js',
    'chunk-note-layout-helpers.js','chunk-note-layout-core.js','playback-index-helpers.js',
    'chunk-matching-helpers.js','annotation-bubble.js','annotation-target-source.js',
    'annotation-generation-diagnostics.js','annotation-generation-diagnostics-records.js',
    'annotation-run-diagnostics.js','annotation-generation-diff.js','annotation-block-planner.js',
    'annotation-prompt-builder.js','annotation-api-config.js','annotation-api-settings-ui.js',
    'annotation-api-client.js','annotation-generation-progress-store.js',
    'annotation-generation-storage.js','annotation-generation-controller.js',
    'annotation-generated-result-store.js','annotation-click-resolver.js',
    'annotation-generation-entry-ui.js'
  ];
  var missingLegacy = legacyScripts.filter(f => !fs.existsSync(path.join(rootDir, f)));
  console.log('  Legacy scripts (27/27): ' + (missingLegacy.length === 0 ? 'PASS' : 'FAIL'));
  missingLegacy.forEach(f => console.log('    MISSING: ' + f));

  // ==========================================
  // 4. VERIFY index.html LOADS LEGACY SCRIPTS
  // ==========================================
  console.log('\n=== 4. index.html SCRIPT INTEGRITY ===');
  var html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  var allInHtml = legacyScripts.every(s => html.indexOf(s) >= 0);
  var hasStores = html.indexOf('src/stores/theme.js') >= 0 &&
                   html.indexOf('src/stores/ui.js') >= 0 &&
                   html.indexOf('src/stores/audio.js') >= 0;
  var hasVueEntry = html.indexOf('/src/main.js') >= 0;
  console.log('  All 27 legacy scripts in index.html: ' + (allInHtml ? 'PASS' : 'FAIL'));
  console.log('  9 store scripts in index.html: ' + (hasStores ? 'PASS' : 'FAIL'));
  console.log('  Vue module entry in index.html: ' + (hasVueEntry ? 'PASS' : 'FAIL'));

  // ==========================================
  // 5. ES MODULE COPIES EXIST
  // ==========================================
  console.log('\n=== 5. ES MODULE COPIES ===');
  var annotDir = path.join(rootDir, 'src/services/annotation');
  var utilsDir = path.join(rootDir, 'src/utils');
  var annotCount = fs.existsSync(annotDir) ? fs.readdirSync(annotDir).filter(f => f.endsWith('.js')).length : 0;
  var utilsCount = fs.existsSync(utilsDir) ? fs.readdirSync(utilsDir).filter(f => f.endsWith('.js')).length : 0;
  console.log('  Annotation ES modules: ' + (annotCount === 14 ? 'PASS (14/14)' : 'FAIL (' + annotCount + ')'));
  console.log('  Utility ES modules: ' + (utilsCount === 8 ? 'PASS (8/8)' : 'FAIL (' + utilsCount + ')'));

  // ==========================================
  // 6. RUNTIME CHECK
  // ==========================================
  console.log('\n=== 6. RUNTIME CHECK ===');
  const runtime = await page.evaluate(() => ({
    flag: window.__USE_VUE_RENDERING === false,
    all27LegacyGlobals: [
      'DataUtils','IdentityStorageKeys','ImportExportSharedHelpers','SentenceNotesPersistenceUtils',
      'ClozeUtils','ClozeViewModelHelpers','ChunkNoteLayoutHelpers','ChunkNoteLayoutCore',
      'PlaybackIndexHelpers','ChunkMatchingHelpers','AnnotationBubble','AnnotationTargetSource',
      'AnnotationGenerationDiagnostics','AnnotationGenerationDiagnosticsRecords',
      'AnnotationRunDiagnostics','AnnotationGenerationDiff','AnnotationBlockPlanner',
      'AnnotationPromptBuilder','AnnotationApiConfig','AnnotationApiSettingsUI',
      'AnnotationApiClient','AnnotationGenerationProgressStore','AnnotationGenerationStorage',
      'AnnotationGenerationController','AnnotationGeneratedResultStore',
      'AnnotationClickResolver','AnnotationGenerationEntryUI'
    ].every(n => typeof window[n] === 'object'),
    stores: ['__themeStore','__uiStore','__audioStore','__marksStore','__clozeStore',
      '__transcriptStore','__chunkStore','__notesStore','__annotationStore'
    ].every(n => typeof window[n] === 'object'),
    globalFuncs: ['handleBackwardClick','handleForwardClick','changeSpeed','cycleHighlightMode',
      'toggleChunkMode','openChunkStyleModal','closeChunkStyleModal'
    ].every(n => typeof window[n] === 'function'),
    dom: {
      transcript: !!document.getElementById('transcript-container'),
      audio: !!document.getElementById('audio-player'),
      theme: !!document.getElementById('theme-toggle'),
      vueRoot: !!document.getElementById('vue-root'),
    },
    themeIcon: document.getElementById('theme-toggle') ? document.getElementById('theme-toggle').textContent : null,
  }));

  console.log('  Flag false: ' + (runtime.flag ? 'PASS' : 'FAIL'));
  console.log('  27 legacy globals (object): ' + (runtime.all27LegacyGlobals ? 'PASS' : 'FAIL'));
  console.log('  9 stores (object): ' + (runtime.stores ? 'PASS' : 'FAIL'));
  console.log('  7 global functions: ' + (runtime.globalFuncs ? 'PASS' : 'FAIL'));
  console.log('  DOM elements: ' + (runtime.dom.transcript && runtime.dom.audio && runtime.dom.theme && runtime.dom.vueRoot ? 'PASS' : 'FAIL'));
  console.log('  Theme icon: ' + (runtime.themeIcon ? 'PASS (' + runtime.themeIcon + ')' : 'FAIL'));

  // ==========================================
  // 7. TOAST CHECK
  // ==========================================
  console.log('\n=== 7. TOAST ===');
  await page.evaluate(() => { window.__uiStore.showToast('Phase6Audit', 'success'); });
  await page.waitForTimeout(600);
  const toast = await page.evaluate(() => {
    var el = document.getElementById('app-toast');
    return { text: el ? el.textContent : 'no-el', class: el ? el.className : '' };
  });
  console.log('  Toast via store → Vue: ' + (toast.text === 'Phase6Audit' ? 'PASS' : 'FAIL - "' + toast.text + '"'));

  // ==========================================
  // 8. GITIGNORE CHECK
  // ==========================================
  console.log('\n=== 8. .gitignore ===');
  var gi = fs.readFileSync(path.join(rootDir, '.gitignore'), 'utf8');
  var hasDist = gi.indexOf('dist/') >= 0;
  var hasViteTxt = gi.indexOf('vite-*.txt') >= 0 || gi.indexOf('vite-*') >= 0;
  console.log('  Has dist/: ' + (hasDist ? 'PASS' : 'FAIL'));
  console.log('  Has vite-*.txt: ' + (hasViteTxt ? 'PASS' : 'FAIL'));

  // ==========================================
  // 9. DOCS CHECK
  // ==========================================
  console.log('\n=== 9. DOCUMENTS ===');
  var agents = fs.readFileSync(path.join(rootDir, 'AGENTS.md'), 'utf8');
  var readme = fs.readFileSync(path.join(rootDir, 'README.md'), 'utf8');
  var projMap = fs.readFileSync(path.join(rootDir, 'PROJECT_MAP.md'), 'utf8');
  console.log('  AGENTS.md updated: ' + (agents.indexOf('phase-6-done') >= 0 ? 'PASS' : 'FAIL'));
  console.log('  README.md updated: ' + (readme.indexOf('Phase 6') >= 0 ? 'PASS' : 'FAIL'));
  console.log('  PROJECT_MAP.md updated: ' + (projMap.indexOf('phase-6-done') >= 0 ? 'PASS' : 'FAIL'));

  // ==========================================
  // FINAL
  // ==========================================
  console.log('\n=== ERRORS ===');
  console.log('  Console errors: ' + errors.length);
  if (errors.length) errors.slice(0, 3).forEach(e => console.log('   ', e));
  console.log('  Page errors: ' + pageErrs.length);
  if (pageErrs.length) pageErrs.slice(0, 3).forEach(e => console.log('   ', e));
  console.log('  Vite 500s: ' + all500s.length);
  if (all500s.length) console.log('   ', all500s.join(', '));

  const allPassed = stillExist.length === 0
    && missing.length === 0
    && missingLegacy.length === 0
    && allInHtml && hasStores && hasVueEntry
    && annotCount === 14 && utilsCount === 8
    && runtime.flag && runtime.all27LegacyGlobals && runtime.stores && runtime.globalFuncs
    && runtime.dom.transcript && runtime.dom.audio && runtime.dom.theme
    && toast.text === 'Phase6Audit'
    && hasDist && hasViteTxt
    && agents.indexOf('phase-6-done') >= 0 && readme.indexOf('Phase 6') >= 0 && projMap.indexOf('phase-6-done') >= 0
    && errors.length === 0 && pageErrs.length === 0 && all500s.length === 0;

  console.log('\n' + (allPassed ? 'PHASE 6 SELF-AUDIT: ALL CLEAR' : 'PHASE 6 SELF-AUDIT: ISSUES FOUND'));

  await browser.close();
  process.exit(allPassed ? 0 : 1);
})();
