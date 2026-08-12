import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  MERRIAM_WEBSTER_SENTENCE_ENDPOINT,
  createMerriamWebsterDailyBudget,
  extractMerriamWebsterExamples,
  handleMerriamWebsterSentenceRequest,
} from '../src/services/vocabulary/merriam-webster-sentence-vite-plugin.mjs'

const rawFixture = [{
  meta: { id: 'automatic', section: 'alpha', stems: ['automatic'] },
  fl: 'adjective',
  def: [{
    sseq: [[['sense', {
      sn: '1',
      dt: [
        ['text', '{bc}working by itself with little direct control'],
        ['vis', [{ t: 'The {wi}automatic{/wi} door opened quietly.' }]],
      ],
    }]]],
  }],
}]

const parsed = extractMerriamWebsterExamples(rawFixture, { word: 'automatic', referenceName: 'learners' })
assert.equal(parsed.length, 1)
assert.equal(parsed[0].sentence, 'The automatic door opened quietly.')
assert.equal(parsed[0].partOfSpeech, 'adjective')
assert.match(parsed[0].definition, /working by itself/)

const rescueWithRelatedEntry = [{
  meta: { id: 'rescue', section: 'alpha', stems: ['rescue', 'rescued'] },
  fl: 'verb',
  def: [{ sseq: [[['sense', { dt: [
    ['text', '{bc}to save someone from danger'],
    ['vis', [{ t: 'The survivors were {wi}rescued{/wi} safely.' }]],
  ] }]]]}],
}, {
  meta: { id: 'mission', section: 'alpha', stems: ['mission'] },
  fl: 'noun',
  def: [{ sseq: [[['sense', { dt: [
    ['text', '{bc}a task or job'],
    ['vis', [{ t: 'She succeeded in her {wi}mission{/wi} of averting a strike.' }]],
  ] }]]]}],
}]
const rescueParsed = extractMerriamWebsterExamples(rescueWithRelatedEntry, { word: 'rescue', referenceName: 'learners' })
assert.equal(rescueParsed.length, 1)
assert.equal(rescueParsed[0].targetLemma, 'rescue')
assert.equal(rescueParsed[0].matchedForm, 'rescued')
assert.doesNotMatch(JSON.stringify(rescueParsed), /succeeded in her mission/)

let upstreamUrl = ''
const response = createJsonResponse()
await handleMerriamWebsterSentenceRequest(
  { method: 'GET', url: `${MERRIAM_WEBSTER_SENTENCE_ENDPOINT}?word=automatic&reference=learners` },
  response,
  () => assert.fail('Merriam-Webster endpoint should handle its own route'),
  {
    learnersApiKey: 'fixture-learners-secret',
    budgets: { learners: createMerriamWebsterDailyBudget({ limit: 2 }) },
    fetchImpl: async (url) => {
      upstreamUrl = String(url)
      return new Response(JSON.stringify(rawFixture), { status: 200 })
    },
  },
)
assert.equal(response.statusCode, 200)
assert.match(upstreamUrl, /references\/learners\/json\/automatic/)
assert.match(upstreamUrl, /fixture-learners-secret/)
assert.doesNotMatch(JSON.stringify(response.json), /fixture-learners-secret/)
assert.equal(response.json.items[0].sentence, 'The automatic door opened quietly.')

let missingKeyFetches = 0
const missingKey = createJsonResponse()
await handleMerriamWebsterSentenceRequest(
  { method: 'GET', url: `${MERRIAM_WEBSTER_SENTENCE_ENDPOINT}?word=automatic&reference=dictionary` },
  missingKey,
  () => assert.fail('missing-key request should be handled'),
  { credentialReader: () => '', fetchImpl: async () => { missingKeyFetches += 1 } },
)
assert.equal(missingKey.statusCode, 503)
assert.equal(missingKeyFetches, 0)

let now = new Date('2026-08-07T08:00:00+08:00').getTime()
const budget = createMerriamWebsterDailyBudget({ limit: 1, now: () => now })
assert.equal(budget.tryTake(), true)
assert.equal(budget.tryTake(), false)
now += 24 * 60 * 60 * 1000
assert.equal(budget.tryTake(), true)

const adapter = await loadBrowserAdapter()
const calls = []
const item = {
  word: 'automatic',
  lemma: 'automatic',
  pos: 'adjective',
  primaryMeaningZh: '自动的',
  targetSenseKey: 'automatic:adjective:primary',
}
const ready = await adapter.findMerriamWebsterPreviewSentence(item, {
  fetchImpl: async (url) => {
    calls.push(String(url))
    return new Response(JSON.stringify({
      items: [{
        id: 'learners:automatic:1:1',
        sentence: 'The automatic door opened quietly.',
        definition: 'working by itself with little direct control',
        partOfSpeech: 'adjective',
        senseOrder: 1,
        matchedTerm: 'automatic',
        reference: 'learners',
        dictionaryTitle: "Merriam-Webster's Advanced Learner's English Dictionary",
        sourceUrl: 'https://dictionaryapi.com/products/api-learners-dictionary',
      }],
    }), { status: 200 })
  },
})
assert.equal(ready.status, 'ready')
assert.equal(ready.source.brandingRequired, true)
assert.match(ready.source.poweredByLogoUrl, /MWLogo_LightBG/)
assert.equal(calls.length, 1)
await adapter.findMerriamWebsterPreviewSentence(item, { fetchImpl: async () => assert.fail('session cache should prevent a second request') })
assert.equal(calls.length, 1)

adapter.clearMerriamWebsterPreviewSessionCache()
const massNoun = await adapter.findMerriamWebsterPreviewSentence({
  word: 'ventilation',
  lemma: 'ventilation',
  pos: 'mass noun',
  primaryMeaningZh: '通风',
  targetSenseKey: 'ventilation:noun:通风',
}, {
  fetchImpl: async () => new Response(JSON.stringify({
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
  }), { status: 200 }),
})
assert.equal(massNoun.status, 'ready')
assert.equal(massNoun.sentence, 'a room with good ventilation')

adapter.clearMerriamWebsterPreviewSessionCache()
const fallbackReferences = []
const fallback = await adapter.findMerriamWebsterPreviewSentence({ ...item, targetSenseKey: 'automatic:fallback' }, {
  fetchImpl: async (url) => {
    const reference = new URL(String(url), 'http://127.0.0.1').searchParams.get('reference')
    fallbackReferences.push(reference)
    return new Response(JSON.stringify({ items: reference === 'learners' ? [{
      id: 'learners:noun', sentence: 'The automatic shifted smoothly.', definition: 'a car',
      partOfSpeech: 'noun', senseOrder: 1, matchedTerm: 'automatic', reference: 'learners',
      dictionaryTitle: 'Learner fixture', sourceUrl: 'https://dictionaryapi.com/',
    }] : [{
      id: 'dictionary:adjective', sentence: 'The automatic controls worked correctly.', definition: 'self-acting',
      partOfSpeech: 'adjective', senseOrder: 1, matchedTerm: 'automatic', reference: 'dictionary',
      dictionaryTitle: 'Collegiate fixture', sourceUrl: 'https://dictionaryapi.com/',
    }] }), { status: 200 })
  },
})
assert.equal(fallback.status, 'ready')
assert.deepEqual(fallbackReferences, ['learners', 'dictionary'])

const componentSource = await readFile(new URL('../src/features/passage-preview/PassagePreviewPage.vue', import.meta.url), 'utf8')
assert.match(componentSource, /brandingRequired/)
assert.match(componentSource, /width="50"/)
assert.doesNotMatch(componentSource, /MERRIAM_WEBSTER_(?:DICTIONARY|LEARNERS)_API_KEY/)

console.log('Merriam-Webster dual-reference sentence verification passed.')

async function loadBrowserAdapter() {
  const rankingSource = await readFile(new URL('../src/services/vocabulary/personalization/sentence-candidate-ranking.js', import.meta.url), 'utf8')
  const registrySource = await readFile(new URL('../src/services/vocabulary/personalization/sentence-source-registry.js', import.meta.url), 'utf8')
  const rankingUrl = dataUrl(rankingSource)
  const registryUrl = dataUrl(registrySource)
  const adapterSource = (await readFile(new URL('../src/features/passage-preview/merriam-webster-preview-sentence.js', import.meta.url), 'utf8'))
    .replace('../../services/vocabulary/personalization/sentence-candidate-ranking.js', rankingUrl)
    .replace('../../services/vocabulary/personalization/sentence-source-registry.js', registryUrl)
  return import(dataUrl(adapterSource))
}

function dataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
}

function createJsonResponse() {
  return {
    statusCode: 0,
    headers: {},
    json: null,
    setHeader(name, value) { this.headers[name] = value },
    end(body) { this.json = JSON.parse(body) },
  }
}
