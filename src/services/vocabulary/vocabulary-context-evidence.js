const DB_NAME = 'SeekPlayerDB';
const DB_VERSION = 1;
const STORE_NAME = 'files';

export const CONTEXT_EVIDENCE_STORE_KEY = 'vocabulary.context-evidence.store.v1';
export const CONTEXT_EVIDENCE_SCHEMA_VERSION = 'context-evidence.v1';
export const CONTEXT_EVIDENCE_STORE_SCHEMA_VERSION = 'context-evidence-store.v1';
export const CONTEXT_EVIDENCE_EXPORT_SCHEMA_VERSION = 'context-evidence-export.v1';
export const SOURCE_LOCATOR_VERSION = 'source-locator.v1';

export const CONTEXT_EVIDENCE_SOURCE_KINDS = Object.freeze({
  ARTICLE: 'article',
  SUBTITLE: 'subtitle',
  USER_LOCAL_EXAM_MATERIAL: 'user_local_exam_material',
  OPEN_CORPUS: 'open_corpus',
  DICTIONARY_EXAMPLE: 'dictionary_example',
  AI_CANDIDATE: 'ai_candidate',
});

export const CONTEXT_EVIDENCE_LICENSE_KINDS = Object.freeze({
  USER_OWNED: 'user_owned',
  LICENSED_OPEN: 'licensed_open',
  DICTIONARY_TERMS: 'dictionary_terms',
  AI_GENERATED: 'ai_generated',
  UNKNOWN: 'unknown',
});

export const CONTEXT_EVIDENCE_OWNERSHIP = Object.freeze({
  USER: 'user',
  PRIVATE: 'private',
  THIRD_PARTY: 'third_party',
  PUBLIC: 'public',
});

export const CONTEXT_EVIDENCE_QUALITY_STATUSES = Object.freeze({
  PENDING: 'pending',
  VALIDATED: 'validated',
  REJECTED: 'rejected',
});

const SOURCE_KINDS = new Set(Object.values(CONTEXT_EVIDENCE_SOURCE_KINDS));
const LICENSE_KINDS = new Set(Object.values(CONTEXT_EVIDENCE_LICENSE_KINDS));
const OWNERSHIP_VALUES = new Set(Object.values(CONTEXT_EVIDENCE_OWNERSHIP));
const QUALITY_STATUSES = new Set(Object.values(CONTEXT_EVIDENCE_QUALITY_STATUSES));
const CONTEXT_FIELDS = new Set([
  'schema_version',
  'context_evidence_id',
  'learning_unit_id',
  'sentence',
  'surrounding_text',
  'content_sha256',
  'source_kind',
  'source_id',
  'source_title',
  'source_locator',
  'license_kind',
  'ownership',
  'quality_status',
  'quality_reason',
  'created_at',
  'validated_at',
  'revision',
  'extensions',
]);
const SOURCE_PRIORITY = new Map([
  [CONTEXT_EVIDENCE_SOURCE_KINDS.ARTICLE, 0],
  [CONTEXT_EVIDENCE_SOURCE_KINDS.SUBTITLE, 0],
  [CONTEXT_EVIDENCE_SOURCE_KINDS.USER_LOCAL_EXAM_MATERIAL, 1],
  [CONTEXT_EVIDENCE_SOURCE_KINDS.OPEN_CORPUS, 2],
  [CONTEXT_EVIDENCE_SOURCE_KINDS.DICTIONARY_EXAMPLE, 3],
  [CONTEXT_EVIDENCE_SOURCE_KINDS.AI_CANDIDATE, 4],
]);

function contractError(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'ContractError';
  error.code = code;
  error.details = cloneJson(details);
  return error;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, field) {
  if (!isPlainObject(value)) {
    throw contractError('INVALID_FIELD_TYPE', `${field} must be a plain object`, { field });
  }
}

function assertKnownFields(input) {
  for (const field of Object.keys(input)) {
    if (!CONTEXT_FIELDS.has(field)) {
      throw contractError('INVALID_FIELD_TYPE', 'Unknown ContextEvidence field', { field });
    }
  }
}

function requireField(input, field) {
  if (!Object.prototype.hasOwnProperty.call(input, field)) {
    throw contractError('MISSING_REQUIRED_FIELD', `Missing required field: ${field}`, { field });
  }
  return input[field];
}

function normalizeId(value, field, nullable = false) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw contractError('INVALID_FIELD_TYPE', `${field} must be a non-empty opaque ID`, { field });
  }
  return value;
}

function normalizeNullableText(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw contractError('INVALID_FIELD_TYPE', `${field} must be a string or null`, { field });
  }
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeRequiredText(value, field) {
  if (typeof value !== 'string') {
    throw contractError('INVALID_FIELD_TYPE', `${field} must be a string`, { field });
  }
  const normalized = normalizeText(value);
  if (!normalized) {
    throw contractError('INVALID_FIELD_TYPE', `${field} must be non-empty`, { field });
  }
  return normalized;
}

function normalizeText(value) {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function normalizeTimestamp(value, field, nullable = false) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.+Z$/u.test(value)) {
    throw contractError('INVALID_TIMESTAMP', `${field} must be a UTC ISO-8601 timestamp`, { field });
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw contractError('INVALID_TIMESTAMP', `${field} must be a valid UTC timestamp`, { field });
  }
  return value;
}

function normalizeEnum(value, allowed, field) {
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw contractError('INVALID_ENUM_VALUE', `${field} contains an unsupported value`, { field });
  }
  return value;
}

function normalizeRevision(value) {
  const revision = value === undefined ? 0 : value;
  if (!Number.isInteger(revision) || revision < 0) {
    throw contractError('INVALID_FIELD_TYPE', 'revision must be a non-negative integer', { field: 'revision' });
  }
  return revision;
}

function assertJsonValue(value, field) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    throw contractError('INVALID_FIELD_TYPE', `${field} contains a non-finite number`, { field });
  }
  if (Array.isArray(value)) {
    value.forEach((item) => assertJsonValue(item, field));
    return;
  }
  if (isPlainObject(value)) {
    Object.values(value).forEach((item) => assertJsonValue(item, field));
    return;
  }
  throw contractError('INVALID_FIELD_TYPE', `${field} must contain JSON values only`, { field });
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  assertJsonValue(value, 'value');
  return JSON.parse(JSON.stringify(value));
}

function canonicalJson(value) {
  assertJsonValue(value, 'value');
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}

function normalizeSourceLocator(value, sourceKind) {
  assertPlainObject(value, 'source_locator');
  assertJsonValue(value, 'source_locator');
  const locator = cloneJson(value);
  locator.locator_version = locator.locator_version ?? SOURCE_LOCATOR_VERSION;
  if (locator.locator_version !== SOURCE_LOCATOR_VERSION) {
    throw contractError('UNSUPPORTED_SCHEMA_VERSION', 'Unsupported source locator version', {
      field: 'source_locator.locator_version',
    });
  }

  const requireLocatorString = (field) => {
    if (typeof locator[field] !== 'string' || !locator[field].trim()) {
      throw contractError('MISSING_REQUIRED_FIELD', `source_locator.${field} is required`, {
        field: `source_locator.${field}`,
        source_kind: sourceKind,
      });
    }
    locator[field] = locator[field].normalize('NFKC').trim();
  };
  const requireLocatorInteger = (field) => {
    if (!Number.isInteger(locator[field]) || locator[field] < 0) {
      throw contractError('INVALID_FIELD_TYPE', `source_locator.${field} must be a non-negative integer`, {
        field: `source_locator.${field}`,
        source_kind: sourceKind,
      });
    }
  };

  switch (sourceKind) {
    case CONTEXT_EVIDENCE_SOURCE_KINDS.ARTICLE:
      requireLocatorInteger('sentence_index');
      break;
    case CONTEXT_EVIDENCE_SOURCE_KINDS.SUBTITLE:
      requireLocatorInteger('start_ms');
      requireLocatorInteger('end_ms');
      if (locator.end_ms < locator.start_ms) {
        throw contractError('INVALID_FIELD_TYPE', 'Subtitle locator end must not precede start', {
          field: 'source_locator.end_ms',
          source_kind: sourceKind,
        });
      }
      break;
    case CONTEXT_EVIDENCE_SOURCE_KINDS.USER_LOCAL_EXAM_MATERIAL:
      requireLocatorString('local_locator');
      break;
    case CONTEXT_EVIDENCE_SOURCE_KINDS.OPEN_CORPUS:
      requireLocatorString('record_id');
      break;
    case CONTEXT_EVIDENCE_SOURCE_KINDS.DICTIONARY_EXAMPLE:
      requireLocatorString('entry_id');
      break;
    case CONTEXT_EVIDENCE_SOURCE_KINDS.AI_CANDIDATE:
      requireLocatorString('candidate_id');
      break;
    default:
      break;
  }
  return locator;
}

function sourceDefaults(sourceKind) {
  switch (sourceKind) {
    case CONTEXT_EVIDENCE_SOURCE_KINDS.ARTICLE:
    case CONTEXT_EVIDENCE_SOURCE_KINDS.SUBTITLE:
      return {
        license_kind: CONTEXT_EVIDENCE_LICENSE_KINDS.UNKNOWN,
        ownership: CONTEXT_EVIDENCE_OWNERSHIP.THIRD_PARTY,
      };
    case CONTEXT_EVIDENCE_SOURCE_KINDS.USER_LOCAL_EXAM_MATERIAL:
      return {
        license_kind: CONTEXT_EVIDENCE_LICENSE_KINDS.USER_OWNED,
        ownership: CONTEXT_EVIDENCE_OWNERSHIP.PRIVATE,
      };
    case CONTEXT_EVIDENCE_SOURCE_KINDS.OPEN_CORPUS:
      return {
        license_kind: CONTEXT_EVIDENCE_LICENSE_KINDS.LICENSED_OPEN,
        ownership: CONTEXT_EVIDENCE_OWNERSHIP.PUBLIC,
      };
    case CONTEXT_EVIDENCE_SOURCE_KINDS.DICTIONARY_EXAMPLE:
      return {
        license_kind: CONTEXT_EVIDENCE_LICENSE_KINDS.DICTIONARY_TERMS,
        ownership: CONTEXT_EVIDENCE_OWNERSHIP.THIRD_PARTY,
      };
    case CONTEXT_EVIDENCE_SOURCE_KINDS.AI_CANDIDATE:
      return {
        license_kind: CONTEXT_EVIDENCE_LICENSE_KINDS.AI_GENERATED,
        ownership: CONTEXT_EVIDENCE_OWNERSHIP.USER,
      };
    default:
      return {
        license_kind: CONTEXT_EVIDENCE_LICENSE_KINDS.UNKNOWN,
        ownership: CONTEXT_EVIDENCE_OWNERSHIP.THIRD_PARTY,
      };
  }
}

function validateSourcePolicy(evidence) {
  const needsSourceId = evidence.source_kind !== CONTEXT_EVIDENCE_SOURCE_KINDS.AI_CANDIDATE;
  if (needsSourceId && evidence.source_id === null) {
    throw contractError('MISSING_REQUIRED_FIELD', 'source_id is required for this source kind', {
      field: 'source_id',
      source_kind: evidence.source_kind,
    });
  }

  if (
    (evidence.source_kind === CONTEXT_EVIDENCE_SOURCE_KINDS.ARTICLE
      || evidence.source_kind === CONTEXT_EVIDENCE_SOURCE_KINDS.SUBTITLE)
    && evidence.source_title === null
  ) {
    throw contractError('MISSING_REQUIRED_FIELD', 'source_title is required for imported documents', {
      field: 'source_title',
      source_kind: evidence.source_kind,
    });
  }

  if (
    evidence.source_kind === CONTEXT_EVIDENCE_SOURCE_KINDS.USER_LOCAL_EXAM_MATERIAL
    && (
      evidence.license_kind !== CONTEXT_EVIDENCE_LICENSE_KINDS.USER_OWNED
      || ![
        CONTEXT_EVIDENCE_OWNERSHIP.USER,
        CONTEXT_EVIDENCE_OWNERSHIP.PRIVATE,
      ].includes(evidence.ownership)
    )
  ) {
    throw contractError('INVALID_ENUM_VALUE', 'Local exam material must remain user-owned and local', {
      field: 'license_kind',
      source_kind: evidence.source_kind,
    });
  }

  if (
    evidence.source_kind === CONTEXT_EVIDENCE_SOURCE_KINDS.OPEN_CORPUS
    && (
      evidence.license_kind !== CONTEXT_EVIDENCE_LICENSE_KINDS.LICENSED_OPEN
      || ![
        CONTEXT_EVIDENCE_OWNERSHIP.PUBLIC,
        CONTEXT_EVIDENCE_OWNERSHIP.THIRD_PARTY,
      ].includes(evidence.ownership)
    )
  ) {
    throw contractError('INVALID_ENUM_VALUE', 'Open corpus evidence requires an open license', {
      field: 'license_kind',
      source_kind: evidence.source_kind,
    });
  }

  if (
    evidence.source_kind === CONTEXT_EVIDENCE_SOURCE_KINDS.DICTIONARY_EXAMPLE
    && ![
      CONTEXT_EVIDENCE_LICENSE_KINDS.DICTIONARY_TERMS,
      CONTEXT_EVIDENCE_LICENSE_KINDS.LICENSED_OPEN,
    ].includes(evidence.license_kind)
  ) {
    throw contractError('INVALID_ENUM_VALUE', 'Dictionary examples require explicit dictionary or open terms', {
      field: 'license_kind',
      source_kind: evidence.source_kind,
    });
  }

  if (
    evidence.source_kind === CONTEXT_EVIDENCE_SOURCE_KINDS.AI_CANDIDATE
    && evidence.license_kind !== CONTEXT_EVIDENCE_LICENSE_KINDS.AI_GENERATED
  ) {
    throw contractError('INVALID_ENUM_VALUE', 'AI candidates must be identified as AI generated', {
      field: 'license_kind',
      source_kind: evidence.source_kind,
    });
  }
}

function rotateRight(value, amount) {
  return (value >>> amount) | (value << (32 - amount));
}

function utf8Bytes(value) {
  const bytes = [];
  for (const character of unescape(encodeURIComponent(value))) {
    bytes.push(character.charCodeAt(0));
  }
  return bytes;
}

function sha256(value) {
  const constants = [];
  const initial = [];
  let candidate = 2;
  while (constants.length < 64) {
    let prime = true;
    for (let divisor = 2; divisor * divisor <= candidate; divisor += 1) {
      if (candidate % divisor === 0) {
        prime = false;
        break;
      }
    }
    if (prime) {
      if (initial.length < 8) initial.push((Math.sqrt(candidate) * 0x100000000) | 0);
      constants.push((Math.cbrt(candidate) * 0x100000000) | 0);
    }
    candidate += 1;
  }

  const bytes = utf8Bytes(value);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((high >>> shift) & 0xff);
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((low >>> shift) & 0xff);

  const hash = initial.slice();
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Array(64);
    for (let index = 0; index < 16; index += 1) {
      const start = offset + index * 4;
      words[index] = (
        (bytes[start] << 24)
        | (bytes[start + 1] << 16)
        | (bytes[start + 2] << 8)
        | bytes[start + 3]
      );
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15];
      const previous2 = words[index - 2];
      const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) | 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + constants[index] + words[index]) | 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    hash[0] = (hash[0] + a) | 0;
    hash[1] = (hash[1] + b) | 0;
    hash[2] = (hash[2] + c) | 0;
    hash[3] = (hash[3] + d) | 0;
    hash[4] = (hash[4] + e) | 0;
    hash[5] = (hash[5] + f) | 0;
    hash[6] = (hash[6] + g) | 0;
    hash[7] = (hash[7] + h) | 0;
  }
  return hash.map((word) => (word >>> 0).toString(16).padStart(8, '0')).join('');
}

export function deriveContextEvidenceContentSha256(sentence, surroundingText = null) {
  const normalizedSentence = normalizeRequiredText(sentence, 'sentence');
  const normalizedSurroundingText = normalizeNullableText(surroundingText, 'surrounding_text');
  return sha256(canonicalJson({
    sentence: normalizedSentence,
    surrounding_text: normalizedSurroundingText,
  }));
}

export function normalizeContextEvidence(input) {
  assertPlainObject(input, 'ContextEvidence');
  assertKnownFields(input);
  const schemaVersion = input.schema_version ?? CONTEXT_EVIDENCE_SCHEMA_VERSION;
  if (schemaVersion !== CONTEXT_EVIDENCE_SCHEMA_VERSION) {
    throw contractError('UNSUPPORTED_SCHEMA_VERSION', 'Unsupported ContextEvidence schema version', {
      field: 'schema_version',
    });
  }

  const sourceKind = normalizeEnum(requireField(input, 'source_kind'), SOURCE_KINDS, 'source_kind');
  const defaults = sourceDefaults(sourceKind);
  const sentence = normalizeRequiredText(requireField(input, 'sentence'), 'sentence');
  const surroundingText = normalizeNullableText(input.surrounding_text, 'surrounding_text');
  const computedHash = deriveContextEvidenceContentSha256(sentence, surroundingText);
  const suppliedHash = input.content_sha256 ?? computedHash;
  if (typeof suppliedHash !== 'string' || !/^[a-f0-9]{64}$/u.test(suppliedHash)) {
    throw contractError('INVALID_FIELD_TYPE', 'content_sha256 must be lowercase hex64', {
      field: 'content_sha256',
    });
  }
  if (suppliedHash !== computedHash) {
    throw contractError('INVALID_FIELD_TYPE', 'content_sha256 does not match normalized content', {
      field: 'content_sha256',
    });
  }

  const licenseKind = normalizeEnum(
    input.license_kind ?? defaults.license_kind,
    LICENSE_KINDS,
    'license_kind',
  );
  const ownership = normalizeEnum(
    input.ownership ?? defaults.ownership,
    OWNERSHIP_VALUES,
    'ownership',
  );
  let qualityStatus = normalizeEnum(
    input.quality_status ?? CONTEXT_EVIDENCE_QUALITY_STATUSES.PENDING,
    QUALITY_STATUSES,
    'quality_status',
  );
  if (licenseKind === CONTEXT_EVIDENCE_LICENSE_KINDS.UNKNOWN) {
    qualityStatus = CONTEXT_EVIDENCE_QUALITY_STATUSES.PENDING;
  }
  const validatedAt = normalizeTimestamp(input.validated_at ?? null, 'validated_at', true);
  if (qualityStatus === CONTEXT_EVIDENCE_QUALITY_STATUSES.VALIDATED && validatedAt === null) {
    throw contractError('MISSING_REQUIRED_FIELD', 'validated_at is required for validated evidence', {
      field: 'validated_at',
    });
  }
  if (qualityStatus !== CONTEXT_EVIDENCE_QUALITY_STATUSES.VALIDATED && validatedAt !== null) {
    throw contractError('INVALID_TIMESTAMP', 'validated_at is only valid for validated evidence', {
      field: 'validated_at',
    });
  }

  const extensions = input.extensions ?? {};
  assertPlainObject(extensions, 'extensions');
  assertJsonValue(extensions, 'extensions');

  const evidence = {
    schema_version: CONTEXT_EVIDENCE_SCHEMA_VERSION,
    context_evidence_id: normalizeId(
      requireField(input, 'context_evidence_id'),
      'context_evidence_id',
    ),
    learning_unit_id: normalizeId(requireField(input, 'learning_unit_id'), 'learning_unit_id'),
    sentence,
    surrounding_text: surroundingText,
    content_sha256: computedHash,
    source_kind: sourceKind,
    source_id: normalizeId(input.source_id ?? null, 'source_id', true),
    source_title: normalizeNullableText(input.source_title, 'source_title'),
    source_locator: normalizeSourceLocator(requireField(input, 'source_locator'), sourceKind),
    license_kind: licenseKind,
    ownership,
    quality_status: qualityStatus,
    quality_reason: normalizeNullableText(input.quality_reason, 'quality_reason'),
    created_at: normalizeTimestamp(requireField(input, 'created_at'), 'created_at'),
    validated_at: validatedAt,
    revision: normalizeRevision(input.revision),
    extensions: cloneJson(extensions),
  };
  validateSourcePolicy(evidence);
  return evidence;
}

export function assertContextEvidence(input) {
  assertPlainObject(input, 'ContextEvidence');
  for (const field of CONTEXT_FIELDS) requireField(input, field);
  const normalized = normalizeContextEvidence(input);
  if (canonicalJson(normalized) !== canonicalJson(input)) {
    throw contractError('INVALID_FIELD_TYPE', 'ContextEvidence is not fully normalized', {
      field: 'ContextEvidence',
    });
  }
}

function normalizeStore(seed) {
  const source = seed ?? {
    schema_version: CONTEXT_EVIDENCE_STORE_SCHEMA_VERSION,
    by_context_evidence_id: {},
  };
  assertPlainObject(source, 'ContextEvidenceStoreV1');
  if (source.schema_version !== CONTEXT_EVIDENCE_STORE_SCHEMA_VERSION) {
    throw contractError('UNSUPPORTED_SCHEMA_VERSION', 'Unsupported ContextEvidence store version', {
      field: 'schema_version',
    });
  }
  assertPlainObject(source.by_context_evidence_id, 'by_context_evidence_id');
  const byId = {};
  for (const [key, value] of Object.entries(source.by_context_evidence_id)) {
    const evidence = normalizeContextEvidence(value);
    if (key !== evidence.context_evidence_id) {
      throw contractError('INVALID_CONTEXT_REFERENCE', 'ContextEvidence map key does not match value ID', {
        context_evidence_id: key,
      });
    }
    byId[key] = evidence;
  }
  const snapshot = {
    schema_version: CONTEXT_EVIDENCE_STORE_SCHEMA_VERSION,
    by_context_evidence_id: byId,
  };
  assertNoDuplicateEvidence(snapshot);
  return snapshot;
}

function evidenceDedupeKey(evidence) {
  return canonicalJson([
    evidence.learning_unit_id,
    evidence.content_sha256,
    evidence.source_id,
    evidence.source_locator,
  ]);
}

function assertNoDuplicateEvidence(snapshot) {
  const seen = new Map();
  for (const evidence of Object.values(snapshot.by_context_evidence_id)) {
    const key = evidenceDedupeKey(evidence);
    const existingId = seen.get(key);
    if (existingId && existingId !== evidence.context_evidence_id) {
      throw contractError('IDEMPOTENCY_CONFLICT', 'Duplicate ContextEvidence dedupe key in snapshot', {
        context_evidence_id: evidence.context_evidence_id,
        existing_context_evidence_id: existingId,
      });
    }
    seen.set(key, evidence.context_evidence_id);
  }
}

function validateExpectedRevision(expectedRevision) {
  if (expectedRevision !== null && (!Number.isInteger(expectedRevision) || expectedRevision < 0)) {
    throw contractError('INVALID_FIELD_TYPE', 'expected_revision must be null or a non-negative integer', {
      field: 'expected_revision',
    });
  }
}

function applyPut(snapshotInput, evidenceInput, expectedRevision) {
  validateExpectedRevision(expectedRevision);
  const snapshot = normalizeStore(snapshotInput);
  const evidence = normalizeContextEvidence(evidenceInput);
  const duplicate = Object.values(snapshot.by_context_evidence_id).find((item) => (
    item.context_evidence_id !== evidence.context_evidence_id
    && evidenceDedupeKey(item) === evidenceDedupeKey(evidence)
  ));
  if (duplicate) {
    return { snapshot, result: cloneJson(duplicate), changed: false };
  }

  const existing = snapshot.by_context_evidence_id[evidence.context_evidence_id] ?? null;
  if (!existing) {
    if (expectedRevision !== null) {
      throw contractError('CONCURRENT_MODIFICATION', 'ContextEvidence does not exist at expected revision', {
        context_evidence_id: evidence.context_evidence_id,
        expected_revision: expectedRevision,
      });
    }
    if (evidence.revision !== 0) {
      throw contractError('CONCURRENT_MODIFICATION', 'New ContextEvidence must start at revision 0', {
        context_evidence_id: evidence.context_evidence_id,
        expected_revision: null,
      });
    }
    snapshot.by_context_evidence_id[evidence.context_evidence_id] = evidence;
    return { snapshot, result: cloneJson(evidence), changed: true };
  }

  if (expectedRevision === null || existing.revision !== expectedRevision) {
    throw contractError('CONCURRENT_MODIFICATION', 'ContextEvidence revision changed', {
      context_evidence_id: evidence.context_evidence_id,
      expected_revision: expectedRevision,
      actual_revision: existing.revision,
    });
  }
  if (existing.learning_unit_id !== evidence.learning_unit_id) {
    throw contractError('INVALID_CONTEXT_REFERENCE', 'ContextEvidence cannot move between learning units', {
      context_evidence_id: evidence.context_evidence_id,
    });
  }
  if (existing.created_at !== evidence.created_at) {
    throw contractError('INVALID_FIELD_TYPE', 'ContextEvidence created_at is immutable', {
      field: 'created_at',
      context_evidence_id: evidence.context_evidence_id,
    });
  }
  const comparable = { ...evidence, revision: existing.revision };
  if (canonicalJson(existing) === canonicalJson(comparable)) {
    return { snapshot, result: cloneJson(existing), changed: false };
  }
  const updated = { ...evidence, revision: existing.revision + 1 };
  snapshot.by_context_evidence_id[evidence.context_evidence_id] = updated;
  return { snapshot, result: cloneJson(updated), changed: true };
}

function repositoryMethods(loadSnapshot, putEvidence) {
  return {
    async loadSnapshot() {
      return cloneJson(normalizeStore(await loadSnapshot()));
    },
    async getById(contextEvidenceId) {
      const id = normalizeId(contextEvidenceId, 'context_evidence_id');
      const snapshot = normalizeStore(await loadSnapshot());
      return cloneJson(snapshot.by_context_evidence_id[id] ?? null);
    },
    async listByLearningUnit(learningUnitId) {
      const id = normalizeId(learningUnitId, 'learning_unit_id');
      const snapshot = normalizeStore(await loadSnapshot());
      return Object.values(snapshot.by_context_evidence_id)
        .filter((evidence) => evidence.learning_unit_id === id)
        .sort((left, right) => (
          left.created_at.localeCompare(right.created_at)
          || left.context_evidence_id.localeCompare(right.context_evidence_id)
        ))
        .map(cloneJson);
    },
    async put(evidence, expectedRevision) {
      return cloneJson(await putEvidence(evidence, expectedRevision));
    },
  };
}

export function createInMemoryContextEvidenceRepository(seed) {
  let snapshot = normalizeStore(seed);
  return repositoryMethods(
    async () => snapshot,
    async (evidence, expectedRevision) => {
      const outcome = applyPut(snapshot, evidence, expectedRevision);
      if (outcome.changed) snapshot = outcome.snapshot;
      return outcome.result;
    },
  );
}

function validateIndexedDbOptions(options) {
  if (!isPlainObject(options)) {
    throw contractError('INVALID_FIELD_TYPE', 'IndexedDB repository options must be an object', {
      field: 'options',
    });
  }
  const keys = Object.keys(options);
  if (keys.some((key) => key !== 'indexedDBApi')) {
    throw contractError('INVALID_FIELD_TYPE', 'Only indexedDBApi may be configured', {
      field: keys.find((key) => key !== 'indexedDBApi'),
    });
  }
}

function indexedDbOperationError(operation) {
  return contractError(
    'TRANSACTION_ABORTED',
    'ContextEvidence IndexedDB operation failed',
    { operation },
  );
}

function runIndexedDbOperation(operation, callback) {
  try {
    return callback();
  } catch {
    throw indexedDbOperationError(operation);
  }
}

function abortTransactionQuietly(transaction) {
  try {
    transaction?.abort();
  } catch {
    // The public promise is rejected with a fixed contract error instead.
  }
}

function openContextEvidenceDb(indexedDBApi) {
  if (!indexedDBApi || typeof indexedDBApi.open !== 'function') {
    throw contractError('INVALID_FIELD_TYPE', 'IndexedDB is unavailable for ContextEvidence storage', {
      field: 'indexedDBApi',
    });
  }
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDBApi.open('SeekPlayerDB', 1);
    } catch {
      reject(indexedDbOperationError('open_database'));
      return;
    }
    let rejectedUpgrade = false;
    request.onupgradeneeded = () => {
      rejectedUpgrade = true;
      try {
        request.transaction?.abort();
      } catch {
        // The database is intentionally never created or upgraded by this module.
      }
      reject(contractError('TRANSACTION_ABORTED', 'ContextEvidence repository requires the existing schema', {
        database: DB_NAME,
        version: DB_VERSION,
        store: STORE_NAME,
      }));
    };
    request.onerror = () => {
      if (!rejectedUpgrade) {
        reject(indexedDbOperationError('open_database'));
      }
    };
    request.onsuccess = () => {
      if (rejectedUpgrade) {
        try {
          request.result?.close?.();
        } catch {
          // The upgrade rejection already crossed the stable contract boundary.
        }
        return;
      }
      let database;
      let schemaTransaction;
      const rejectSchema = () => {
        abortTransactionQuietly(schemaTransaction);
        try {
          database?.close?.();
        } catch {
          // Closing diagnostics are never exposed through the public repository.
        }
        reject(contractError('TRANSACTION_ABORTED', 'ContextEvidence repository schema is incompatible', {
          operation: 'validate_schema',
          database: DB_NAME,
          version: DB_VERSION,
          store: STORE_NAME,
        }));
      };
      try {
        database = request.result;
        if (!database.objectStoreNames.contains('files')) {
          rejectSchema();
          return;
        }
        schemaTransaction = database.transaction(['files'], 'readonly');
        const store = schemaTransaction.objectStore('files');
        if (store.keyPath !== 'id') {
          rejectSchema();
          return;
        }
      } catch {
        rejectSchema();
        return;
      }
      resolve(database);
    };
  });
}

export function createIndexedDbContextEvidenceRepository(options = {}) {
  validateIndexedDbOptions(options);
  const indexedDBApi = options.indexedDBApi
    ?? (typeof globalThis !== 'undefined' ? globalThis.indexedDB : null);
  let databasePromise = null;
  const getDatabase = () => {
    databasePromise ??= openContextEvidenceDb(indexedDBApi);
    return databasePromise;
  };

  async function loadSnapshot() {
    const database = await getDatabase();
    const row = await new Promise((resolve, reject) => {
      let transaction;
      let request;
      try {
        ({ transaction, request } = runIndexedDbOperation(
          'read_context_evidence',
          () => {
            const nextTransaction = database.transaction(['files'], 'readonly');
            const store = nextTransaction.objectStore('files');
            return {
              transaction: nextTransaction,
              request: store.get(CONTEXT_EVIDENCE_STORE_KEY),
            };
          },
        ));
      } catch (error) {
        reject(error);
        return;
      }
      let requestValue;
      let settled = false;
      const fail = () => {
        if (settled) return;
        settled = true;
        reject(indexedDbOperationError('read_context_evidence'));
      };
      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        resolve(requestValue);
      };
      transaction.onerror = fail;
      transaction.onabort = fail;
      request.onsuccess = () => {
        requestValue = request.result;
      };
      request.onerror = fail;
    });
    return normalizeStore(row?.content ?? null);
  }

  async function putEvidence(evidence, expectedRevision) {
    const database = await getDatabase();
    return new Promise((resolve, reject) => {
      let transaction;
      let store;
      let getRequest;
      try {
        ({ transaction, store, getRequest } = runIndexedDbOperation(
          'write_context_evidence',
          () => {
            const nextTransaction = database.transaction(['files'], 'readwrite');
            const nextStore = nextTransaction.objectStore('files');
            return {
              transaction: nextTransaction,
              store: nextStore,
              getRequest: nextStore.get(CONTEXT_EVIDENCE_STORE_KEY),
            };
          },
        ));
      } catch (error) {
        reject(error);
        return;
      }
      let outcome;
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      transaction.oncomplete = () => {
        if (!settled) {
          settled = true;
          resolve(cloneJson(outcome.result));
        }
      };
      transaction.onerror = () => fail(indexedDbOperationError('write_context_evidence'));
      transaction.onabort = () => fail(indexedDbOperationError('write_context_evidence'));

      getRequest.onerror = () => fail(indexedDbOperationError('write_context_evidence'));
      getRequest.onsuccess = () => {
        try {
          outcome = applyPut(getRequest.result?.content ?? null, evidence, expectedRevision);
          if (!outcome.changed) return;
          const putRequest = runIndexedDbOperation('write_context_evidence', () => store.put({
            id: CONTEXT_EVIDENCE_STORE_KEY,
            content: outcome.snapshot,
            timestamp: new Date().toISOString(),
          }));
          putRequest.onerror = () => fail(indexedDbOperationError('write_context_evidence'));
        } catch (error) {
          abortTransactionQuietly(transaction);
          fail(error?.name === 'ContractError'
            ? error
            : indexedDbOperationError('write_context_evidence'));
        }
      };
    });
  }

  return repositoryMethods(loadSnapshot, putEvidence);
}

export function bindContextEvidenceRepositoryToTransaction(rowPort) {
  assertPlainObject(rowPort, 'VocabularyLearningTransactionRowPort');
  if (
    typeof rowPort.transaction_id !== 'string'
    || !rowPort.transaction_id
    || typeof rowPort.getRow !== 'function'
    || typeof rowPort.putRow !== 'function'
    || typeof rowPort.abort !== 'function'
  ) {
    throw contractError('INVALID_FIELD_TYPE', 'Invalid VocabularyLearningTransactionRowPort', {
      field: 'row_port',
    });
  }

  const loadSnapshot = async () => {
    const row = await rowPort.getRow(CONTEXT_EVIDENCE_STORE_KEY);
    return normalizeStore(row?.content ?? null);
  };
  const putEvidence = async (evidence, expectedRevision) => {
    try {
      const row = await rowPort.getRow(CONTEXT_EVIDENCE_STORE_KEY);
      const outcome = applyPut(row?.content ?? null, evidence, expectedRevision);
      if (outcome.changed) {
        await rowPort.putRow({
          id: CONTEXT_EVIDENCE_STORE_KEY,
          content: outcome.snapshot,
          timestamp: new Date().toISOString(),
        });
      }
      return outcome.result;
    } catch (error) {
      if (error?.name === 'ContractError') return rowPort.abort(error);
      return rowPort.abort(contractError(
        'TRANSACTION_ABORTED',
        'ContextEvidence row-port operation failed',
        { operation: 'row_port' },
      ));
    }
  };
  const repository = repositoryMethods(loadSnapshot, putEvidence);
  return {
    getById: repository.getById,
    listByLearningUnit: repository.listByLearningUnit,
    put: repository.put,
  };
}

export function selectValidatedAnchor(learningUnitId, contexts) {
  const id = normalizeId(learningUnitId, 'learning_unit_id');
  if (!Array.isArray(contexts)) {
    throw contractError('INVALID_FIELD_TYPE', 'contexts must be an array', { field: 'contexts' });
  }
  return contexts
    .map((context) => {
      assertContextEvidence(context);
      return cloneJson(context);
    })
    .filter((context) => (
      context.learning_unit_id === id
      && context.quality_status === CONTEXT_EVIDENCE_QUALITY_STATUSES.VALIDATED
    ))
    .sort((left, right) => (
      (SOURCE_PRIORITY.get(left.source_kind) ?? Number.MAX_SAFE_INTEGER)
      - (SOURCE_PRIORITY.get(right.source_kind) ?? Number.MAX_SAFE_INTEGER)
      || left.validated_at.localeCompare(right.validated_at)
      || left.created_at.localeCompare(right.created_at)
      || left.context_evidence_id.localeCompare(right.context_evidence_id)
    ))[0] ?? null;
}

function canExportText(evidence, includeUserOwnedText) {
  if (evidence.license_kind === CONTEXT_EVIDENCE_LICENSE_KINDS.LICENSED_OPEN) return true;
  if (evidence.license_kind === CONTEXT_EVIDENCE_LICENSE_KINDS.AI_GENERATED) return true;
  if (
    includeUserOwnedText
    && (
      evidence.license_kind === CONTEXT_EVIDENCE_LICENSE_KINDS.USER_OWNED
      || evidence.ownership === CONTEXT_EVIDENCE_OWNERSHIP.USER
      || evidence.ownership === CONTEXT_EVIDENCE_OWNERSHIP.PRIVATE
    )
  ) return true;
  return false;
}

function sanitizeSourceLocatorForExport(evidence) {
  const fieldsBySourceKind = {
    [CONTEXT_EVIDENCE_SOURCE_KINDS.ARTICLE]: [
      'locator_version',
      'sentence_index',
    ],
    [CONTEXT_EVIDENCE_SOURCE_KINDS.SUBTITLE]: [
      'locator_version',
      'start_ms',
      'end_ms',
    ],
    [CONTEXT_EVIDENCE_SOURCE_KINDS.USER_LOCAL_EXAM_MATERIAL]: [
      'locator_version',
      'local_locator',
    ],
    [CONTEXT_EVIDENCE_SOURCE_KINDS.OPEN_CORPUS]: [
      'locator_version',
      'record_id',
    ],
    [CONTEXT_EVIDENCE_SOURCE_KINDS.DICTIONARY_EXAMPLE]: [
      'locator_version',
      'entry_id',
    ],
    [CONTEXT_EVIDENCE_SOURCE_KINDS.AI_CANDIDATE]: [
      'locator_version',
      'candidate_id',
    ],
  };
  const locator = {};
  for (const field of fieldsBySourceKind[evidence.source_kind] ?? ['locator_version']) {
    if (Object.prototype.hasOwnProperty.call(evidence.source_locator, field)) {
      locator[field] = cloneJson(evidence.source_locator[field]);
    }
  }
  return locator;
}

function createRedactedContextEvidenceExportItem(evidence) {
  return {
    schema_version: evidence.schema_version,
    context_evidence_id: evidence.context_evidence_id,
    learning_unit_id: evidence.learning_unit_id,
    content_sha256: evidence.content_sha256,
    source_kind: evidence.source_kind,
    source_id: evidence.source_id,
    source_locator: sanitizeSourceLocatorForExport(evidence),
    license_kind: evidence.license_kind,
    ownership: evidence.ownership,
    quality_status: evidence.quality_status,
    created_at: evidence.created_at,
    validated_at: evidence.validated_at,
    revision: evidence.revision,
  };
}

export function exportContextEvidence(contexts, options = {}) {
  if (!Array.isArray(contexts)) {
    throw contractError('INVALID_FIELD_TYPE', 'contexts must be an array', { field: 'contexts' });
  }
  if (!isPlainObject(options) || Object.keys(options).some((key) => key !== 'includeUserOwnedText')) {
    throw contractError('INVALID_FIELD_TYPE', 'Unsupported ContextEvidence export option', {
      field: 'options',
    });
  }
  const includeUserOwnedText = options.includeUserOwnedText ?? false;
  if (typeof includeUserOwnedText !== 'boolean') {
    throw contractError('INVALID_FIELD_TYPE', 'includeUserOwnedText must be boolean', {
      field: 'includeUserOwnedText',
    });
  }
  const items = contexts.map((context) => {
    assertContextEvidence(context);
    if (!canExportText(context, includeUserOwnedText)) {
      return createRedactedContextEvidenceExportItem(context);
    }
    return cloneJson(context);
  });
  return {
    schema_version: CONTEXT_EVIDENCE_EXPORT_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    include_user_owned_text: includeUserOwnedText,
    items,
  };
}
