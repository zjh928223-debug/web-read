import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import test from 'node:test';
import { babelParse, parse as parseVue } from 'vue/compiler-sfc';

import { readEcdictConfig } from '../application/ecdict-config.mjs';
import { createEcdictService } from '../application/ecdict-service.mjs';

const projectRoot = resolve(import.meta.dirname, '..', '..', '..', '..');
const serverOnlyFiles = new Set([
  resolve(projectRoot, 'src/services/vocabulary/sentence-translation-service.mjs'),
  resolve(projectRoot, 'src/services/vocabulary/sentence-translation-vite-plugin.mjs'),
]);
const ecdictInfrastructure = /ecdict-repository|sqlite-connection|application[/\\]ecdict-service/i;

// Check local source dependencies without executing browser code or Node services.
function assertBrowserBoundary(entries, overrides = new Map()) {
  const pending = [...entries];
  const visited = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    assert.ok(!serverOnlyFiles.has(file), `Browser imports Node-only service: ${file}`);
    const source = overrides.get(file) ?? readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /node:sqlite/i, `Browser imports node:sqlite: ${file}`);
    assert.doesNotMatch(source, ecdictInfrastructure, `Browser imports ECDICT infrastructure: ${file}`);
    const scripts = extname(file) === '.vue'
      ? (() => {
        const { descriptor, errors } = parseVue(source, { filename: file });
        assert.deepEqual(errors, [], file);
        return [descriptor.script, descriptor.scriptSetup].filter(Boolean);
      })()
      : [{ content: source }];
    const imports = scripts.flatMap((script) => {
      const names = script.src ? [script.src] : [];
      const nodes = [babelParse(script.content, {
        sourceType: 'module', createImportExpressions: true,
        plugins: script.lang === 'ts' ? ['typescript'] : [],
      })];
      while (nodes.length) {
        const node = nodes.pop();
        if (/^(ImportDeclaration|ExportNamedDeclaration|ExportAllDeclaration|ImportExpression)$/.test(node.type)
          && typeof node.source?.value === 'string') names.push(node.source.value);
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) nodes.push(...value.filter((item) => item?.type));
          else if (value?.type) nodes.push(value);
        }
      }
      return names;
    });
    for (const specifier of imports) {
      if (!/^(\.|\/src\/|@\/)/.test(specifier)) continue;
      const base = specifier.startsWith('@/') ? resolve(projectRoot, 'src', specifier.slice(2))
        : specifier.startsWith('/src/') ? resolve(projectRoot, specifier.slice(1))
          : resolve(dirname(file), specifier);
      const dependency = [base, ...['.js', '.mjs', '.vue', '/index.js'].map((suffix) => base + suffix)]
        .find((candidate) => overrides.has(candidate) || (existsSync(candidate) && statSync(candidate).isFile()));
      assert.ok(dependency, `Unresolved browser import ${specifier} in ${file}`);
      if (/\.(js|mjs|vue)$/.test(dependency)) pending.push(dependency);
    }
  }
}

test('defaults the ECDICT feature flag to disabled', () => {
  assert.deepEqual(readEcdictConfig({}), {
    enabled: false,
    databasePath: undefined,
  });
  assert.equal(readEcdictConfig({ ECDICT_ENABLED: 'TRUE' }).enabled, false);
  assert.equal(readEcdictConfig({ ECDICT_ENABLED: 'true' }).enabled, true);
});

test('core vocabulary and scheduler modules do not import ECDICT', () => {
  const isolatedBusinessFiles = [
    'src/main.js',
    'src/services/vocabulary/vocabulary-models.js',
    'src/services/vocabulary/vocabulary-repository.js',
    'src/services/vocabulary/vocabulary-service.js',
    'src/services/vocabulary/srs-scheduler.js',
  ];
  for (const relativePath of isolatedBusinessFiles) {
    const source = readFileSync(join(projectRoot, relativePath), 'utf8');
    assert.doesNotMatch(source, /dictionary[/\\]ecdict|from\s+['"][^'"]*ecdict/i, relativePath);
  }
});

test('business modules never import ECDICT infrastructure; only the Node translation service may use SQLite', () => {
  const roots = [
    join(projectRoot, 'src', 'services', 'vocabulary'),
    join(projectRoot, 'src', 'features', 'srs-review'),
    join(projectRoot, 'src', 'composables'),
  ];
  const files = roots.flatMap((root) => readdirSync(root, {
    recursive: true,
    withFileTypes: true,
  }).filter((entry) => entry.isFile() && /\.(?:js|mjs|vue)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name)));
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(
      source,
      ecdictInfrastructure,
      file,
    );
    // This service owns a separate translation cache, not the ECDICT database.
    if (file !== resolve(projectRoot, 'src/services/vocabulary/sentence-translation-service.mjs')) {
      assert.doesNotMatch(source, /node:sqlite/i, file);
    }
  }

  for (const relativePath of ['src/App.vue', 'src/srs-review-main.js']) {
    const source = readFileSync(join(projectRoot, relativePath), 'utf8');
    assert.doesNotMatch(
      source,
      /ecdict-repository|sqlite-connection|application[/\\]ecdict-service|node:sqlite/i,
      relativePath,
    );
  }
});

test('reader and standalone SRS browser dependency graphs exclude Node services and SQLite', () => {
  const html = readFileSync(join(projectRoot, 'index.html'), 'utf8');
  const entries = [...html.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/g)]
    .map((match) => resolve(projectRoot, match[1].replace(/^\//, '')));
  assert.ok(entries.includes(resolve(projectRoot, 'src/main.js')));
  assertBrowserBoundary([...entries, resolve(projectRoot, 'src/srs-review-main.js')]);
});

test('browser boundary rejects SQLite, ECDICT infrastructure and transitive Node service imports', () => {
  const entry = resolve(projectRoot, 'src/boundary-fixture.js');
  const barrel = resolve(projectRoot, 'src/boundary-barrel.js');
  for (const source of [
    "import { DatabaseSync } from 'node:sqlite'",
    "import './dictionary/ecdict/infrastructure/ecdict-repository.mjs'",
    "import './services/vocabulary/sentence-translation-service.mjs'",
    "import('./boundary-barrel.js')",
  ]) {
    assert.throws(() => assertBrowserBoundary([entry], new Map([
      [entry, source],
      [barrel, "export * from './services/vocabulary/sentence-translation-vite-plugin.mjs'"],
    ])), /Browser imports (node:sqlite|ECDICT infrastructure|Node-only service)/);
  }
});

test('an independent sentinel business database is untouched by disabled lookup', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ecdict-isolation-'));
  try {
    const businessDatabase = join(directory, 'app.db');
    writeFileSync(businessDatabase, 'sentinel business data', 'utf8');
    const before = {
      bytes: readFileSync(businessDatabase),
      modified: statSync(businessDatabase).mtimeMs,
    };
    const service = createEcdictService({
      enabled: false,
      databasePath: join(directory, 'ecdict.sqlite'),
    });
    await service.lookup('look');
    service.close();

    const after = {
      bytes: readFileSync(businessDatabase),
      modified: statSync(businessDatabase).mtimeMs,
    };
    assert.deepEqual(after.bytes, before.bytes);
    assert.equal(after.modified, before.modified);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
