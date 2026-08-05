/**
 * Deterministic primary-sense selection from independent evidence families.
 *
 * This module deliberately does not use whole-word frequency as sense
 * evidence.  A frequency value can be carried by a caller for diagnostics,
 * but it is ignored unless it is attached to one of the three supported
 * sense-evidence families.
 */

export const PRIMARY_SENSE_POLICY_VERSION = 'primary-sense-policy.v1';
export const PRIMARY_SENSE_SCHEMA_VERSION = PRIMARY_SENSE_POLICY_VERSION;

export const PRIMARY_SENSE_EVIDENCE_SOURCES = Object.freeze({
  LEARNER_DICTIONARY: 'learner_dictionary',
  WORDNET_MFS: 'wordnet_mfs',
  GENERAL_OR_EXAM_CORPUS: 'general_or_exam_corpus',
});

export const PRIMARY_SENSE_STATUSES = Object.freeze({
  RESOLVED: 'resolved',
  UNRESOLVED: 'unresolved',
});

const EVIDENCE_SOURCES = Object.freeze(Object.values(PRIMARY_SENSE_EVIDENCE_SOURCES));
const EVIDENCE_SOURCE_SET = new Set(EVIDENCE_SOURCES);
const SOURCE_ALIASES = new Map([
  ['learner_dictionary', PRIMARY_SENSE_EVIDENCE_SOURCES.LEARNER_DICTIONARY],
  ['learner-dictionary', PRIMARY_SENSE_EVIDENCE_SOURCES.LEARNER_DICTIONARY],
  ['learner dictionary', PRIMARY_SENSE_EVIDENCE_SOURCES.LEARNER_DICTIONARY],
  ['learnerDictionary', PRIMARY_SENSE_EVIDENCE_SOURCES.LEARNER_DICTIONARY],
  ['dictionary', PRIMARY_SENSE_EVIDENCE_SOURCES.LEARNER_DICTIONARY],
  ['wordnet_mfs', PRIMARY_SENSE_EVIDENCE_SOURCES.WORDNET_MFS],
  ['wordnet-mfs', PRIMARY_SENSE_EVIDENCE_SOURCES.WORDNET_MFS],
  ['wordnet_most_frequent_sense', PRIMARY_SENSE_EVIDENCE_SOURCES.WORDNET_MFS],
  ['wordnet-most-frequent-sense', PRIMARY_SENSE_EVIDENCE_SOURCES.WORDNET_MFS],
  ['wordnet', PRIMARY_SENSE_EVIDENCE_SOURCES.WORDNET_MFS],
  ['general_or_exam_corpus', PRIMARY_SENSE_EVIDENCE_SOURCES.GENERAL_OR_EXAM_CORPUS],
  ['general-or-exam-corpus', PRIMARY_SENSE_EVIDENCE_SOURCES.GENERAL_OR_EXAM_CORPUS],
  ['general_corpus', PRIMARY_SENSE_EVIDENCE_SOURCES.GENERAL_OR_EXAM_CORPUS],
  ['exam_corpus', PRIMARY_SENSE_EVIDENCE_SOURCES.GENERAL_OR_EXAM_CORPUS],
  ['corpus', PRIMARY_SENSE_EVIDENCE_SOURCES.GENERAL_OR_EXAM_CORPUS],
]);

const IGNORED_FREQUENCY_SOURCES = new Set([
  'ecdict',
  'ecdict_frequency',
  'whole_word_frequency',
  'whole-word-frequency',
  'ecdict_whole_word_frequency',
  'ecdictwholewordfrequency',
  'whole_word_freq',
  'frequency',
  'word_frequency',
]);

const POS_ALIASES = new Map([
  ['n', 'noun'],
  ['noun', 'noun'],
  ['pos.noun', 'noun'],
  ['v', 'verb'],
  ['verb', 'verb'],
  ['pos.verb', 'verb'],
  ['adj', 'adjective'],
  ['adjective', 'adjective'],
  ['pos.adjective', 'adjective'],
  ['adv', 'adverb'],
  ['adverb', 'adverb'],
  ['pos.adverb', 'adverb'],
]);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
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

function normalizeLemma(value) {
  return normalizeText(value).toLocaleLowerCase('en-US');
}

function normalizePos(value) {
  if (Array.isArray(value)) {
    const normalized = value.map(normalizePos).filter(Boolean);
    return normalized.length === 1 ? normalized[0] : null;
  }
  if (isPlainObject(value)) return normalizePos(value.pos ?? value.part_of_speech ?? value.code);
  const normalized = normalizeText(value).toLocaleLowerCase('en-US');
  if (!normalized || ['unknown', 'unspecified', 'ambiguous', 'any', 'all', '*', '?'].includes(normalized)) {
    return null;
  }
  return POS_ALIASES.get(normalized) ?? null;
}

function normalizeSource(value) {
  if (typeof value !== 'string') return null;
  const trimmed = normalizeText(value);
  if (!trimmed) return null;
  return SOURCE_ALIASES.get(trimmed) ?? SOURCE_ALIASES.get(trimmed.toLocaleLowerCase('en-US')) ?? null;
}

function normalizeSenseKey(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = normalizeText(String(value));
  return normalized || null;
}

function getSenseKey(value, fallback = null) {
  if (typeof value === 'string' || typeof value === 'number') return normalizeSenseKey(value);
  if (!isPlainObject(value)) return fallback;
  return normalizeSenseKey(
    value.sense_key
      ?? value.target_sense_key
      ?? value.senseKey
      ?? value.targetSenseKey
      ?? value.sense_id
      ?? value.primary_sense_key
      ?? value.sense
      ?? value.id
      ?? value.key
      ?? fallback,
  );
}

function getSource(value, fallback = null) {
  if (!isPlainObject(value)) return normalizeSource(fallback);
  return normalizeSource(
    value.source
      ?? value.source_kind
      ?? value.source_type
      ?? value.evidence_source
      ?? value.evidence_kind
      ?? value.family
      ?? fallback,
  );
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function firstFinite(value, fields) {
  if (!isPlainObject(value)) return null;
  for (const field of fields) {
    const number = finiteNumber(value[field]);
    if (number !== null) return number;
  }
  return null;
}

function isTruthy(value) {
  return value === true || value === 'true' || value === 1;
}

function evidenceSignal(value, entryIndex) {
  const evidence = isPlainObject(value) ? value : {};
  const rank = firstFinite(evidence, ['rank', 'sense_rank', 'position', 'order', 'ordinal']);
  const score = firstFinite(evidence, [
    'score',
    'confidence',
    'probability',
    'weight',
    'count',
    'occurrences',
    'frequency',
  ]);
  return {
    preferred: isTruthy(evidence.preferred) || isTruthy(evidence.is_primary) || isTruthy(evidence.primary),
    rank,
    score,
    entry_index: entryIndex,
  };
}

function isMetadataKey(key) {
  return new Set([
    'source',
    'source_kind',
    'source_type',
    'evidence_source',
    'family',
    'lemma',
    'pos',
    'part_of_speech',
    'notes',
    'metadata',
    'version',
  ]).has(key);
}

function addEvidenceRecord(records, ignoredSources, sourceValue, value, fallbackSenseKey = null, entryIndex = 0) {
  const source = normalizeSource(sourceValue);
  if (!source) {
    const rawSource = normalizeText(String(sourceValue ?? '')).toLocaleLowerCase('en-US');
    if (IGNORED_FREQUENCY_SOURCES.has(rawSource)) ignoredSources.add(rawSource);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => addEvidenceRecord(
      records,
      ignoredSources,
      source,
      item,
      fallbackSenseKey,
      entryIndex + index,
    ));
    return;
  }

  if (isPlainObject(value)) {
    const senseKey = getSenseKey(value, fallbackSenseKey);
    if (senseKey) {
      records.push({
        source,
        sense_key: senseKey,
        signal: evidenceSignal(value, entryIndex),
      });
      return;
    }

    const keys = Object.keys(value).filter((key) => !isMetadataKey(key));
    if (keys.length > 0) {
      keys.sort((left, right) => left.localeCompare(right));
      keys.forEach((key, index) => addEvidenceRecord(
        records,
        ignoredSources,
        source,
        typeof value[key] === 'number'
          ? { score: value[key] }
          : value[key],
        getSenseKey(key),
        entryIndex + index,
      ));
    }
    return;
  }

  const senseKey = getSenseKey(fallbackSenseKey);
  if (senseKey) {
    records.push({
      source,
      sense_key: senseKey,
      signal: evidenceSignal(
        typeof value === 'number' ? { score: value } : {},
        entryIndex,
      ),
    });
  }
}

function collectTopLevelEvidence(input, records, ignoredSources) {
  const sourceFields = [
    PRIMARY_SENSE_EVIDENCE_SOURCES.LEARNER_DICTIONARY,
    PRIMARY_SENSE_EVIDENCE_SOURCES.WORDNET_MFS,
    PRIMARY_SENSE_EVIDENCE_SOURCES.GENERAL_OR_EXAM_CORPUS,
    'learner-dictionary',
    'wordnet-mfs',
    'wordnet',
    'general-or-exam-corpus',
    'general_corpus',
    'exam_corpus',
    'ecdict',
    'ecdict_frequency',
    'whole_word_frequency',
    'ecdict_whole_word_frequency',
    'ecdictWholeWordFrequency',
    'whole_word_freq',
    'frequency',
  ];
  sourceFields.forEach((field, index) => {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      addEvidenceRecord(records, ignoredSources, field, input[field], null, index);
    }
  });

  const evidence = input.evidence
    ?? input.sense_evidence
    ?? input.evidence_by_source
    ?? input.source_evidence
    ?? input.sources;
  if (Array.isArray(evidence)) {
    evidence.forEach((item, index) => {
      const source = getSource(item);
      if (source) addEvidenceRecord(records, ignoredSources, source, item, null, index);
      else if (isPlainObject(item)) {
        const rawSource = normalizeText(String(item.source ?? item.source_kind ?? '')).toLocaleLowerCase('en-US');
        if (IGNORED_FREQUENCY_SOURCES.has(rawSource)) ignoredSources.add(rawSource);
      }
    });
  } else if (isPlainObject(evidence)) {
    Object.keys(evidence).forEach((source, index) => {
      addEvidenceRecord(records, ignoredSources, source, evidence[source], null, index);
    });
  }
}

function collectCandidateEvidence(input, records, ignoredSources, senseKeys) {
  const candidates = Array.isArray(input.candidates)
    ? input.candidates
    : (Array.isArray(input.senses)
      ? input.senses
      : (Array.isArray(input.sense_candidates) ? input.sense_candidates : []));
  candidates.forEach((candidate, candidateIndex) => {
    const senseKey = getSenseKey(candidate);
    if (senseKey) senseKeys.add(senseKey);
    if (!isPlainObject(candidate)) return;

    const evidenceBySource = candidate.evidence
      ?? candidate.evidence_by_source
      ?? candidate.source_evidence;
    if (isPlainObject(evidenceBySource)) {
      Object.keys(evidenceBySource).forEach((source, index) => {
        addEvidenceRecord(
          records,
          ignoredSources,
          source,
          evidenceBySource[source],
          senseKey,
          candidateIndex * 100 + index,
        );
      });
    } else if (Array.isArray(evidenceBySource)) {
      evidenceBySource.forEach((item, index) => {
        addEvidenceRecord(
          records,
          ignoredSources,
          getSource(item),
          item,
          senseKey,
          candidateIndex * 100 + index,
        );
      });
    }

    for (const source of [
      PRIMARY_SENSE_EVIDENCE_SOURCES.LEARNER_DICTIONARY,
      PRIMARY_SENSE_EVIDENCE_SOURCES.WORDNET_MFS,
      PRIMARY_SENSE_EVIDENCE_SOURCES.GENERAL_OR_EXAM_CORPUS,
      'learner-dictionary',
      'wordnet-mfs',
      'wordnet',
      'general-or-exam-corpus',
      'general_corpus',
      'exam_corpus',
      'ecdict',
      'ecdict_frequency',
      'whole_word_frequency',
    ]) {
      if (Object.prototype.hasOwnProperty.call(candidate, source)) {
        addEvidenceRecord(
          records,
          ignoredSources,
          source,
          candidate[source],
          senseKey,
          candidateIndex,
        );
      }
    }
  });
}

function compareEvidenceStrength(left, right) {
  if (left.signal.preferred !== right.signal.preferred) return left.signal.preferred ? -1 : 1;
  if (left.signal.rank !== null || right.signal.rank !== null) {
    if (left.signal.rank === null) return 1;
    if (right.signal.rank === null) return -1;
    if (left.signal.rank !== right.signal.rank) return left.signal.rank - right.signal.rank;
  }
  if (left.signal.score !== null || right.signal.score !== null) {
    if (left.signal.score === null) return 1;
    if (right.signal.score === null) return -1;
    if (left.signal.score !== right.signal.score) return right.signal.score - left.signal.score;
  }
  return 0;
}

function compareSignals(left, right) {
  const strengthComparison = compareEvidenceStrength(left, right);
  if (strengthComparison !== 0) return strengthComparison;
  return left.sense_key.localeCompare(right.sense_key)
    || left.source.localeCompare(right.source)
    || left.signal.entry_index - right.signal.entry_index;
}

function reason(code, message, details = {}) {
  return { code, message, details: cloneJson(details) };
}

function candidateDescription(input, senseKey) {
  const candidates = Array.isArray(input.candidates)
    ? input.candidates
    : (Array.isArray(input.senses)
      ? input.senses
      : (Array.isArray(input.sense_candidates) ? input.sense_candidates : []));
  const candidate = candidates.find((item) => getSenseKey(item) === senseKey);
  if (!isPlainObject(candidate)) return null;
  return candidate.definition ?? candidate.gloss ?? candidate.meaning ?? null;
}

function rankSenseCandidates(input, records, senseKeys) {
  const bySource = new Map();
  for (const source of EVIDENCE_SOURCES) bySource.set(source, []);
  records.forEach((record) => bySource.get(record.source)?.push(record));

  const votes = new Map();
  const sourceSummaries = [];
  const sourceInternalConflicts = [];
  for (const source of EVIDENCE_SOURCES) {
    const sourceRecords = bySource.get(source) ?? [];
    const bestBySense = new Map();
    sourceRecords.forEach((record) => {
      const current = bestBySense.get(record.sense_key);
      if (!current || compareEvidenceStrength(record, current) < 0) bestBySense.set(record.sense_key, record);
      senseKeys.add(record.sense_key);
    });

    const bestRecords = [...bestBySense.values()];
    let strongestRecord = null;
    for (const record of bestRecords) {
      if (!strongestRecord || compareEvidenceStrength(record, strongestRecord) < 0) {
        strongestRecord = record;
      }
    }
    const strongestRecords = strongestRecord
      ? bestRecords.filter((record) => compareEvidenceStrength(record, strongestRecord) === 0)
      : [];
    const conflictingSenseKeys = [...new Set(strongestRecords.map((record) => record.sense_key))]
      .sort((left, right) => left.localeCompare(right));
    const hasInternalConflict = conflictingSenseKeys.length > 1;
    if (hasInternalConflict) {
      sourceInternalConflicts.push({
        source,
        conflicting_sense_keys: conflictingSenseKeys,
        evidence_count: sourceRecords.length,
      });
    }

    const ranked = bestRecords.slice().sort(compareSignals);
    const winner = hasInternalConflict ? null : (strongestRecords[0] ?? null);
    if (winner) {
      if (!votes.has(winner.sense_key)) votes.set(winner.sense_key, []);
      votes.get(winner.sense_key).push(source);
    }
    sourceSummaries.push({
      source,
      evidence_count: sourceRecords.length,
      considered_sense_keys: ranked.map((record) => record.sense_key),
      selected_sense_key: winner?.sense_key ?? null,
      abstained: hasInternalConflict,
      internal_conflict: hasInternalConflict,
      conflicting_sense_keys: hasInternalConflict ? conflictingSenseKeys : [],
    });
  }

  const rankedCandidates = [...senseKeys].map((senseKey) => {
    const supportingSources = votes.get(senseKey) ?? [];
    return {
      sense_key: senseKey,
      description: candidateDescription(input, senseKey),
      independent_source_count: supportingSources.length,
      supporting_sources: [...supportingSources].sort((left, right) => left.localeCompare(right)),
    };
  }).sort((left, right) => (
    right.independent_source_count - left.independent_source_count
    || left.sense_key.localeCompare(right.sense_key)
  ));

  return { rankedCandidates, sourceSummaries, sourceInternalConflicts, votes };
}

/**
 * Resolve the primary sense for one lemma/POS pair.
 *
 * Accepted input is intentionally tolerant so Wave B can adapt existing
 * evidence rows without making this policy depend on a repository shape.
 * The canonical evidence names are learner_dictionary, wordnet_mfs and
 * general_or_exam_corpus.
 */
export function resolvePrimarySense(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const lemma = normalizeLemma(source.lemma ?? source.word ?? source.lookup_key);
  const pos = normalizePos(source.pos ?? source.part_of_speech ?? source.partOfSpeech);
  const minimumAgreement = Number.isInteger(options.minimum_agreement)
    ? Math.max(1, options.minimum_agreement)
    : (Number.isInteger(options.min_agreeing_sources) ? Math.max(1, options.min_agreeing_sources) : 2);
  const records = [];
  const ignoredSources = new Set();
  const senseKeys = new Set();

  collectTopLevelEvidence(source, records, ignoredSources);
  collectCandidateEvidence(source, records, ignoredSources, senseKeys);

  const ranked = rankSenseCandidates(source, records, senseKeys);
  const selectedBySupport = ranked.rankedCandidates[0] ?? null;
  const votes = ranked.votes;
  const sourceInternalConflicts = ranked.sourceInternalConflicts;
  const selectedVotes = selectedBySupport ? (votes.get(selectedBySupport.sense_key) ?? []) : [];
  const selectedSourceCount = selectedVotes.length;
  const distinctVotedSenses = [...votes.keys()].sort((left, right) => left.localeCompare(right));
  const votedSupportCounts = distinctVotedSenses
    .map((senseKey) => ({ sense_key: senseKey, source_count: (votes.get(senseKey) ?? []).length }))
    .sort((left, right) => right.source_count - left.source_count || left.sense_key.localeCompare(right.sense_key));
  const runnerUpSourceCount = votedSupportCounts[1]?.source_count ?? 0;
  const hasMajority = selectedSourceCount > runnerUpSourceCount;
  const hasConflict = distinctVotedSenses.length > 1;
  const hasThreeWayDisagreement = distinctVotedSenses.length >= 3
    && ranked.sourceSummaries.filter((summary) => summary.selected_sense_key !== null).length >= 3;
  const hasEnoughIndependentEvidence = selectedSourceCount >= minimumAgreement;
  const resolved = Boolean(
    lemma
      && pos
      && selectedBySupport
      && hasEnoughIndependentEvidence
      && hasMajority,
  );

  const reasons = [];
  if (!lemma && !pos && senseKeys.size === 0 && records.length === 0) {
    reasons.push(reason('EMPTY_INPUT', 'A lemma, POS, and sense evidence are required before selecting a primary sense.'));
  } else if (!lemma) {
    reasons.push(reason('EMPTY_LEMMA', 'A lemma is required before selecting a primary sense.'));
  }
  if (!pos) reasons.push(reason('POS_UNKNOWN', 'A single known part of speech is required; the policy will not infer it.'));
  if (senseKeys.size === 0) reasons.push(reason('EMPTY_SENSE_EVIDENCE', 'No sense candidates or usable sense evidence were supplied.'));
  if (ignoredSources.size > 0) {
    reasons.push(reason(
      'ECDICT_WHOLE_WORD_FREQUENCY_IGNORED',
      'Whole-word frequency is diagnostic only and cannot decide a sense.',
      { ignored_sources: [...ignoredSources].sort((left, right) => left.localeCompare(right)) },
    ));
  }
  if (sourceInternalConflicts.length > 0) {
    reasons.push(reason(
      'SOURCE_INTERNAL_CONFLICT',
      'An evidence family had multiple equally strong senses and abstained instead of using sense-key order.',
      { conflicts: sourceInternalConflicts },
    ));
  }
  if (hasThreeWayDisagreement && !resolved) {
    reasons.push(reason(
      'THREE_WAY_DISAGREEMENT',
      'The independent evidence families select three different senses.',
      { selected_senses: distinctVotedSenses },
    ));
  } else if (hasConflict && resolved) {
    reasons.push(reason(
      'MINORITY_EVIDENCE_DISAGREEMENT',
      'A strict source majority agrees; the dissenting evidence is retained as an explanation.',
      {
        selected_sense_key: selectedBySupport?.sense_key ?? null,
        selected_source_count: selectedSourceCount,
        runner_up_source_count: runnerUpSourceCount,
        selected_senses: distinctVotedSenses,
      },
    ));
  } else if (hasConflict) {
    reasons.push(reason(
      'EVIDENCE_CONFLICT',
      'Independent evidence families do not form a strict majority for one sense.',
      {
        selected_senses: distinctVotedSenses,
        selected_source_count: selectedSourceCount,
        runner_up_source_count: runnerUpSourceCount,
      },
    ));
  }
  if (!hasMajority && distinctVotedSenses.length > 0) {
    reasons.push(reason(
      'NO_EVIDENCE_MAJORITY',
      'The evidence vote is tied or otherwise cannot form a strict majority.',
      { vote_counts: votedSupportCounts },
    ));
  }
  if (!hasEnoughIndependentEvidence && senseKeys.size > 0) {
    reasons.push(reason(
      'INSUFFICIENT_INDEPENDENT_EVIDENCE',
      `At least ${minimumAgreement} independent evidence families must agree before resolving a primary sense.`,
      {
        required_sources: minimumAgreement,
        observed_sources: selectedSourceCount,
        selected_sense_key: selectedBySupport?.sense_key ?? null,
      },
    ));
  }
  if (resolved) {
    reasons.push(reason(
      'INDEPENDENT_SOURCE_AGREEMENT',
      'The primary sense is supported by the required independent evidence families.',
      {
        selected_sense_key: selectedBySupport.sense_key,
        supporting_sources: selectedVotes.slice().sort((left, right) => left.localeCompare(right)),
      },
    ));
  }

  const selectedSenseKey = resolved ? selectedBySupport.sense_key : null;
  const rankedCandidates = ranked.rankedCandidates.map((candidate, index) => ({
    ...candidate,
    rank: index + 1,
    selected: candidate.sense_key === selectedSenseKey,
  }));
  const reasonCodes = reasons.map((item) => item.code);
  return {
    schema_version: PRIMARY_SENSE_SCHEMA_VERSION,
    policy_version: PRIMARY_SENSE_POLICY_VERSION,
    version: PRIMARY_SENSE_POLICY_VERSION,
    lemma: lemma || null,
    pos,
    status: resolved ? PRIMARY_SENSE_STATUSES.RESOLVED : PRIMARY_SENSE_STATUSES.UNRESOLVED,
    resolved,
    primary_sense_key: selectedSenseKey,
    target_sense_key: selectedSenseKey,
    ranked_candidates: rankedCandidates,
    candidates: rankedCandidates,
    evidence_sources: ranked.sourceSummaries,
    source_internal_conflicts: cloneJson(sourceInternalConflicts),
    majority_source_count: selectedSourceCount,
    runner_up_source_count: runnerUpSourceCount,
    has_majority: hasMajority,
    reason_codes: reasonCodes,
    reasons,
  };
}

export const selectPrimarySense = resolvePrimarySense;
export const rankPrimarySenseCandidates = resolvePrimarySense;
export const resolvePrimarySensePolicy = resolvePrimarySense;

export function normalizePrimarySenseEvidence(input = {}) {
  const result = resolvePrimarySense(input, { minimum_agreement: 1 });
  return {
    schema_version: PRIMARY_SENSE_SCHEMA_VERSION,
    policy_version: PRIMARY_SENSE_POLICY_VERSION,
    lemma: result.lemma,
    pos: result.pos,
    evidence_sources: result.evidence_sources,
    ranked_candidates: result.ranked_candidates,
    reason_codes: result.reason_codes,
    reasons: result.reasons,
  };
}

export function isResolvedPrimarySense(result) {
  return Boolean(
    isPlainObject(result)
      && result.schema_version === PRIMARY_SENSE_SCHEMA_VERSION
      && result.status === PRIMARY_SENSE_STATUSES.RESOLVED
      && typeof result.primary_sense_key === 'string'
      && result.primary_sense_key.length > 0,
  );
}

export function canonicalizePrimarySenseInput(input) {
  return canonicalJson(cloneJson(isPlainObject(input) ? input : {}));
}
