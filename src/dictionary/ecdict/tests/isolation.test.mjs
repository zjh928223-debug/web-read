import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
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

test('has no integration import from current reader or SRS business entry points', () => {
  const isolatedBusinessFiles = [
    'src/main.js',
    'src/App.vue',
    'src/srs-review-main.js',
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
