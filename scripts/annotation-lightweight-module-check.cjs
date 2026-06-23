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
  assert.equal(typeof api.exportManualLightweightAnnotations, 'function');
  assert.equal(typeof api.importManualLightweightAnnotations, 'function');
  assert.equal(typeof api.buildImportSuccessMessage, 'function');
  assert.equal(typeof api.initManualLightweightAnnotationControls, 'function');

  assert.equal(
    api.buildImportSuccessMessage({
      importedCount: 3,
      skippedCount: 1,
      ambiguousItems: ['a', 'b'],
      markedTextMismatchTargetIds: ['m'],
    }),
    '轻量回填完成 3 条，跳过 1 条，歧义未导入 2 条，markedText 校验不一致 1 条'
  );

  assert.throws(() => api.exportManualLightweightAnnotations(), /not ready/);
  await assert.rejects(() => api.importManualLightweightAnnotations({}), /not ready/);

  let exported = false;
  let importedFile = null;
  api.configureManualLightweightAnnotationRuntime({
    exportManualLightweightAnnotations: () => {
      exported = true;
      return { ok: true };
    },
    importManualLightweightAnnotations: async (file) => {
      importedFile = file;
      return {
        importedCount: 2,
        skippedCount: 0,
        ambiguousItems: [],
        markedTextMismatchTargetIds: [],
      };
    }
  });

  const exportButton = new FakeElement();
  const importButton = new FakeElement();
  const importInput = new FakeElement();
  const toastCalls = [];
  const errorCalls = [];
  let refreshed = false;
  const file = { name: 'light.json' };

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

  importButton.click();
  assert.equal(importInput.clickCount, 1);
  importInput.value = 'selected-file-path';
  await importInput.dispatch('change', { file, target: importInput });
  assert.equal(importedFile, file);
  assert.equal(importInput.value, '');
  assert.equal(refreshed, true);
  assert.deepEqual(toastCalls, [{ message: '轻量回填完成 2 条', type: 'success' }]);
  assert.deepEqual(errorCalls, []);

  api.configureManualLightweightAnnotationRuntime({
    exportManualLightweightAnnotations: () => ({ ok: true }),
    importManualLightweightAnnotations: async () => {
      throw new Error('bad import');
    }
  });
  await importInput.dispatch('change', { file, target: importInput });
  assert.deepEqual(errorCalls.at(-1), { code: 'ANNOTATION_LIGHT_IMPORT', message: 'bad import' });

  assert.equal(source.includes('__session_exportManualLightweightAnnotations'), false);
  assert.equal(source.includes('__session_importManualLightweightAnnotations'), false);

  console.log('annotation lightweight module check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
