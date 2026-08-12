import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

export const IELTS_LEARNING_POOL_ENDPOINT = '/api/vocabulary/ielts-learning-pool'
export const IELTS_READING_CANDIDATES_DEFAULT_PATH = resolve(
  process.cwd(),
  '..',
  '雅思语料工作区',
  'corpus',
  'cambridge-04-21',
  'reading-vocabulary-candidates.json',
)

export function createIeltsLearningPoolVitePlugin(options = {}) {
  const candidatesPath = options.candidatesPath
    || process.env.IELTS_READING_VOCABULARY_CANDIDATES_PATH
    || IELTS_READING_CANDIDATES_DEFAULT_PATH
  const endpoint = options.endpoint || IELTS_LEARNING_POOL_ENDPOINT
  let cache = null

  function readPool() {
    let stat
    try {
      stat = statSync(candidatesPath)
    } catch {
      return null
    }
    if (cache && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) return cache.pool

    try {
      const payload = JSON.parse(readFileSync(candidatesPath, 'utf8'))
      const candidates = Array.isArray(payload?.candidates)
        ? payload.candidates.filter((item) => item?.priority === true).map(normalizeCandidate).filter(Boolean)
        : []
      const pool = {
        schemaVersion: 'ielts-learning-pool.response.v1',
        source: 'cambridge-04-21-reading-vocabulary-local',
        candidateCount: Number(payload?.candidate_count) || 0,
        priorityCandidateCount: Number(payload?.priority_candidate_count) || candidates.length,
        generatedAtUtc: normalizeIso(payload?.generated_at_utc),
        candidates,
      }
      cache = { mtimeMs: stat.mtimeMs, size: stat.size, pool }
      return pool
    } catch {
      return null
    }
  }

  const serve = (req, res, next) => {
    const requestUrl = new URL(req.url || '/', 'http://read-web.local')
    if (requestUrl.pathname !== endpoint) {
      next?.()
      return
    }
    if (req.method !== 'GET') {
      writeJson(res, 405, { available: false, errorCode: 'METHOD_NOT_ALLOWED' })
      return
    }

    const poolId = requestUrl.searchParams.get('pool') || 'readingVocabulary'
    if (poolId !== 'readingVocabulary') {
      writeJson(res, 400, { available: false, errorCode: 'UNKNOWN_IELTS_LEARNING_POOL' })
      return
    }

    const pool = readPool()
    if (!pool) {
      writeJson(res, 503, {
        available: false,
        errorCode: existsSync(candidatesPath)
          ? 'IELTS_LEARNING_POOL_INVALID'
          : 'IELTS_LEARNING_POOL_UNAVAILABLE',
        items: [],
      })
      return
    }

    const requestedLemmas = uniqueWords(requestUrl.searchParams.get('lemmas'))
    const items = requestedLemmas.length
      ? pool.candidates
        .filter((candidate) => requestedLemmas.includes(candidate.lemma))
        .map(toDetailedCandidate)
      : pool.candidates.map(toSummaryCandidate)
    writeJson(res, 200, {
      available: true,
      schemaVersion: pool.schemaVersion,
      source: pool.source,
      candidateCount: pool.candidateCount,
      priorityCandidateCount: pool.priorityCandidateCount,
      generatedAtUtc: pool.generatedAtUtc,
      items,
    })
  }

  return {
    name: 'read-web-ielts-learning-pool',
    configureServer(server) {
      server.middlewares.use(serve)
    },
    configurePreviewServer(server) {
      server.middlewares.use(serve)
    },
  }
}

function normalizeCandidate(item) {
  const lemma = normalizeWord(item?.lemma)
  if (!lemma) return null
  return {
    lemma,
    form: normalizeWord(item?.example?.form) || normalizeWord(item?.forms?.[0]) || lemma,
    phonetic: normalizeText(item?.phonetic),
    pos: normalizeText(item?.pos),
    translation: normalizeTranslation(item?.translation),
    definition: normalizeText(item?.definition),
    example: normalizeExample(item?.example, lemma),
  }
}

function normalizeExample(example, lemma) {
  if (!example || typeof example !== 'object') return null
  const sentence = normalizeText(example.sentence)
  if (!sentence || !containsLemma(sentence, lemma)) return null
  const book = normalizePositiveInteger(example.book)
  const test = normalizePositiveInteger(example.test)
  const passage = normalizePositiveInteger(example.passage)
  const sourceId = normalizeText(example.source_id)
  const contextSentences = Array.isArray(example.context_sentences)
    ? example.context_sentences.map(normalizeText).filter(Boolean)
    : []
  return {
    sentence,
    previousSentence: normalizeText(example.previous_sentence),
    nextSentence: normalizeText(example.next_sentence),
    contextSentences,
    sourceId,
    book,
    test,
    passage,
  }
}

function toSummaryCandidate(candidate) {
  const meaning = selectPrimaryMeaning(candidate.translation, candidate.pos)
  return {
    lemma: candidate.lemma,
    word: candidate.form || candidate.lemma,
    form: candidate.form || candidate.lemma,
    phonetic: candidate.phonetic,
    pos: candidate.pos,
    primaryMeaningZh: meaning,
    primarySenseStatus: meaning ? 'resolved' : 'suggested',
    primarySenseReason: meaning ? '剑雅本地候选池已提供首要义项提示' : '剑雅候选池暂未提供中文首要义项',
    targetSenseKey: stableTargetSenseKey(candidate.lemma, meaning),
  }
}

function toDetailedCandidate(candidate) {
  const summary = toSummaryCandidate(candidate)
  const example = candidate.example
  if (!example) return summary
  const sourceId = `cambridge-04-21:${example.sourceId || `${example.book || 'unknown'}-${example.test || 'unknown'}-${example.passage || 'unknown'}`}`
  const localLocator = [
    `book-${example.book || 'unknown'}`,
    `test-${example.test || 'unknown'}`,
    `passage-${example.passage || 'unknown'}`,
    example.sourceId || candidate.lemma,
  ].join(':')
  const surrounding = uniqueText([
    example.previousSentence,
    example.nextSentence,
    ...example.contextSentences,
  ].filter((sentence) => sentence !== example.sentence)).join(' ')
  return {
    ...summary,
    previewContext: {
      sentence: example.sentence,
      surrounding_text: surrounding || null,
      source_kind: 'user_local_exam_material',
      source_id: sourceId,
      source_title: formatSourceTitle(example),
      source_locator: {
        locator_version: 'source-locator.v1',
        local_locator: localLocator,
      },
      license_kind: 'user_owned',
      ownership: 'private',
      quality_status: 'validated',
      quality_reason: '本地用户持有的剑桥雅思语料已通过来源校验',
      extensions: {
        corpus: 'cambridge-04-21',
        book: example.book,
        test: example.test,
        passage: example.passage,
      },
    },
  }
}

function formatSourceTitle(example) {
  const parts = ['剑桥雅思本地阅读语料']
  if (example.book) parts.push(`Book ${example.book}`)
  if (example.test) parts.push(`Test ${example.test}`)
  if (example.passage) parts.push(`Passage ${example.passage}`)
  return parts.join(' · ')
}

function selectPrimaryMeaning(translation, partOfSpeech) {
  const source = String(translation ?? '').normalize('NFKC').replace(/\r/gu, '')
  if (!source) return ''
  const target = normalizeText(partOfSpeech).toLowerCase().replace(/\.$/u, '')
  const lines = source.split(/[\r\n]+/u).map((line) => line.trim()).filter(Boolean)
  const preferred = target
    ? lines.find((line) => new RegExp(`^(?:${escapeRegExp(target)}|n|v|a|adj|adv)\\.?\\s`, 'iu').test(line))
    : lines[0]
  return normalizeText((preferred || lines[0]).replace(/^(?:n|v|a|adj|adv|pron|prep|conj|vt|vi)\.?\s*/iu, ''))
    .split(/[;,；，]/u)
    .map((value) => value.trim())
    .find(Boolean) || ''
}

function stableTargetSenseKey(lemma, meaning) {
  return `ielts-reading:${lemma}:${meaning || 'candidate'}`
}

function containsLemma(sentence, lemma) {
  return new RegExp(`(?<![A-Za-z])${escapeRegExp(lemma)}(?:s|es|ed|ing)?(?![A-Za-z])`, 'iu').test(sentence)
}

function uniqueWords(value) {
  return [...new Set(String(value || '')
    .split(',')
    .map(normalizeWord)
    .filter(Boolean))].slice(0, 100)
}

function uniqueText(values) {
  return [...new Set(values.map(normalizeText).filter(Boolean))]
}

function normalizeWord(value) {
  const word = normalizeText(value).toLowerCase()
  return /^[a-z]+(?:[-'][a-z]+)*$/u.test(word) ? word : ''
}

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
}

function normalizeTranslation(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\r/gu, '')
    .replace(/\\n/gu, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

function normalizePositiveInteger(value) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function normalizeIso(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function writeJson(res, statusCode, payload) {
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}
