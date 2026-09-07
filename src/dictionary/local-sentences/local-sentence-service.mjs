import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import {
  deriveEnglishLemmaCandidates,
} from '../../services/vocabulary/english-inflection-match.mjs'

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
  const hasPrimarySenses = Boolean(database.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'primary_senses'",
  ).get()?.present)
  const primarySenseStatement = hasPrimarySenses ? database.prepare(`
    SELECT lemma, part_of_speech, definition_en, meaning_zh, source_name,
           source_record_id, source_priority, entry_order, sense_order
      FROM primary_senses
     WHERE lemma IN (?, ?, ?, ?, ?, ?, ?, ?)
     ORDER BY source_priority ASC, entry_order ASC, sense_order ASC
  `) : null

  return Object.freeze({
    available: true,
    query(word, { lemma = '', limit = 24, maxWordCount = 20 } = {}) {
      const normalizedWord = normalizeWord(word)
      const normalizedLemma = normalizeWord(lemma)
      // The preview batch carries the lemma separately from the displayed
      // surface. Keep that explicit pair even for irregular forms such as
      // molten -> melt; otherwise the database query silently drops the real
      // lemma before sentence selection can inspect the sentence.
      const suppliedLemma = normalizedLemma || ''
      const lemmas = unique([suppliedLemma, normalizedWord, ...deriveLemmaCandidates(normalizedWord)]).slice(0, 8)
      while (lemmas.length < 8) lemmas.push('')
      if (!normalizedWord && !normalizedLemma) return { available: true, items: [], lemmas: [] }
      const surfacePattern = `*${normalizedWord}*`
      const rows = statement.all(...lemmas, normalizeMaxWords(maxWordCount), surfacePattern, normalizeLimit(limit))
      const primarySenses = primarySenseStatement?.all(...lemmas) || []
      const primarySense = lemmas
        .filter(Boolean)
        .map((candidate) => primarySenses.find((sense) => normalizeWord(sense.lemma) === candidate))
        .find(Boolean) || null
      return {
        available: true,
        schemaVersion: 'local-sentence-results.v2',
        lemmas: lemmas.filter(Boolean),
        primarySense: primarySense ? {
          lemma: primarySense.lemma,
          partOfSpeech: primarySense.part_of_speech,
          definitionEn: primarySense.definition_en,
          meaningZh: primarySense.meaning_zh,
          entryOrder: primarySense.entry_order,
          senseOrder: primarySense.sense_order,
          source: {
            name: primarySense.source_name,
            recordId: primarySense.source_record_id,
          },
        } : null,
        items: rows.map((row) => ({
          lemma: row.lemma,
          sentence: row.sentence,
          senseGloss: row.sense_gloss,
          partOfSpeech: row.part_of_speech,
          senseOrder: row.sense_order,
          sourcePriority: row.source_priority,
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
  return deriveEnglishLemmaCandidates(value)
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
