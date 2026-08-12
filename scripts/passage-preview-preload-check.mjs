import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const { preloadPassagePreviewBatch } = await importPreparedPreloader()

const calls = []
const prepared = await preloadPassagePreviewBatch([
  {
    id: 'ielts-reading:2026-08-09:ventilation',
    word: 'ventilation',
    lemma: 'ventilation',
    form: 'ventilation',
    pos: 'mass noun',
    primaryMeaningZh: '通风',
    primarySenseStatus: 'resolved',
    targetSenseKey: 'ventilation:noun:通风',
    previewContext: {
      sentence: 'Modern teaching practices, the organizations of desks in the classroom, poor classroom acoustics, and mechanical means of ventilation such as air-conditioning units all contribute to the number of children unable to comprehend the teacher voice.',
      source_kind: 'user_local_exam_material',
      source_id: 'cambridge-long-fallback',
      source_title: '剑桥雅思本地阅读语料',
      source_locator: { locator_version: 'source-locator.v1', local_locator: 'long-1' },
      license_kind: 'user_owned',
      ownership: 'private',
      quality_status: 'validated',
    },
  },
], {
  concurrency: 1,
  fetchImpl: async (url, options = {}) => {
    const parsed = new URL(String(url), 'http://127.0.0.1')
    calls.push({ url: parsed.href, method: options.method || 'GET' })
    if (parsed.pathname === '/api/vocabulary/local-sentences') {
      return jsonResponse({
        available: true,
        primarySense: {
          lemma: 'ventilation',
          partOfSpeech: 'mass noun',
          definitionEn: 'the circulation of air',
          meaningZh: '通风',
        },
        items: [],
      })
    }
    if (parsed.pathname === '/api/vocabulary/merriam-webster-examples') {
      if (parsed.searchParams.get('reference') === 'learners') return jsonResponse({ items: [] })
      return jsonResponse({
        items: [{
          id: 'dictionary:ventilation:1:1',
          sentence: 'a room with good ventilation',
          definition: 'the circulation of air in a room',
          partOfSpeech: 'noun',
          senseOrder: 1,
          matchedTerm: 'ventilation',
          reference: 'dictionary',
          dictionaryTitle: "Merriam-Webster's Collegiate Dictionary",
          sourceUrl: 'https://dictionaryapi.com/products/api-collegiate-dictionary',
        }],
      })
    }
    if (parsed.pathname === '/api/vocabulary/sentence-translations') {
      const body = JSON.parse(options.body)
      return jsonResponse({
        available: true,
        items: body.items.map((item) => ({
          ...item,
          translationZh: '通风良好的房间',
        })),
      })
    }
    return jsonResponse({ available: false, items: [] }, 404)
  },
})

const sentence = prepared.preloadedSentences['ielts-reading:2026-08-09:ventilation']
assert.equal(sentence.sentence, 'a room with good ventilation')
assert.equal(sentence.translationZh, '通风良好的房间')
assert.equal(sentence.persistence, 'none')
assert.equal(prepared.items[0].realSentence, undefined, 'Merriam-Webster content stays session-only')
assert.equal(prepared.stats.sourceReady, 1)
assert.equal(prepared.stats.translated, 1)
assert.ok(calls.some(({ url }) => url.includes('reference=dictionary')))
assert.ok(calls.some(({ url }) => url.includes('/api/vocabulary/sentence-translations')))

const aiCalls = []
const aiPrepared = await preloadPassagePreviewBatch([
  {
    id: 'ielts-reading:2026-08-09:resilient',
    word: 'resilient',
    lemma: 'resilient',
    form: 'resilient',
    pos: 'adjective',
    primaryMeaningZh: '有韧性的',
    primarySenseStatus: 'resolved',
    targetSenseKey: 'resilient:adjective:有韧性的',
  },
  {
    id: 'ielts-reading:2026-08-09:steady',
    word: 'steady',
    lemma: 'steady',
    form: 'steady',
    pos: 'adjective',
    primaryMeaningZh: '稳定的',
    primarySenseStatus: 'resolved',
    targetSenseKey: 'steady:adjective:稳定的',
  },
], {
  concurrency: 1,
  fetchImpl: async (url, options = {}) => {
    const parsed = new URL(String(url), 'http://127.0.0.1')
    aiCalls.push({ url: parsed.href, method: options.method || 'GET' })
    if (parsed.pathname === '/api/vocabulary/local-sentences') {
      return jsonResponse({ available: true, primarySense: null, items: [] })
    }
    if (parsed.pathname === '/api/vocabulary/merriam-webster-examples') {
      return jsonResponse({ items: [] })
    }
    if (parsed.pathname === '/api/vocabulary/real-sentences') {
      return jsonResponse({ items: [] })
    }
    if (parsed.pathname === '/api/vocabulary/wordnik-examples') {
      return jsonResponse({ items: [] })
    }
    if (parsed.pathname === '/api/vocabulary/ai-preview-sentences') {
      const body = JSON.parse(options.body)
      return jsonResponse({
        available: true,
        items: body.items.map((item) => ({
          id: item.id,
          sentence: item.id.endsWith(':steady') ? 'Steady.' : 'The resilient child kept trying.',
        })),
      })
    }
    if (parsed.pathname === '/api/vocabulary/sentence-translations') {
      const body = JSON.parse(options.body)
      return jsonResponse({
        available: true,
        items: body.items.map((item) => ({ ...item, translationZh: '这个坚韧的孩子一直在尝试。' })),
      })
    }
    return jsonResponse({ available: false, items: [] }, 404)
  },
})

const aiSentence = aiPrepared.preloadedSentences['ielts-reading:2026-08-09:resilient']
assert.equal(aiSentence.generated, true)
assert.equal(aiSentence.authentic, false)
assert.equal(aiSentence.usableForGraduation, false)
assert.equal(aiSentence.persistence, 'session-only')
assert.equal(aiSentence.translationZh, '这个坚韧的孩子一直在尝试。')
assert.equal(aiPrepared.items.every((item) => item.realSentence === undefined), true, 'AI content stays outside persistent preview anchors')
assert.equal(aiPrepared.preloadedSentences['ielts-reading:2026-08-09:steady'], undefined, 'short fragments are rejected')
assert.equal(aiPrepared.stats.aiGenerated, 1)
assert.ok(aiCalls.some(({ url }) => url.includes('/api/vocabulary/ai-preview-sentences')))

console.log('Passage preview sentence, translation, and preload checks passed.')

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body },
  }
}

async function importPreparedPreloader() {
  const projectRoot = fileURLToPath(new URL('..', import.meta.url))
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'read-web-preview-preload-'))
  const files = [
    ['src/features/passage-preview/passage-preview-preload.mjs', 'passage-preview-preload.mjs'],
    ['src/features/passage-preview/passage-preview-ai-sentence.js', 'passage-preview-ai-sentence.mjs'],
    ['src/features/passage-preview/preview-sentence-source.js', 'preview-sentence-source.mjs'],
    ['src/features/passage-preview/preview-sentence-target-validation.mjs', 'preview-sentence-target-validation.mjs'],
    ['src/features/passage-preview/sentence-translation.js', 'sentence-translation.mjs'],
    ['src/features/passage-preview/merriam-webster-preview-sentence.js', 'merriam-webster-preview-sentence.mjs'],
    ['src/features/passage-preview/local-warehouse-preview-sentence.js', 'local-warehouse-preview-sentence.mjs'],
    ['src/features/passage-preview/tatoeba-preview-sentence.js', 'tatoeba-preview-sentence.mjs'],
    ['src/features/passage-preview/wordnik-preview-sentence.js', 'wordnik-preview-sentence.mjs'],
    ['src/services/vocabulary/personalization/sentence-source-registry.js', 'sentence-source-registry.mjs'],
    ['src/services/vocabulary/personalization/wordnik-sentence-source.js', 'wordnik-sentence-source.mjs'],
    ['src/services/vocabulary/personalization/merriam-webster-sentence-source.js', 'merriam-webster-sentence-source.mjs'],
    ['src/services/vocabulary/personalization/sentence-candidate-ranking.js', 'sentence-candidate-ranking.mjs'],
    ['src/services/vocabulary/english-inflection-match.mjs', 'english-inflection-match.mjs'],
  ]
  const importReplacements = [
    ['../../services/vocabulary/personalization/sentence-source-registry.js', './sentence-source-registry.mjs'],
    ['../../services/vocabulary/personalization/wordnik-sentence-source.js', './wordnik-sentence-source.mjs'],
    ['../../services/vocabulary/personalization/merriam-webster-sentence-source.js', './merriam-webster-sentence-source.mjs'],
    ['../../services/vocabulary/personalization/sentence-candidate-ranking.js', './sentence-candidate-ranking.mjs'],
    ['../../services/vocabulary/english-inflection-match.mjs', './english-inflection-match.mjs'],
    ['./preview-sentence-source.js', './preview-sentence-source.mjs'],
    ['./passage-preview-ai-sentence.js', './passage-preview-ai-sentence.mjs'],
    ['./sentence-translation.js', './sentence-translation.mjs'],
    ['./preview-sentence-target-validation.mjs', './preview-sentence-target-validation.mjs'],
    ['./sentence-source-registry.js', './sentence-source-registry.mjs'],
    ['./sentence-candidate-ranking.js', './sentence-candidate-ranking.mjs'],
    ['./tatoeba-preview-sentence.js', './tatoeba-preview-sentence.mjs'],
    ['./wordnik-preview-sentence.js', './wordnik-preview-sentence.mjs'],
    ['./merriam-webster-preview-sentence.js', './merriam-webster-preview-sentence.mjs'],
    ['./local-warehouse-preview-sentence.js', './local-warehouse-preview-sentence.mjs'],
  ]
  try {
    for (const [relativePath, targetName] of files) {
      let source = await readFile(join(projectRoot, relativePath), 'utf8')
      for (const [from, to] of importReplacements) source = source.replaceAll(from, to)
      await writeFile(join(temporaryDirectory, targetName), source, 'utf8')
    }
    return import(`${pathToFileURL(join(temporaryDirectory, 'passage-preview-preload.mjs')).href}?v=${Date.now()}`)
  } finally {
    setTimeout(() => { void rm(temporaryDirectory, { recursive: true, force: true }) }, 0)
  }
}
