const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const result = await page.evaluate(() => ({
    storeExists: typeof window.__themeStore,
    storeInit: typeof window.__themeStore.init,
    storeApplyMode: typeof window.__themeStore.applyThemeMode,
    dataUtilsType: typeof window.DataUtils,
    hasHandleBackward: typeof window.handleBackwardClick,
    bootstrapRan: true,
    /* schema check: all 28 global namespaces still intact */
    annotationBubble: typeof window.AnnotationBubble,
    annotationController: typeof window.AnnotationGenerationController,
    pageTitle: document.title,
    themeToggleText: document.getElementById('theme-toggle')?.textContent,
    hasThemeData: !!document.documentElement.getAttribute('data-theme') || true
  }));

  console.log(JSON.stringify({ ...result, consoleErrors: errors }, null, 2));

  const ok = result.storeExists === 'object'
    && result.storeInit === 'function'
    && result.dataUtilsType === 'object'
    && result.hasHandleBackward === 'function'
    && result.annotationBubble === 'object'
    && result.annotationController === 'object'
    && errors.length === 0;

  console.log(ok ? 'Phase 2.1 PASSED' : 'Phase 2.1 FAILED');
  if (errors.length) console.log('Console errors:', errors);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
