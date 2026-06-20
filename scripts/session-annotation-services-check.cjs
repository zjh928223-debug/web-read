const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const modulePath = path.join(repoRoot, 'src', 'composables', 'session-annotation-services.js');
  const sessionInitPath = path.join(repoRoot, 'src', 'composables', 'session-init.js');
  const sessionAssemblyPath = path.join(repoRoot, 'src', 'composables', 'session-runtime-assembly.js');
  const moduleSource = fs.readFileSync(modulePath, 'utf8');
  const sessionInitSource = fs.readFileSync(sessionInitPath, 'utf8');
  const sessionAssemblySource = fs.readFileSync(sessionAssemblyPath, 'utf8');

  assert.ok(
    sessionInitSource.includes("from './session-runtime-assembly.js';")
      && sessionAssemblySource.includes("from './session-annotation-services.js';"),
    'session-init should reach annotation service helpers through session-runtime-assembly'
  );
  [
    'function getAnnotationGenerationStorage()',
    'function getAnnotationGeneratedResultStore()',
    'function getAnnotationTargetSource()',
    'function getAnnotationApiConfigHelper()',
    'function emitAnnotationDiagnostics(event, payload)'
  ].forEach((pattern) => {
    assert.equal(sessionInitSource.includes(pattern), false, `session-init should not keep local helper: ${pattern}`);
  });
  [
    'export function getAnnotationGenerationStorage',
    'export function getAnnotationGeneratedResultStore',
    'export function getAnnotationTargetSource',
    'export function getAnnotationApiConfigHelper',
    'export function emitAnnotationDiagnostics'
  ].forEach((pattern) => {
    assert.ok(moduleSource.includes(pattern), `session-annotation-services should export ${pattern}`);
  });
  assert.equal(moduleSource.includes('document.'), false, 'session annotation service helpers should not read document globals');

  const encodedSource = Buffer.from(moduleSource, 'utf8').toString('base64');
  const api = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);

  const globalObject = {
    AnnotationGenerationStorage: { id: 'storage' },
    AnnotationBlockPlanner: { id: 'planner' },
    AnnotationPromptBuilder: { id: 'prompt' },
    AnnotationGeneratedResultStore: { id: 'store' },
    AnnotationClickResolver: { id: 'click' },
    AnnotationTargetSource: { id: 'target' },
    AnnotationApiConfig: { id: 'config' },
    AnnotationGenerationDiagnostics: {
      calls: [],
      emit(event, payload) {
        this.calls.push({ event, payload });
      }
    }
  };

  assert.equal(api.getAnnotationGenerationStorage(globalObject), globalObject.AnnotationGenerationStorage);
  assert.equal(api.getAnnotationBlockPlanner(globalObject), globalObject.AnnotationBlockPlanner);
  assert.equal(api.getAnnotationPromptBuilder(globalObject), globalObject.AnnotationPromptBuilder);
  assert.equal(api.getAnnotationGeneratedResultStore(globalObject), globalObject.AnnotationGeneratedResultStore);
  assert.equal(api.getAnnotationClickResolver(globalObject), globalObject.AnnotationClickResolver);
  assert.equal(api.getAnnotationTargetSource(globalObject), globalObject.AnnotationTargetSource);
  assert.equal(api.getAnnotationApiConfigHelper(globalObject), globalObject.AnnotationApiConfig);
  assert.equal(api.getAnnotationGenerationDiagnostics(globalObject), globalObject.AnnotationGenerationDiagnostics);
  assert.equal(api.getAnnotationGenerationStorage({}), null);

  api.emitAnnotationDiagnostics('event.a', { ok: true }, { globalObject });
  assert.deepEqual(globalObject.AnnotationGenerationDiagnostics.calls, [
    { event: 'event.a', payload: { ok: true } }
  ]);

  const injectedDiagnostics = {
    calls: [],
    emit(event, payload) {
      this.calls.push([event, payload]);
    }
  };
  api.emitAnnotationDiagnostics('event.b', { injected: true }, {
    getAnnotationGenerationDiagnostics() {
      return injectedDiagnostics;
    }
  });
  assert.deepEqual(injectedDiagnostics.calls, [['event.b', { injected: true }]]);

  assert.doesNotThrow(() => {
    api.emitAnnotationDiagnostics('event.c', { missing: true }, { globalObject: {} });
  });

  console.log('session annotation services check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
