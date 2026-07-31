import {
  CONTEXT_EVIDENCE_LICENSE_KINDS,
  CONTEXT_EVIDENCE_OWNERSHIP,
  CONTEXT_EVIDENCE_QUALITY_STATUSES,
  CONTEXT_EVIDENCE_SOURCE_KINDS,
  normalizeContextEvidence,
} from './vocabulary-context-evidence.js';
import { canonicalJson, sha256Utf8 } from './vocabulary-learning-uow.js';

export const EXAM_VOCABULARY_CONTEXT_MATCH_SCHEMA = 'exam-vocabulary-context-match.v1';

export const MISSING_CONTEXT_ACTIONS = Object.freeze([
  Object.freeze({
    action: 'wait_for_natural_encounter',
    label: '等待自然遇见',
    execution_phase: 'acquisition_only',
    requires_network: false,
    requires_user_confirmation: false,
    allowed_during_review: true,
  }),
  Object.freeze({
    action: 'import_licensed_corpus',
    label: '从许可语料导入',
    execution_phase: 'acquisition_only',
    requires_network: false,
    requires_user_confirmation: true,
    allowed_during_review: false,
  }),
  Object.freeze({
    action: 'request_optional_ai_candidate',
    label: '可选 AI 候选',
    execution_phase: 'acquisition_only',
    requires_network: true,
    requires_user_confirmation: true,
    allowed_during_review: false,
  }),
]);

const USER_CONTEXT_SOURCE_KINDS = new Set([
  CONTEXT_EVIDENCE_SOURCE_KINDS.ARTICLE,
  CONTEXT_EVIDENCE_SOURCE_KINDS.SUBTITLE,
  CONTEXT_EVIDENCE_SOURCE_KINDS.USER_LOCAL_EXAM_MATERIAL,
]);
const SOURCE_PRIORITY = new Map([
  [CONTEXT_EVIDENCE_SOURCE_KINDS.ARTICLE, 0],
  [CONTEXT_EVIDENCE_SOURCE_KINDS.SUBTITLE, 1],
  [CONTEXT_EVIDENCE_SOURCE_KINDS.USER_LOCAL_EXAM_MATERIAL, 2],
]);
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function matcherError(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'ExamVocabularyContextMatcherError';
  error.code = code;
  error.details = clone(details);
  return error;
}

function fail(code, message, details = {}) {
  throw matcherError(code, message, details);
}

function text(value, field, { nullable = false, lowercase = false } = {}) {
  if (nullable && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'string') fail('INVALID_FIELD_TYPE', 'Expected text', { field });
  let normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!normalized) {
    if (nullable) return null;
    fail('MISSING_REQUIRED_FIELD', 'Required text is missing', { field });
  }
  if (lowercase) normalized = normalized.toLocaleLowerCase('en-US');
  return normalized;
}

function timestamp(value, field) {
  if (typeof value !== 'string'
    || !UTC_TIMESTAMP.test(value)
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    fail('INVALID_TIMESTAMP', 'Expected a UTC timestamp', { field });
  }
  return value;
}

function nonNegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    fail('INVALID_FIELD_TYPE', 'Expected a non-negative integer', { field });
  }
  return value;
}

function normalizeCandidate(input) {
  if (!isPlainObject(input)) fail('INVALID_FIELD_TYPE', 'Candidate must be an object', { field: 'candidates' });
  return {
    learning_unit_id: text(input.learning_unit_id, 'candidate.learning_unit_id'),
    lemma: text(input.lemma ?? input.normalized_form, 'candidate.lemma', { lowercase: true }),
    target_meaning: text(input.target_meaning, 'candidate.target_meaning', { nullable: true }),
  };
}

function normalizeSourcePolicy(input, sourceKind) {
  if (sourceKind === CONTEXT_EVIDENCE_SOURCE_KINDS.USER_LOCAL_EXAM_MATERIAL) {
    return {
      license_kind: CONTEXT_EVIDENCE_LICENSE_KINDS.USER_OWNED,
      ownership: input.ownership ?? CONTEXT_EVIDENCE_OWNERSHIP.PRIVATE,
      quality_status: input.quality_status ?? CONTEXT_EVIDENCE_QUALITY_STATUSES.VALIDATED,
    };
  }
  const licenseKind = input.license_kind ?? CONTEXT_EVIDENCE_LICENSE_KINDS.UNKNOWN;
  return {
    license_kind: licenseKind,
    ownership: input.ownership ?? CONTEXT_EVIDENCE_OWNERSHIP.THIRD_PARTY,
    quality_status: licenseKind === CONTEXT_EVIDENCE_LICENSE_KINDS.UNKNOWN
      ? CONTEXT_EVIDENCE_QUALITY_STATUSES.PENDING
      : (input.quality_status ?? CONTEXT_EVIDENCE_QUALITY_STATUSES.VALIDATED),
  };
}

function normalizeDocument(input, documentIndex) {
  if (!isPlainObject(input)) fail('INVALID_FIELD_TYPE', 'Context document must be an object', { document_index: documentIndex });
  const sourceKind = text(input.source_kind, 'document.source_kind');
  if (!USER_CONTEXT_SOURCE_KINDS.has(sourceKind)) {
    fail('INVALID_ENUM_VALUE', 'Matcher only accepts user article, subtitle, or local exam sources', {
      source_kind: sourceKind,
      document_index: documentIndex,
    });
  }
  const sourceId = text(input.source_id, 'document.source_id');
  const sourceTitle = sourceKind === CONTEXT_EVIDENCE_SOURCE_KINDS.USER_LOCAL_EXAM_MATERIAL
    ? text(input.source_title, 'document.source_title', { nullable: true })
    : text(input.source_title, 'document.source_title');
  const policy = normalizeSourcePolicy(input, sourceKind);
  const rawEntries = sourceKind === CONTEXT_EVIDENCE_SOURCE_KINDS.SUBTITLE
    ? input.segments
    : input.sentences;
  if (!Array.isArray(rawEntries)) {
    fail('INVALID_FIELD_TYPE', 'Context document entries must be an array', {
      field: sourceKind === CONTEXT_EVIDENCE_SOURCE_KINDS.SUBTITLE ? 'segments' : 'sentences',
      document_index: documentIndex,
    });
  }

  const entries = rawEntries.map((rawEntry, entryIndex) => {
    const entry = typeof rawEntry === 'string' ? { sentence: rawEntry } : rawEntry;
    if (!isPlainObject(entry)) fail('INVALID_FIELD_TYPE', 'Context entry must be text or an object', { document_index: documentIndex, entry_index: entryIndex });
    const sentence = text(entry.sentence ?? entry.text, 'context_entry.sentence');
    let sourceLocator;
    if (sourceKind === CONTEXT_EVIDENCE_SOURCE_KINDS.ARTICLE) {
      sourceLocator = {
        locator_version: 'source-locator.v1',
        sentence_index: nonNegativeInteger(entry.sentence_index ?? entryIndex, 'context_entry.sentence_index'),
      };
    } else if (sourceKind === CONTEXT_EVIDENCE_SOURCE_KINDS.SUBTITLE) {
      const startMs = nonNegativeInteger(entry.start_ms, 'context_entry.start_ms');
      const endMs = nonNegativeInteger(entry.end_ms, 'context_entry.end_ms');
      if (endMs < startMs) fail('INVALID_FIELD_TYPE', 'Subtitle end must not precede start', { document_index: documentIndex, entry_index: entryIndex });
      sourceLocator = {
        locator_version: 'source-locator.v1',
        start_ms: startMs,
        end_ms: endMs,
      };
    } else {
      sourceLocator = {
        locator_version: 'source-locator.v1',
        local_locator: text(
          entry.local_locator ?? `sentence:${entryIndex}`,
          'context_entry.local_locator',
        ),
      };
    }
    return {
      sentence,
      surrounding_text: text(entry.surrounding_text, 'context_entry.surrounding_text', { nullable: true }),
      source_locator: sourceLocator,
    };
  });

  return {
    source_kind: sourceKind,
    source_id: sourceId,
    source_title: sourceTitle,
    ...policy,
    entries,
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function containsLemma(sentence, lemma) {
  const expression = new RegExp(
    `(?<![\\p{L}\\p{M}])${escapeRegExp(lemma).replace(/\s+/gu, '\\s+')}(?![\\p{L}\\p{M}])`,
    'iu',
  );
  return expression.test(sentence.normalize('NFKC'));
}

function matchIdentity(candidate, document, entry) {
  return sha256Utf8(canonicalJson({
    learning_unit_id: candidate.learning_unit_id,
    source_kind: document.source_kind,
    source_id: document.source_id,
    source_locator: entry.source_locator,
    sentence: entry.sentence,
  }));
}

function buildMatch(candidate, document, entry) {
  return {
    match_id: `exam-context-match:${matchIdentity(candidate, document, entry)}`,
    learning_unit_id: candidate.learning_unit_id,
    lemma: candidate.lemma,
    sentence: entry.sentence,
    surrounding_text: entry.surrounding_text,
    source_kind: document.source_kind,
    source_id: document.source_id,
    source_title: document.source_title,
    source_locator: clone(entry.source_locator),
    license_kind: document.license_kind,
    ownership: document.ownership,
    quality_status: document.quality_status,
    requires_validation: document.quality_status !== CONTEXT_EVIDENCE_QUALITY_STATUSES.VALIDATED,
  };
}

export function matchExamVocabularyCandidatesToUserContexts(candidates, documents, options = {}) {
  if (!Array.isArray(candidates)) fail('INVALID_FIELD_TYPE', 'candidates must be an array', { field: 'candidates' });
  if (!Array.isArray(documents)) fail('INVALID_FIELD_TYPE', 'documents must be an array', { field: 'documents' });
  if (!isPlainObject(options)) fail('INVALID_FIELD_TYPE', 'Matcher options must be an object', { field: 'options' });
  const maxMatchesPerCandidate = options.max_matches_per_candidate ?? 5;
  if (!Number.isInteger(maxMatchesPerCandidate) || maxMatchesPerCandidate < 1) {
    fail('INVALID_FIELD_TYPE', 'max_matches_per_candidate must be a positive integer', {
      field: 'options.max_matches_per_candidate',
    });
  }
  const normalizedCandidates = candidates.map(normalizeCandidate);
  const normalizedDocuments = documents
    .map(normalizeDocument)
    .sort((left, right) => (
      SOURCE_PRIORITY.get(left.source_kind) - SOURCE_PRIORITY.get(right.source_kind)
      || left.source_id.localeCompare(right.source_id)
    ));

  const results = normalizedCandidates.map((candidate) => {
    const matches = [];
    for (const document of normalizedDocuments) {
      for (const entry of document.entries) {
        if (containsLemma(entry.sentence, candidate.lemma)) {
          matches.push(buildMatch(candidate, document, entry));
          if (matches.length >= maxMatchesPerCandidate) break;
        }
      }
      if (matches.length >= maxMatchesPerCandidate) break;
    }
    return {
      learning_unit_id: candidate.learning_unit_id,
      lemma: candidate.lemma,
      matches,
      has_validated_match: matches.some((match) => !match.requires_validation),
    };
  });
  const gaps = results
    .filter((result) => result.matches.length === 0)
    .map((result) => ({
      learning_unit_id: result.learning_unit_id,
      lemma: result.lemma,
      actions: clone(MISSING_CONTEXT_ACTIONS),
    }));
  const validationGaps = results
    .filter((result) => result.matches.length > 0 && !result.has_validated_match)
    .map((result) => ({
      learning_unit_id: result.learning_unit_id,
      lemma: result.lemma,
      match_ids: result.matches.map((match) => match.match_id),
      reason: 'MATCH_REQUIRES_SOURCE_OR_LICENSE_VALIDATION',
    }));

  return {
    schema_version: EXAM_VOCABULARY_CONTEXT_MATCH_SCHEMA,
    searched_source_order: [
      CONTEXT_EVIDENCE_SOURCE_KINDS.ARTICLE,
      CONTEXT_EVIDENCE_SOURCE_KINDS.SUBTITLE,
      CONTEXT_EVIDENCE_SOURCE_KINDS.USER_LOCAL_EXAM_MATERIAL,
    ],
    results,
    gaps,
    validation_gaps: validationGaps,
    runtime_api_calls: 0,
    review_api_calls: 0,
  };
}

export function createContextEvidenceFromUserMatch(match, options = {}) {
  if (!isPlainObject(match)) fail('INVALID_FIELD_TYPE', 'match must be an object', { field: 'match' });
  if (!isPlainObject(options)) fail('INVALID_FIELD_TYPE', 'Evidence options must be an object', { field: 'options' });
  const createdAt = timestamp(options.created_at, 'options.created_at');
  const qualityStatus = options.confirmed === true
    && match.license_kind !== CONTEXT_EVIDENCE_LICENSE_KINDS.UNKNOWN
    ? CONTEXT_EVIDENCE_QUALITY_STATUSES.VALIDATED
    : match.quality_status;
  return normalizeContextEvidence({
    schema_version: 'context-evidence.v1',
    context_evidence_id: options.context_evidence_id
      ?? `context-evidence:${sha256Utf8(match.match_id)}`,
    learning_unit_id: match.learning_unit_id,
    sentence: match.sentence,
    surrounding_text: match.surrounding_text,
    source_kind: match.source_kind,
    source_id: match.source_id,
    source_title: match.source_title,
    source_locator: match.source_locator,
    license_kind: match.license_kind,
    ownership: match.ownership,
    quality_status: qualityStatus,
    quality_reason: options.confirmed === true ? 'user_confirmed_source_and_context' : null,
    created_at: createdAt,
    validated_at: qualityStatus === CONTEXT_EVIDENCE_QUALITY_STATUSES.VALIDATED
      ? (options.validated_at ?? createdAt)
      : null,
    revision: 0,
    extensions: {},
  });
}

export function createLicensedCorpusContextEvidence(candidateInput, record, options = {}) {
  const candidate = normalizeCandidate(candidateInput);
  if (!isPlainObject(record)) fail('INVALID_FIELD_TYPE', 'Licensed corpus record must be an object', { field: 'record' });
  if (!isPlainObject(options)) fail('INVALID_FIELD_TYPE', 'Evidence options must be an object', { field: 'options' });
  const createdAt = timestamp(options.created_at, 'options.created_at');
  if (options.user_confirmed !== true) {
    fail('INVALID_STATE_TRANSITION', 'Licensed corpus evidence requires explicit user confirmation', {
      field: 'options.user_confirmed',
    });
  }
  const sentence = text(record.sentence, 'record.sentence');
  if (!containsLemma(sentence, candidate.lemma)) {
    fail('INVALID_CONTEXT_REFERENCE', 'Licensed corpus sentence does not contain the candidate lemma', {
      learning_unit_id: candidate.learning_unit_id,
    });
  }
  const sourceId = text(record.source_id, 'record.source_id');
  const recordId = text(record.record_id, 'record.record_id');
  return normalizeContextEvidence({
    schema_version: 'context-evidence.v1',
    context_evidence_id: options.context_evidence_id
      ?? `context-evidence:${sha256Utf8(canonicalJson({
        learning_unit_id: candidate.learning_unit_id,
        source_id: sourceId,
        record_id: recordId,
      }))}`,
    learning_unit_id: candidate.learning_unit_id,
    sentence,
    surrounding_text: text(record.surrounding_text, 'record.surrounding_text', { nullable: true }),
    source_kind: CONTEXT_EVIDENCE_SOURCE_KINDS.OPEN_CORPUS,
    source_id: sourceId,
    source_title: text(record.source_title, 'record.source_title', { nullable: true }),
    source_locator: {
      locator_version: 'source-locator.v1',
      record_id: recordId,
    },
    license_kind: CONTEXT_EVIDENCE_LICENSE_KINDS.LICENSED_OPEN,
    ownership: record.ownership ?? CONTEXT_EVIDENCE_OWNERSHIP.PUBLIC,
    quality_status: CONTEXT_EVIDENCE_QUALITY_STATUSES.VALIDATED,
    quality_reason: 'user_confirmed_licensed_corpus_context',
    created_at: createdAt,
    validated_at: options.validated_at ?? createdAt,
    revision: 0,
    extensions: {
      license_reference: text(record.license_reference, 'record.license_reference'),
    },
  });
}
