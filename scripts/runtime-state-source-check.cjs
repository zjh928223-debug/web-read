const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const composablesDir = path.join(repoRoot, 'src', 'composables');
const runtimeStateFacadePath = path.join(composablesDir, 'runtime-state-facade.js');
const runtimeStateFacadeSource = fs.readFileSync(runtimeStateFacadePath, 'utf8');

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(fullPath);
    return entry.isFile() && entry.name.endsWith('.js') ? [fullPath] : [];
  });
}

listFiles(composablesDir).forEach((filePath) => {
  if (filePath === runtimeStateFacadePath) return;
  const source = fs.readFileSync(filePath, 'utf8');
  assert.equal(
    source.includes('window.__state'),
    false,
    `${path.relative(repoRoot, filePath)} should not read window.__state`
  );
});

assert.ok(
  runtimeStateFacadeSource.includes('export const runtimeState = {};'),
  'runtime-state-facade should own the runtimeState object'
);

assert.ok(
  runtimeStateFacadeSource.includes('window.__state = runtimeState;'),
  'runtime-state-facade should expose runtimeState only as the temporary window.__state facade'
);

assert.equal(
  /state:\s*window\.__state/.test(appSource),
  false,
  'app.js should inject runtimeState instead of window.__state into runtime modules'
);

console.log('runtime state source check passed');
