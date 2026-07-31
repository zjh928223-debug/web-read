const AUDIT_SCHEMA_VERSION = 'legacy-audit-manifest.v1';
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const LEGACY_REVIEW_STATES = new Set(['new', 'learning', 'review', 'relearning']);

const REASON_ORDER = Object.freeze([
  'WORD_IGNORED',
  'WORD_DELETED',
  'MISSING_WORD_RECORD',
  'MISSING_WORD_ID',
  'DUPLICATE_LEMMA',
  'MULTIPLE_REVIEW_STATES',
  'ORPHAN_REVIEW_STATE',
  'ORPHAN_REVIEW_LOG',
  'BAD_WORD_DATE',
  'BAD_CONTEXT_DATE',
  'BAD_REVIEW_STATE_DATE',
  'BAD_REVIEW_LOG_DATE',
  'MULTIPLE_TARGET_SENSES',
  'MISSING_CONTEXT',
  'MISSING_TARGET_SENSE',
]);

const CONFLICT_REASONS = new Set([
  'MISSING_WORD_RECORD',
  'MISSING_WORD_ID',
  'DUPLICATE_LEMMA',
  'MULTIPLE_REVIEW_STATES',
  'ORPHAN_REVIEW_STATE',
  'ORPHAN_REVIEW_LOG',
  'BAD_WORD_DATE',
  'BAD_CONTEXT_DATE',
  'BAD_REVIEW_STATE_DATE',
  'BAD_REVIEW_LOG_DATE',
  'MULTIPLE_TARGET_SENSES',
]);

function contractError(code, message, field) {
  return {
    code,
    message,
    details: { field },
  };
}

function requireObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw contractError('INVALID_FIELD_TYPE', `${field} must be an object`, field);
  }
  return value;
}

function requireArray(value, field) {
  if (!Array.isArray(value)) {
    throw contractError('INVALID_FIELD_TYPE', `${field} must be an array`, field);
  }
  return value;
}

function requireText(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw contractError('MISSING_REQUIRED_FIELD', `${field} is required`, field);
  }
  return value.trim();
}

function requireUtcTimestamp(value, field) {
  const timestamp = requireText(value, field);
  if (!timestamp.endsWith('Z') || Number.isNaN(Date.parse(timestamp))) {
    throw contractError('INVALID_TIMESTAMP', `${field} must be a UTC timestamp`, field);
  }
  return timestamp;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.normalize('NFKC').replace(/\s+/g, ' ').trim() : '';
}

function normalizeLookup(value) {
  return normalizeText(value).toLocaleLowerCase('en-US');
}

function getWordId(value) {
  return normalizeText(value && (value.id || value.word_id || value.wordId));
}

function getReferenceWordId(value) {
  return normalizeText(value && (value.word_id || value.wordId));
}

function hasBadTimestamp(value) {
  return value !== null
    && value !== undefined
    && value !== ''
    && (typeof value !== 'string' || !value.endsWith('Z') || Number.isNaN(Date.parse(value)));
}

function hasBadDate(record, fields) {
  return fields.some((field) => hasBadTimestamp(record && record[field]));
}

function addReason(reasonsByWordId, wordId, reason) {
  if (!reasonsByWordId.has(wordId)) reasonsByWordId.set(wordId, new Set());
  reasonsByWordId.get(wordId).add(reason);
}

function getPreferredContextSense(context) {
  return normalizeLookup(
    context && (context.simple_meaning || context.simpleMeaning || context.meaning),
  );
}

function hasTargetSense(word, contexts) {
  if (normalizeText(word && (
    word.meaning
    || word.general_meaning
    || word.generalMeaning
    || word.dictionary_definition
    || word.dictionaryDefinition
  ))) {
    return true;
  }
  return contexts.some((context) => getPreferredContextSense(context));
}

function uniqueContextSenseValues(contexts) {
  return new Set(contexts.map(getPreferredContextSense).filter(Boolean));
}

function classify(reasons) {
  if (reasons.includes('WORD_IGNORED') || reasons.includes('WORD_DELETED')) {
    return 'ignored_or_deleted';
  }
  if (reasons.some((reason) => CONFLICT_REASONS.has(reason))) return 'conflicting';
  if (reasons.includes('MISSING_CONTEXT')) return 'needs_context';
  if (reasons.includes('MISSING_TARGET_SENSE')) return 'needs_sense';
  return 'compatible';
}

function sortReasons(reasons) {
  const order = new Map(REASON_ORDER.map((reason, index) => [reason, index]));
  return [...reasons].sort((left, right) => {
    const leftOrder = order.has(left) ? order.get(left) : Number.MAX_SAFE_INTEGER;
    const rightOrder = order.has(right) ? order.get(right) : Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.localeCompare(right);
  });
}

export function auditLegacyVocabularySnapshot(snapshot, options) {
  const source = requireObject(snapshot, 'snapshot');
  const settings = requireObject(options, 'options');
  if (source.schemaVersion !== 1) {
    throw contractError(
      'UNSUPPORTED_SCHEMA_VERSION',
      'snapshot.schemaVersion must be 1',
      'snapshot.schemaVersion',
    );
  }
  const policyVersion = requireText(settings.policy_version, 'options.policy_version');
  const sourceHash = requireText(
    settings.source_snapshot_hmac_sha256,
    'options.source_snapshot_hmac_sha256',
  );
  if (!HASH_PATTERN.test(sourceHash)) {
    throw contractError(
      'INVALID_FIELD_TYPE',
      'options.source_snapshot_hmac_sha256 must be lowercase hex64',
      'options.source_snapshot_hmac_sha256',
    );
  }
  const auditedAt = requireUtcTimestamp(settings.audited_at, 'options.audited_at');

  const words = requireArray(source.words, 'snapshot.words');
  const contexts = requireArray(source.contexts, 'snapshot.contexts');
  const reviewStates = requireArray(source.reviewStates, 'snapshot.reviewStates');
  const reviewLogs = requireArray(source.reviewLogs, 'snapshot.reviewLogs');

  const wordsById = new Map();
  const contextsByWordId = new Map();
  const reviewStatesByWordId = new Map();
  const reasonsByWordId = new Map();
  const lookupGroups = new Map();

  words.forEach((word, index) => {
    const wordId = getWordId(word) || `__missing_word_id__:${index}`;
    wordsById.set(wordId, word);
    if (!getWordId(word)) addReason(reasonsByWordId, wordId, 'MISSING_WORD_ID');
    if (hasBadDate(word, ['created_at', 'createdAt', 'updated_at', 'updatedAt', 'deleted_at', 'deletedAt'])) {
      addReason(reasonsByWordId, wordId, 'BAD_WORD_DATE');
    }
    const status = normalizeLookup(word && word.status);
    if (status === 'ignored') addReason(reasonsByWordId, wordId, 'WORD_IGNORED');
    if (status === 'deleted' || word && (word.deleted === true || word.is_deleted === true || word.deleted_at || word.deletedAt)) {
      addReason(reasonsByWordId, wordId, 'WORD_DELETED');
    }
    const lemma = normalizeLookup(word && (word.lookup_key || word.lookupKey || word.lemma || word.word));
    const language = normalizeLookup(word && word.language) || 'en';
    if (lemma) {
      const lookupKey = `${language}\u001f${lemma}`;
      if (!lookupGroups.has(lookupKey)) lookupGroups.set(lookupKey, []);
      lookupGroups.get(lookupKey).push(wordId);
    }
  });

  lookupGroups.forEach((wordIds) => {
    if (wordIds.length < 2) return;
    wordIds.forEach((wordId) => addReason(reasonsByWordId, wordId, 'DUPLICATE_LEMMA'));
  });

  contexts.forEach((context) => {
    const wordId = getReferenceWordId(context);
    if (!wordId) return;
    if (!contextsByWordId.has(wordId)) contextsByWordId.set(wordId, []);
    contextsByWordId.get(wordId).push(context);
    if (!wordsById.has(wordId)) addReason(reasonsByWordId, wordId, 'MISSING_WORD_RECORD');
    if (hasBadDate(context, ['created_at', 'createdAt'])) {
      addReason(reasonsByWordId, wordId, 'BAD_CONTEXT_DATE');
    }
  });

  reviewStates.forEach((reviewState, index) => {
    if (!reviewState || !LEGACY_REVIEW_STATES.has(reviewState.state)) {
      throw contractError(
        'UNKNOWN_REVIEW_STATE',
        'legacy review state is not recognized',
        `snapshot.reviewStates[${index}].state`,
      );
    }
    const wordId = getReferenceWordId(reviewState);
    if (!wordId) return;
    if (!reviewStatesByWordId.has(wordId)) reviewStatesByWordId.set(wordId, []);
    reviewStatesByWordId.get(wordId).push(reviewState);
    if (!wordsById.has(wordId)) addReason(reasonsByWordId, wordId, 'ORPHAN_REVIEW_STATE');
    if (hasBadDate(reviewState, ['due_at', 'dueAt', 'last_review_at', 'lastReviewAt'])) {
      addReason(reasonsByWordId, wordId, 'BAD_REVIEW_STATE_DATE');
    }
  });

  reviewStatesByWordId.forEach((states, wordId) => {
    if (states.length > 1) addReason(reasonsByWordId, wordId, 'MULTIPLE_REVIEW_STATES');
  });

  reviewLogs.forEach((reviewLog) => {
    const wordId = getReferenceWordId(reviewLog);
    if (!wordId) return;
    if (!wordsById.has(wordId)) addReason(reasonsByWordId, wordId, 'ORPHAN_REVIEW_LOG');
    if (hasBadDate(reviewLog, ['reviewed_at', 'reviewedAt'])) {
      addReason(reasonsByWordId, wordId, 'BAD_REVIEW_LOG_DATE');
    }
  });

  wordsById.forEach((word, wordId) => {
    const wordContexts = contextsByWordId.get(wordId) || [];
    if (!wordContexts.some((context) => normalizeText(context && context.sentence))) {
      addReason(reasonsByWordId, wordId, 'MISSING_CONTEXT');
    }
    if (!hasTargetSense(word, wordContexts)) {
      addReason(reasonsByWordId, wordId, 'MISSING_TARGET_SENSE');
    }
    if (uniqueContextSenseValues(wordContexts).size > 1) {
      addReason(reasonsByWordId, wordId, 'MULTIPLE_TARGET_SENSES');
    }
  });

  const itemIds = new Set([...wordsById.keys(), ...reasonsByWordId.keys()]);
  const items = [...itemIds].sort().map((legacyWordId) => {
    const reasons = sortReasons(reasonsByWordId.get(legacyWordId) || []);
    return {
      legacy_word_id: legacyWordId,
      classification: classify(reasons),
      reason_codes: reasons,
      is_legacy: true,
      training_eligible: false,
    };
  });

  return {
    schema_version: AUDIT_SCHEMA_VERSION,
    policy_version: policyVersion,
    source_snapshot_hmac_sha256: sourceHash,
    audited_at: auditedAt,
    items,
  };
}
