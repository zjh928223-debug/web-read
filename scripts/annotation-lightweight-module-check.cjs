const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeElement {
  constructor() {
    this.value = '';
    this.listeners = {};
    this.clickCount = 0;
  }

  addEventListener(type, handler) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(handler);
  }

  click() {
    this.clickCount += 1;
    this.dispatch('click', { target: this });
  }

  async dispatch(type, event) {
    const handlers = this.listeners[type] || [];
    for (const handler of handlers) {
      await handler(event || { target: this });
    }
  }
}

const repoRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(repoRoot, 'src', 'composables', 'annotation-lightweight-module.js');
const source = fs.readFileSync(sourcePath, 'utf8');

async function main() {
  const sandbox = {
    window: {},
    console,
  };

  vm.runInNewContext(source, sandbox, { filename: sourcePath });

  const api = sandbox.window.__annotationLightweightModule;
  assert.ok(api, 'annotation lightweight module should attach to window');
  assert.equal(typeof api.configureManualLightweightAnnotationRuntime, 'function');
  assert.equal(typeof api.buildManualLightweightAnnotationTemplate, 'function');
  assert.equal(typeof api.exportManualLightweightAnnotations, 'function');
  assert.equal(typeof api.importManualLightweightAnnotations, 'function');
  assert.equal(api.buildImportSuccessMessage, undefined);
  assert.equal(typeof api.initManualLightweightAnnotationControls, 'function');


  assert.throws(() => api.exportManualLightweightAnnotations(), /not ready/);
  assert.throws(() => api.buildManualLightweightAnnotationTemplate(), /not ready/);
  await assert.rejects(() => api.importManualLightweightAnnotations({}), /not ready/);

  let exported = false;
  let templateBuilt = false;
  let importedFile = null;
  let importedOptions = null;
  api.configureManualLightweightAnnotationRuntime({
    buildManualLightweightAnnotationTemplate: () => {
      templateBuilt = true;
      return { articleId: 'template-only', items: [] };
    },
    exportManualLightweightAnnotations: () => {
      exported = true;
      return { ok: true };
    },
    importManualLightweightAnnotations: async (file, options) => {
      importedFile = file;
      importedOptions = options;
      return {
        importedCount: 2,
        skippedCount: 0,
        ambiguousItems: [],
        markedTextMismatchTargetIds: [],
      };
    }
  });

  assert.deepEqual(api.buildManualLightweightAnnotationTemplate(), { articleId: 'template-only', items: [] });
  assert.equal(templateBuilt, true);

  const exportButton = new FakeElement();
  const importButton = new FakeElement();
  const importInput = new FakeElement();
  const toastCalls = [];
  const errorCalls = [];
  let refreshed = false;
  const file = { name: 'light.json' };

  const incrementalOptions = { replaceExisting: false };
  await api.importManualLightweightAnnotations(file, incrementalOptions);
  assert.equal(importedFile, file);
  assert.equal(importedOptions, incrementalOptions, 'import facade should forward the options object unchanged');

  api.initManualLightweightAnnotationControls({
    exportButton,
    importButton,
    importInput,
    getFirstFileFromEvent: (event) => event.file || null,
    refreshAfterImport: () => {
      refreshed = true;
    },
    showToast: (message, type) => {
      toastCalls.push({ message, type });
    },
    showError: (code, message) => {
      errorCalls.push({ code, message });
    },
  });

  exportButton.click();
  assert.equal(exported, true);

  assert.deepEqual(importButton.listeners, {});
  assert.deepEqual(importInput.listeners, {});
  importButton.click();
  assert.equal(importInput.clickCount, 0, 'retired button must not open a file picker');
  importInput.value = 'selected-file-path';
  await importInput.dispatch('change', { file, target: importInput });
  assert.equal(importInput.value, 'selected-file-path');
  assert.equal(refreshed, false);
  assert.deepEqual(toastCalls, []);
  assert.deepEqual(errorCalls, []);

  api.configureManualLightweightAnnotationRuntime({
    exportManualLightweightAnnotations: () => { throw new Error('bad export'); },
    importManualLightweightAnnotations: async () => {
      throw new Error('bad import');
    }
  });
  await assert.rejects(() => api.importManualLightweightAnnotations(file), /bad import/);
  exportButton.click();
  assert.deepEqual(errorCalls.at(-1), { code: 'ANNOTATION_LIGHT_EXPORT', message: 'bad export' });

  assert.equal(source.includes('__session_exportManualLightweightAnnotations'), false);
  assert.equal(source.includes('__session_importManualLightweightAnnotations'), false);

  console.log('annotation lightweight module check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
