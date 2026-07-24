import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { openReadOnlyEcdictDatabase } from '../infrastructure/sqlite-connection.mjs';

const buildScript = fileURLToPath(
  new URL('../scripts/build-ecdict-database.py', import.meta.url),
);

test('builds indexed data and enforces a read-only runtime connection', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ecdict-build-test-'));
  const csvPath = join(directory, 'ecdict.csv');
  const lemmaPath = join(directory, 'lemma.en.txt');
  const databasePath = join(directory, 'ecdict.sqlite');
  try {
    writeFileSync(
      csvPath,
      [
        'word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio',
        'look,,to see,看,,5,1,cet4,100,90,,,,',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(lemmaPath, 'look -> looked\n', 'utf8');
    const build = spawnSync(
      'python',
      [buildScript, '--csv', csvPath, '--lemma', lemmaPath, '--database', databasePath],
      { encoding: 'utf8' },
    );
    assert.equal(build.status, 0, build.stderr);

    const inspection = new DatabaseSync(databasePath, { readOnly: true });
    const indexes = inspection
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all()
      .map(({ name }) => name);
    inspection.close();
    assert.ok(indexes.includes('idx_entries_word'));
    assert.ok(indexes.includes('idx_entries_sw'));
    assert.ok(indexes.includes('idx_lemma_forms_form'));

    const runtime = openReadOnlyEcdictDatabase(databasePath);
    try {
      assert.throws(
        () => runtime.exec("INSERT INTO entries (word, sw) VALUES ('write', 'write')"),
        /readonly|read-only/i,
      );
    } finally {
      runtime.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
