const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const modulePath = path.join(repoRoot, 'src', 'composables', 'session-annotation-api-settings-runtime.js');
  const sessionInitPath = path.join(repoRoot, 'src', 'composables', 'session-init.js');
  const sessionAssemblyPath = path.join(repoRoot, 'src', 'composables', 'session-runtime-assembly.js');
  const sessionAnnotationRuntimePath = path.join(repoRoot, 'src', 'composables', 'session-annotation-runtime.js');
  const moduleSource = fs.readFileSync(modulePath, 'utf8');
  const sessionInitSource = fs.readFileSync(sessionInitPath, 'utf8');
  const sessionAssemblySource = fs.readFileSync(sessionAssemblyPath, 'utf8');
  const sessionAnnotationRuntimeSource = fs.readFileSync(sessionAnnotationRuntimePath, 'utf8');

  assert.ok(
    sessionInitSource.includes("from './session-runtime-assembly.js';")
      && sessionAssemblySource.includes("from './session-annotation-runtime.js';")
      && sessionAnnotationRuntimeSource.includes("from './session-annotation-api-settings-runtime.js';"),
    'session-init should reach annotation API settings runtime through session-runtime-assembly'
  );
  assert.equal(
    sessionInitSource.includes('function initAnnotationApiSettingsUi()'),
    false,
    'session-init should not keep local API settings initializer'
  );
  assert.ok(moduleSource.includes('export function createSessionAnnotationApiSettingsRuntime'));

  const encodedSource = Buffer.from(moduleSource, 'utf8').toString('base64');
  const api = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);

  let restored = 0;
  let synced = 0;
  let initOptions = null;
  const buttonEl = { hidden: false };
  const panelEl = {};
  const runtime = api.createSessionAnnotationApiSettingsRuntime({
    buttonEl,
    panelEl,
    getAnnotationApiConfigHelper() {
      return {
        restore() {
          restored += 1;
        }
      };
    },
    getAnnotationApiSettingsUiApi() {
      return {
        init(options) {
          initOptions = options;
        }
      };
    },
    syncAnnotationGenerationEntryStatus() {
      synced += 1;
    }
  });
  runtime.initAnnotationApiSettingsUi();
  assert.equal(restored, 1);
  assert.equal(initOptions.buttonEl, buttonEl);
  assert.equal(initOptions.panelEl, panelEl);
  initOptions.onChange();
  assert.equal(synced, 1);

  initOptions = null;
  api.createSessionAnnotationApiSettingsRuntime({
    buttonEl: { hidden: true },
    panelEl,
    getAnnotationApiConfigHelper() {
      throw new Error('should not restore hidden settings UI');
    },
    getAnnotationApiSettingsUiApi() {
      return { init(options) { initOptions = options; } };
    },
    syncAnnotationGenerationEntryStatus() {}
  }).initAnnotationApiSettingsUi();
  assert.equal(initOptions, null);

  console.log('session annotation API settings runtime check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
