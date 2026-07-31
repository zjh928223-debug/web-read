import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { readEcdictConfig } from '../application/ecdict-config.mjs';
import { createEcdictService } from '../application/ecdict-service.mjs';

const projectRoot = resolve(import.meta.dirname, '..', '..', '..', '..');

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

test('business modules never import ECDICT infrastructure or node:sqlite', () => {
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
      /ecdict-repository|sqlite-connection|application[/\\]ecdict-service|node:sqlite/i,
      file,
    );
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
