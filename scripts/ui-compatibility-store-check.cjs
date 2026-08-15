const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { chromium } = require('playwright');

const host = '127.0.0.1';
const reservedPorts = new Set([5173, 8765]);

function normalizeTargetUrl(value) {
  const url = new URL(value);
  assert.equal(url.protocol, 'http:', 'UI compatibility check requires an isolated HTTP origin');
  assert.equal(url.hostname, host, `UI compatibility check requires ${host}`);
  const port = Number(url.port || 80);
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, 'UI compatibility check requires an explicit valid port');
  assert.equal(reservedPorts.has(port), false, `UI compatibility check refuses reserved daily port ${port}`);
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.toString();
}

async function main() {
  assert.throws(() => normalizeTargetUrl('http://127.0.0.1:5173/'), /reserved daily port/);
  assert.throws(() => normalizeTargetUrl('http://127.0.0.1:8765/'), /reserved daily port/);
  assert.throws(() => normalizeTargetUrl('http://localhost:4193/'), /requires 127\.0\.0\.1/);
  let serverProcess = null;
  const explicitUrl = process.env.READ_WEB_URL;
  const port = explicitUrl ? null : await findFreePort();
  const targetUrl = normalizeTargetUrl(explicitUrl || `http://${host}:${port}/`);
  const targetOrigin = new URL(targetUrl).origin;
  const targetPort = Number(new URL(targetUrl).port);
  const backendPort = await findFreePort(new Set([targetPort]));
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
        env: {
          ...process.env,
          READ_WEB_FRONTEND_HOST: host,
          READ_WEB_FRONTEND_PORT: String(port),
          READ_WEB_BACKEND_HOST: host,
          READ_WEB_BACKEND_PORT: String(backendPort),
          READ_WEB_SUBTITLE_DATA_ROOT: path.join(os.tmpdir(), `read-web-ui-compat-${process.pid}`),
          VITE_LOCAL_SERVICE_BASE_URL: `http://${host}:${backendPort}`,
          VITE_READ_WEB_SERVICE_TOKEN: 'ui-compatibility-isolated-token',
          ECDICT_ENABLED: 'false'
        },
        stdio: 'ignore',
        windowsHide: true
      });
      assert.equal(await waitForServer(targetUrl), true, `Vite did not become ready at ${targetUrl}`);
    }

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === targetOrigin && !url.pathname.startsWith('/api/')) return route.continue();
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
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

function findFreePort(excluded = new Set()) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else if (excluded.has(port) || reservedPorts.has(port)) resolve(findFreePort(excluded));
        else resolve(port);
      });
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

if (require.main === module) main().catch((error) => {
  console.error(`UI compatibility store behavior failed: ${error.message || error}`);
  process.exitCode = 1;
});

module.exports = { normalizeTargetUrl };
