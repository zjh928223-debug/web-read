const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [], pageErrs = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().substring(0, 120)); });
  page.on('pageerror', e => pageErrs.push(e.message.substring(0, 120)));

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // 1. Flag and globals
  const r1 = await page.evaluate(() => ({
    flag: window.__USE_VUE_RENDERING,
    hasBackward: typeof window.handleBackwardClick === 'function',
    hasForward: typeof window.handleForwardClick === 'function',
    hasSpeed: typeof window.changeSpeed === 'function',
    hasChunkTgl: typeof window.toggleChunkMode === 'function',
    hasDataUtil: typeof window.DataUtils === 'object',
    hasBubble: typeof window.AnnotationBubble === 'object',
  }));

  console.log('1. FLAG: ' + (r1.flag === false ? 'PASS (false)' : 'FAIL'));
  console.log('2. GLOBALS: ' + (r1.hasBackward && r1.hasForward && r1.hasSpeed && r1.hasChunkTgl && r1.hasDataUtil && r1.hasBubble ? 'PASS' : 'FAIL'));

  const ok = r1.flag === false
    && r1.hasBackward && r1.hasForward && r1.hasSpeed && r1.hasChunkTgl && r1.hasDataUtil && r1.hasBubble
    && r2.theme && r2.ui && r2.audio
    && r3 === 'Phase4'
    && r4.hasData && r4.itemsArr && r4.checkFn
    && r5.vueTranscript === null && r5.vueChunk === null && r5.oldTranscript
    && r6.storePasses && r6.showToastAccepts && r6.showError3800
    && errors.length === 0 && pageErrs.length === 0;

  console.log('\n' + (ok ? 'PHASE 4 SELF-AUDIT: ALL CLEAR' : 'PHASE 4 SELF-AUDIT: ISSUES FOUND'));

  await browser.close();
  process.exit(ok ? 0 : 1);
})();
