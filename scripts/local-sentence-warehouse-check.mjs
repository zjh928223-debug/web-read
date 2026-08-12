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
  assert.deepEqual(deriveLemmaCandidates('slates'), ['slate'])
  assert.match(service.query('sanctuaries').items[0].sentence, /sanctuary/i)
  assert.match(service.query('propping').items[0].sentence, /prop/i)
  assert.match(service.query('gauges').items[0].sentence, /gauge/i)
  const automatic = service.query('automatic')
  assert.equal(automatic.primarySense.meaningZh, '自动的')
  assert.equal(automatic.primarySense.partOfSpeech, 'adjective')
  assert.equal(automatic.items[0].senseOrder, 2)
  const slates = service.query('slates')
  assert.equal(slates.primarySense.lemma, 'slate')
  assert.equal(slates.primarySense.meaningZh, '石板；板岩')
  assert.ok(slates.items.length > 0)
  assert.ok(slates.items.every((item) => item.lemma === 'slate'))
  const staleLemma = service.query('slates', { lemma: 'slat' })
  assert.equal(staleLemma.primarySense.lemma, 'slate')
  assert.ok(!staleLemma.lemmas.includes('slat'))
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
    const realSlates = real.query('slates', { limit: 12, maxWordCount: 20 })
    assert.equal(realSlates.primarySense?.lemma, 'slate')
    assert.ok(realSlates.items.some((item) => item.lemma === 'slate' && /\bslates\b/iu.test(item.sentence)))
    assert.ok(realSlates.items.every((item) => item.lemma !== 'slat'))
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
  const builderSource = readFileSync('scripts/build-local-sentence-warehouse.py', 'utf8')
  assert.match(builderSource, /CREATE TABLE IF NOT EXISTS primary_senses/)
  assert.match(builderSource, /import_new_oxford_primary_senses/)
  assert.match(builderSource, /--primary-senses-only/)
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
    CREATE TABLE primary_senses (
      lemma TEXT NOT NULL, part_of_speech TEXT NOT NULL DEFAULT '',
      definition_en TEXT NOT NULL, meaning_zh TEXT NOT NULL,
      source_name TEXT NOT NULL, source_record_id TEXT NOT NULL,
      source_priority INTEGER NOT NULL, entry_order INTEGER NOT NULL DEFAULT 999,
      sense_order INTEGER NOT NULL DEFAULT 999,
      PRIMARY KEY (lemma, part_of_speech, source_name)
    );
    INSERT INTO primary_senses VALUES (
      'automatic', 'adjective',
      '(of a device or process) working by itself with little or no direct human control',
      '自动的', 'New Oxford English-Chinese Dictionary', 'automatic:adjective:1', 5, 1, 1
    );
    INSERT INTO primary_senses VALUES (
      'slat', 'noun', 'a thin narrow strip of wood or metal',
      '板条；百叶板', 'fixture learner dictionary', 'slat:noun:1', 5, 1, 1
    );
    INSERT INTO primary_senses VALUES (
      'slate', 'noun', 'a flat piece of slate used for roofing',
      '石板；板岩', 'fixture learner dictionary', 'slate:noun:1', 5, 1, 1
    );
  `)
  const insert = database.prepare(`INSERT INTO sentences
    (lemma, sentence, source_name, source_type, source_record_id, source_url,
     license_note, source_priority, sense_order, word_count)
    VALUES (?, ?, 'fixture', 'dictionary_example', ?, '#', 'fixture only', 10, 1, ?)`)
  insert.run('sanctuary', 'The park is a wildlife sanctuary.', 'sanctuary:1', 6)
  insert.run('prop', 'They prop up the old wall.', 'prop:1', 6)
  insert.run('gauge', 'This test can gauge the temperature.', 'gauge:1', 6)
  insert.run('slat', 'They looked through the wooden slats.', 'slat:1', 6)
  insert.run('slate', 'Several slates were missing from the roof.', 'slate:1', 7)
  database.prepare(`INSERT INTO sentences
    (lemma, sentence, sense_gloss, part_of_speech, source_name, source_type,
     source_record_id, source_url, license_note, source_priority, sense_order, word_count)
    VALUES (?, ?, ?, ?, 'fixture', 'dictionary_example', ?, '#', 'fixture only', 10, ?, ?)`)
    .run('automatic', 'The heating system is fully automatic.',
      'a machine or device that works by itself without direct human control',
      'adjective', 'automatic:2', 2, 6)
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
