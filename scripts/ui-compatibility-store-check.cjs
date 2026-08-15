const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { chromium } = require('playwright');

const host = '127.0.0.1';

async function main() {
  let serverProcess = null;
  const explicitUrl = process.env.READ_WEB_URL;
  const port = explicitUrl ? null : await findFreePort();
  const targetUrl = explicitUrl || `http://${host}:${port}/`;
  const consoleErrors = [];
  const pageErrors = [];

  try {
    if (!explicitUrl) {
      const viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
      serverProcess = spawn(process.execPath, [
        viteBin,
        '--host', host,
        '--port', String(port),
        '--strictPort',
        '--clearScreen', 'false'
      ], {
        cwd: process.cwd(),
        stdio: 'ignore',
        windowsHide: true
      });
      assert.equal(await waitForServer(targetUrl), true, `Vite did not become ready at ${targetUrl}`);
    }

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === host) return route.continue();
      return route.fulfill({ status: 204, body: '' });
    });
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const response = await page.goto(targetUrl, { waitUntil: 'load', timeout: 30_000 });
    assert.ok(response && response.status() < 400, `reader startup returned ${response && response.status()}`);
    await page.waitForFunction(() => Boolean(window.__piniaStores?.ui && typeof window.showToast === 'function'));

    const initial = await page.evaluate(() => ({
      legacyUiStoreType: typeof window.__uiStore,
      hasLegacyUiStore: Object.prototype.hasOwnProperty.call(window, '__uiStore'),
      piniaUiStore: Boolean(window.__piniaStores && window.__piniaStores.ui),
      showToastType: typeof window.showToast,
      showErrorType: typeof window.showError
    }));
    assert.equal(initial.legacyUiStoreType, 'undefined');
    assert.equal(initial.hasLegacyUiStore, false);
    assert.equal(initial.piniaUiStore, true);
    assert.equal(initial.showToastType, 'function');
    assert.equal(initial.showErrorType, 'function');

    await page.evaluate(() => window.showToast('UI compatibility boundary behavior', 'info', 0));
    await page.waitForFunction(() => document.querySelector('#app-toast')?.textContent.includes('UI compatibility boundary behavior'));
    const toastText = await page.locator('#app-toast').textContent();
    assert.match(toastText || '', /UI compatibility boundary behavior/);

    await page.evaluate(() => window.showError('UI_COMPATIBILITY_CHECK', 'Pinia owner')); 
    await page.waitForFunction(() => document.querySelector('#app-toast')?.textContent.includes('Error [UI_COMPATIBILITY_CHECK]'));
    const errorText = await page.locator('#app-toast').textContent();
    assert.match(errorText || '', /Error \[UI_COMPATIBILITY_CHECK\]/);

    assert.deepEqual(consoleErrors, [], `UI compatibility behavior emitted console errors: ${consoleErrors.join(' | ')}`);
    assert.deepEqual(pageErrors, [], `UI compatibility behavior emitted page errors: ${pageErrors.join(' | ')}`);
    await browser.close();
    console.log(`UI compatibility store behavior passed at ${targetUrl}`);
  } finally {
    if (serverProcess) killProcessTree(serverProcess);
  }
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function canReach(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    request.on('error', () => resolve(false));
    request.setTimeout(1_000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(url, timeoutMs = 20_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await canReach(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function killProcessTree(child) {
  if (!child || child.killed) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
}

main().catch((error) => {
  console.error(`UI compatibility store behavior failed: ${error.message || error}`);
  process.exitCode = 1;
});
