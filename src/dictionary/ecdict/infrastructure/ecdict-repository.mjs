import { openReadOnlyEcdictDatabase } from './sqlite-connection.mjs';

const ENTRY_FIELDS = `
  word, phonetic, definition, translation, pos, collins,
  oxford, tag, bnc, frq, exchange
`;

function toEntry(row) {
  if (!row) return null;
  return {
    word: row.word,
    phonetic: row.phonetic ?? null,
    definition: row.definition ?? null,
    translation: row.translation ?? null,
    pos: row.pos ?? null,
    collins: row.collins > 0 ? row.collins : null,
    oxford: Boolean(row.oxford),
    tags: row.tag ? row.tag.trim().split(/\s+/).filter(Boolean) : [],
    bncRank: row.bnc > 0 ? row.bnc : null,
    frequencyRank: row.frq > 0 ? row.frq : null,
    exchange: row.exchange ?? null,
  };
}

export class EcdictRepository {
  constructor(databasePath) {
    this.database = openReadOnlyEcdictDatabase(databasePath);
    this.exactStatement = this.database.prepare(`
      SELECT ${ENTRY_FIELDS}
      FROM entries
      WHERE word = ? COLLATE NOCASE
      LIMIT 1
    `);
    this.normalizedStatement = this.database.prepare(`
      SELECT ${ENTRY_FIELDS}
      FROM entries
      WHERE sw = ? COLLATE NOCASE
      ORDER BY word COLLATE NOCASE, word
    `);
    this.lemmaStatement = this.database.prepare(`
      SELECT lf.lemma, ${ENTRY_FIELDS.split(',').map((field) => `e.${field.trim()}`).join(', ')}
      FROM lemma_forms AS lf
      JOIN entries AS e ON e.word = lf.lemma COLLATE NOCASE
      WHERE lf.form = ? COLLATE NOCASE
      ORDER BY lf.lemma COLLATE NOCASE, lf.lemma
    `);
  }

  findExact(query) {
    return toEntry(this.exactStatement.get(query));
  }

  findNormalized(normalizedQuery) {
    if (!normalizedQuery) return [];
    return this.normalizedStatement.all(normalizedQuery).map(toEntry);
  }

  findLemmaCandidates(query) {
    if (!query) return [];
    return this.lemmaStatement.all(query).map((row) => ({
      lemma: row.lemma,
      entry: toEntry(row),
    }));
  }

  close() {
    this.database.close();
  }
}
