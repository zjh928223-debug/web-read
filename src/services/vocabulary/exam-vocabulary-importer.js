import { normalizeLearningEvent } from './vocabulary-learning-events.js';
import { normalizeLearningUnit } from './vocabulary-learning-models.js';
import {
  canonicalJson,
  runVocabularyLearningUnitOfWork,
  sha256Utf8,
} from './vocabulary-learning-uow.js';

export const EXAM_VOCABULARY_IMPORT_ROW_SCHEMA = 'exam-vocabulary-import-row.v1';
export const EXAM_VOCABULARY_IMPORT_PREVIEW_SCHEMA = 'exam-vocabulary-import-preview.v1';
export const EXAM_VOCABULARY_IMPORT_COMMAND_SCHEMA = 'exam-vocabulary-import-command.v1';

const REQUIRED_FIELDS = Object.freeze([
  'lemma',
  'exam_category',
  'exam_level',
  'source_id',
]);
const OPTIONAL_FIELDS = Object.freeze(['target_meaning']);
const ALL_FIELDS = new Set([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]);
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const LEMMA_PATTERN = /^[\p{L}\p{M}]+(?:[ '\u2019-][\p{L}\p{M}]+)*$/u;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function importError(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'ExamVocabularyImportError';
  error.code = code;
  error.details = clone(details);
  return error;
}

function fail(code, message, details = {}) {
  throw importError(code, message, details);
}

function normalizeText(value, field, { nullable = false, lowercase = false } = {}) {
  if (nullable && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'string') {
    fail('INVALID_FIELD_TYPE', 'Import field must be text', { field });
  }
  let normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!normalized) {
    if (nullable) return null;
    fail('MISSING_REQUIRED_FIELD', 'Import field is required', { field });
  }
  if (lowercase) normalized = normalized.toLocaleLowerCase('en-US');
  return normalized;
}

function normalizeMeaningForComparison(value) {
  return value === null
    ? null
    : value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
}

function normalizeLemma(value) {
  const lemma = normalizeText(value, 'lemma', { lowercase: true });
  if (!LEMMA_PATTERN.test(lemma)) {
    fail('INVALID_FIELD_TYPE', 'lemma must contain letters and word separators only', {
      field: 'lemma',
    });
  }
  return lemma;
}

function normalizeRow(input, rowNumber) {
  if (!isPlainObject(input)) {
    fail('INVALID_FIELD_TYPE', 'Import row must be an object', { row_number: rowNumber });
  }
  const unknownField = Object.keys(input).find((field) => !ALL_FIELDS.has(field));
  if (unknownField) {
    fail('INVALID_FIELD_TYPE', 'Import row contains an unknown field', {
      field: unknownField,
      row_number: rowNumber,
    });
  }
  const row = {
    schema_version: EXAM_VOCABULARY_IMPORT_ROW_SCHEMA,
    row_number: rowNumber,
    lemma: normalizeLemma(input.lemma),
    target_meaning: normalizeText(input.target_meaning, 'target_meaning', { nullable: true }),
    exam_category: normalizeText(input.exam_category, 'exam_category'),
    exam_level: normalizeText(input.exam_level, 'exam_level'),
    source_id: normalizeText(input.source_id, 'source_id'),
  };
  return row;
}

export function normalizeExamVocabularyImportRow(input, rowNumber = 1) {
  if (!Number.isInteger(rowNumber) || rowNumber < 1) {
    fail('INVALID_FIELD_TYPE', 'rowNumber must be a positive integer', { field: 'rowNumber' });
  }
  return normalizeRow(input, rowNumber);
}

function parseCsvRecords(text) {
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;
  let line = 1;
  let recordLine = 1;

  function pushRecord() {
    record.push(field);
    records.push({ cells: record, line_number: recordLine });
    record = [];
    field = '';
    closedQuote = false;
    recordLine = line + 1;
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        closedQuote = true;
      } else {
        field += character;
        if (character === '\n') line += 1;
      }
      continue;
    }
    if (character === '"' && field === '' && !closedQuote) {
      quoted = true;
    } else if (character === ',') {
      record.push(field);
      field = '';
      closedQuote = false;
    } else if (character === '\r' && text[index + 1] === '\n') {
      pushRecord();
      index += 1;
      line += 1;
    } else if (character === '\n' || character === '\r') {
      pushRecord();
      line += 1;
    } else if (closedQuote && !/\s/u.test(character)) {
      fail('INVALID_CSV', 'Unexpected text after a closing quote', { line_number: line });
    } else if (!closedQuote) {
      field += character;
    }
  }
  if (quoted) fail('INVALID_CSV', 'CSV contains an unclosed quoted field', { line_number: line });
  if (record.length > 0 || field.length > 0 || closedQuote) pushRecord();
  return records;
}

function parseCsv(text) {
  const records = parseCsvRecords(text.replace(/^\uFEFF/u, ''));
  if (records.length === 0) fail('INVALID_CSV', 'CSV requires a header row', {});
  const header = records[0].cells.map((cell) => cell.normalize('NFKC').trim());
  const duplicateHeader = header.find((field, index) => header.indexOf(field) !== index);
  if (duplicateHeader) fail('INVALID_CSV', 'CSV header contains a duplicate field', { field: duplicateHeader });
  const unknownHeader = header.find((field) => !ALL_FIELDS.has(field));
  if (unknownHeader) fail('INVALID_CSV', 'CSV header contains an unknown field', { field: unknownHeader });
  const missingHeader = REQUIRED_FIELDS.find((field) => !header.includes(field));
  if (missingHeader) fail('INVALID_CSV', 'CSV header is missing a required field', { field: missingHeader });

  return records.slice(1).map((record) => {
    if (record.cells.every((cell) => cell.trim() === '')) {
      return { row_number: record.line_number, input: null };
    }
    if (record.cells.length !== header.length) {
      return {
        row_number: record.line_number,
        error: importError('INVALID_CSV_ROW', 'CSV row has the wrong number of fields', {
          row_number: record.line_number,
        }),
      };
    }
    return {
      row_number: record.line_number,
      input: Object.fromEntries(header.map((field, index) => [field, record.cells[index]])),
    };
  });
}

function parseJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail('INVALID_JSON', 'JSON could not be parsed', {});
  }
  const rows = Array.isArray(parsed) ? parsed : parsed?.rows;
  if (!Array.isArray(rows)) {
    fail('INVALID_JSON', 'JSON must be an array or an object with a rows array', {});
  }
  return rows.map((input, index) => ({
    row_number: index + 1,
    input,
  }));
}

function normalizeExistingWord(input) {
  if (!isPlainObject(input)) fail('INVALID_FIELD_TYPE', 'Existing word must be an object', { field: 'existing_words' });
  return {
    word_id: normalizeText(input.word_id, 'existing_words.word_id'),
    lemma: normalizeLemma(input.lemma ?? input.normalized_form),
  };
}

function normalizeExistingUnit(input) {
  if (!isPlainObject(input)) fail('INVALID_FIELD_TYPE', 'Existing unit must be an object', { field: 'existing_learning_units' });
  return {
    learning_unit_id: normalizeText(input.learning_unit_id, 'existing_learning_units.learning_unit_id'),
    word_id: normalizeText(input.word_id, 'existing_learning_units.word_id'),
    lemma: normalizeLemma(input.lemma ?? input.normalized_form),
    target_meaning: normalizeMeaningForComparison(
      input.target_meaning
      ?? input.target_sense?.normalized_gloss
      ?? input.target_sense?.gloss
      ?? null,
    ),
    archived: input.archived_at !== undefined && input.archived_at !== null,
  };
}

function issue(code, severity, rowNumber, details = {}) {
  return {
    code,
    severity,
    row_number: rowNumber,
    details: clone(details),
  };
}

function semanticRowKey(row) {
  return `${row.lemma}\u001f${normalizeMeaningForComparison(row.target_meaning) ?? ''}`;
}

function rowPreview(row, issues, existingWordId = null) {
  return {
    ...clone(row),
    status: issues.some((item) => item.severity === 'error') ? 'rejected' : 'ready',
    existing_word_id: existingWordId,
    issues: clone(issues),
  };
}

export function previewExamVocabularyImport(input, options = {}) {
  if (!isPlainObject(input)) fail('INVALID_FIELD_TYPE', 'Import input must be an object', { field: 'input' });
  if (!isPlainObject(options)) fail('INVALID_FIELD_TYPE', 'Preview options must be an object', { field: 'options' });
  const format = normalizeText(input.format, 'format', { lowercase: true });
  if (!['csv', 'json'].includes(format)) {
    fail('INVALID_ENUM_VALUE', 'Import format must be csv or json', { field: 'format' });
  }
  if (typeof input.text !== 'string') fail('INVALID_FIELD_TYPE', 'Import text must be a string', { field: 'text' });

  const parsedRows = format === 'csv' ? parseCsv(input.text) : parseJson(input.text);
  const existingWords = (options.existing_words ?? []).map(normalizeExistingWord);
  const existingUnits = (options.existing_learning_units ?? [])
    .map(normalizeExistingUnit)
    .filter((unit) => !unit.archived);
  const previewRows = [];
  const seenByLemma = new Map();

  for (const parsedRow of parsedRows) {
    if (parsedRow.input === null) {
      previewRows.push({
        schema_version: EXAM_VOCABULARY_IMPORT_ROW_SCHEMA,
        row_number: parsedRow.row_number,
        status: 'rejected',
        issues: [issue('EMPTY_ROW', 'error', parsedRow.row_number)],
      });
      continue;
    }
    if (parsedRow.error) {
      previewRows.push({
        schema_version: EXAM_VOCABULARY_IMPORT_ROW_SCHEMA,
        row_number: parsedRow.row_number,
        status: 'rejected',
        issues: [issue(parsedRow.error.code, 'error', parsedRow.row_number)],
      });
      continue;
    }

    let row;
    try {
      row = normalizeRow(parsedRow.input, parsedRow.row_number);
    } catch (error) {
      previewRows.push({
        schema_version: EXAM_VOCABULARY_IMPORT_ROW_SCHEMA,
        row_number: parsedRow.row_number,
        status: 'rejected',
        issues: [issue(error.code ?? 'INVALID_ROW', 'error', parsedRow.row_number, error.details)],
      });
      continue;
    }

    const issues = [];
    const meaning = normalizeMeaningForComparison(row.target_meaning);
    const priorRows = seenByLemma.get(row.lemma) ?? [];
    const exactPrior = priorRows.find((prior) => semanticRowKey(prior) === semanticRowKey(row));
    const ambiguousPrior = priorRows.find((prior) => (
      meaning === null || normalizeMeaningForComparison(prior.target_meaning) === null
    ));
    if (exactPrior) {
      issues.push(issue('DUPLICATE_WORD', 'error', row.row_number, {
        first_row_number: exactPrior.row_number,
      }));
    } else if (ambiguousPrior) {
      issues.push(issue('DUPLICATE_LEMMA_WITHOUT_SENSE', 'error', row.row_number, {
        first_row_number: ambiguousPrior.row_number,
      }));
    } else if (priorRows.length > 0) {
      issues.push(issue('SAME_LEMMA_DIFFERENT_SENSE', 'info', row.row_number, {
        other_row_numbers: priorRows.map((prior) => prior.row_number),
      }));
    }
    priorRows.push(row);
    seenByLemma.set(row.lemma, priorRows);

    const wordsForLemma = existingWords.filter((word) => word.lemma === row.lemma);
    const unitsForLemma = existingUnits.filter((unit) => unit.lemma === row.lemma);
    const existingWordId = wordsForLemma[0]?.word_id ?? unitsForLemma[0]?.word_id ?? null;
    const exactExistingUnit = unitsForLemma.find((unit) => (
      meaning === null || unit.target_meaning === null || unit.target_meaning === meaning
    ));
    if (exactExistingUnit) {
      issues.push(issue(
        exactExistingUnit.target_meaning === meaning && meaning !== null
          ? 'ALREADY_EXISTS'
          : 'ALREADY_CANDIDATE_OR_UNSPECIFIED_SENSE',
        'error',
        row.row_number,
        { learning_unit_id: exactExistingUnit.learning_unit_id },
      ));
    } else if (unitsForLemma.length > 0) {
      issues.push(issue('EXISTING_WORD_DIFFERENT_SENSE', 'info', row.row_number, {
        existing_learning_unit_ids: unitsForLemma.map((unit) => unit.learning_unit_id),
      }));
    } else if (wordsForLemma.length > 0) {
      issues.push(issue('EXISTING_WORD', 'info', row.row_number, {
        word_id: wordsForLemma[0].word_id,
      }));
    }
    previewRows.push(rowPreview(row, issues, existingWordId));
  }

  const readyRows = previewRows.filter((row) => row.status === 'ready');
  const rejectedRows = previewRows.filter((row) => row.status === 'rejected');
  return {
    schema_version: EXAM_VOCABULARY_IMPORT_PREVIEW_SCHEMA,
    format,
    counts: {
      input_rows: previewRows.length,
      confirmable_rows: readyRows.length,
      rejected_rows: rejectedRows.length,
      duplicate_rows: previewRows.filter((row) => row.issues.some((item) => item.code.startsWith('DUPLICATE_'))).length,
      existing_rows: previewRows.filter((row) => row.issues.some((item) => (
        item.code === 'ALREADY_EXISTS'
        || item.code === 'ALREADY_CANDIDATE_OR_UNSPECIFIED_SENSE'
        || item.code === 'EXISTING_WORD'
        || item.code === 'EXISTING_WORD_DIFFERENT_SENSE'
      ))).length,
      same_lemma_different_sense_rows: previewRows.filter((row) => row.issues.some((item) => (
        item.code === 'SAME_LEMMA_DIFFERENT_SENSE'
        || item.code === 'EXISTING_WORD_DIFFERENT_SENSE'
      ))).length,
    },
    rows: previewRows,
    confirmable_rows: readyRows,
    rejected_rows: rejectedRows,
  };
}

function normalizeTimestamp(value, field) {
  if (typeof value !== 'string'
    || !UTC_TIMESTAMP.test(value)
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    fail('INVALID_TIMESTAMP', 'Expected a UTC timestamp', { field });
  }
  return value;
}

function requiredId(value, field) {
  return normalizeText(value, field);
}

function candidateIdentity(importId, row) {
  const meaning = normalizeMeaningForComparison(row.target_meaning) ?? '';
  const wordHash = sha256Utf8(canonicalJson({ language: 'en', lemma: row.lemma }));
  const unitHash = sha256Utf8(canonicalJson({
    lemma: row.lemma,
    target_meaning: meaning,
    source_id: row.source_id,
    exam_category: row.exam_category,
    exam_level: row.exam_level,
  }));
  return {
    word_id: row.existing_word_id ?? `vocabulary-word:${wordHash}`,
    learning_unit_id: `exam-candidate:${unitHash}`,
    event_id: `exam-candidate-event:${sha256Utf8(`${importId}\u001f${unitHash}`)}`,
  };
}

function buildCandidateUnit(importId, row, occurredAt) {
  const identity = candidateIdentity(importId, row);
  return {
    unit: normalizeLearningUnit({
      schema_version: 'learning-unit.v1',
      learning_unit_id: identity.learning_unit_id,
      word_id: identity.word_id,
      normalized_form: row.lemma,
      language: 'en',
      target_sense_id: null,
      target_sense_key: null,
      target_sense: null,
      created_at: occurredAt,
      updated_at: occurredAt,
      archived_at: null,
      revision: 0,
      extensions: {
        exam_import: {
          schema_version: EXAM_VOCABULARY_IMPORT_ROW_SCHEMA,
          import_id: importId,
          row_number: row.row_number,
          proposed_target_meaning: row.target_meaning,
          exam_category: row.exam_category,
          exam_level: row.exam_level,
          source_id: row.source_id,
        },
      },
    }),
    event_id: identity.event_id,
  };
}

function buildCandidateEvent(unit, eventId, command, occurredAt) {
  return normalizeLearningEvent({
    schema_version: 'learning-event.v1',
    event_id: eventId,
    command_id: command.command_id,
    correlation_id: command.correlation_id,
    event_type: 'candidate_queued',
    attempt_id: null,
    occurred_at: occurredAt,
    recorded_at: occurredAt,
    session_id: null,
    session_position: null,
    learning_unit_id: unit.learning_unit_id,
    word_id: unit.word_id,
    target_sense_id: null,
    policy_version: null,
    scheduler_version: null,
    content_version: 'exam-vocabulary-import.v1',
    prompt_mode: null,
    cue_level: null,
    rating: null,
    answer_revealed_before_rating: null,
    graduation_eligibility: null,
    duration_ms: null,
    active_duration_ms: null,
    before_state: null,
    after_state: null,
    source_kind: null,
    context_evidence_id: null,
    is_legacy: false,
    training_eligible: false,
    exclusion_reasons: [],
    payload: {
      normalized_form: unit.normalized_form,
      import_source_id: unit.extensions.exam_import.source_id,
    },
    extensions: {},
  });
}

export async function confirmExamVocabularyImport(preview, options = {}) {
  if (!isPlainObject(preview) || preview.schema_version !== EXAM_VOCABULARY_IMPORT_PREVIEW_SCHEMA) {
    fail('INVALID_FIELD_TYPE', 'A normalized import preview is required', { field: 'preview' });
  }
  if (!isPlainObject(options)) fail('INVALID_FIELD_TYPE', 'Confirmation options must be an object', { field: 'options' });
  const importId = requiredId(options.import_id, 'options.import_id');
  const occurredAt = normalizeTimestamp(options.occurred_at, 'options.occurred_at');
  const command = {
    command_id: requiredId(options.command_id, 'options.command_id'),
    command_type: 'confirm_exam_vocabulary_import',
    correlation_id: requiredId(options.correlation_id, 'options.correlation_id'),
    event_partition: occurredAt.slice(0, 7),
    payload: {
      schema_version: EXAM_VOCABULARY_IMPORT_COMMAND_SCHEMA,
      import_id: importId,
      occurred_at: occurredAt,
      rows: clone(preview.confirmable_rows),
    },
  };
  const runUnitOfWork = options.runUnitOfWork ?? runVocabularyLearningUnitOfWork;
  if (typeof runUnitOfWork !== 'function') {
    fail('INVALID_FIELD_TYPE', 'runUnitOfWork must be a function', { field: 'options.runUnitOfWork' });
  }
  if (command.payload.rows.length === 0) {
    fail('INVALID_STATE_TRANSITION', 'Preview has no confirmable rows', {});
  }

  return runUnitOfWork({ now: () => occurredAt }, command, async (uow) => {
    const candidates = [];
    for (const row of command.payload.rows) {
      const { unit, event_id: eventId } = buildCandidateUnit(importId, row, occurredAt);
      if (await uow.review.getByLearningUnitId(unit.learning_unit_id)) {
        fail('REVIEW_STATE_BEFORE_GRADUATION', 'Candidate import cannot target a review unit', {
          learning_unit_id: unit.learning_unit_id,
        });
      }
      const stored = await uow.acquisition.putLearningUnit(unit, null);
      const state = await uow.acquisition.getState(stored.learning_unit_id);
      if (!state || state.status !== 'candidate') {
        fail('INVALID_STATE_TRANSITION', 'Import did not create a candidate state', {
          learning_unit_id: stored.learning_unit_id,
        });
      }
      await uow.events.append(buildCandidateEvent(stored, eventId, command, occurredAt));
      if (await uow.review.getByLearningUnitId(stored.learning_unit_id)) {
        fail('REVIEW_STATE_BEFORE_GRADUATION', 'Candidate import created an unexpected ReviewState', {
          learning_unit_id: stored.learning_unit_id,
        });
      }
      candidates.push({
        learning_unit_id: stored.learning_unit_id,
        word_id: stored.word_id,
        lemma: stored.normalized_form,
        status: state.status,
        target_meaning: row.target_meaning,
        event_id: eventId,
      });
    }
    return {
      schema_version: 'exam-vocabulary-import-result.v1',
      import_id: importId,
      imported_count: candidates.length,
      review_state_count: 0,
      due_review_count: 0,
      candidates,
    };
  });
}
