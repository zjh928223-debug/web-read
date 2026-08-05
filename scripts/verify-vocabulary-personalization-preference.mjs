import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sorted(values) {
  return [...values].sort();
}

async function loadOwnedModules() {
  const sourceDir = path.join(
    REPO_ROOT,
    'src',
    'services',
    'vocabulary',
    'personalization',
  );
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-web-pl-c-'));
  const moduleNames = [
    'presentation-features',
    'preference-estimator',
    'presentation-ranker',
  ];
  try {
    for (const moduleName of moduleNames) {
      let source = fs.readFileSync(path.join(sourceDir, `${moduleName}.js`), 'utf8');
      source = source.replaceAll('./presentation-features.js', './presentation-features.mjs');
      fs.writeFileSync(path.join(tempDir, `${moduleName}.mjs`), source, 'utf8');
    }
    const features = await import(pathToFileURL(path.join(tempDir, 'presentation-features.mjs')));
    const estimator = await import(pathToFileURL(path.join(tempDir, 'preference-estimator.mjs')));
    const ranker = await import(pathToFileURL(path.join(tempDir, 'presentation-ranker.mjs')));
    return { features, estimator, ranker };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function assertHasReason(item, code) {
  assert.ok(
    item.reason_codes.includes(code),
    `expected reason ${code}, got ${item.reason_codes.join(', ')}`,
  );
}

function assertNoNonFiniteNumbers(value, path = 'result') {
  if (typeof value === 'number') {
    assert.equal(Number.isFinite(value), true, `${path} contains a non-finite number`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoNonFiniteNumbers(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, entry]) => {
      assertNoNonFiniteNumbers(entry, `${path}.${key}`);
    });
  }
}

async function main() {
  const fixture = JSON.parse(fs.readFileSync(
    path.join(REPO_ROOT, 'scripts', 'fixtures', 'vocabulary-personalization-preference.fixture.json'),
    'utf8',
  ));
  assert.equal(fixture.schema_version, 'vocabulary-personalization-preference-fixtures.v1');

  const { features, estimator, ranker } = await loadOwnedModules();
  assert.equal(features.PRESENTATION_FEATURES_VERSION, 'presentation-features.v1');
  assert.equal(estimator.PREFERENCE_ESTIMATOR_VERSION, 'presentation-preference.v1');
  assert.equal(ranker.PRESENTATION_RANKER_VERSION, 'presentation-ranker.v1');
  assert.equal(ranker.PREFERENCE_CONTRIBUTION_HARD_CAP, 0.20);

  const customInput = {
    variant_id: 'Custom Tactile',
    features: {
      modality: 'HAPTIC',
      context_level: 'minimal',
      interaction: 'custom recall',
      sentence_difficulty_band: 'easy',
      cue_density: 'LOW',
      haptic_strength: 0.5,
    },
  };
  const customVariant = features.normalizePresentationVariant(customInput);
  assert.deepEqual(customVariant, {
    variant_id: 'custom_tactile',
    features: {
      modality: 'haptic',
      context_level: 'minimal',
      interaction: 'custom_recall',
      sentence_difficulty_band: 'easy',
      cue_density: 'low',
      haptic_strength: 0.5,
    },
  });
  assert.deepEqual(
    features.normalizePresentationVariants([...fixture.variants].reverse()),
    features.normalizePresentationVariants(fixture.variants),
    'variant normalization must not depend on input order',
  );
  assert.throws(
    () => features.normalizePresentationVariant({ variant_id: 'bad', features: { modality: [] } }),
    (error) => error.code === 'INVALID_PRESENTATION_FEATURE',
  );

  const originalFixture = clone(fixture);
  const emptyEstimate = estimator.estimatePresentationPreferences({
    variants: fixture.variants,
    events: fixture.scenarios.empty_history.events,
  });
  assert.equal(emptyEstimate.baseline.sample_count, 0);
  assert.equal(emptyEstimate.baseline.uncertainty, 1);
  assert.ok(emptyEstimate.estimates.length >= 6);
  assert.ok(emptyEstimate.estimates.every((entry) => (
    entry.sample_count === 0
    && entry.preference_score === 0
    && entry.uncertainty === 1
  )));
  assert.ok(emptyEstimate.reason_codes.includes('DETERMINISTIC_DEFAULT_BASELINE'));

  const noObservationRank = ranker.rankPresentations(
    ['word_only', 'audio_first'],
    emptyEstimate,
  );
  assert.ok(noObservationRank.ranked.every((entry) => (
    entry.preference_contribution === 0
    && entry.score === entry.base_score
    && entry.score_components.base_score === entry.base_score
    && entry.score_components.preference_contribution === 0
    && entry.score_components.score === entry.score
  )));
  assertNoNonFiniteNumbers(noObservationRank);

  const clearScenario = fixture.scenarios.clear_preference;
  const clearEstimate = estimator.estimatePresentationPreferences({
    variants: fixture.variants,
    events: clearScenario.events,
  });
  const clearAudio = clearEstimate.by_variant.audio_first;
  const clearWord = clearEstimate.by_variant.word_only;
  assert.ok(clearAudio.preference_score > clearWord.preference_score);
  assert.ok(clearAudio.signal_summary.replay_count > 0);
  assert.ok(clearWord.signal_summary.skip_count >= 2);
  assertHasReason(clearAudio, 'REPLAY_SIGNAL_USED');
  assertHasReason(clearWord, 'SKIP_SIGNAL_USED');
  assert.ok(clearAudio.uncertainty < 1);
  assert.ok(clearAudio.sample_count >= 3);

  const reversedClearEstimate = estimator.estimatePresentationPreferences({
    variants: [...fixture.variants].reverse(),
    events: [...clearScenario.events].reverse(),
  });
  assert.deepEqual(
    reversedClearEstimate,
    clearEstimate,
    'same evidence must produce byte-stable output regardless of event order',
  );

  const knowledgeEstimate = estimator.estimatePresentationPreferences({
    variants: ['word_only'],
    events: fixture.scenarios.knowledge_failure_confounded.events,
  });
  const knowledgeEntry = knowledgeEstimate.by_variant.word_only;
  assert.equal(knowledgeEntry.signal_summary.negative_evidence, 0);
  assert.equal(knowledgeEntry.preference_score, 0);
  assertHasReason(knowledgeEntry, 'KNOWLEDGE_FAILURE_NOT_NEGATIVE_PREFERENCE');
  assertHasReason(knowledgeEntry, 'RATING_IGNORED_KNOWLEDGE_CONFOUNDED');
  assertHasReason(knowledgeEntry, 'SKIP_IGNORED_KNOWLEDGE_CONFOUNDED');

  const invalidContentEstimate = estimator.estimatePresentationPreferences({
    variants: ['original_context'],
    events: fixture.scenarios.invalid_content_confounded.events,
  });
  const invalidEntry = invalidContentEstimate.by_variant.original_context;
  assert.equal(invalidEntry.sample_count, 0);
  assert.equal(invalidEntry.signal_summary.invalid_content_count, 2);
  assertHasReason(invalidEntry, 'CONTENT_INVALID_EXCLUDED');
  assert.equal(invalidEntry.preference_score, 0);

  const abnormalDurationEstimate = estimator.estimatePresentationPreferences({
    variants: ['audio_first'],
    events: fixture.scenarios.abnormal_duration.events,
  });
  const abnormalEntry = abnormalDurationEstimate.by_variant.audio_first;
  assert.equal(abnormalEntry.signal_summary.abnormal_duration_count, 1);
  assert.equal(abnormalEntry.signal_summary.negative_evidence, 0);
  assertHasReason(abnormalEntry, 'ABNORMAL_DURATION_IGNORED');
  const abnormalScored = estimator.scorePreferenceEvent(
    fixture.scenarios.abnormal_duration.events[0],
  );
  assert.equal(abnormalScored.signal >= 0, true);

  const reliableScenario = fixture.scenarios.reliable_duration_markers;
  const reliableSnake = estimator.normalizePreferenceEvent(reliableScenario.events[0]);
  const reliableCamel = estimator.normalizePreferenceEvent(reliableScenario.events[1]);
  const unreliableSnake = estimator.normalizePreferenceEvent(reliableScenario.events[2]);
  const unreliableCamel = estimator.normalizePreferenceEvent(reliableScenario.events[3]);
  const explicitAnomaly = estimator.normalizePreferenceEvent(reliableScenario.events[4]);
  assert.equal(reliableSnake.duration_status, 'valid');
  assert.equal(reliableSnake.active_duration_reliable, true);
  assert.equal(reliableCamel.duration_status, 'valid');
  assert.equal(reliableCamel.active_duration_reliable, true);
  assert.equal(unreliableSnake.duration_status, 'abnormal');
  assert.equal(unreliableSnake.active_duration_reliable, false);
  assert.equal(unreliableCamel.duration_status, 'abnormal');
  assert.equal(explicitAnomaly.duration_status, 'abnormal');
  assert.equal(estimator.normalizePreferenceEvent({
    event_id: 'reliability-conflict',
    presentation_variant: 'audio_first',
    completed: true,
    content_valid: true,
    knowledge_outcome: 'success',
    active_duration_ms: 4000,
    active_duration_reliable: true,
    activeDurationReliable: false,
  }).duration_status, 'abnormal');
  assert.equal(estimator.normalizePreferenceEvent({
    event_id: 'anomaly-conflict',
    presentation_variant: 'audio_first',
    completed: true,
    content_valid: true,
    knowledge_outcome: 'success',
    active_duration_ms: 4000,
    duration_anomaly: false,
    timingAnomaly: true,
  }).duration_status, 'abnormal');
  const reliableLong = estimator.normalizePreferenceEvent({
    event_id: 'reliable-long',
    presentation_variant: 'audio_first',
    completed: true,
    content_valid: true,
    knowledge_outcome: 'success',
    activeDurationMs: 31 * 60 * 1000,
    activeDurationReliable: true,
  });
  assert.equal(reliableLong.duration_status, 'valid');
  const reliableEstimate = estimator.estimatePresentationPreferences({
    variants: ['audio_first'],
    events: reliableScenario.events,
  });
  assert.equal(reliableEstimate.by_variant.audio_first.sample_count, 5);
  assert.equal(reliableEstimate.by_variant.audio_first.signal_summary.abnormal_duration_count, 3);

  const trainingScenario = fixture.scenarios.training_ineligible;
  const trainingEstimate = estimator.estimatePresentationPreferences({
    variants: ['word_only'],
    events: trainingScenario.events,
  });
  const trainingEntry = trainingEstimate.by_variant.word_only;
  assert.equal(trainingEntry.sample_count, 0);
  assert.equal(trainingEntry.excluded_count, trainingScenario.events.length);
  assert.equal(trainingEntry.signal_summary.negative_evidence, 0);
  assertHasReason(trainingEntry, 'TRAINING_INELIGIBLE_EXCLUDED');
  assertHasReason(trainingEntry, 'EVENT_EXCLUSION_REASONS_PRESENT');
  assertHasReason(trainingEntry, 'TRAINING_ELIGIBILITY_MISSING');
  for (const event of trainingScenario.events) {
    assert.equal(estimator.scorePreferenceEvent(event).eligible, false);
  }
  const missingMarkerScored = estimator.scorePreferenceEvent(
    trainingScenario.events.at(-1),
  );
  assert.equal(missingMarkerScored.eligible, false);
  assertHasReason(missingMarkerScored, 'TRAINING_ELIGIBILITY_MISSING');
  const nonBooleanTrainingMarker = estimator.scorePreferenceEvent({
    event_id: 'non-boolean-training-marker',
    training_eligible: 'true',
    presentation_variant: 'word_only',
    completed: true,
    content_valid: true,
    knowledge_outcome: 'success',
  });
  assert.equal(nonBooleanTrainingMarker.eligible, false);
  assertHasReason(nonBooleanTrainingMarker, 'INVALID_TRAINING_ELIGIBILITY');
  const unvalidatedContent = estimator.scorePreferenceEvent({
    event_id: 'unvalidated-content',
    training_eligible: true,
    presentation_variant: 'word_only',
    completed: true,
    knowledge_outcome: 'success',
  });
  assert.equal(unvalidatedContent.eligible, false);
  assertHasReason(unvalidatedContent, 'CONTENT_NOT_VALIDATED_EXCLUDED');
  const invalidCamelContent = estimator.scorePreferenceEvent({
    event_id: 'invalid-content-camel',
    presentation_variant: 'word_only',
    skipped: true,
    contentValid: false,
    knowledge_outcome: 'success',
  });
  assert.equal(invalidCamelContent.eligible, false);
  assertHasReason(invalidCamelContent, 'CONTENT_INVALID_EXCLUDED');

  const unknownKnowledgeEstimate = estimator.estimatePresentationPreferences({
    variants: ['word_only'],
    events: fixture.scenarios.unknown_knowledge_skip.events,
  });
  const unknownKnowledgeEntry = unknownKnowledgeEstimate.by_variant.word_only;
  assert.equal(unknownKnowledgeEntry.signal_summary.negative_evidence, 0);
  assert.equal(unknownKnowledgeEntry.preference_score, 0);
  assertHasReason(unknownKnowledgeEntry, 'KNOWLEDGE_UNRESOLVED_NEGATIVE_IGNORED');
  const unknownAgainstPositiveBaseline = estimator.estimatePresentationPreferences({
    variants: ['word_only', 'audio_first'],
    events: [
      ...fixture.scenarios.unknown_knowledge_skip.events,
      {
        event_id: 'known-audio-positive',
        training_eligible: true,
        presentation_variant: 'audio_first',
        completed: true,
        content_valid: true,
        knowledge_outcome: 'success',
      },
    ],
  });
  assert.equal(unknownAgainstPositiveBaseline.by_variant.word_only.signal_summary.negative_evidence, 0);
  assert.ok(unknownAgainstPositiveBaseline.by_variant.word_only.preference_score >= 0);

  const isolatedNegativeEstimate = estimator.estimatePresentationPreferences({
    variants: ['word_only', 'audio_first'],
    events: fixture.scenarios.isolated_negative_preference.events,
  });
  const isolatedWord = isolatedNegativeEstimate.by_variant.word_only;
  const isolatedAudio = isolatedNegativeEstimate.by_variant.audio_first;
  assert.ok(isolatedWord.signal_summary.negative_evidence > 0);
  assert.ok(isolatedWord.preference_score < isolatedAudio.preference_score);
  assert.ok(isolatedWord.sample_count >= 3);
  const isolatedLowSample = estimator.estimatePresentationPreferences({
    variants: ['word_only', 'audio_first'],
    events: [
      {
        event_id: 'isolated-low-sample-word',
        training_eligible: true,
        presentation_variant: 'word_only',
        skipped: true,
        content_valid: true,
        knowledge_outcome: 'success',
      },
      {
        event_id: 'isolated-low-sample-audio',
        training_eligible: true,
        presentation_variant: 'audio_first',
        completed: true,
        content_valid: true,
        knowledge_outcome: 'success',
      },
    ],
  });
  assert.ok(isolatedLowSample.by_variant.word_only.signal_summary.negative_evidence > 0);
  assert.equal(isolatedLowSample.by_variant.word_only.preference_score, 0);
  assertHasReason(
    isolatedLowSample.by_variant.word_only,
    'NEGATIVE_PREFERENCE_INSUFFICIENT_EVIDENCE',
  );

  for (const invalidOption of [
    { prior_strength: Number.NaN },
    { priorStrength: Number.POSITIVE_INFINITY },
    { reveal_reference_ms: Number.NaN },
    { minimumActiveDurationMs: Number.POSITIVE_INFINITY },
    { durationByDifficultyBand: { easy: Number.NaN } },
  ]) {
    assert.throws(
      () => estimator.normalizePreferenceEstimationOptions(invalidOption),
      (error) => error.code === 'INVALID_NUMERIC_OPTION',
    );
  }
  const nonFiniteEvent = estimator.scorePreferenceEvent({
    event_id: 'non-finite-event',
    training_eligible: true,
    presentation_variant: 'audio_first',
    completed: true,
    content_valid: true,
    knowledge_outcome: 'success',
    active_duration_ms: Number.NaN,
    reveal_delay_ms: Number.POSITIVE_INFINITY,
    active_replay_count: Number.POSITIVE_INFINITY,
    expected_duration_ms: Number.NaN,
  });
  assertNoNonFiniteNumbers(nonFiniteEvent);
  const nonFiniteEstimate = estimator.estimatePresentationPreferences({
    variants: ['audio_first'],
    events: [{
      event_id: 'non-finite-estimate',
      training_eligible: true,
      presentation_variant: 'audio_first',
      completed: true,
      content_valid: true,
      knowledge_outcome: 'success',
      active_duration_ms: Number.POSITIVE_INFINITY,
    }],
  });
  assertNoNonFiniteNumbers(nonFiniteEstimate);

  const duplicateScenario = fixture.scenarios.duplicate_event_id;
  const duplicateEstimate = estimator.estimatePresentationPreferences({
    variants: ['audio_first'],
    events: duplicateScenario.events,
  });
  const uniqueEstimate = estimator.estimatePresentationPreferences({
    variants: ['audio_first'],
    events: [duplicateScenario.events[0], duplicateScenario.events[2]],
  });
  assert.equal(duplicateEstimate.events_seen, 3);
  assert.equal(duplicateEstimate.events_deduplicated, 2);
  assert.equal(duplicateEstimate.duplicate_event_count, 1);
  assert.deepEqual(
    duplicateEstimate.by_variant.audio_first.signal_summary,
    uniqueEstimate.by_variant.audio_first.signal_summary,
  );
  assert.equal(
    duplicateEstimate.by_variant.audio_first.sample_count,
    uniqueEstimate.by_variant.audio_first.sample_count,
  );
  assert.ok(duplicateEstimate.reason_codes.includes('DUPLICATE_EVENT_ID_IGNORED'));

  const conflictingEvents = [
    {
      event_id: 'conflicting-event-id',
      training_eligible: true,
      presentation_variant: 'audio_first',
      completed: true,
      content_valid: true,
      knowledge_outcome: 'success',
      active_duration_ms: 4000,
    },
    {
      event_id: 'conflicting-event-id',
      training_eligible: true,
      presentation_variant: 'audio_first',
      skipped: true,
      content_valid: true,
      knowledge_outcome: 'success',
      active_duration_ms: 4000,
    },
  ];
  const conflictEstimate = estimator.estimatePresentationPreferences({
    variants: ['audio_first'],
    events: conflictingEvents,
  });
  const conflictEstimateReversed = estimator.estimatePresentationPreferences({
    variants: ['audio_first'],
    events: [...conflictingEvents].reverse(),
  });
  assert.deepEqual(conflictEstimateReversed, conflictEstimate);
  assert.equal(conflictEstimate.events_seen, 2);
  assert.equal(conflictEstimate.events_deduplicated, 0);
  assert.equal(conflictEstimate.conflicting_event_id_count, 1);
  assert.equal(conflictEstimate.conflicting_event_count, 2);
  assert.equal(conflictEstimate.by_variant.audio_first.sample_count, 0);
  assert.equal(conflictEstimate.baseline.sample_count, 0);
  assert.equal(conflictEstimate.events_excluded, 2);
  assert.ok(conflictEstimate.reason_codes.includes('EVENT_ID_CONFLICT_EXCLUDED'));

  const missingIdEvent = {
    training_eligible: true,
    presentation_variant: 'audio_first',
    completed: true,
    content_valid: true,
    knowledge_outcome: 'success',
    active_duration_ms: 4000,
  };
  const missingIdScored = estimator.scorePreferenceEvent(missingIdEvent);
  assert.equal(missingIdScored.eligible, false);
  assertHasReason(missingIdScored, 'MISSING_EVENT_ID_EXCLUDED');
  const missingIdEstimate = estimator.estimatePresentationPreferences({
    variants: ['audio_first'],
    events: [missingIdEvent],
  });
  assert.equal(missingIdEstimate.baseline.sample_count, 0);
  assert.equal(missingIdEstimate.by_variant.audio_first.sample_count, 0);
  assert.equal(missingIdEstimate.events_excluded, 1);
  assert.ok(missingIdEstimate.reason_codes.includes('MISSING_EVENT_ID_EXCLUDED'));

  const forgedNormalizedEvent = estimator.scorePreferenceEvent({
    valid: true,
    event_id: 'forged-normalized-event',
    training_eligible: true,
    presentation_variant: 'audio_first',
    content_valid: true,
    knowledge_outcome: 'success',
    variant: { variant_id: 'audio_first', features: {} },
    completed: true,
    signal: Number.NaN,
    weight: Number.POSITIVE_INFINITY,
    active_duration_ms: Number.NaN,
    replay_count: Number.POSITIVE_INFINITY,
  });
  assert.equal(forgedNormalizedEvent.eligible, true);
  assertNoNonFiniteNumbers(forgedNormalizedEvent);
  const forgedFeatureEvent = estimator.scorePreferenceEvent({
    valid: true,
    variant: {
      variant_id: 'custom_forged',
      features: { modality: Number.NaN },
    },
    completed: true,
  });
  assert.equal(forgedFeatureEvent.eligible, false);
  assertNoNonFiniteNumbers(forgedFeatureEvent);

  const protoEstimate = estimator.estimatePresentationPreferences({
    variants: ['__proto__'],
    events: [],
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(protoEstimate.by_variant, '__proto__'),
    true,
  );
  assert.deepEqual(Object.keys(protoEstimate.by_variant), ['__proto__']);
  const protoRoundTrip = JSON.parse(JSON.stringify(protoEstimate));
  assert.equal(protoRoundTrip.by_variant.__proto__.variant_id, '__proto__');
  const protoRank = ranker.rankPresentations(['__proto__'], protoEstimate);
  assert.deepEqual(protoRank.allowed_variant_ids, ['__proto__']);
  assert.equal(protoRank.ranked[0].preference_contribution, 0);
  assert.equal(protoRank.ranked[0].score, protoRank.ranked[0].base_score);
  assertNoNonFiniteNumbers(protoEstimate);
  assertNoNonFiniteNumbers(protoRank);

  const rankClear = ranker.rankPresentations({
    allowed_presentations: clearScenario.allowed_presentations,
    preferences: clearEstimate,
  });
  assert.deepEqual(
    sorted(rankClear.ranked.map((entry) => entry.variant_id)),
    sorted(clearScenario.allowed_presentations),
    'ranker must retain every allowed presentation',
  );
  assert.equal(rankClear.constraint_scope, 'allowed_presentations_only');
  assert.equal(rankClear.allowed_count, clearScenario.allowed_presentations.length);
  assert.ok(rankClear.ranked.every((entry) => (
    Math.abs(entry.preference_contribution) <= ranker.PREFERENCE_CONTRIBUTION_HARD_CAP
    && entry.version === undefined
    && typeof entry.uncertainty === 'number'
    && Array.isArray(entry.reasons)
  )));
  assert.equal(rankClear.selected_variant_id, 'audio_first');
  assertHasReason(rankClear.ranked[0], 'PREFERENCE_EVIDENCE_APPLIED');

  const rankClearReversed = ranker.rankPresentations({
    allowed_presentations: [...clearScenario.allowed_presentations].reverse(),
    preferences: reversedClearEstimate,
  });
  assert.deepEqual(rankClearReversed, rankClear, 'rank tie-break must be input-order independent');

  const unseenEstimate = estimator.estimatePresentationPreferences({
    variants: fixture.scenarios.all_unseen_subset.allowed_presentations,
    events: fixture.scenarios.all_unseen_subset.events,
  });
  const unseenForward = ranker.rankPresentations(
    fixture.scenarios.all_unseen_subset.allowed_presentations,
    unseenEstimate,
  );
  const unseenReverse = ranker.rankPresentations(
    [...fixture.scenarios.all_unseen_subset.allowed_presentations].reverse(),
    unseenEstimate,
  );
  assert.deepEqual(unseenForward, unseenReverse);
  assert.deepEqual(
    sorted(unseenForward.ranked.map((entry) => entry.variant_id)),
    sorted(['custom_tactile', 'cloze', 'word_only']),
  );
  assert.ok(unseenForward.ranked.every((entry) => entry.preference_contribution === 0));
  assert.ok(unseenForward.ranked.every((entry) => entry.uncertainty === 1));

  const invalidRank = ranker.rankPresentations({
    allowed_presentations: fixture.scenarios.invalid_content_confounded.allowed_presentations,
    preferences: invalidContentEstimate,
  });
  assert.deepEqual(invalidRank.allowed_variant_ids, ['original_context']);
  assert.equal(invalidRank.ranked.length, 1);
  assert.equal(invalidRank.ranked[0].preference_contribution, 0);

  const cappedRank = ranker.rankPresentations(
    ['word_only'],
    {
      version: 'synthetic.preference.v1',
      by_variant: {
        word_only: {
          variant_id: 'word_only',
          preference_score: 1,
          sample_count: 100,
          effective_sample_count: 100,
          uncertainty: 0,
          observed: true,
        },
      },
    },
    { preference_contribution_cap: 99 },
  );
  assert.equal(cappedRank.ranked[0].preference_contribution, ranker.PREFERENCE_CONTRIBUTION_HARD_CAP);
  assertHasReason(cappedRank.ranked[0], 'PREFERENCE_CONTRIBUTION_CAPPED');

  const nonFiniteRank = ranker.rankPresentations(
    ['audio_first'],
    {
      version: Number.NaN,
      by_variant: {
        audio_first: {
          preference_score: Number.NaN,
          sample_count: Number.POSITIVE_INFINITY,
          effective_sample_count: Number.NaN,
          uncertainty: Number.POSITIVE_INFINITY,
          observed: Number.NaN,
          version: Number.POSITIVE_INFINITY,
        },
      },
    },
    {
      preference_contribution_cap: Number.NaN,
      minimum_samples_for_confidence: Number.POSITIVE_INFINITY,
      default_priorities: { audio_first: Number.NaN },
    },
  );
  assertNoNonFiniteNumbers(nonFiniteRank);

  const factory = ranker.createPresentationRanker({ preference_contribution_cap: 0.1 });
  const factoryRank = factory(['audio_first'], clearEstimate);
  assert.equal(factoryRank.ranked.length, 1);
  assert.ok(Math.abs(factoryRank.ranked[0].preference_contribution) <= 0.1);

  assert.deepEqual(fixture, originalFixture, 'all PL-C functions must leave inputs immutable');
  const ownedSources = [
    'src/services/vocabulary/personalization/presentation-features.js',
    'src/services/vocabulary/personalization/preference-estimator.js',
    'src/services/vocabulary/personalization/presentation-ranker.js',
  ];
  for (const relativePath of ownedSources) {
    const source = fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
    assert.doesNotMatch(source, /\b(?:window|document|indexedDB|fetch|XMLHttpRequest|WebSocket)\b/);
    assert.doesNotMatch(source, /(?:openai|anthropic|llm|ai[_-]?sdk)/i);
  }

  console.log('Vocabulary PL-C presentation preference verification passed.');
  console.log(`Public API: ${[
    'normalizePresentationVariant',
    'normalizePresentationFeatures',
    'normalizePresentationVariants',
    'estimatePresentationPreferences',
    'scorePreferenceEvent',
    'rankPresentations',
    'createPresentationRanker',
  ].join(', ')}`);
  console.log('Wave B adapter seam: pass read-only LearningEvent snapshots to the estimator, then pass CurriculumPlanner.allowed_presentations to rankPresentations; keep the returned rank report in shadow mode until integration review.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
