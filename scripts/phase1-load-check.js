const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('http://localhost:5173/', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(2000);

  const result = await page.evaluate(() => ({
    dataUtilsType: typeof window.DataUtils,
    hasHandleBackward: typeof window.handleBackwardClick,
    hasBubble: typeof window.AnnotationBubble,
    hasVueRoot: !!document.querySelector('#vue-root'),
    title: document.title
  }));

  console.log(JSON.stringify({ ...result, consoleErrors: errors }, null, 2));
  await browser.close();

  const ok = result.dataUtilsType === 'object'
    && result.hasHandleBackward === 'function'
    && result.hasBubble === 'object'
    && result.hasVueRoot
    && errors.length === 0;

  console.log(ok ? 'Phase 1 LOAD CHECK PASSED' : 'Phase 1 LOAD CHECK FAILED');
  process.exit(ok ? 0 : 1);
})();
