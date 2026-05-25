const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const r = await page.evaluate(() => ({
    uiStoreType: typeof window.__uiStore,
    themeStoreType: typeof window.__themeStore,
    showToastFn: typeof window.__uiStore.showToast,
    allGlobals: {
      DataUtils: typeof window.DataUtils,
      handleBackwardClick: typeof window.handleBackwardClick,
      AnnotationBubble: typeof window.AnnotationBubble,
      AnnotationGenerationController: typeof window.AnnotationGenerationController
    },
    themeToggle: document.getElementById('theme-toggle')?.textContent
  }));

  console.log(JSON.stringify({ ...r, errors }, null, 2));
  const ok = r.uiStoreType === 'object' && r.themeStoreType === 'object'
    && r.showToastFn === 'function' && r.allGlobals.DataUtils === 'object'
    && r.allGlobals.handleBackwardClick === 'function'
    && errors.length === 0;

  console.log(ok ? 'Phase 2.2 PASSED' : 'Phase 2.2 FAILED');
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
