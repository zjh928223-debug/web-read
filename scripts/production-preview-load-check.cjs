const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');

const host = '127.0.0.1';
const port = Number(process.env.READ_WEB_PREVIEW_PORT || 4173);
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

function runLoadCheck() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join('scripts', 'read26-load-check.cjs')], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: {
        ...process.env,
        READ_WEB_URL: targetUrl
      }
    });

    child.on('exit', (code) => resolve(code || 0));
    child.on('error', () => resolve(1));
  });
}

async function main() {
  let serverProcess = null;
  const alreadyRunning = await canReach(targetUrl);

  try {
    if (!alreadyRunning) {
      const viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
      serverProcess = spawn(process.execPath, [
        viteBin,
        'preview',
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
      if (!ready) throw new Error(`Vite preview server did not start at ${targetUrl}`);
    }

    process.exitCode = await runLoadCheck();
  } finally {
    if (serverProcess) killProcessTree(serverProcess);
  }
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
