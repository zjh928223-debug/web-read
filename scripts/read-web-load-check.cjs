const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const targetUrl = process.env.READ_WEB_URL || 'http://127.0.0.1:4173/';
const artifactsDir = path.join(process.cwd(), '.playwright-artifacts');
const screenshotPath = path.join(artifactsDir, 'read-web-load.png');
const reportPath = path.join(artifactsDir, 'read-web-load-report.json');

const expectedGlobals = [
  'ImportExportSharedHelpers',
  'IdentityStorageKeys'
];

async function ensureArtifactsDir() {
  await fs.promises.mkdir(artifactsDir, { recursive: true });
}

async function main() {
  await ensureArtifactsDir();

  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];
  const responseErrors = [];

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 }
  });

  await page.addInitScript(() => {
    window.__readWebStartupLayoutShifts = [];
    if (!('PerformanceObserver' in window)) return;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__readWebStartupLayoutShifts.push({
            startTime: entry.startTime,
            value: entry.value,
            hadRecentInput: entry.hadRecentInput,
            sources: (entry.sources || []).map((source) => ({
              node: source.node instanceof Element
                ? `${source.node.tagName.toLowerCase()}${source.node.id ? `#${source.node.id}` : ''}${source.node.classList.length ? `.${Array.from(source.node.classList).join('.')}` : ''}`
                : null,
              previousRect: source.previousRect,
              currentRect: source.currentRect,
            })),
          });
        }
      });
      observer.observe({ type: 'layout-shift', buffered: true });
    } catch {}
  });

  page.on('console', async (message) => {
    if (message.type() !== 'error') return;
    const location = message.location();
    consoleErrors.push({
      text: message.text(),
      location
    });
  });

  page.on('pageerror', (error) => {
    pageErrors.push({
      name: error.name,
      message: error.message,
      stack: error.stack || ''
    });
  });

  page.on('requestfailed', (request) => {
    requestFailures.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()
    });
  });

  page.on('response', (response) => {
    if (response.status() < 400) return;
    responseErrors.push({
      url: response.url(),
      status: response.status(),
      statusText: response.statusText()
    });
  });

  const gotoResponse = await page.goto(targetUrl, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(1500);

  const symbolStatus = await page.evaluate((symbols) => {
    return symbols.map((name) => ({
      name,
      type: typeof window[name],
      defined: typeof window[name] !== 'undefined'
    }));
  }, expectedGlobals);

  const renderingOwnership = await page.evaluate(() => ({
    vueTranscriptMounted: Boolean(document.querySelector('#transcript-vue-container')),
    vueChunkMounted: Boolean(document.querySelector('#chunk-vue-container')),
    legacyTranscriptHidden: (() => {
      const element = document.getElementById('transcript-container');
      if (!element) return false;
      return element.hidden || getComputedStyle(element).display === 'none';
    })(),
    legacyRenderingFlagDefined: typeof window.__USE_VUE_RENDERING !== 'undefined',
  }));
  const startupLayoutShifts = await page.evaluate(() => (
    Array.isArray(window.__readWebStartupLayoutShifts)
      ? window.__readWebStartupLayoutShifts
      : []
  ));
  const startupLayoutShiftTotal = startupLayoutShifts
    .filter((entry) => !entry.hadRecentInput)
    .reduce((total, entry) => total + entry.value, 0);

  const undefinedSymbols = symbolStatus.filter((item) => !item.defined);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const report = {
    targetUrl,
    ok: consoleErrors.length === 0
      && pageErrors.length === 0
      && requestFailures.length === 0
      && responseErrors.length === 0
      && undefinedSymbols.length === 0
      && renderingOwnership.vueTranscriptMounted
      && renderingOwnership.vueChunkMounted
      && renderingOwnership.legacyTranscriptHidden
      && !renderingOwnership.legacyRenderingFlagDefined
      && startupLayoutShiftTotal < 0.01,
    mainResponse: gotoResponse ? {
      url: gotoResponse.url(),
      status: gotoResponse.status(),
      statusText: gotoResponse.statusText()
    } : null,
    pageTitle: await page.title(),
    consoleErrors,
    pageErrors,
    requestFailures,
    responseErrors,
    symbolStatus,
    undefinedSymbols,
    renderingOwnership,
    startupLayoutShifts,
    startupLayoutShiftTotal,
    screenshotPath
  };

  await fs.promises.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await browser.close();

  if (!report.ok) {
    console.error(`read-web load check failed. Report: ${reportPath}`);
    process.exitCode = 1;
    return;
  }

  console.log(`read-web load check passed. Report: ${reportPath}`);
}

main().catch(async (error) => {
  const fallback = {
    targetUrl,
    ok: false,
    fatalError: {
      name: error.name,
      message: error.message,
      stack: error.stack || ''
    }
  };

  await ensureArtifactsDir();
  await fs.promises.writeFile(reportPath, `${JSON.stringify(fallback, null, 2)}\n`, 'utf8');
  console.error(`read-web load check crashed. Report: ${reportPath}`);
  process.exit(1);
});
