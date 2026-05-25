const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const host = '127.0.0.1';
const port = 4173;
const targetUrl = `http://${host}:${port}/`;

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
    if (await canReach(url)) {
      return true;
    }
    await wait(500);
  }
  return false;
}

function runLoadCheck() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join('scripts', 'read26-load-check.js')], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: {
        ...process.env,
        READ26_URL: targetUrl
      }
    });

    child.on('exit', (code) => resolve(code || 0));
    child.on('error', () => resolve(1));
  });
}

async function main() {
  let serverProcess = null;

  try {
    const alreadyRunning = await canReach(targetUrl);
    if (!alreadyRunning) {
      serverProcess = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
        cwd: process.cwd(),
        stdio: 'ignore',
        windowsHide: true,
        shell: true
      });

      const ready = await waitForServer(targetUrl);
      if (!ready) {
        throw new Error(`Vite preview server did not start at ${targetUrl}`);
      }
    }

    const exitCode = await runLoadCheck();
    process.exitCode = exitCode;
  } finally {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill();
    }
  }
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
