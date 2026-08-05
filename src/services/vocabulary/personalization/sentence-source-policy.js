/**
 * Pure normalization and policy facts for sentence provenance.
 *
 * The shape intentionally mirrors the existing ContextEvidence vocabulary
 * (`source_kind`, `license_kind`, `ownership`, `quality_status`) while adding
 * presentation-facing facts needed by personalization.  It does not persist
 * text, inspect a browser, or decide which candidate wins a ranking.
 */

export const SENTENCE_SOURCE_POLICY_VERSION = 'sentence-source-policy.v1';
export const SENTENCE_SOURCE_SCHEMA_VERSION = SENTENCE_SOURCE_POLICY_VERSION;

export const SENTENCE_SOURCE_KINDS = Object.freeze({
  ARTICLE: 'article',
  SUBTITLE: 'subtitle',
  USER_LOCAL_EXAM_MATERIAL: 'user_local_exam_material',
  OPEN_CORPUS: 'open_corpus',
  DICTIONARY_EXAMPLE: 'dictionary_example',
  AI_CANDIDATE: 'ai_candidate',
  UNKNOWN: 'unknown',
});

export const SENTENCE_LICENSE_KINDS = Object.freeze({
  USER_OWNED: 'user_owned',
  LICENSED_OPEN: 'licensed_open',
  DICTIONARY_TERMS: 'dictionary_terms',
  AI_GENERATED: 'ai_generated',
  UNKNOWN: 'unknown',
});

export const SENTENCE_OWNERSHIP = Object.freeze({
  USER: 'user',
  PRIVATE: 'private',
  THIRD_PARTY: 'third_party',
  PUBLIC: 'public',
  UNKNOWN: 'unknown',
});

export const SENTENCE_QUALITY_STATUSES = Object.freeze({
  PENDING: 'pending',
  VALIDATED: 'validated',
  REJECTED: 'rejected',
});

export const SENTENCE_CONTENT_STATUSES = Object.freeze({
  AUTHENTIC: 'authentic',
  GENERATED: 'generated',
  UNKNOWN: 'unknown',
});

export const SENTENCE_USAGE_SCOPES = Object.freeze({
  REDISTRIBUTABLE: 'redistributable',
  LOCAL_ONLY: 'local_only',
  LATE_CONTEXT_TRANSFER: 'late_context_transfer',
  REFERENCE_ONLY: 'reference_only',
  AUXILIARY_ONLY: 'auxiliary_only',
  UNKNOWN: 'unknown',
});

const SOURCE_KINDS = new Set(Object.values(SENTENCE_SOURCE_KINDS));
const LICENSE_KINDS = new Set(Object.values(SENTENCE_LICENSE_KINDS));
const OWNERSHIP_VALUES = new Set(Object.values(SENTENCE_OWNERSHIP));
const QUALITY_STATUSES = new Set(Object.values(SENTENCE_QUALITY_STATUSES));
const CONTENT_STATUSES = new Set(Object.values(SENTENCE_CONTENT_STATUSES));
const USAGE_SCOPES = new Set(Object.values(SENTENCE_USAGE_SCOPES));

const SOURCE_ALIASES = new Map([
  ['article', SENTENCE_SOURCE_KINDS.ARTICLE],
  ['user_article', SENTENCE_SOURCE_KINDS.ARTICLE],
  ['subtitle', SENTENCE_SOURCE_KINDS.SUBTITLE],
  ['captions', SENTENCE_SOURCE_KINDS.SUBTITLE],
  ['transcript', SENTENCE_SOURCE_KINDS.SUBTITLE],
  ['user_local_exam_material', SENTENCE_SOURCE_KINDS.USER_LOCAL_EXAM_MATERIAL],
  ['local_exam', SENTENCE_SOURCE_KINDS.USER_LOCAL_EXAM_MATERIAL],
  ['user_local_exam', SENTENCE_SOURCE_KINDS.USER_LOCAL_EXAM_MATERIAL],
  ['exam_material', SENTENCE_SOURCE_KINDS.USER_LOCAL_EXAM_MATERIAL],
  ['local_copyrighted', SENTENCE_SOURCE_KINDS.USER_LOCAL_EXAM_MATERIAL],
  ['local_copyrighted_exam', SENTENCE_SOURCE_KINDS.USER_LOCAL_EXAM_MATERIAL],
  ['exam_original', SENTENCE_SOURCE_KINDS.USER_LOCAL_EXAM_MATERIAL],
  ['copyrighted_exam', SENTENCE_SOURCE_KINDS.USER_LOCAL_EXAM_MATERIAL],
  ['ielts', SENTENCE_SOURCE_KINDS.USER_LOCAL_EXAM_MATERIAL],
  ['open_corpus', SENTENCE_SOURCE_KINDS.OPEN_CORPUS],
  ['open_corpus_example', SENTENCE_SOURCE_KINDS.OPEN_CORPUS],
  ['open', SENTENCE_SOURCE_KINDS.OPEN_CORPUS],
  ['dictionary_example', SENTENCE_SOURCE_KINDS.DICTIONARY_EXAMPLE],
  ['dictionary', SENTENCE_SOURCE_KINDS.DICTIONARY_EXAMPLE],
  ['ai_candidate', SENTENCE_SOURCE_KINDS.AI_CANDIDATE],
  ['ai_generated', SENTENCE_SOURCE_KINDS.AI_CANDIDATE],
  ['ai-generated', SENTENCE_SOURCE_KINDS.AI_CANDIDATE],
  ['generated', SENTENCE_SOURCE_KINDS.AI_CANDIDATE],
  ['unknown', SENTENCE_SOURCE_KINDS.UNKNOWN],
]);

const LICENSE_ALIASES = new Map([
  ['user_owned', SENTENCE_LICENSE_KINDS.USER_OWNED],
  ['user-owned', SENTENCE_LICENSE_KINDS.USER_OWNED],
  ['owned', SENTENCE_LICENSE_KINDS.USER_OWNED],
  ['licensed_open', SENTENCE_LICENSE_KINDS.LICENSED_OPEN],
  ['licensed-open', SENTENCE_LICENSE_KINDS.LICENSED_OPEN],
  ['open', SENTENCE_LICENSE_KINDS.LICENSED_OPEN],
  ['open_license', SENTENCE_LICENSE_KINDS.LICENSED_OPEN],
  ['dictionary_terms', SENTENCE_LICENSE_KINDS.DICTIONARY_TERMS],
  ['dictionary-terms', SENTENCE_LICENSE_KINDS.DICTIONARY_TERMS],
  ['dictionary', SENTENCE_LICENSE_KINDS.DICTIONARY_TERMS],
  ['ai_generated', SENTENCE_LICENSE_KINDS.AI_GENERATED],
  ['ai-generated', SENTENCE_LICENSE_KINDS.AI_GENERATED],
  ['generated', SENTENCE_LICENSE_KINDS.AI_GENERATED],
  ['unknown', SENTENCE_LICENSE_KINDS.UNKNOWN],
  ['', SENTENCE_LICENSE_KINDS.UNKNOWN],
]);

const OWNERSHIP_ALIASES = new Map([
  ['user', SENTENCE_OWNERSHIP.USER],
  ['user_owned', SENTENCE_OWNERSHIP.USER],
  ['private', SENTENCE_OWNERSHIP.PRIVATE],
  ['personal', SENTENCE_OWNERSHIP.PRIVATE],
  ['third_party', SENTENCE_OWNERSHIP.THIRD_PARTY],
  ['third-party', SENTENCE_OWNERSHIP.THIRD_PARTY],
  ['public', SENTENCE_OWNERSHIP.PUBLIC],
  ['unknown', SENTENCE_OWNERSHIP.UNKNOWN],
  ['', SENTENCE_OWNERSHIP.UNKNOWN],
]);

const QUALITY_ALIASES = new Map([
  ['pending', SENTENCE_QUALITY_STATUSES.PENDING],
  ['unreviewed', SENTENCE_QUALITY_STATUSES.PENDING],
  ['validated', SENTENCE_QUALITY_STATUSES.VALIDATED],
  ['approved', SENTENCE_QUALITY_STATUSES.VALIDATED],
  ['rejected', SENTENCE_QUALITY_STATUSES.REJECTED],
  ['invalid', SENTENCE_QUALITY_STATUSES.REJECTED],
  ['', SENTENCE_QUALITY_STATUSES.PENDING],
]);

const CONTENT_ALIASES = new Map([
  ['authentic', SENTENCE_CONTENT_STATUSES.AUTHENTIC],
  ['real', SENTENCE_CONTENT_STATUSES.AUTHENTIC],
  ['human', SENTENCE_CONTENT_STATUSES.AUTHENTIC],
  ['original', SENTENCE_CONTENT_STATUSES.AUTHENTIC],
  ['generated', SENTENCE_CONTENT_STATUSES.GENERATED],
  ['ai_generated', SENTENCE_CONTENT_STATUSES.GENERATED],
  ['ai-generated', SENTENCE_CONTENT_STATUSES.GENERATED],
  ['unknown', SENTENCE_CONTENT_STATUSES.UNKNOWN],
  ['', SENTENCE_CONTENT_STATUSES.UNKNOWN],
]);

const USAGE_ALIASES = new Map([
  ['redistributable', SENTENCE_USAGE_SCOPES.REDISTRIBUTABLE],
  ['public', SENTENCE_USAGE_SCOPES.REDISTRIBUTABLE],
  ['local_only', SENTENCE_USAGE_SCOPES.LOCAL_ONLY],
  ['local-only', SENTENCE_USAGE_SCOPES.LOCAL_ONLY],
  ['private', SENTENCE_USAGE_SCOPES.LOCAL_ONLY],
  ['late_context_transfer', SENTENCE_USAGE_SCOPES.LATE_CONTEXT_TRANSFER],
  ['late-context-transfer', SENTENCE_USAGE_SCOPES.LATE_CONTEXT_TRANSFER],
  ['context_transfer', SENTENCE_USAGE_SCOPES.LATE_CONTEXT_TRANSFER],
  ['reference_only', SENTENCE_USAGE_SCOPES.REFERENCE_ONLY],
  ['reference-only', SENTENCE_USAGE_SCOPES.REFERENCE_ONLY],
  ['auxiliary_only', SENTENCE_USAGE_SCOPES.AUXILIARY_ONLY],
  ['auxiliary-only', SENTENCE_USAGE_SCOPES.AUXILIARY_ONLY],
  ['unknown', SENTENCE_USAGE_SCOPES.UNKNOWN],
  ['', SENTENCE_USAGE_SCOPES.UNKNOWN],
]);

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

function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function normalizeNullableText(value) {
  const result = normalizeText(value);
  return result || null;
}

function normalizeId(value) {
  const result = normalizeText(value);
  return result || null;
}

function rawValue(input, source, key, fallback = undefined) {
  if (Object.prototype.hasOwnProperty.call(input, key)) return input[key];
  if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
  return fallback;
}

function normalizeAlias(value, aliases, fallback) {
  const normalized = normalizeText(value).toLocaleLowerCase('en-US');
  return aliases.get(normalized) ?? fallback;
}

function normalizeSourceKind(value) {
  const normalized = normalizeText(value).toLocaleLowerCase('en-US');
  return SOURCE_ALIASES.get(normalized) ?? SENTENCE_SOURCE_KINDS.UNKNOWN;
}

function defaultsForSourceKind(sourceKind) {
  switch (sourceKind) {
    case SENTENCE_SOURCE_KINDS.ARTICLE:
    case SENTENCE_SOURCE_KINDS.SUBTITLE:
      return {
        license_kind: SENTENCE_LICENSE_KINDS.UNKNOWN,
        ownership: SENTENCE_OWNERSHIP.UNKNOWN,
        content_status: SENTENCE_CONTENT_STATUSES.UNKNOWN,
        usage_scope: SENTENCE_USAGE_SCOPES.LOCAL_ONLY,
      };
    case SENTENCE_SOURCE_KINDS.USER_LOCAL_EXAM_MATERIAL:
      return {
        license_kind: SENTENCE_LICENSE_KINDS.UNKNOWN,
        ownership: SENTENCE_OWNERSHIP.UNKNOWN,
        content_status: SENTENCE_CONTENT_STATUSES.UNKNOWN,
        usage_scope: SENTENCE_USAGE_SCOPES.LATE_CONTEXT_TRANSFER,
      };
    case SENTENCE_SOURCE_KINDS.OPEN_CORPUS:
      return {
        license_kind: SENTENCE_LICENSE_KINDS.UNKNOWN,
        ownership: SENTENCE_OWNERSHIP.UNKNOWN,
        content_status: SENTENCE_CONTENT_STATUSES.UNKNOWN,
        usage_scope: SENTENCE_USAGE_SCOPES.UNKNOWN,
      };
    case SENTENCE_SOURCE_KINDS.DICTIONARY_EXAMPLE:
      return {
        license_kind: SENTENCE_LICENSE_KINDS.UNKNOWN,
        ownership: SENTENCE_OWNERSHIP.UNKNOWN,
        content_status: SENTENCE_CONTENT_STATUSES.UNKNOWN,
        usage_scope: SENTENCE_USAGE_SCOPES.REFERENCE_ONLY,
      };
    case SENTENCE_SOURCE_KINDS.AI_CANDIDATE:
      return {
        license_kind: SENTENCE_LICENSE_KINDS.UNKNOWN,
        ownership: SENTENCE_OWNERSHIP.UNKNOWN,
        content_status: SENTENCE_CONTENT_STATUSES.GENERATED,
        usage_scope: SENTENCE_USAGE_SCOPES.AUXILIARY_ONLY,
      };
    default:
      return {
        license_kind: SENTENCE_LICENSE_KINDS.UNKNOWN,
        ownership: SENTENCE_OWNERSHIP.UNKNOWN,
        content_status: SENTENCE_CONTENT_STATUSES.UNKNOWN,
        usage_scope: SENTENCE_USAGE_SCOPES.UNKNOWN,
      };
  }
}

function normalizeSourceLocator(value) {
  if (!isPlainObject(value)) return null;
  return cloneJson(value);
}

function hasLocatorText(locator, field) {
  return typeof locator?.[field] === 'string' && Boolean(normalizeText(locator[field]));
}

function hasLocatorInteger(locator, field) {
  return Number.isInteger(locator?.[field]) && locator[field] >= 0;
}

function hasRequiredProvenance(sourceKind, sourceId, sourceTitle, sourceLocator) {
  if (sourceKind === SENTENCE_SOURCE_KINDS.AI_CANDIDATE) return false;
  if (
    !sourceId
      || !isPlainObject(sourceLocator)
      || !hasLocatorText(sourceLocator, 'locator_version')
      || sourceLocator.locator_version !== 'source-locator.v1'
  ) return false;
  switch (sourceKind) {
    case SENTENCE_SOURCE_KINDS.ARTICLE:
      return Boolean(sourceTitle) && hasLocatorInteger(sourceLocator, 'sentence_index');
    case SENTENCE_SOURCE_KINDS.SUBTITLE:
      return Boolean(sourceTitle)
        && hasLocatorInteger(sourceLocator, 'start_ms')
        && hasLocatorInteger(sourceLocator, 'end_ms')
        && sourceLocator.end_ms >= sourceLocator.start_ms;
    case SENTENCE_SOURCE_KINDS.USER_LOCAL_EXAM_MATERIAL:
      return hasLocatorText(sourceLocator, 'local_locator');
    case SENTENCE_SOURCE_KINDS.OPEN_CORPUS:
      return hasLocatorText(sourceLocator, 'record_id');
    case SENTENCE_SOURCE_KINDS.DICTIONARY_EXAMPLE:
      return hasLocatorText(sourceLocator, 'entry_id');
    default:
      return false;
  }
}

function firstPresent(input, source, fields) {
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(input, field)) return input[field];
    if (Object.prototype.hasOwnProperty.call(source, field)) return source[field];
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
  if (typeof value !== 'string') return { status: SENTENCE_CONTENT_STATUSES.GENERATED, invalid: true };
  const normalized = normalizeText(value).toLocaleLowerCase('en-US');
  if (!normalized) return { status: fallback, invalid: false };
  const status = CONTENT_ALIASES.get(normalized);
  return status
    ? { status, invalid: false }
    : { status: SENTENCE_CONTENT_STATUSES.GENERATED, invalid: true };
}

function reason(code, message, details = {}) {
  return { code, message, details: cloneJson(details) };
}

function policyReasons({
  sentence,
  sourceKind,
  licenseKind,
  ownership,
  contentStatus,
  qualityStatus,
  generatedFlagIssue,
  provenanceComplete,
  validatedAuthenticAnchor,
}) {
  const reasons = [];
  if (!sentence) reasons.push(reason('EMPTY_SENTENCE', 'Sentence text is empty after normalization.'));
  if (sourceKind === SENTENCE_SOURCE_KINDS.UNKNOWN) {
    reasons.push(reason('SOURCE_TYPE_UNKNOWN', 'The sentence source type is missing or unsupported.'));
  }
  if (licenseKind === SENTENCE_LICENSE_KINDS.UNKNOWN) {
    reasons.push(reason('LICENSE_UNKNOWN', 'License is unknown; the sentence cannot be a validated anchor.'));
  }
  if (ownership === SENTENCE_OWNERSHIP.UNKNOWN) {
    reasons.push(reason('OWNERSHIP_UNKNOWN', 'Ownership is unknown; the sentence cannot be a validated anchor.'));
  }
  if (contentStatus === SENTENCE_CONTENT_STATUSES.UNKNOWN) {
    reasons.push(reason('AUTHENTICITY_UNKNOWN', 'Authentic status must be explicit; source type alone is insufficient.'));
  }
  if (sourceKind !== SENTENCE_SOURCE_KINDS.AI_CANDIDATE && !provenanceComplete) {
    reasons.push(reason('PROVENANCE_INCOMPLETE', 'Source ID, locator, and source-specific provenance are required for an anchor.'));
  }
  if (contentStatus === SENTENCE_CONTENT_STATUSES.GENERATED) {
    reasons.push(reason(
      'AI_GENERATED_AUXILIARY_ONLY',
      'Generated text may assist learning but cannot be a validated authentic anchor by default.',
    ));
  }
  if (generatedFlagIssue) {
    reasons.push(reason(
      'GENERATED_FLAG_INVALID_ASSUMED_GENERATED',
      'An invalid or ambiguous generated flag was treated as generated for safety.',
    ));
  }
  if (sourceKind === SENTENCE_SOURCE_KINDS.USER_LOCAL_EXAM_MATERIAL) {
    reasons.push(reason(
      'LOCAL_EXAM_LATE_TRANSFER_ONLY',
      'User-local exam material is restricted to local late context-transfer use.',
    ));
  }
  if (qualityStatus === SENTENCE_QUALITY_STATUSES.PENDING && contentStatus !== SENTENCE_CONTENT_STATUSES.GENERATED) {
    reasons.push(reason('AUTHENTICITY_PENDING_VALIDATION', 'Authentic provenance is present but validation is still pending.'));
  }
  if (qualityStatus === SENTENCE_QUALITY_STATUSES.REJECTED) {
    reasons.push(reason('SOURCE_REJECTED', 'The sentence source has been rejected by content validation.'));
  }
  if (ownership === SENTENCE_OWNERSHIP.PRIVATE || ownership === SENTENCE_OWNERSHIP.USER) {
    reasons.push(reason('LOCAL_OWNERSHIP', 'The sentence is user-owned or private and must remain local.'));
  }
  if (validatedAuthenticAnchor) {
    reasons.push(reason('VALIDATED_AUTHENTIC_ANCHOR', 'Known provenance, compatible license, and validation permit anchor use.'));
  }
  return reasons;
}

function isKnownLicense(licenseKind) {
  return licenseKind !== SENTENCE_LICENSE_KINDS.UNKNOWN;
}

function canUseAsValidatedAuthenticAnchor({
  sourceKind,
  licenseKind,
  ownership,
  contentStatus,
  qualityStatus,
  provenanceComplete,
}) {
  return Boolean(
    sourceKind !== SENTENCE_SOURCE_KINDS.UNKNOWN
      && isKnownLicense(licenseKind)
      && ownership !== SENTENCE_OWNERSHIP.UNKNOWN
      && contentStatus === SENTENCE_CONTENT_STATUSES.AUTHENTIC
      && qualityStatus === SENTENCE_QUALITY_STATUSES.VALIDATED
      && licenseKind !== SENTENCE_LICENSE_KINDS.AI_GENERATED
      && provenanceComplete,
  );
}

function enforceSourceCompatibility(sourceKind, licenseKind, ownership) {
  if (sourceKind === SENTENCE_SOURCE_KINDS.AI_CANDIDATE && licenseKind !== SENTENCE_LICENSE_KINDS.AI_GENERATED) {
    return reason('AI_SOURCE_LICENSE_MISMATCH', 'AI candidates must carry the ai_generated license kind.');
  }
  if (sourceKind === SENTENCE_SOURCE_KINDS.USER_LOCAL_EXAM_MATERIAL && (
    licenseKind !== SENTENCE_LICENSE_KINDS.USER_OWNED
      || ![SENTENCE_OWNERSHIP.USER, SENTENCE_OWNERSHIP.PRIVATE].includes(ownership)
  )) {
    return reason('LOCAL_EXAM_PROVENANCE_MISMATCH', 'Local exam material must remain user-owned and private.');
  }
  if (sourceKind === SENTENCE_SOURCE_KINDS.OPEN_CORPUS && licenseKind !== SENTENCE_LICENSE_KINDS.LICENSED_OPEN) {
    return reason('OPEN_SOURCE_LICENSE_MISMATCH', 'Open corpus evidence requires an explicit open license.');
  }
  if (sourceKind === SENTENCE_SOURCE_KINDS.DICTIONARY_EXAMPLE && ![
    SENTENCE_LICENSE_KINDS.DICTIONARY_TERMS,
    SENTENCE_LICENSE_KINDS.LICENSED_OPEN,
  ].includes(licenseKind)) {
    return reason('DICTIONARY_SOURCE_LICENSE_MISMATCH', 'Dictionary examples require dictionary terms or an open license.');
  }
  return null;
}

/**
 * Normalize one sentence and its provenance without changing the caller's
 * object.  Nested `source` or `provenance` objects are accepted as adapters,
 * but the returned shape is flat and stable for downstream policies.
 */
export function normalizeSentenceSource(input = {}) {
  const candidate = isPlainObject(input) ? input : {};
  const nestedSource = typeof candidate.source === 'string'
    ? { source_kind: candidate.source }
    : (isPlainObject(candidate.source) ? candidate.source : {});
  const nestedProvenance = isPlainObject(candidate.provenance) ? candidate.provenance : {};
  const provenance = { ...nestedSource, ...nestedProvenance };
  const sentence = normalizeText(
    rawValue(candidate, provenance, 'sentence', rawValue(candidate, provenance, 'text', '')),
  );
  const rawSourceKind = rawValue(candidate, provenance, 'source_kind', rawValue(candidate, provenance, 'source_type', ''));
  const sourceKind = normalizeSourceKind(rawSourceKind);
  const defaults = defaultsForSourceKind(sourceKind);
  const generatedFlag = normalizeGeneratedFlag(firstPresent(candidate, provenance, ['generated', 'is_generated']));
  const rawContentStatus = firstPresent(candidate, provenance, ['content_status', 'generation_status']);
  const contentStatusInput = normalizeContentStatusValue(
    rawContentStatus,
    sourceKind === SENTENCE_SOURCE_KINDS.AI_CANDIDATE
      ? SENTENCE_CONTENT_STATUSES.GENERATED
      : defaults.content_status,
  );
  const licenseKind = normalizeAlias(
    firstPresent(candidate, provenance, ['license_kind']),
    LICENSE_ALIASES,
    SENTENCE_LICENSE_KINDS.UNKNOWN,
  );
  const licenseExplicit = firstPresent(candidate, provenance, ['license_kind']) !== undefined
    && Boolean(normalizeText(firstPresent(candidate, provenance, ['license_kind'])));
  const ownership = normalizeAlias(
    firstPresent(candidate, provenance, ['ownership']),
    OWNERSHIP_ALIASES,
    SENTENCE_OWNERSHIP.UNKNOWN,
  );
  const ownershipExplicit = firstPresent(candidate, provenance, ['ownership']) !== undefined
    && Boolean(normalizeText(firstPresent(candidate, provenance, ['ownership'])));
  let contentStatus = contentStatusInput.status;
  const generatedHint = generatedFlag.value
    || generatedFlag.invalid
    || contentStatusInput.invalid
    || sourceKind === SENTENCE_SOURCE_KINDS.AI_CANDIDATE
    || licenseKind === SENTENCE_LICENSE_KINDS.AI_GENERATED;
  if (generatedHint) contentStatus = SENTENCE_CONTENT_STATUSES.GENERATED;
  const generated = contentStatus === SENTENCE_CONTENT_STATUSES.GENERATED;
  const authentic = contentStatus === SENTENCE_CONTENT_STATUSES.AUTHENTIC && !generated;
  let qualityStatus = normalizeAlias(
    rawValue(candidate, provenance, 'quality_status', rawValue(candidate, provenance, 'validation_status', SENTENCE_QUALITY_STATUSES.PENDING)),
    QUALITY_ALIASES,
    SENTENCE_QUALITY_STATUSES.PENDING,
  );
  if (generated || sourceKind === SENTENCE_SOURCE_KINDS.UNKNOWN || licenseKind === SENTENCE_LICENSE_KINDS.UNKNOWN) {
    qualityStatus = SENTENCE_QUALITY_STATUSES.PENDING;
  }
  const requestedUsageScope = normalizeAlias(
    rawValue(candidate, provenance, 'usage_scope', rawValue(candidate, provenance, 'distribution_scope', defaults.usage_scope)),
    USAGE_ALIASES,
    defaults.usage_scope,
  );
  let usageScope = requestedUsageScope;
  if (generated) usageScope = SENTENCE_USAGE_SCOPES.AUXILIARY_ONLY;
  if (sourceKind === SENTENCE_SOURCE_KINDS.USER_LOCAL_EXAM_MATERIAL) {
    usageScope = SENTENCE_USAGE_SCOPES.LATE_CONTEXT_TRANSFER;
  }
  if (!SOURCE_KINDS.has(sourceKind)) usageScope = SENTENCE_USAGE_SCOPES.UNKNOWN;
  const sourceId = normalizeId(rawValue(candidate, provenance, 'source_id', null));
  const sourceTitle = normalizeNullableText(rawValue(candidate, provenance, 'source_title', null));
  const sourceLocator = normalizeSourceLocator(rawValue(candidate, provenance, 'source_locator', null));
  const provenanceComplete = hasRequiredProvenance(sourceKind, sourceId, sourceTitle, sourceLocator);
  const compatibilityReason = enforceSourceCompatibility(sourceKind, licenseKind, ownership);
  const validatedAuthenticAnchor = canUseAsValidatedAuthenticAnchor({
    sourceKind,
    licenseKind,
    ownership,
    contentStatus,
    qualityStatus,
    provenanceComplete,
  }) && !compatibilityReason && !generatedFlag.invalid && !contentStatusInput.invalid;
  const reasons = policyReasons({
    sentence,
    sourceKind,
    licenseKind,
    ownership,
    contentStatus,
    qualityStatus,
    generatedFlagIssue: generatedFlag.invalid || contentStatusInput.invalid,
    provenanceComplete,
    validatedAuthenticAnchor,
  });
  if (compatibilityReason) reasons.push(compatibilityReason);
  const result = {
    schema_version: SENTENCE_SOURCE_SCHEMA_VERSION,
    policy_version: SENTENCE_SOURCE_POLICY_VERSION,
    version: SENTENCE_SOURCE_POLICY_VERSION,
    sentence: sentence || null,
    source_kind: sourceKind,
    source_type: sourceKind,
    source_id: sourceId,
    source_title: sourceTitle,
    source_locator: sourceLocator,
    license_kind: licenseKind,
    ownership,
    quality_status: qualityStatus,
    content_status: contentStatus,
    authenticity_status: contentStatus,
    generation_status: generated ? SENTENCE_CONTENT_STATUSES.GENERATED : contentStatus,
    generated,
    authentic,
    is_authentic: authentic,
    usage_scope: usageScope,
    is_local_only: usageScope === SENTENCE_USAGE_SCOPES.LOCAL_ONLY
      || usageScope === SENTENCE_USAGE_SCOPES.LATE_CONTEXT_TRANSFER
      || ownership === SENTENCE_OWNERSHIP.USER
      || ownership === SENTENCE_OWNERSHIP.PRIVATE,
    is_publicly_redistributable: licenseExplicit
      && ownershipExplicit
      && provenanceComplete
      && licenseKind === SENTENCE_LICENSE_KINDS.LICENSED_OPEN,
    license_explicit: licenseExplicit,
    ownership_explicit: ownershipExplicit,
    provenance_complete: provenanceComplete,
    generated_flag_valid: !generatedFlag.invalid,
    validated_authentic_anchor: validatedAuthenticAnchor,
    is_validated_authentic_anchor: validatedAuthenticAnchor,
    can_be_validated_anchor: validatedAuthenticAnchor,
    reason_codes: reasons.map((item) => item.code),
    reasons,
  };
  return result;
}

export const normalizeSentenceProvenance = normalizeSentenceSource;
export const normalizeSentenceCandidateSource = normalizeSentenceSource;

export function isValidatedAuthenticAnchor(source) {
  const normalized = source?.schema_version === SENTENCE_SOURCE_SCHEMA_VERSION
    ? source
    : normalizeSentenceSource(source);
  return Boolean(normalized.validated_authentic_anchor);
}

export function evaluateSentenceSource(input = {}, options = {}) {
  const normalized = normalizeSentenceSource(input);
  const useCase = normalizeAlias(
    options.use_case ?? options.useCase ?? 'first_preview',
    new Map([
      ['first_preview', 'first_preview'],
      ['first-preview', 'first_preview'],
      ['preview', 'first_preview'],
      ['review', 'review'],
      ['late_context_transfer', 'late_context_transfer'],
      ['late-context-transfer', 'late_context_transfer'],
      ['context_transfer', 'late_context_transfer'],
    ]),
    'first_preview',
  );
  const failures = [];
  if (!normalized.sentence) failures.push(reason('EMPTY_SENTENCE', 'Sentence text is required.'));
  if (normalized.source_kind === SENTENCE_SOURCE_KINDS.UNKNOWN) failures.push(reason('SOURCE_TYPE_UNKNOWN', 'Source type is unknown.'));
  if (normalized.license_kind === SENTENCE_LICENSE_KINDS.UNKNOWN) failures.push(reason('LICENSE_UNKNOWN', 'A known license is required for candidate selection.'));
  if (normalized.source_kind !== SENTENCE_SOURCE_KINDS.AI_CANDIDATE && !normalized.provenance_complete) {
    failures.push(reason('PROVENANCE_INCOMPLETE', 'Source ID, locator, and source-specific provenance are required.'));
  }
  if (normalized.quality_status === SENTENCE_QUALITY_STATUSES.REJECTED) failures.push(reason('SOURCE_REJECTED', 'Rejected evidence cannot be selected.'));
  if (normalized.source_kind === SENTENCE_SOURCE_KINDS.USER_LOCAL_EXAM_MATERIAL && useCase === 'first_preview') {
    failures.push(reason('LOCAL_EXAM_NOT_FIRST_PREVIEW', 'Local exam material is reserved for late context transfer.'));
  }
  if (normalized.generated && options.allow_generated !== true) {
    failures.push(reason('GENERATED_NOT_AUTHENTIC_ANCHOR', 'Generated candidates are auxiliary-only unless explicitly allowed.'));
  }
  if (normalized.source_kind === SENTENCE_SOURCE_KINDS.USER_LOCAL_EXAM_MATERIAL && useCase !== 'late_context_transfer') {
    failures.push(reason('LOCAL_EXAM_LATE_TRANSFER_ONLY', 'This material may only be used in late context-transfer mode.'));
  }
  const compatibilityReason = enforceSourceCompatibility(
    normalized.source_kind,
    normalized.license_kind,
    normalized.ownership,
  );
  if (compatibilityReason) failures.push(compatibilityReason);
  const requireValidatedAnchor = options.require_validated_anchor
    ?? useCase === 'first_preview';
  if (requireValidatedAnchor && !normalized.validated_authentic_anchor) {
    failures.push(reason('NOT_VALIDATED_AUTHENTIC_ANCHOR', 'The candidate is not yet a validated authentic anchor.'));
  }
  if (requireValidatedAnchor && !normalized.provenance_complete && !failures.some((item) => item.code === 'PROVENANCE_INCOMPLETE')) {
    failures.push(reason('PROVENANCE_INCOMPLETE', 'Validated anchor selection requires complete source provenance.'));
  }
  return {
    schema_version: SENTENCE_SOURCE_SCHEMA_VERSION,
    policy_version: SENTENCE_SOURCE_POLICY_VERSION,
    version: SENTENCE_SOURCE_POLICY_VERSION,
    use_case: useCase,
    eligible: failures.length === 0,
    normalized_source: normalized,
    hard_failures: failures,
    reason_codes: failures.map((item) => item.code),
    reasons: failures.length > 0
      ? failures
      : [{
        code: 'SOURCE_POLICY_ELIGIBLE',
        message: 'Provenance and use-case policy permit this sentence candidate.',
        details: {},
      }],
  };
}

export function isSourcePolicyEligible(input, options = {}) {
  return evaluateSentenceSource(input, options).eligible;
}

export function getSentenceSourcePriority(sourceKind) {
  return {
    [SENTENCE_SOURCE_KINDS.ARTICLE]: 0,
    [SENTENCE_SOURCE_KINDS.SUBTITLE]: 0,
    [SENTENCE_SOURCE_KINDS.OPEN_CORPUS]: 1,
    [SENTENCE_SOURCE_KINDS.DICTIONARY_EXAMPLE]: 2,
    [SENTENCE_SOURCE_KINDS.USER_LOCAL_EXAM_MATERIAL]: 3,
    [SENTENCE_SOURCE_KINDS.AI_CANDIDATE]: 4,
    [SENTENCE_SOURCE_KINDS.UNKNOWN]: 5,
  }[sourceKind] ?? 5;
}
