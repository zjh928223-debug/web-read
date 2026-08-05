/**
 * Deterministic sentence selection for a target sense.
 *
 * This file is intentionally self-contained.  It accepts the flat source
 * fields used by sentence-source-policy.js as well as a nested `source` or
 * `provenance` object, so Wave B can add one adapter without coupling this
 * policy to storage or runtime code.
 */

export const SENTENCE_CANDIDATE_RANKING_VERSION = 'sentence-candidate-ranking.v1';
export const SENTENCE_CANDIDATE_RANKING_SCHEMA_VERSION = SENTENCE_CANDIDATE_RANKING_VERSION;

export const SENTENCE_RANKING_USE_CASES = Object.freeze({
  FIRST_PREVIEW: 'first_preview',
  REVIEW: 'review',
  LATE_CONTEXT_TRANSFER: 'late_context_transfer',
});

export const SENTENCE_CANDIDATE_STATUSES = Object.freeze({
  ELIGIBLE: 'eligible',
  REJECTED: 'rejected',
});

const SOURCE_KIND = Object.freeze({
  ARTICLE: 'article',
  SUBTITLE: 'subtitle',
  USER_LOCAL_EXAM_MATERIAL: 'user_local_exam_material',
  OPEN_CORPUS: 'open_corpus',
  DICTIONARY_EXAMPLE: 'dictionary_example',
  AI_CANDIDATE: 'ai_candidate',
  UNKNOWN: 'unknown',
});

const LICENSE_KIND = Object.freeze({
  USER_OWNED: 'user_owned',
  LICENSED_OPEN: 'licensed_open',
  DICTIONARY_TERMS: 'dictionary_terms',
  AI_GENERATED: 'ai_generated',
  UNKNOWN: 'unknown',
});

const OWNERSHIP = Object.freeze({
  USER: 'user',
  PRIVATE: 'private',
  THIRD_PARTY: 'third_party',
  PUBLIC: 'public',
  UNKNOWN: 'unknown',
});

const QUALITY_STATUS = Object.freeze({
  PENDING: 'pending',
  VALIDATED: 'validated',
  REJECTED: 'rejected',
});

const CONTENT_STATUS = Object.freeze({
  AUTHENTIC: 'authentic',
  GENERATED: 'generated',
  UNKNOWN: 'unknown',
});

const SOURCE_ALIASES = new Map([
  ['article', SOURCE_KIND.ARTICLE],
  ['user_article', SOURCE_KIND.ARTICLE],
  ['subtitle', SOURCE_KIND.SUBTITLE],
  ['captions', SOURCE_KIND.SUBTITLE],
  ['transcript', SOURCE_KIND.SUBTITLE],
  ['user_local_exam_material', SOURCE_KIND.USER_LOCAL_EXAM_MATERIAL],
  ['local_exam', SOURCE_KIND.USER_LOCAL_EXAM_MATERIAL],
  ['user_local_exam', SOURCE_KIND.USER_LOCAL_EXAM_MATERIAL],
  ['exam_material', SOURCE_KIND.USER_LOCAL_EXAM_MATERIAL],
  ['local_copyrighted', SOURCE_KIND.USER_LOCAL_EXAM_MATERIAL],
  ['local_copyrighted_exam', SOURCE_KIND.USER_LOCAL_EXAM_MATERIAL],
  ['exam_original', SOURCE_KIND.USER_LOCAL_EXAM_MATERIAL],
  ['copyrighted_exam', SOURCE_KIND.USER_LOCAL_EXAM_MATERIAL],
  ['ielts', SOURCE_KIND.USER_LOCAL_EXAM_MATERIAL],
  ['open_corpus', SOURCE_KIND.OPEN_CORPUS],
  ['open', SOURCE_KIND.OPEN_CORPUS],
  ['dictionary_example', SOURCE_KIND.DICTIONARY_EXAMPLE],
  ['dictionary', SOURCE_KIND.DICTIONARY_EXAMPLE],
  ['ai_candidate', SOURCE_KIND.AI_CANDIDATE],
  ['ai_generated', SOURCE_KIND.AI_CANDIDATE],
  ['ai-generated', SOURCE_KIND.AI_CANDIDATE],
  ['generated', SOURCE_KIND.AI_CANDIDATE],
  ['unknown', SOURCE_KIND.UNKNOWN],
]);

const LICENSE_ALIASES = new Map([
  ['user_owned', LICENSE_KIND.USER_OWNED],
  ['user-owned', LICENSE_KIND.USER_OWNED],
  ['owned', LICENSE_KIND.USER_OWNED],
  ['licensed_open', LICENSE_KIND.LICENSED_OPEN],
  ['licensed-open', LICENSE_KIND.LICENSED_OPEN],
  ['open', LICENSE_KIND.LICENSED_OPEN],
  ['open_license', LICENSE_KIND.LICENSED_OPEN],
  ['dictionary_terms', LICENSE_KIND.DICTIONARY_TERMS],
  ['dictionary-terms', LICENSE_KIND.DICTIONARY_TERMS],
  ['dictionary', LICENSE_KIND.DICTIONARY_TERMS],
  ['ai_generated', LICENSE_KIND.AI_GENERATED],
  ['ai-generated', LICENSE_KIND.AI_GENERATED],
  ['generated', LICENSE_KIND.AI_GENERATED],
  ['unknown', LICENSE_KIND.UNKNOWN],
  ['', LICENSE_KIND.UNKNOWN],
]);

const OWNERSHIP_ALIASES = new Map([
  ['user', OWNERSHIP.USER],
  ['user_owned', OWNERSHIP.USER],
  ['private', OWNERSHIP.PRIVATE],
  ['personal', OWNERSHIP.PRIVATE],
  ['third_party', OWNERSHIP.THIRD_PARTY],
  ['third-party', OWNERSHIP.THIRD_PARTY],
  ['public', OWNERSHIP.PUBLIC],
  ['unknown', OWNERSHIP.UNKNOWN],
  ['', OWNERSHIP.UNKNOWN],
]);

const QUALITY_ALIASES = new Map([
  ['pending', QUALITY_STATUS.PENDING],
  ['unreviewed', QUALITY_STATUS.PENDING],
  ['validated', QUALITY_STATUS.VALIDATED],
  ['approved', QUALITY_STATUS.VALIDATED],
  ['rejected', QUALITY_STATUS.REJECTED],
  ['invalid', QUALITY_STATUS.REJECTED],
  ['', QUALITY_STATUS.PENDING],
]);

const CONTENT_ALIASES = new Map([
  ['authentic', CONTENT_STATUS.AUTHENTIC],
  ['real', CONTENT_STATUS.AUTHENTIC],
  ['human', CONTENT_STATUS.AUTHENTIC],
  ['original', CONTENT_STATUS.AUTHENTIC],
  ['generated', CONTENT_STATUS.GENERATED],
  ['ai_generated', CONTENT_STATUS.GENERATED],
  ['ai-generated', CONTENT_STATUS.GENERATED],
  ['unknown', CONTENT_STATUS.UNKNOWN],
  ['', CONTENT_STATUS.UNKNOWN],
]);

const USE_CASE_ALIASES = new Map([
  ['first_preview', SENTENCE_RANKING_USE_CASES.FIRST_PREVIEW],
  ['first-preview', SENTENCE_RANKING_USE_CASES.FIRST_PREVIEW],
  ['preview', SENTENCE_RANKING_USE_CASES.FIRST_PREVIEW],
  ['review', SENTENCE_RANKING_USE_CASES.REVIEW],
  ['late_context_transfer', SENTENCE_RANKING_USE_CASES.LATE_CONTEXT_TRANSFER],
  ['late-context-transfer', SENTENCE_RANKING_USE_CASES.LATE_CONTEXT_TRANSFER],
  ['context_transfer', SENTENCE_RANKING_USE_CASES.LATE_CONTEXT_TRANSFER],
]);

const SOURCE_PRIORITY = new Map([
  [SOURCE_KIND.ARTICLE, 0],
  [SOURCE_KIND.SUBTITLE, 0],
  [SOURCE_KIND.OPEN_CORPUS, 1],
  [SOURCE_KIND.DICTIONARY_EXAMPLE, 2],
  [SOURCE_KIND.USER_LOCAL_EXAM_MATERIAL, 3],
  [SOURCE_KIND.AI_CANDIDATE, 4],
  [SOURCE_KIND.UNKNOWN, 5],
]);

const DEFAULT_LIMITS = Object.freeze({
  [SENTENCE_RANKING_USE_CASES.FIRST_PREVIEW]: Object.freeze({
    max_word_count: 20,
    max_clause_depth: 1,
    max_structure_difficulty: 2,
    max_non_target_unknown_ratio: 0.25,
  }),
  [SENTENCE_RANKING_USE_CASES.REVIEW]: Object.freeze({
    max_word_count: 36,
    max_clause_depth: 3,
    max_structure_difficulty: 4,
    max_non_target_unknown_ratio: 0.45,
  }),
  [SENTENCE_RANKING_USE_CASES.LATE_CONTEXT_TRANSFER]: Object.freeze({
    max_word_count: 80,
    max_clause_depth: 6,
    max_structure_difficulty: 8,
    max_non_target_unknown_ratio: 0.7,
  }),
});

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneJson(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(cloneJson);
  const result = {};
  for (const key of Object.keys(value)) result[key] = cloneJson(value[key]);
  return result;
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function normalizeKey(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function normalizeRatio(value) {
  const number = normalizeNumber(value);
  if (number === null) return null;
  if (number > 1 && number <= 100) return number / 100;
  return Math.max(0, Math.min(1, number));
}

function normalizeAlias(value, aliases, fallback) {
  const normalized = normalizeText(value).toLocaleLowerCase('en-US');
  return aliases.get(normalized) ?? fallback;
}

function nestedMetadata(candidate) {
  const source = typeof candidate.source === 'string'
    ? { source_kind: candidate.source }
    : (isPlainObject(candidate.source) ? candidate.source : {});
  const provenance = isPlainObject(candidate.provenance) ? candidate.provenance : {};
  const normalizedSource = isPlainObject(candidate.normalized_source) ? candidate.normalized_source : {};
  const metrics = isPlainObject(candidate.metrics) ? candidate.metrics : {};
  const features = isPlainObject(candidate.features) ? candidate.features : {};
  return { ...source, ...normalizedSource, ...provenance, ...metrics, ...features };
}

function field(candidate, metadata, ...names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(candidate, name)) return candidate[name];
    if (Object.prototype.hasOwnProperty.call(metadata, name)) return metadata[name];
  }
  return undefined;
}

function normalizeGeneratedFlag(value) {
  if (value === undefined) return { present: false, value: false, invalid: false };
  if (typeof value === 'boolean') return { present: true, value, invalid: false };
  if (typeof value === 'number') {
    if (value === 1) return { present: true, value: true, invalid: false };
    if (value === 0) return { present: true, value: false, invalid: false };
    return { present: true, value: true, invalid: true };
  }
  if (typeof value === 'string') {
    const normalized = normalizeText(value).toLocaleLowerCase('en-US');
    if (['true', '1', 'yes', 'y', 'on', 'generated', 'ai_generated', 'ai-generated'].includes(normalized)) {
      return { present: true, value: true, invalid: false };
    }
    if (['false', '0', 'no', 'n', 'off', 'authentic', 'real'].includes(normalized)) {
      return { present: true, value: false, invalid: false };
    }
  }
  return { present: true, value: true, invalid: true };
}

function normalizeContentStatusValue(value, fallback) {
  if (value === undefined || value === null) {
    return { status: fallback, invalid: false };
  }
  if (typeof value !== 'string') return { status: CONTENT_STATUS.GENERATED, invalid: true };
  const normalized = normalizeText(value).toLocaleLowerCase('en-US');
  if (!normalized) return { status: fallback, invalid: false };
  const status = CONTENT_ALIASES.get(normalized);
  return status
    ? { status, invalid: false }
    : { status: CONTENT_STATUS.GENERATED, invalid: true };
}

function hasLocatorText(locator, fieldName) {
  return typeof locator?.[fieldName] === 'string' && Boolean(normalizeText(locator[fieldName]));
}

function hasLocatorInteger(locator, fieldName) {
  return Number.isInteger(locator?.[fieldName]) && locator[fieldName] >= 0;
}

function hasRequiredProvenance(sourceKind, sourceId, sourceTitle, sourceLocator) {
  if (sourceKind === SOURCE_KIND.AI_CANDIDATE) return false;
  if (
    !sourceId
      || !isPlainObject(sourceLocator)
      || !hasLocatorText(sourceLocator, 'locator_version')
      || sourceLocator.locator_version !== 'source-locator.v1'
  ) return false;
  switch (sourceKind) {
    case SOURCE_KIND.ARTICLE:
      return Boolean(sourceTitle) && hasLocatorInteger(sourceLocator, 'sentence_index');
    case SOURCE_KIND.SUBTITLE:
      return Boolean(sourceTitle)
        && hasLocatorInteger(sourceLocator, 'start_ms')
        && hasLocatorInteger(sourceLocator, 'end_ms')
        && sourceLocator.end_ms >= sourceLocator.start_ms;
    case SOURCE_KIND.USER_LOCAL_EXAM_MATERIAL:
      return hasLocatorText(sourceLocator, 'local_locator');
    case SOURCE_KIND.OPEN_CORPUS:
      return hasLocatorText(sourceLocator, 'record_id');
    case SOURCE_KIND.DICTIONARY_EXAMPLE:
      return hasLocatorText(sourceLocator, 'entry_id');
    default:
      return false;
  }
}

function defaultSourceValues(sourceKind) {
  switch (sourceKind) {
    case SOURCE_KIND.USER_LOCAL_EXAM_MATERIAL:
      return {
        license_kind: LICENSE_KIND.UNKNOWN,
        ownership: OWNERSHIP.UNKNOWN,
        content_status: CONTENT_STATUS.UNKNOWN,
      };
    case SOURCE_KIND.OPEN_CORPUS:
      return {
        license_kind: LICENSE_KIND.UNKNOWN,
        ownership: OWNERSHIP.UNKNOWN,
        content_status: CONTENT_STATUS.UNKNOWN,
      };
    case SOURCE_KIND.DICTIONARY_EXAMPLE:
      return {
        license_kind: LICENSE_KIND.UNKNOWN,
        ownership: OWNERSHIP.UNKNOWN,
        content_status: CONTENT_STATUS.UNKNOWN,
      };
    case SOURCE_KIND.AI_CANDIDATE:
      return {
        license_kind: LICENSE_KIND.UNKNOWN,
        ownership: OWNERSHIP.UNKNOWN,
        content_status: CONTENT_STATUS.GENERATED,
      };
    default:
      return {
        license_kind: LICENSE_KIND.UNKNOWN,
        ownership: OWNERSHIP.UNKNOWN,
        content_status: CONTENT_STATUS.UNKNOWN,
      };
  }
}

function normalizeSource(candidate) {
  const metadata = nestedMetadata(candidate);
  const sourceValue = field(candidate, metadata, 'source_kind', 'source_type', 'kind', 'type');
  const sourceKind = normalizeAlias(sourceValue, SOURCE_ALIASES, SOURCE_KIND.UNKNOWN);
  const defaults = defaultSourceValues(sourceKind);
  const generatedFlag = normalizeGeneratedFlag(field(candidate, metadata, 'generated', 'is_generated'));
  const contentStatusInput = normalizeContentStatusValue(
    field(candidate, metadata, 'content_status', 'generation_status'),
    defaults.content_status,
  );
  const licenseKind = normalizeAlias(field(candidate, metadata, 'license_kind'), LICENSE_ALIASES, LICENSE_KIND.UNKNOWN);
  const ownership = normalizeAlias(field(candidate, metadata, 'ownership'), OWNERSHIP_ALIASES, OWNERSHIP.UNKNOWN);
  let contentStatus = contentStatusInput.status;
  const generatedHint = generatedFlag.value
    || generatedFlag.invalid
    || contentStatusInput.invalid
    || sourceKind === SOURCE_KIND.AI_CANDIDATE
    || licenseKind === LICENSE_KIND.AI_GENERATED;
  if (generatedHint) contentStatus = CONTENT_STATUS.GENERATED;
  const generated = contentStatus === CONTENT_STATUS.GENERATED;
  let qualityStatus = normalizeAlias(
    field(candidate, metadata, 'quality_status', 'validation_status') ?? QUALITY_STATUS.PENDING,
    QUALITY_ALIASES,
    QUALITY_STATUS.PENDING,
  );
  if (generated || sourceKind === SOURCE_KIND.UNKNOWN || licenseKind === LICENSE_KIND.UNKNOWN) qualityStatus = QUALITY_STATUS.PENDING;
  const sourceId = normalizeKey(field(candidate, metadata, 'source_id'));
  const sourceTitle = normalizeText(field(candidate, metadata, 'source_title')) || null;
  const sourceLocator = isPlainObject(field(candidate, metadata, 'source_locator'))
    ? cloneJson(field(candidate, metadata, 'source_locator'))
    : null;
  const provenanceComplete = hasRequiredProvenance(sourceKind, sourceId, sourceTitle, sourceLocator);
  const compatible = sourceCompatibility(sourceKind, licenseKind, ownership);
  const validatedAnchor = Boolean(
    !compatible
      && sourceKind !== SOURCE_KIND.UNKNOWN
      && licenseKind !== LICENSE_KIND.UNKNOWN
      && ownership !== OWNERSHIP.UNKNOWN
      && licenseKind !== LICENSE_KIND.AI_GENERATED
      && contentStatus === CONTENT_STATUS.AUTHENTIC
      && qualityStatus === QUALITY_STATUS.VALIDATED
      && provenanceComplete
      && !generatedFlag.invalid
      && !contentStatusInput.invalid,
  );
  return {
    source_kind: sourceKind,
    source_type: sourceKind,
    source_id: sourceId,
    source_title: sourceTitle,
    source_locator: sourceLocator,
    license_kind: licenseKind,
    ownership,
    quality_status: qualityStatus,
    content_status: contentStatus,
    generated,
    authentic: contentStatus === CONTENT_STATUS.AUTHENTIC && !generated,
    generated_flag_valid: !generatedFlag.invalid,
    provenance_complete: provenanceComplete,
    validated_authentic_anchor: validatedAnchor,
    is_validated_authentic_anchor: validatedAnchor,
    compatibility_error: compatible,
  };
}

function sourceCompatibility(sourceKind, licenseKind, ownership) {
  if (sourceKind === SOURCE_KIND.AI_CANDIDATE && licenseKind !== LICENSE_KIND.AI_GENERATED) {
    return { code: 'AI_SOURCE_LICENSE_MISMATCH', message: 'AI candidates must use the ai_generated license kind.', details: {} };
  }
  if (sourceKind === SOURCE_KIND.USER_LOCAL_EXAM_MATERIAL && (
    licenseKind !== LICENSE_KIND.USER_OWNED
      || ![OWNERSHIP.USER, OWNERSHIP.PRIVATE].includes(ownership)
  )) {
    return { code: 'LOCAL_EXAM_PROVENANCE_MISMATCH', message: 'Local exam material must remain user-owned and private.', details: {} };
  }
  if (sourceKind === SOURCE_KIND.OPEN_CORPUS && licenseKind !== LICENSE_KIND.LICENSED_OPEN) {
    return { code: 'OPEN_SOURCE_LICENSE_MISMATCH', message: 'Open corpus material needs an explicit open license.', details: {} };
  }
  if (sourceKind === SOURCE_KIND.DICTIONARY_EXAMPLE && ![
    LICENSE_KIND.DICTIONARY_TERMS,
    LICENSE_KIND.LICENSED_OPEN,
  ].includes(licenseKind)) {
    return { code: 'DICTIONARY_SOURCE_LICENSE_MISMATCH', message: 'Dictionary examples need dictionary terms or an open license.', details: {} };
  }
  return null;
}

function normalizeUseCase(value) {
  return normalizeAlias(value, USE_CASE_ALIASES, SENTENCE_RANKING_USE_CASES.FIRST_PREVIEW);
}

function targetSenseKey(value) {
  if (typeof value === 'string' || typeof value === 'number') return normalizeKey(String(value));
  if (!isPlainObject(value)) return null;
  return normalizeKey(value.target_sense_key ?? value.sense_key ?? value.senseKey ?? value.key ?? value.id);
}

function candidateSenseMatch(candidate, targetKey) {
  if (!targetKey) return { matches: false, explicit: false };
  const metadata = nestedMetadata(candidate);
  const explicitMatch = field(candidate, metadata, 'target_sense_match', 'sense_match', 'matches_target_sense');
  if (typeof explicitMatch === 'boolean') return { matches: explicitMatch, explicit: true };
  const matchScore = normalizeNumber(field(candidate, metadata, 'target_sense_match_score', 'sense_match_score'));
  if (matchScore !== null) return { matches: matchScore >= 0.5, explicit: true, score: Math.max(0, Math.min(1, matchScore)) };
  const directKey = targetSenseKey(field(candidate, metadata, 'target_sense_key', 'sense_key', 'senseKey'));
  if (directKey) return { matches: directKey === targetKey, explicit: true, score: directKey === targetKey ? 1 : 0 };
  const keys = field(candidate, metadata, 'target_sense_keys', 'sense_keys', 'matched_sense_keys');
  if (Array.isArray(keys)) {
    const normalizedKeys = keys.map(targetSenseKey).filter(Boolean);
    return { matches: normalizedKeys.includes(targetKey), explicit: true, score: normalizedKeys.includes(targetKey) ? 1 : 0 };
  }
  return { matches: false, explicit: false, score: null };
}

function wordsFromSentence(sentence) {
  const matches = normalizeText(sentence).match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?/gu);
  return matches ? matches.length : 0;
}

function normalizeWordCount(candidate, metadata, sentence) {
  const supplied = normalizeNumber(field(
    candidate,
    metadata,
    'word_count',
    'sentence_word_count',
    'length_words',
    'sentence_length',
    'word_length',
  ));
  if (supplied !== null) return Math.max(0, supplied);
  return wordsFromSentence(sentence);
}

function normalizeDifficulty(value) {
  const numeric = normalizeNumber(value);
  if (numeric !== null) return Math.max(0, numeric);
  const text = normalizeText(value).toLocaleLowerCase('en-US');
  if (text === 'simple' || text === 'easy' || text === 'low') return 0;
  if (text === 'medium' || text === 'moderate') return 1;
  if (text === 'complex' || text === 'hard' || text === 'high') return 3;
  return null;
}

function normalizeClauseDepth(candidate, metadata, sentence) {
  const direct = normalizeDifficulty(field(
    candidate,
    metadata,
    'clause_depth',
    'subordination_depth',
    'subordinate_clause_depth',
    'clause_depth_score',
  ));
  if (direct !== null) return direct;
  const clauseCount = normalizeNumber(field(candidate, metadata, 'clause_count', 'clauses'));
  if (clauseCount !== null) return Math.max(0, clauseCount - 1);
  const punctuation = (normalizeText(sentence).match(/[,;:]/gu) ?? []).length;
  return Math.min(4, punctuation);
}

function normalizeStructureDifficulty(candidate, metadata, clauseDepth) {
  const direct = normalizeDifficulty(field(
    candidate,
    metadata,
    'structure_difficulty',
    'sentence_difficulty',
    'difficulty_score',
  ));
  return direct === null ? clauseDepth : direct;
}

function normalizeUnknownRatio(candidate, metadata) {
  return normalizeRatio(field(
    candidate,
    metadata,
    'non_target_unknown_ratio',
    'non_target_learner_unknown_ratio',
    'non_target_unknown_word_ratio',
    'unknown_word_ratio',
    'unknown_ratio',
    'non_target_unknown_rate',
  ));
}

function normalizeIndependentComprehensibility(candidate, metadata) {
  const value = field(
    candidate,
    metadata,
    'independent_comprehensibility',
    'independent_understanding',
    'independent_comprehensibility_score',
    'context_independence',
    'self_contained',
    'can_stand_alone',
  );
  if (typeof value === 'boolean') return value ? 1 : 0;
  const number = normalizeNumber(value);
  if (number !== null) return number > 1 ? Math.max(0, Math.min(1, number / 100)) : Math.max(0, Math.min(1, number));
  return null;
}

function normalizeNaturalness(candidate, metadata) {
  const value = normalizeNumber(field(candidate, metadata, 'naturalness', 'naturalness_score', 'fluency_score'));
  if (value === null) return null;
  return value > 1 ? Math.max(0, Math.min(1, value / 100)) : Math.max(0, Math.min(1, value));
}

function sourcePolicyFailures(source, useCase, options) {
  const failures = [];
  if (source.source_kind === SOURCE_KIND.UNKNOWN) {
    failures.push({ code: 'SOURCE_TYPE_UNKNOWN', message: 'A known sentence source type is required.', details: {} });
  }
  if (source.license_kind === LICENSE_KIND.UNKNOWN) {
    failures.push({ code: 'LICENSE_UNKNOWN', message: 'Unknown license cannot be selected as an authentic anchor.', details: {} });
  }
  if (source.source_kind !== SOURCE_KIND.AI_CANDIDATE && !source.provenance_complete) {
    failures.push({ code: 'PROVENANCE_INCOMPLETE', message: 'Source ID, locator, and source-specific provenance are required.', details: {} });
  }
  if (source.quality_status === QUALITY_STATUS.REJECTED) {
    failures.push({ code: 'SOURCE_REJECTED', message: 'Rejected sentence evidence is not eligible.', details: {} });
  }
  if (source.compatibility_error) failures.push(cloneJson(source.compatibility_error));
  if (source.generated && options.allow_generated !== true) {
    failures.push({
      code: 'GENERATED_NOT_AUTHENTIC_ANCHOR',
      message: 'AI-generated text is auxiliary-only and cannot be the default authentic anchor.',
      details: {},
    });
  }
  if (source.source_kind === SOURCE_KIND.USER_LOCAL_EXAM_MATERIAL && useCase !== SENTENCE_RANKING_USE_CASES.LATE_CONTEXT_TRANSFER) {
    failures.push({
      code: 'LOCAL_EXAM_NOT_FIRST_PREVIEW',
      message: 'User-local exam material is allowed only for late context transfer.',
      details: { use_case: useCase },
    });
  }
  const requireValidatedAnchor = options.require_validated_anchor
    ?? useCase === SENTENCE_RANKING_USE_CASES.FIRST_PREVIEW;
  if (requireValidatedAnchor && !source.validated_authentic_anchor) {
    failures.push({
      code: 'NOT_VALIDATED_AUTHENTIC_ANCHOR',
      message: 'The caller requires a validated authentic anchor.',
      details: {},
    });
  }
  if (requireValidatedAnchor && !source.provenance_complete && !failures.some((item) => item.code === 'PROVENANCE_INCOMPLETE')) {
    failures.push({
      code: 'PROVENANCE_INCOMPLETE',
      message: 'Validated anchor selection requires complete source provenance.',
      details: {},
    });
  }
  return failures;
}

function limitsFor(useCase, options) {
  const defaults = DEFAULT_LIMITS[useCase];
  const overrides = isPlainObject(options.limits) ? options.limits : {};
  return {
    max_word_count: normalizeNumber(overrides.max_word_count ?? options.max_word_count) ?? defaults.max_word_count,
    max_clause_depth: normalizeNumber(overrides.max_clause_depth ?? options.max_clause_depth) ?? defaults.max_clause_depth,
    max_structure_difficulty: normalizeNumber(overrides.max_structure_difficulty ?? options.max_structure_difficulty) ?? defaults.max_structure_difficulty,
    max_non_target_unknown_ratio: normalizeRatio(overrides.max_non_target_unknown_ratio ?? options.max_non_target_unknown_ratio)
      ?? defaults.max_non_target_unknown_ratio,
  };
}

function hardFailures(candidate, normalized, metrics, targetKey, useCase, options, limits) {
  const failures = [];
  if (!metrics.sentence) failures.push({ code: 'EMPTY_SENTENCE', message: 'Sentence text is empty after normalization.', details: {} });
  if (!targetKey) failures.push({ code: 'TARGET_SENSE_UNKNOWN', message: 'A target sense is required for sentence selection.', details: {} });
  const senseMatch = candidateSenseMatch(candidate, targetKey);
  if (targetKey && (!senseMatch.explicit || !senseMatch.matches)) {
    failures.push({
      code: senseMatch.explicit ? 'TARGET_SENSE_MISMATCH' : 'TARGET_SENSE_NOT_VERIFIED',
      message: senseMatch.explicit
        ? 'The sentence candidate does not express the requested target sense.'
        : 'The candidate does not provide target-sense evidence.',
      details: { target_sense_key: targetKey },
    });
  }
  failures.push(...sourcePolicyFailures(normalized, useCase, options));
  if (metrics.word_count > limits.max_word_count) {
    failures.push({
      code: 'SENTENCE_TOO_LONG',
      message: 'Sentence exceeds the word-count limit for this use case.',
      details: { word_count: metrics.word_count, limit: limits.max_word_count },
    });
  }
  if (metrics.clause_depth > limits.max_clause_depth) {
    failures.push({
      code: 'STRUCTURE_TOO_COMPLEX',
      message: 'Clause or subordination depth exceeds the use-case limit.',
      details: { clause_depth: metrics.clause_depth, limit: limits.max_clause_depth },
    });
  }
  if (metrics.structure_difficulty > limits.max_structure_difficulty) {
    failures.push({
      code: 'DIFFICULT_STRUCTURE',
      message: 'Sentence structure difficulty exceeds the use-case limit.',
      details: { structure_difficulty: metrics.structure_difficulty, limit: limits.max_structure_difficulty },
    });
  }
  if (metrics.non_target_unknown_ratio !== null && metrics.non_target_unknown_ratio > limits.max_non_target_unknown_ratio) {
    failures.push({
      code: 'NON_TARGET_UNKNOWN_RATIO_TOO_HIGH',
      message: 'Too many non-target unknown words make the sentence unsuitable for this use case.',
      details: {
        non_target_unknown_ratio: metrics.non_target_unknown_ratio,
        limit: limits.max_non_target_unknown_ratio,
      },
    });
  }
  if (metrics.independent_comprehensibility === 0) {
    failures.push({
      code: 'NOT_INDEPENDENTLY_COMPREHENSIBLE',
      message: 'The candidate depends on surrounding context and cannot stand alone.',
      details: {},
    });
  }
  if (useCase === SENTENCE_RANKING_USE_CASES.FIRST_PREVIEW && options.require_independent_comprehensibility !== false
    && metrics.independent_comprehensibility === null && options.reject_unknown_comprehensibility === true) {
    failures.push({
      code: 'COMPREHENSIBILITY_UNKNOWN',
      message: 'Independent comprehensibility must be measured for this preview policy.',
      details: {},
    });
  }
  return failures;
}

function scoreCandidate(metrics, source, useCase) {
  const preferredLength = useCase === SENTENCE_RANKING_USE_CASES.FIRST_PREVIEW ? 12 : 18;
  const lengthDistance = Math.abs(metrics.word_count - preferredLength);
  const lengthScore = Math.max(0, 20 - lengthDistance);
  const clauseScore = Math.max(0, 15 - metrics.clause_depth * 5);
  const structureScore = Math.max(0, 10 - metrics.structure_difficulty * 2);
  const unknownScore = metrics.non_target_unknown_ratio === null
    ? 5
    : Math.max(0, 20 - metrics.non_target_unknown_ratio * 20);
  const independentScore = metrics.independent_comprehensibility === null
    ? 5
    : metrics.independent_comprehensibility * 10;
  const naturalnessScore = metrics.naturalness === null ? 5 : metrics.naturalness * 10;
  const sourcePriority = SOURCE_PRIORITY.get(source.source_kind) ?? SOURCE_PRIORITY.get(SOURCE_KIND.UNKNOWN);
  const sourceScore = Math.max(0, 20 - sourcePriority * 4)
    + (source.validated_authentic_anchor ? 6 : 0)
    + (source.quality_status === QUALITY_STATUS.VALIDATED ? 2 : 0)
    - (source.generated ? 8 : 0);
  const total = 100 + sourceScore + lengthScore + clauseScore + structureScore + unknownScore + independentScore + naturalnessScore;
  return {
    total: Number(total.toFixed(6)),
    target_sense_match: 100,
    source: Number(sourceScore.toFixed(6)),
    length: Number(lengthScore.toFixed(6)),
    clause_depth: Number(clauseScore.toFixed(6)),
    structure_difficulty: Number(structureScore.toFixed(6)),
    non_target_unknown_ratio: Number(unknownScore.toFixed(6)),
    independent_comprehensibility: Number(independentScore.toFixed(6)),
    naturalness: Number(naturalnessScore.toFixed(6)),
  };
}

function tieBreakKey(entry) {
  return [
    entry.candidate_id,
    entry.metrics.word_count,
    entry.metrics.clause_depth,
    entry.metrics.non_target_unknown_ratio ?? 2,
    entry.source.source_id ?? '',
    entry.metrics.sentence,
    canonicalJson(entry.original_candidate),
  ];
}

function compareTieBreak(left, right) {
  const leftKey = tieBreakKey(left);
  const rightKey = tieBreakKey(right);
  for (let index = 0; index < leftKey.length; index += 1) {
    const leftValue = leftKey[index];
    const rightValue = rightKey[index];
    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      if (leftValue !== rightValue) return leftValue - rightValue;
    } else {
      const comparison = String(leftValue).localeCompare(String(rightValue));
      if (comparison !== 0) return comparison;
    }
  }
  return 0;
}

function compareEligible(left, right) {
  return right.score_components.total - left.score_components.total
    || (SOURCE_PRIORITY.get(left.source.source_kind) ?? 5) - (SOURCE_PRIORITY.get(right.source.source_kind) ?? 5)
    || left.metrics.word_count - right.metrics.word_count
    || left.metrics.clause_depth - right.metrics.clause_depth
    || (left.metrics.non_target_unknown_ratio ?? 2) - (right.metrics.non_target_unknown_ratio ?? 2)
    || compareTieBreak(left, right);
}

function compareDuplicatePreference(left, right) {
  if (left.eligible !== right.eligible) return left.eligible ? -1 : 1;
  if (left.eligible && right.eligible) return compareEligible(left, right);
  return canonicalJson(left.original_candidate).localeCompare(canonicalJson(right.original_candidate))
    || compareTieBreak(left, right);
}

function deduplicateEntries(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const group = groups.get(entry.candidate_id) ?? [];
    group.push(entry);
    groups.set(entry.candidate_id, group);
  }
  return [...groups.entries()]
    .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
    .map(([candidateId, group]) => {
      const kept = group.slice().sort(compareDuplicatePreference)[0];
      if (group.length === 1) return kept;
      const duplicateReason = reason(
        'DUPLICATE_CANDIDATE_ID_DEDUPED',
        'Repeated candidate_id values were deterministically reduced to one candidate.',
        { candidate_id: candidateId, input_count: group.length },
      );
      return {
        ...kept,
        duplicate_input_count: group.length,
        reason_codes: [...kept.reason_codes, duplicateReason.code],
        reasons: [...kept.reasons, duplicateReason],
      };
    });
}

function normalizeCandidate(candidate) {
  const originalCandidate = isPlainObject(candidate) ? cloneJson(candidate) : { value: cloneJson(candidate) };
  const sourceCandidate = isPlainObject(candidate) ? candidate : {};
  const metadata = nestedMetadata(sourceCandidate);
  const sentence = normalizeText(field(sourceCandidate, metadata, 'sentence', 'text', 'example'));
  const source = normalizeSource({ ...sourceCandidate, sentence });
  const candidateId = normalizeKey(field(sourceCandidate, metadata, 'candidate_id', 'id', 'context_evidence_id'))
    ?? `candidate:${source.source_kind}:${source.source_id ?? ''}:${sentence}`;
  const clauseDepth = normalizeClauseDepth(sourceCandidate, metadata, sentence);
  const metrics = {
    sentence,
    word_count: normalizeWordCount(sourceCandidate, metadata, sentence),
    clause_depth: clauseDepth,
    structure_difficulty: normalizeStructureDifficulty(sourceCandidate, metadata, clauseDepth),
    non_target_unknown_ratio: normalizeUnknownRatio(sourceCandidate, metadata),
    independent_comprehensibility: normalizeIndependentComprehensibility(sourceCandidate, metadata),
    naturalness: normalizeNaturalness(sourceCandidate, metadata),
  };
  return {
    candidate_id: candidateId,
    original_candidate: originalCandidate,
    source,
    metrics,
    sense_key: targetSenseKey(field(sourceCandidate, metadata, 'target_sense_key', 'sense_key', 'senseKey')),
  };
}

function normalizeInput(input, options) {
  if (Array.isArray(input)) {
    return {
      target_sense_key: targetSenseKey(options.target_sense_key ?? options.targetSenseKey),
      candidates: input,
      use_case: options.use_case ?? options.useCase ?? options.mode,
    };
  }
  const source = isPlainObject(input) ? input : {};
  return {
    target_sense_key: targetSenseKey(source.target_sense_key ?? source.targetSenseKey ?? source.sense_key),
    candidates: Array.isArray(source.candidates)
      ? source.candidates
      : (Array.isArray(source.sentence_candidates) ? source.sentence_candidates : []),
    use_case: source.use_case ?? source.useCase ?? source.mode,
  };
}

function reason(code, message, details = {}) {
  return { code, message, details: cloneJson(details) };
}

/**
 * Filter and rank candidates for one target sense.  The returned object keeps
 * rejected candidates and hard-failure reasons so a UI or later adapter can
 * explain why a candidate was not used.
 */
export function rankSentenceCandidates(input = {}, options = {}) {
  const normalizedOptions = isPlainObject(options) ? options : {};
  const request = normalizeInput(input, normalizedOptions);
  const useCase = normalizeUseCase(request.use_case ?? normalizedOptions.use_case ?? normalizedOptions.mode);
  const limits = limitsFor(useCase, normalizedOptions);
  const targetKey = request.target_sense_key;
  const evaluatedEntries = request.candidates.map(normalizeCandidate).map((candidate) => {
    const failures = hardFailures(
      candidate.original_candidate,
      candidate.source,
      candidate.metrics,
      targetKey,
      useCase,
      normalizedOptions,
      limits,
    );
    const eligible = failures.length === 0;
    const senseMatch = candidateSenseMatch(candidate.original_candidate, targetKey);
    const scoreComponents = eligible
      ? scoreCandidate(candidate.metrics, candidate.source, useCase)
      : null;
    return {
      ...candidate,
      eligible,
      status: eligible ? SENTENCE_CANDIDATE_STATUSES.ELIGIBLE : SENTENCE_CANDIDATE_STATUSES.REJECTED,
      target_sense_match: senseMatch.matches,
      score_components: scoreComponents,
      score: scoreComponents?.total ?? null,
      hard_failures: failures,
      reason_codes: failures.map((item) => item.code),
      reasons: failures.length > 0
        ? failures
        : [reason('CANDIDATE_ELIGIBLE', 'Candidate satisfies target-sense, provenance, and difficulty constraints.')],
    };
  });
  const entries = deduplicateEntries(evaluatedEntries);
  const eligible = entries.filter((entry) => entry.eligible).sort(compareEligible);
  const rejected = entries.filter((entry) => !entry.eligible).sort(compareTieBreak);
  const rankedCandidates = eligible.map((entry, index) => ({
    ...entry,
    rank: index + 1,
    selected: index === 0,
    reasons: index === 0
      ? [
        ...entry.reasons,
        reason('DETERMINISTIC_TOP_SCORE', 'Candidate has the highest permitted score under this policy.'),
        ...(eligible.length > 1 && entry.score_components.total === eligible[1].score_components.total
          ? [reason('TIE_BREAK_CANDIDATE_ID', 'Scores tied; canonical candidate tie-break order selected this candidate.')]
          : []),
      ]
      : entry.reasons,
  }));
  const rejectedCandidates = rejected.map((entry) => ({ ...entry, rank: null, selected: false }));
  const selected = rankedCandidates[0] ?? null;
  const reasons = [];
  if (!targetKey) reasons.push(reason('TARGET_SENSE_UNKNOWN', 'No target sense was supplied; no candidate can be selected safely.'));
  if (request.candidates.length === 0) reasons.push(reason('EMPTY_CANDIDATES', 'No sentence candidates were supplied.'));
  if (selected) {
    reasons.push(reason(
      'CANDIDATE_SELECTED',
      'The first eligible candidate in deterministic score order was selected.',
      { candidate_id: selected.candidate_id, rank: selected.rank },
    ));
  } else if (request.candidates.length > 0) {
    reasons.push(reason(
      'NO_ELIGIBLE_CANDIDATE',
      'Every supplied sentence candidate failed at least one hard policy constraint.',
      { rejected_count: rejectedCandidates.length },
    ));
  }
  const allCandidates = [...rankedCandidates, ...rejectedCandidates];
  return {
    schema_version: SENTENCE_CANDIDATE_RANKING_SCHEMA_VERSION,
    policy_version: SENTENCE_CANDIDATE_RANKING_VERSION,
    version: SENTENCE_CANDIDATE_RANKING_VERSION,
    use_case: useCase,
    target_sense_key: targetKey,
    status: selected ? 'selected' : 'unresolved',
    selected_candidate_id: selected?.candidate_id ?? null,
    selected_candidate: selected,
    ranked_candidates: rankedCandidates,
    rejected_candidates: rejectedCandidates,
    candidates: allCandidates,
    limits,
    reason_codes: reasons.map((item) => item.code),
    reasons,
  };
}

export const selectSentenceCandidate = rankSentenceCandidates;
export const rankSentenceCandidate = rankSentenceCandidates;
export const selectSentenceCandidates = rankSentenceCandidates;
export const filterAndRankSentenceCandidates = rankSentenceCandidates;
export const rankSentenceCandidateSet = rankSentenceCandidates;

export function isSentenceCandidateRankingResolved(result) {
  return Boolean(
    isPlainObject(result)
      && result.schema_version === SENTENCE_CANDIDATE_RANKING_SCHEMA_VERSION
      && result.status === 'selected'
      && typeof result.selected_candidate_id === 'string',
  );
}

export function normalizeSentenceCandidate(candidate) {
  const normalized = normalizeCandidate(candidate);
  const normalizationReasons = normalized.source.compatibility_error
    ? [cloneJson(normalized.source.compatibility_error)]
    : [{
      code: 'CANDIDATE_NORMALIZED',
      message: 'Sentence candidate fields were normalized without selecting the candidate.',
      details: {},
    }];
  return {
    schema_version: SENTENCE_CANDIDATE_RANKING_SCHEMA_VERSION,
    policy_version: SENTENCE_CANDIDATE_RANKING_VERSION,
    ...normalized,
    reason_codes: normalizationReasons.map((item) => item.code),
    reasons: normalizationReasons,
  };
}
