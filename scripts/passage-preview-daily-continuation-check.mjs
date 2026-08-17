import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const {
  generateIeltsDailyPreviewBatch,
  getPreviewBatchDate,
  excludePreviouslyIntroducedPreviewItems,
  loadIeltsDailyPreviewAllocations,
  loadIeltsPreviewCandidateWords,
  materializeIeltsDailyPreviewBatch,
  saveIeltsDailyPreviewAllocations,
  selectNextIeltsDailyPreviewBatch,
} = await importDailyContinuation()

const storage = createMemoryStorage({
  'vocabulary.ielts-daily-preview.allocations.v1': JSON.stringify({
    schemaVersion: 'ielts-daily-preview.allocations.v1',
    batches: {
      '2026-07-31': ['pledge', 'insert', 'pledge'],
      '2026-08-03': ['scare', 'variant'],
      '2026-08-05': ['accomplish'],
      '2026-08-06': ['poll'],
    },
  }),
})

const allocations = loadIeltsDailyPreviewAllocations(storage)
assert.deepEqual(
  allocations.batches.map((batch) => [batch.date, batch.words]),
  [
    ['2026-07-31', ['pledge', 'insert']],
    ['2026-08-03', ['scare', 'variant']],
    ['2026-08-05', ['accomplish']],
    ['2026-08-06', ['poll']],
  ],
)

assert.equal(
  getPreviewBatchDate([
    { id: 'ielts-reading:2026-07-31:pledge' },
    { id: 'ielts-reading:2026-07-31:insert' },
  ]),
  '2026-07-31',
)

assert.equal(
  selectNextIeltsDailyPreviewBatch({
    allocations,
    currentBatchDate: '2026-07-31',
    consumedBatchDates: [],
    today: '2026-08-08',
  }).date,
  '2026-08-03',
)
assert.equal(
  selectNextIeltsDailyPreviewBatch({
    allocations,
    currentBatchDate: '2026-07-31',
    consumedBatchDates: ['2026-08-03'],
    today: '2026-08-08',
  }).date,
  '2026-08-05',
)

const generated = generateIeltsDailyPreviewBatch({
  allocations,
  date: '2026-08-08',
  candidateWords: ['scare', 'new-word-a', 'new-word-b', 'new-word-c'],
  excludedLemmas: ['new-word-a'],
  batchSize: 2,
})
assert.equal(generated.created, true)
assert.deepEqual(generated.batch.words, ['new-word-b', 'new-word-c'])
assert.ok(generated.allocations.assignedLemmas.includes('new-word-b'))
assert.deepEqual(
  generateIeltsDailyPreviewBatch({
    allocations: generated.allocations,
    date: '2026-08-08',
    candidateWords: ['new-word-a', 'new-word-b', 'new-word-c'],
    batchSize: 2,
  }).batch.words,
  ['new-word-b', 'new-word-c'],
)
saveIeltsDailyPreviewAllocations(generated.allocations, storage)
assert.deepEqual(
  loadIeltsDailyPreviewAllocations(storage).batches.at(-1),
  { date: '2026-08-08', words: ['new-word-b', 'new-word-c'] },
)

const filteredAllocatedBatch = selectNextIeltsDailyPreviewBatch({
  allocations,
  currentBatchDate: '2026-07-31',
  consumedBatchDates: [],
  excludedLemmas: ['scare'],
  today: '2026-08-08',
})
assert.equal(filteredAllocatedBatch.date, '2026-08-03')
assert.deepEqual(filteredAllocatedBatch.words, ['variant'], 'an existing future batch should skip canonically introduced words')

const reconciledCurrentBatch = excludePreviouslyIntroducedPreviewItems({
  items: [
    { id: 'ielts-reading:2026-08-08:scare', lemma: 'scare' },
    { id: 'ielts-reading:2026-08-08:variant', lemma: 'variant' },
    { id: 'ielts-reading:2026-08-08:poll', lemma: 'poll' },
  ],
  introducedRecords: [
    { previewItemId: 'ielts-reading:2026-08-03:scare', lemma: 'scare' },
    { previewItemId: 'ielts-reading:2026-08-08:variant', lemma: 'variant' },
  ],
  currentIndex: 1,
})
assert.deepEqual(reconciledCurrentBatch.items.map((item) => item.lemma), ['variant', 'poll'])
assert.equal(reconciledCurrentBatch.currentIndex, 0)
assert.equal(reconciledCurrentBatch.removedCount, 1)

const candidateWords = await loadIeltsPreviewCandidateWords({
  fetchImpl: async (url) => {
    assert.match(String(url), /\/api\/vocabulary\/ielts-learning-pool/u)
    return jsonResponse({
      available: true,
      items: [
        { lemma: 'fresh-word', primaryMeaningZh: '新词', primarySenseStatus: 'resolved' },
      ],
    })
  },
})
assert.deepEqual(candidateWords.map((item) => item.lemma), ['fresh-word'])

const requests = []
const items = await materializeIeltsDailyPreviewBatch({
  batch: { date: '2026-08-03', words: ['scare', 'variant'] },
  fetchImpl: async (url) => {
    requests.push(String(url))
    const parsed = new URL(url, 'http://127.0.0.1')
    const word = parsed.searchParams.get('word') || parsed.searchParams.get('q')
    if (parsed.pathname === '/api/vocabulary/ielts-learning-pool') {
      return jsonResponse({
        available: true,
        items: [
          {
            lemma: 'scare',
            primaryMeaningZh: '使害怕',
            primarySenseStatus: 'resolved',
            previewContext: {
              sentence: 'The noise may scare the animals.',
              source_kind: 'user_local_exam_material',
              source_id: 'cambridge-test',
              source_title: '剑桥雅思本地语料',
              source_locator: { locator_version: 'source-locator.v1', local_locator: 'test-1' },
              license_kind: 'user_owned',
              ownership: 'private',
              quality_status: 'validated',
            },
          },
          { lemma: 'variant', primaryMeaningZh: '变体', primarySenseStatus: 'suggested' },
        ],
      })
    }
    if (parsed.pathname === '/api/vocabulary/local-sentences' && word === 'scare') {
      return jsonResponse({
        available: true,
        primarySense: {
          lemma: 'scare',
          partOfSpeech: 'verb',
          definitionEn: 'to frighten someone',
          meaningZh: '使害怕',
        },
        items: [],
      })
    }
    if (parsed.pathname === '/api/dev/dictionary/ecdict' && word === 'variant') {
      return jsonResponse({
        available: true,
        directMatch: {
          word: 'variant',
          translation: 'n. 变体；变种',
          definition: 'a form that differs',
          pos: 'n',
          phonetic: '/ˈveəriənt/',
        },
        normalizedCandidates: [],
        lemmaCandidates: [],
      })
    }
    return jsonResponse({ available: false, items: [] }, 404)
  },
})

assert.equal(items.length, 2)
assert.ok(items.every((item) => (
  item.schemaVersion === 'vocabulary-preview.first-contact.v1'
  && item.id
  && item.lemma
  && item.primaryMeaningZh
)))
assert.equal(items[0].id, 'ielts-reading:2026-08-03:scare')
assert.equal(items[0].primaryMeaningZh, '使害怕')
assert.equal(items[0].primarySenseStatus, 'resolved')
assert.equal(items[1].primaryMeaningZh, '变体')
assert.equal(items[1].primarySenseStatus, 'suggested')
assert.equal(items[1].phonetic, '/ˈveəriənt/')
assert.equal(items[0].previewContext?.source_id, 'cambridge-test')
assert.ok(requests.some((url) => url.includes('/api/vocabulary/local-sentences')))
assert.ok(requests.some((url) => url.includes('/api/dev/dictionary/ecdict')))

console.log('Passage preview daily continuation checks passed.')

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null },
    setItem(key, value) { values.set(key, String(value)) },
    removeItem(key) { values.delete(key) },
  }
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body },
  }
}

async function importDailyContinuation() {
  const projectRoot = fileURLToPath(new URL('..', import.meta.url))
  const tempDir = await mkdtemp(join(tmpdir(), 'read-web-daily-continuation-'))
  const policySource = await readFile(join(projectRoot, 'src/services/vocabulary/personalization/primary-sense-policy.js'), 'utf8')
  const importerSource = (await readFile(join(projectRoot, 'src/features/passage-preview/passage-preview-import.js'), 'utf8'))
    .replace('../../services/vocabulary/personalization/primary-sense-policy.js', './primary-sense-policy.mjs')
  const continuationSource = (await readFile(join(projectRoot, 'src/features/passage-preview/passage-preview-daily-continuation.js'), 'utf8'))
    .replace("./passage-preview-import.js", './passage-preview-import.mjs')
    .replace("./passage-preview-durable-state.js", './passage-preview-durable-state.mjs')
  await writeFile(join(tempDir, 'primary-sense-policy.mjs'), policySource, 'utf8')
  await writeFile(join(tempDir, 'passage-preview-import.mjs'), importerSource, 'utf8')
  await writeFile(join(tempDir, 'passage-preview-durable-state.mjs'), await readFile(join(projectRoot, 'src/features/passage-preview/passage-preview-durable-state.js'), 'utf8'), 'utf8')
  const continuationPath = join(tempDir, 'passage-preview-daily-continuation.mjs')
  await writeFile(continuationPath, continuationSource, 'utf8')
  return import(`${pathToFileURL(continuationPath).href}?v=${Date.now()}`)
}
