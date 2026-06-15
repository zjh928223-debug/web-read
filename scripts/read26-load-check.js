const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const targetUrl = process.env.READ_WEB_URL || process.env.READ26_URL || 'http://127.0.0.1:4173/';
const artifactsDir = path.join(process.cwd(), '.playwright-artifacts');
const screenshotPath = path.join(artifactsDir, 'read-web-load.png');
const reportPath = path.join(artifactsDir, 'read-web-load-report.json');

const expectedGlobals = [
  'ImportExportSharedHelpers',
  'IdentityStorageKeys',
  'SentenceNotesPersistenceUtils'
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

  const undefinedSymbols = symbolStatus.filter((item) => !item.defined);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const report = {
    targetUrl,
    ok: consoleErrors.length === 0
      && pageErrors.length === 0
      && requestFailures.length === 0
      && responseErrors.length === 0
      && undefinedSymbols.length === 0,
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
