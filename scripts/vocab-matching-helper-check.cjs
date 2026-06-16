const http = require('http');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');

const host = '127.0.0.1';
const port = Number(process.env.READ_WEB_PORT || 4173);
const targetUrl = process.env.READ_WEB_URL || `http://${host}:${port}/`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canReach(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });

    request.on('error', () => resolve(false));
    request.setTimeout(1500, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await canReach(url)) return true;
    await wait(500);
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

function assert(condition, message, details) {
  if (condition) return;
  const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
  throw new Error(`${message}${suffix}`);
}

async function runBrowserCheck() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 640 } });
    await page.goto(targetUrl, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(
      () => typeof window.processTranscript === 'function',
      null,
      { timeout: 10000 }
    );

    const result = await page.evaluate(() => {
      const helper = window.VocabMatchingHelpers;
      if (!helper || typeof helper.buildVocabMatchMap !== 'function') {
        return { ok: false, reason: 'missing buildVocabMatchMap helper' };
      }

      const vocabIceCream = {
        word: 'ice cream',
        match_context: 'love ice cream',
        meaning: 'dessert'
      };
      const vocabToday = {
        word: 'today',
        meaning: 'date word'
      };
      const words = [
        { word: 'I' },
        { word: 'love' },
        { word: 'ice' },
        { word: 'cream' },
        { word: 'today' }
      ];
      const map = helper.buildVocabMatchMap(words, [vocabIceCream, vocabToday]);
      return {
        ok: true,
        entries: Array.from(map.entries()).map(([index, value]) => ({
          index,
          word: value && value.data ? value.data.word : '',
          group: value && Array.isArray(value.group) ? value.group : []
        }))
      };
    });

    assert(result.ok, 'vocab matching helper is not available', result);

    const byIndex = new Map(result.entries.map((entry) => [entry.index, entry]));
    assert(result.entries.length === 3, 'expected exactly three matched vocab entries', result);
    assert(byIndex.get(2) && byIndex.get(2).word === 'ice cream', 'expected index 2 to match ice cream', result);
    assert(byIndex.get(3) && byIndex.get(3).word === 'ice cream', 'expected index 3 to match ice cream', result);
    assert(byIndex.get(4) && byIndex.get(4).word === 'today', 'expected index 4 to match today', result);
    assert(
      JSON.stringify(byIndex.get(2).group) === JSON.stringify([2, 3])
        && JSON.stringify(byIndex.get(3).group) === JSON.stringify([2, 3]),
      'expected multi-word target entries to share the full group',
      result
    );
  } finally {
    await browser.close();
  }
}

async function main() {
  let serverProcess = null;
  const alreadyRunning = await canReach(targetUrl);

  try {
    if (!alreadyRunning) {
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

      const ready = await waitForServer(targetUrl);
      if (!ready) throw new Error(`Vite server did not start at ${targetUrl}`);
    }

    await runBrowserCheck();
    console.log('vocab matching helper check passed');
  } finally {
    if (serverProcess) killProcessTree(serverProcess);
  }
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
