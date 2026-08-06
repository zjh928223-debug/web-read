import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

export const LOCAL_SENTENCE_SCHEMA_VERSION = '1'

export function createLocalSentenceService({ databasePath } = {}) {
  if (!databasePath || !existsSync(databasePath)) {
    return unavailableService('LOCAL_SENTENCE_DATABASE_MISSING')
  }

  const database = new DatabaseSync(databasePath, { readOnly: true })
  const schema = database.prepare("SELECT value FROM build_metadata WHERE key = 'schema_version'").get()
  if (schema?.value !== LOCAL_SENTENCE_SCHEMA_VERSION) {
    database.close()
    return unavailableService('LOCAL_SENTENCE_DATABASE_INVALID')
  }

  const statement = database.prepare(`
    SELECT lemma, sentence, sense_gloss, part_of_speech, source_name, source_type,
           source_record_id, source_ref, source_url, license_note, source_priority,
           sense_order, word_count
      FROM sentences
     WHERE lemma IN (?, ?, ?, ?, ?, ?, ?, ?)
       AND word_count BETWEEN 3 AND ?
     ORDER BY
       CASE WHEN lower(sentence) GLOB ? THEN 0 ELSE 1 END,
       source_priority ASC,
       sense_order ASC,
       word_count ASC,
       id ASC
     LIMIT ?
  `)

  return Object.freeze({
    available: true,
    query(word, { lemma = '', limit = 24, maxWordCount = 20 } = {}) {
      const normalizedWord = normalizeWord(word)
      const normalizedLemma = normalizeWord(lemma)
      const lemmas = unique([normalizedLemma, normalizedWord, ...deriveLemmaCandidates(normalizedWord)]).slice(0, 8)
      while (lemmas.length < 8) lemmas.push('')
      if (!normalizedWord && !normalizedLemma) return { available: true, items: [], lemmas: [] }
      const surfacePattern = `*${normalizedWord}*`
      const rows = statement.all(...lemmas, normalizeMaxWords(maxWordCount), surfacePattern, normalizeLimit(limit))
      return {
        available: true,
        schemaVersion: 'local-sentence-results.v1',
        lemmas: lemmas.filter(Boolean),
        items: rows.map((row) => ({
          lemma: row.lemma,
          sentence: row.sentence,
          senseGloss: row.sense_gloss,
          partOfSpeech: row.part_of_speech,
          wordCount: row.word_count,
          source: {
            name: row.source_name,
            type: row.source_type,
            recordId: row.source_record_id,
            ref: row.source_ref,
            url: row.source_url,
            license: row.license_note,
          },
        })),
      }
    },
    close() {
      database.close()
    },
  })
}

export function deriveLemmaCandidates(value) {
  const word = normalizeWord(value)
  if (!word) return []
  const candidates = []
  if (word.endsWith('ies') && word.length > 4) candidates.push(`${word.slice(0, -3)}y`)
  if (word.endsWith('ves') && word.length > 4) candidates.push(`${word.slice(0, -3)}f`, `${word.slice(0, -3)}fe`)
  if (word.endsWith('ing') && word.length > 5) {
    const stem = word.slice(0, -3)
    candidates.push(stem, `${stem}e`, removeDoubledFinal(stem))
  }
  if (word.endsWith('ied') && word.length > 4) candidates.push(`${word.slice(0, -3)}y`)
  if (word.endsWith('ed') && word.length > 4) {
    const stem = word.slice(0, -2)
    candidates.push(stem, `${stem}e`, removeDoubledFinal(stem))
  }
  if (word.endsWith('es') && word.length > 4) candidates.push(word.slice(0, -2), word.slice(0, -1))
  if (word.endsWith('s') && word.length > 3 && !word.endsWith('ss')) candidates.push(word.slice(0, -1))
  return unique(candidates.filter((candidate) => candidate.length >= 2 && candidate !== word))
}

function unavailableService(errorCode) {
  return Object.freeze({
    available: false,
    errorCode,
    query() {
      return { available: false, errorCode, items: [], lemmas: [] }
    },
    close() {},
  })
}

function removeDoubledFinal(value) {
  return /([b-df-hj-np-tv-z])\1$/u.test(value) ? value.slice(0, -1) : value
}

function normalizeWord(value) {
  const word = String(value || '').normalize('NFKC').trim().toLowerCase()
  return /^[a-z]+(?:[-'][a-z]+)*$/u.test(word) && word.length <= 64 ? word : ''
}

function normalizeLimit(value) {
  const number = Number(value)
  return Number.isInteger(number) ? Math.max(1, Math.min(50, number)) : 24
}

function normalizeMaxWords(value) {
  const number = Number(value)
  return Number.isInteger(number) ? Math.max(6, Math.min(32, number)) : 20
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}
