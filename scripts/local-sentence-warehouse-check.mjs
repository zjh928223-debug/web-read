import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createLocalSentenceService, deriveLemmaCandidates } from '../src/dictionary/local-sentences/local-sentence-service.mjs'
import { handleLocalSentenceRequest } from '../src/dictionary/local-sentences/local-sentence-vite-plugin.mjs'

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'read-web-local-sentences-'))
const databasePath = join(temporaryDirectory, 'sentences.sqlite')
try {
  createFixtureDatabase(databasePath)
  const service = createLocalSentenceService({ databasePath })
  assert.equal(service.available, true)
  assert.ok(deriveLemmaCandidates('sanctuaries').includes('sanctuary'))
  assert.ok(deriveLemmaCandidates('propping').includes('prop'))
  assert.ok(deriveLemmaCandidates('gauges').includes('gauge'))
  assert.match(service.query('sanctuaries').items[0].sentence, /sanctuary/i)
  assert.match(service.query('propping').items[0].sentence, /prop/i)
  assert.match(service.query('gauges').items[0].sentence, /gauge/i)
  service.close()

  const response = createJsonResponse()
  const endpointService = createLocalSentenceService({ databasePath })
  await handleLocalSentenceRequest(
    { method: 'GET', url: '/api/vocabulary/local-sentences?word=propping&limit=2' },
    response,
    () => assert.fail('local endpoint should handle its own route'),
    { serviceFactory: () => endpointService },
  )
  assert.equal(response.statusCode, 200)
  assert.equal(response.json.available, true)
  assert.equal(response.json.items[0].lemma, 'prop')
  endpointService.close()

  const realDatabase = resolve('data/dictionaries/local-sentences.sqlite')
  if (existsSync(realDatabase)) {
    const real = createLocalSentenceService({ databasePath: realDatabase })
    for (const word of ['sanctuaries', 'propping', 'gauges']) {
      const result = real.query(word, { limit: 12, maxWordCount: 20 })
      assert.ok(result.items.length > 0, `${word} should resolve in the local warehouse`)
    }
    real.close()
  }
  assert.match(readFileSync('.gitignore', 'utf8'), /^\/data\/dictionaries\/$/m)
  assert.equal(
    execFileSync('git', ['ls-files', 'data/dictionaries'], { encoding: 'utf8' }).trim(),
    '',
    'local dictionary sources and generated warehouse must never be tracked',
  )
  const runtimeSources = [
    'src/dictionary/local-sentences/local-sentence-service.mjs',
    'src/dictionary/local-sentences/local-sentence-vite-plugin.mjs',
  ].map((path) => readFileSync(path, 'utf8')).join('\n')
  assert.doesNotMatch(runtimeSources, /indexedDB|SeekPlayerDB|objectStore/)
  console.log('Local sentence warehouse verification passed.')
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true })
}

function createFixtureDatabase(path) {
  const database = new DatabaseSync(path)
  database.exec(`
    CREATE TABLE build_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO build_metadata VALUES ('schema_version', '1');
    CREATE TABLE sentences (
      id INTEGER PRIMARY KEY, lemma TEXT NOT NULL, sentence TEXT NOT NULL,
      sense_gloss TEXT NOT NULL DEFAULT '', part_of_speech TEXT NOT NULL DEFAULT '',
      source_name TEXT NOT NULL, source_type TEXT NOT NULL, source_record_id TEXT NOT NULL,
      source_ref TEXT NOT NULL DEFAULT '', source_url TEXT NOT NULL DEFAULT '',
      license_note TEXT NOT NULL, source_priority INTEGER NOT NULL,
      sense_order INTEGER NOT NULL DEFAULT 999, word_count INTEGER NOT NULL
    );
  `)
  const insert = database.prepare(`INSERT INTO sentences
    (lemma, sentence, source_name, source_type, source_record_id, source_url,
     license_note, source_priority, sense_order, word_count)
    VALUES (?, ?, 'fixture', 'dictionary_example', ?, '#', 'fixture only', 10, 1, ?)`)
  insert.run('sanctuary', 'The park is a wildlife sanctuary.', 'sanctuary:1', 6)
  insert.run('prop', 'They prop up the old wall.', 'prop:1', 6)
  insert.run('gauge', 'This test can gauge the temperature.', 'gauge:1', 6)
  database.close()
}

function createJsonResponse() {
  return {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    end(value) { this.json = JSON.parse(value) },
  }
}
