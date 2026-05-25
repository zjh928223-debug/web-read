const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const response404s = [];

  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('requestfailed', r => failedRequests.push({ url: r.url(), failure: r.failure()?.errorText }));
  page.on('response', r => { if (r.status() === 404) response404s.push(r.url()); });

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // 1. Check all 28 global namespaces
  const globals = await page.evaluate(() => {
    const names = [
      'DataUtils','IdentityStorageKeys','ImportExportSharedHelpers','SentenceNotesPersistenceUtils',
      'ClozeUtils','ClozeViewModelHelpers','ChunkNoteLayoutHelpers','ChunkNoteLayoutCore',
      'PlaybackIndexHelpers','ChunkMatchingHelpers','AnnotationBubble','AnnotationTargetSource',
      'AnnotationGenerationDiagnostics','AnnotationGenerationDiagnosticsRecords',
      'AnnotationRunDiagnostics','AnnotationGenerationDiff','AnnotationBlockPlanner',
      'AnnotationPromptBuilder','AnnotationApiConfig','AnnotationApiSettingsUI',
      'AnnotationApiClient','AnnotationGenerationProgressStore','AnnotationGenerationStorage',
      'AnnotationGenerationController','AnnotationGeneratedResultStore',
      'AnnotationClickResolver','AnnotationGenerationEntryUI'
    ];
    return names.map(n => ({ name: n, type: typeof window[n], ok: typeof window[n] !== 'undefined' }));
  });

  // 2. Check HTML elements exist
  const elements = await page.evaluate(() => ({
    audioPlayer: !!document.getElementById('audio-player'),
    transcriptContainer: !!document.getElementById('transcript-container'),
    themeControls: !!document.getElementById('theme-controls'),
    chunkStyleModal: !!document.getElementById('chunk-style-modal'),
    annotationBubble: !!document.getElementById('annotation-bubble-frame'),
    vueRoot: !!document.getElementById('vue-root'),
    vueMounted: !!document.querySelector('[data-vue-mounted]'),
  }));

  // 3. Check for CSS loading (body should have background)
  const cssLoaded = await page.evaluate(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    return bg && bg !== 'rgba(0, 0, 0, 0)';
  });

  // 4. Check for Google CSE and fonts
  const external = response404s.filter(u =>
    u.includes('fonts.googleapis.com') || u.includes('cse.google.com')
  );

  const results = {
    globals: {
      total: globals.length,
      ok: globals.filter(g => g.ok).length,
      missing: globals.filter(g => !g.ok).map(g => g.name)
    },
    elements: Object.entries(elements).map(([k, v]) => ({ element: k, exists: v })),
    cssLoaded,
    consoleErrors,
    pageErrors,
    failedRequests,
    response404s,
    external404s: external,
  };

  console.log(JSON.stringify(results, null, 2));

  const allGlobalsOK = results.globals.missing.length === 0;
  const noConsoleErrors = consoleErrors.length === 0;
  const noPageErrors = pageErrors.length === 0;
  const noFailedRequests = failedRequests.length === 0;
  const noExternal404s = external.length === 0;

  const passed = allGlobalsOK && noConsoleErrors && noPageErrors && noFailedRequests;

  console.log('\n=== SELF-AUDIT RESULTS ===');
  console.log(`Globals (${results.globals.ok}/${results.globals.total}): ${allGlobalsOK ? 'PASS' : 'FAIL'}`);
  if (!allGlobalsOK) console.log('  Missing:', results.globals.missing);
  console.log(`Console errors: ${noConsoleErrors ? 'PASS (0)' : 'FAIL (' + consoleErrors.length + ')'}`);
  if (consoleErrors.length) console.log('  Errors:', consoleErrors.slice(0, 5));
  console.log(`Page errors: ${noPageErrors ? 'PASS (0)' : 'FAIL (' + pageErrors.length + ')'}`);
  if (pageErrors.length) console.log('  Errors:', pageErrors.slice(0, 5));
  console.log(`Failed requests: ${noFailedRequests ? 'PASS (0)' : 'FAIL (' + failedRequests.length + ')'}`);
  if (failedRequests.length) console.log('  Failed:', failedRequests.slice(0, 5));
  console.log(`External 404s: ${noExternal404s ? 'PASS (0)' : 'FAIL (' + external.length + ')'}`);
  console.log(`CSS loaded: ${results.cssLoaded ? 'PASS' : 'FAIL'}`);
  console.log(`Vue root: ${elements.vueRoot ? 'PASS' : 'FAIL'}`);
  console.log(`Vue mounted: ${elements.vueMounted ? 'PASS' : 'FAIL'}`);

  console.log(passed ? '\nSELF-AUDIT: ALL CLEAR' : '\nSELF-AUDIT: ISSUES FOUND');
  await browser.close();
  process.exit(passed ? 0 : 1);
})();
