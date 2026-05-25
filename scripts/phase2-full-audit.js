const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [], pageErrs = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => pageErrs.push(e.message));

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const r = await page.evaluate(() => {
    // 1. Store existence check
    const stores = {
      theme: { exists: !!window.__themeStore, keys: window.__themeStore ? Object.keys(window.__themeStore) : [] },
      ui: { exists: !!window.__uiStore, keys: window.__uiStore ? Object.keys(window.__uiStore) : [] },
      audio: { exists: !!window.__audioStore, keys: window.__audioStore ? Object.keys(window.__audioStore) : [] },
      marks: { exists: !!window.__marksStore, keys: window.__marksStore ? Object.keys(window.__marksStore) : [] },
      cloze: { exists: !!window.__clozeStore, keys: window.__clozeStore ? Object.keys(window.__clozeStore) : [] },
      transcript: { exists: !!window.__transcriptStore, keys: window.__transcriptStore ? Object.keys(window.__transcriptStore) : [] },
      chunk: { exists: !!window.__chunkStore, keys: window.__chunkStore ? Object.keys(window.__chunkStore) : [] },
      notes: { exists: !!window.__notesStore, keys: window.__notesStore ? Object.keys(window.__notesStore) : [] },
      annotation: { exists: !!window.__annotationStore, keys: window.__annotationStore ? Object.keys(window.__annotationStore) : [] },
    };

    // 2. Old global functions still intact
    const globals = {
      handleBackwardClick: typeof window.handleBackwardClick,
      handleForwardClick: typeof window.handleForwardClick,
      changeSpeed: typeof window.changeSpeed,
      cycleHighlightMode: typeof window.cycleHighlightMode,
      toggleChunkMode: typeof window.toggleChunkMode,
      openChunkStyleModal: typeof window.openChunkStyleModal,
      closeChunkStyleModal: typeof window.closeChunkStyleModal,
    };

    // 3. Store function integrity
    const storeFunctions = {
      themeInit: typeof window.__themeStore?.init,
      themeApplyMode: typeof window.__themeStore?.applyThemeMode,
      uiShowToast: typeof window.__uiStore?.showToast,
      uiShowError: typeof window.__uiStore?.showError,
      audioInitDB: typeof window.__audioStore?.initDB,
      audioSaveToDB: typeof window.__audioStore?.saveToDB,
      audioLoadFromDB: typeof window.__audioStore?.loadFromDB,
      audioClearDBStore: typeof window.__audioStore?.clearDBStore,
      marksToggle: typeof window.__marksStore?.toggleMark,
      marksSync: typeof window.__marksStore?.syncMarkedWordVisual,
    };

    // 4. Theme test — toggle button click
    const themeBtn = document.getElementById('theme-toggle');
    const themeBtnIcon = themeBtn?.textContent;
    const dataTheme = document.documentElement.getAttribute('data-theme');

    return { stores, globals, storeFunctions, themeBtnIcon, dataTheme };
  });

  // Check results
  const allStoresExist = Object.values(r.stores).every(s => s.exists);
  const allGlobalsOK = Object.values(r.globals).every(v => v === 'function');

  console.log('=== STORES ===');
  Object.entries(r.stores).forEach(([name, s]) => {
    console.log(`  __${name}Store: ${s.exists ? 'EXISTS (' + s.keys.length + ' keys)' : 'MISSING'}`);
    if (s.keys.length) console.log('    keys:', s.keys.join(', '));
  });

  console.log('\n=== GLOBAL FUNCTIONS ===');
  Object.entries(r.globals).forEach(([name, t]) => {
    console.log(`  ${name}: ${t === 'function' ? 'OK' : 'MISSING'}`);
  });

  console.log('\n=== STORE FUNCTIONS ===');
  Object.entries(r.storeFunctions).forEach(([name, t]) => {
    console.log(`  ${name}: ${t === 'function' ? 'OK' : 'MISSING'}`);
  });

  console.log('\n=== THEME CHECK ===');
  console.log(`  Toggle icon: ${r.themeBtnIcon}`);
  console.log(`  data-theme: ${r.dataTheme || '(none = light)'}`);

  console.log('\n=== ERRORS ===');
  console.log(`  Console: ${errors.length}`);
  if (errors.length) errors.slice(0, 5).forEach(e => console.log('   ', e));
  console.log(`  Page: ${pageErrs.length}`);
  if (pageErrs.length) pageErrs.slice(0, 5).forEach(e => console.log('   ', e));

  const allStoreFuncsOK = Object.values(r.storeFunctions).every(v => v === 'function');
  const passed = allStoresExist && allGlobalsOK && allStoreFuncsOK && errors.length === 0 && pageErrs.length === 0;

  console.log('\n' + (passed ? 'PHASE 2 SELF-AUDIT: ALL CLEAR' : 'PHASE 2 SELF-AUDIT: ISSUES FOUND'));

  await browser.close();
  process.exit(passed ? 0 : 1);
})();
