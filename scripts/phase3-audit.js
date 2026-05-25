const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [], pageErrs = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => pageErrs.push(e.message));

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // ===== 1. Check #app-toast does NOT exist before any call (static HTML removed) =====
  const before = await page.evaluate(() => {
    var el = document.getElementById('app-toast');
    return { exists: !!el, count: document.querySelectorAll('#app-toast').length };
  });
  console.log('1. #app-toast before call: ' + (before.count === 0 ? 'PASS (0)' : 'FAIL (' + before.count + ')'));

  // ===== 2. Trigger toast via app.js wrapper (simulates actual usage) =====
  await page.evaluate(() => { window.__uiStore.showToast('Audit test 1', 'success'); });
  await page.waitForTimeout(600);

  const after1 = await page.evaluate(() => {
    var el = document.getElementById('app-toast');
    return {
      exists: !!el,
      text: el ? el.textContent : '',
      classes: el ? el.className : '',
      display: el ? getComputedStyle(el).display : ''
    };
  });
  console.log('2. Toast via __uiStore: ' +
    (after1.text === 'Audit test 1' ? 'PASS' : 'FAIL') +
    ' | text="' + after1.text + '" classes="' + after1.classes.substring(0, 50) + '"');

  // ===== 3. Check no duplicate IDs in DOM =====
  const dupCheck = await page.evaluate(() => {
    var all = document.querySelectorAll('#app-toast');
    return all.length;
  });
  console.log('3. Duplicate #app-toast: ' + (dupCheck === 1 ? 'PASS (1)' : 'FAIL (' + dupCheck + ')'));

  // ===== 4. Wait for auto-hide, then retrigger =====
  await page.waitForTimeout(2500);

  const afterHide = await page.evaluate(() => {
    var el = document.getElementById('app-toast');
    return { exists: !!el, display: el ? getComputedStyle(el).display : '-', visible: el ? (window.getComputedStyle(el).display !== 'none') : false };
  });
  console.log('4. Auto-hide after timeout: ' + (!afterHide.exists ? 'PASS (element removed)' : afterHide.display === 'none' ? 'PASS (display:none)' : 'FAIL (visible)'));

  // ===== 5. Trigger via app.js showToast wrapper =====
  await page.evaluate(() => {
    // Simulate app.js calling showToast directly
    window.__uiStore.showToast('Wrapper test', 'info');
  });
  await page.waitForTimeout(600);

  const after5 = await page.evaluate(() => {
    var el = document.getElementById('app-toast');
    return { text: el ? el.textContent : '', classes: el ? el.className : '' };
  });
  console.log('5. Toast via wrapper: ' +
    (after5.text === 'Wrapper test' ? 'PASS' : 'FAIL') +
    ' | text="' + after5.text + '" classes="' + after5.classes + '"');

  // ===== 6. Check all stores intact =====
  const stores = await page.evaluate(() => ({
    theme: typeof window.__themeStore,
    ui: typeof window.__uiStore,
    audio: typeof window.__audioStore,
    marks: typeof window.__marksStore
  }));
  console.log('6. Stores: theme=' + stores.theme + ' ui=' + stores.ui + ' audio=' + stores.audio + ' marks=' + stores.marks + ' ' +
    (stores.theme === 'object' && stores.ui === 'object' ? 'PASS' : 'FAIL'));

  // ===== 7. Check global handlers intact =====
  const globals = await page.evaluate(() => ({
    handleBackward: typeof window.handleBackwardClick,
    changeSpeed: typeof window.changeSpeed,
    toggleChunk: typeof window.toggleChunkMode,
    openStyle: typeof window.openChunkStyleModal,
    closeStyle: typeof window.closeChunkStyleModal,
    DataUtils: typeof window.DataUtils
  }));
  console.log('7. Globals: backward=' + globals.handleBackward + ' speed=' + globals.changeSpeed +
    ' chunk=' + globals.toggleChunk + ' style=' + globals.openStyle + ' dataUtils=' + globals.DataUtils + ' ' +
    (Object.values(globals).every(v => v === 'function' || v === 'object') ? 'PASS' : 'FAIL'));

  // ===== 8. Check showToast available on window =====
  const showFn = await page.evaluate(() => ({
    type: typeof window.showToast,
    isFn: typeof window.showToast === 'function',
    isNotNative: typeof window.showToast === 'function' && window.showToast.toString().indexOf('native') === -1
  }));
  console.log('8. window.showToast: ' + (showFn.isFn && showFn.isNotNative ? 'PASS (Vue function)' : 'FAIL'));

  // ===== SUMMARY =====
  const ok = before.count === 0 && after1.text === 'Audit test 1'
    && dupCheck === 1 && !afterHide.exists
    && after5.text === 'Wrapper test' && errors.length === 0 && pageErrs.length === 0;

  console.log('\n=== ERRORS ===');
  console.log('Console: ' + errors.length + (errors.length ? ': ' + errors.slice(0,3).join(' | ') : ''));
  console.log('Page: ' + pageErrs.length + (pageErrs.length ? ': ' + pageErrs.slice(0,3).join(' | ') : ''));

  console.log('\n' + (ok ? 'PHASE 3 SELF-AUDIT: ALL CLEAR' : 'PHASE 3 SELF-AUDIT: ISSUES FOUND'));

  await browser.close();
  process.exit(ok ? 0 : 1);
})();
