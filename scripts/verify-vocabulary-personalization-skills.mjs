import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const personalizationRoot = path.join(
  repoRoot,
  'src',
  'services',
  'vocabulary',
  'personalization',
);
const fixturePath = path.join(
  repoRoot,
  'scripts',
  'fixtures',
  'vocabulary-personalization-skills.fixture.json',
);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

async function importPersonalizationModules() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'read-web-skill-estimator-'));
  const files = [
    'skill-taxonomy.js',
    'skill-evidence.js',
    'skill-estimator.js',
  ];

  for (const file of files) {
    let source = fs.readFileSync(path.join(personalizationRoot, file), 'utf8');
    source = source
      .replaceAll("./skill-taxonomy.js", './skill-taxonomy.mjs')
      .replaceAll("./skill-evidence.js", './skill-evidence.mjs');
    fs.writeFileSync(
      path.join(temporaryDirectory, file.replace(/\.js$/, '.mjs')),
      source,
      'utf8',
    );
  }

  const modules = await Promise.all(files.map((file) => import(
    `${pathToFileURL(path.join(temporaryDirectory, file.replace(/\.js$/, '.mjs'))).href}?v=${Date.now()}`
  )));
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  return {
    taxonomy: modules[0],
    evidence: modules[1],
    estimator: modules[2],
  };
}

function findEvidence(evidence, learningUnitId) {
  const result = evidence.find((item) => item.learning_unit_id === learningUnitId);
  assert.ok(result, `missing evidence for ${learningUnitId}`);
  return result;
}

function findEvent(events, eventId) {
  const result = events.find((event) => event.event_id === eventId);
  assert.ok(result, `missing event ${eventId}`);
  return result;
}

function findEstimate(result, skillId) {
  const estimate = result.estimates.find((item) => item.skill_id === skillId);
  assert.ok(estimate, `missing estimate for ${skillId}`);
  return estimate;
}

function assertNoRuntimeDependencies() {
  for (const file of ['skill-taxonomy.js', 'skill-evidence.js', 'skill-estimator.js']) {
    const source = fs.readFileSync(path.join(personalizationRoot, file), 'utf8');
    assert.doesNotMatch(source, /\b(?:window|document|indexedDB|fetch|XMLHttpRequest|WebSocket)\b/);
    assert.doesNotMatch(source, /Math\.random\s*\(/);
    assert.doesNotMatch(source, /Date\.now\s*\(/);
  }
}

const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const { taxonomy, evidence, estimator } = await importPersonalizationModules();

if (process.argv.includes('--tz-probe')) {
  const event = JSON.parse(process.env.PLB_TZ_EVENT_JSON ?? 'null');
  const converted = evidence.toSkillEvidence(event);
  const result = estimator.estimateSkillsFromLearningEvents([event]);
  console.log(JSON.stringify({
    converted,
    estimate: result.estimates.find((item) => item.skill_id === 'pos.verb'),
  }));
  process.exit(0);
}

assertNoRuntimeDependencies();
assert.equal(fixture.schema_version, 'vocabulary-personalization-skills.fixture.v1');

const requiredSkillIds = [
  'pos.noun',
  'pos.verb',
  'pos.adjective',
  'pos.adverb',
  'morphology.inflection',
  'morphology.derivation',
  'morphology.irregular',
  'sense.primary',
  'sense.secondary',
  'usage.collocation',
  'usage.context_transfer',
];
assert.deepEqual(taxonomy.SKILL_IDS, requiredSkillIds);
assert.equal(taxonomy.SKILL_TAXONOMY.version, 'skill-taxonomy.v1');
assert.equal(taxonomy.SKILL_TAXONOMY.schema_version, 'skill-taxonomy.v1');

const customInput = {
  version: 'skill-taxonomy.v2-test',
  skills: [{
    id: 'syntax.future_dimension',
    family: 'syntax',
    label: 'future dimension',
    description: 'A test-only extension point.',
    order: 500,
  }],
};
const customInputSnapshot = clone(customInput);
const customTaxonomy = taxonomy.createSkillTaxonomy(customInput);
assert.deepEqual(customInput, customInputSnapshot);
assert.ok(customTaxonomy.skills.some((skill) => skill.id === 'syntax.future_dimension'));
assert.equal(customTaxonomy.version, 'skill-taxonomy.v2-test');
assert.equal(taxonomy.isKnownSkill('syntax.future_dimension', customTaxonomy), true);
assert.equal(taxonomy.isKnownSkill('syntax.future_dimension'), false);

const mixedEvents = fixture.events.mixed;
const qualityEvents = fixture.events.quality_signals;
const unknownEvents = fixture.events.unknown_and_custom;
const allEvents = [...mixedEvents, ...qualityEvents, ...unknownEvents];
const allEventsSnapshot = clone(allEvents);

const mixedEvidence = evidence.eventsToSkillEvidence(mixedEvents);
assert.deepEqual(allEvents.slice(0, mixedEvents.length), mixedEvents);
assert.deepEqual(mixedEvents, allEventsSnapshot.slice(0, mixedEvents.length));

const skipEvidence = findEvidence(mixedEvidence, 'unit-verb-4');
assert.equal(skipEvidence.outcome, 'skip');
assert.equal(skipEvidence.weight, 0);
assert.ok(skipEvidence.exclusions.includes('SKIP_NOT_FAILURE'));
assert.ok(!skipEvidence.exclusions.includes('OUTCOME_UNKNOWN'));

const answerEvidence = findEvidence(
  evidence.eventsToSkillEvidence([qualityEvents[0]]),
  'unit-adj-answer',
);
assert.equal(answerEvidence.outcome, 'success');
assert.ok(answerEvidence.weight < 0.1);
assert.ok(answerEvidence.exclusions.includes('ANSWER_REVEALED'));
assert.ok(answerEvidence.exclusions.includes('STRONG_CUE'));

const cueEvidence = findEvidence(
  evidence.eventsToSkillEvidence([qualityEvents[1]]),
  'unit-adj-cue',
);
assert.equal(cueEvidence.outcome, 'success');
assert.equal(cueEvidence.weight, 0.35);
assert.ok(cueEvidence.exclusions.includes('STRONG_CUE'));

const legacyEvidence = findEvidence(
  evidence.eventsToSkillEvidence([qualityEvents[2]]),
  'unit-adj-legacy',
);
assert.equal(legacyEvidence.outcome, 'success');
assert.equal(legacyEvidence.weight, 0);
assert.ok(legacyEvidence.exclusions.includes('LEGACY'));
assert.ok(legacyEvidence.exclusions.includes('TRAINING_INELIGIBLE'));

const longDurationEvidence = findEvidence(
  evidence.eventsToSkillEvidence([qualityEvents[3]]),
  'unit-adj-long',
);
assert.equal(longDurationEvidence.outcome, 'success');
assert.equal(longDurationEvidence.weight, 0);
assert.ok(longDurationEvidence.exclusions.includes('ABNORMAL_ACTIVE_DURATION'));
assert.ok(longDurationEvidence.exclusions.includes('ACTIVE_DURATION_UNRELIABLE'));

const invalidDurationEvidence = findEvidence(
  evidence.eventsToSkillEvidence([qualityEvents[4]]),
  'unit-adj-invalid-duration',
);
assert.equal(invalidDurationEvidence.outcome, 'failure');
assert.equal(invalidDurationEvidence.weight, 0);
assert.ok(invalidDurationEvidence.exclusions.includes('ACTIVE_DURATION_EXCEEDS_DURATION'));

const difficultContentEvidence = findEvidence(
  evidence.eventsToSkillEvidence([qualityEvents[5]]),
  'unit-adj-difficult-content',
);
assert.equal(difficultContentEvidence.outcome, 'failure');
assert.equal(difficultContentEvidence.weight, 0);
assert.ok(difficultContentEvidence.exclusions.includes('CONTENT_DIFFICULTY_DOWNWEIGHTED'));
assert.ok(difficultContentEvidence.exclusions.includes('PRESENTATION_DISLIKE_NOT_KNOWLEDGE_FAILURE'));
assert.ok(difficultContentEvidence.exclusions.includes('CONTENT_DIFFICULTY_EXCLUDED'));
assert.ok(difficultContentEvidence.exclusions.includes('PRESENTATION_SIGNAL_EXCLUDED'));

const trainingIneligibleEvidence = findEvidence(
  evidence.eventsToSkillEvidence([qualityEvents[7]]),
  'unit-adj-training-ineligible',
);
assert.equal(trainingIneligibleEvidence.weight, 0);
assert.ok(trainingIneligibleEvidence.exclusions.includes('TRAINING_INELIGIBLE'));
assert.ok(trainingIneligibleEvidence.exclusions.includes('PROMPT_MODE_MISSING'));

const trainingExclusionEvidence = findEvidence(
  evidence.eventsToSkillEvidence([qualityEvents[8]]),
  'unit-adj-training-exclusion',
);
assert.equal(trainingExclusionEvidence.weight, 0);
assert.ok(trainingExclusionEvidence.exclusions.includes('IMPORTED_EVENT'));

const invalidContentEvidence = findEvidence(
  evidence.eventsToSkillEvidence([qualityEvents[9]]),
  'unit-adj-invalid-content',
);
assert.equal(invalidContentEvidence.outcome, 'failure');
assert.equal(invalidContentEvidence.weight, 0);
assert.ok(invalidContentEvidence.exclusions.includes('INVALID_CONTENT_EXCLUDED'));

const missingEligibilityEvidence = findEvidence(
  evidence.eventsToSkillEvidence([qualityEvents[10]]),
  'unit-adj-training-eligibility-missing',
);
assert.equal(missingEligibilityEvidence.weight, 0);
assert.ok(missingEligibilityEvidence.exclusions.includes('TRAINING_ELIGIBILITY_MISSING'));
const missingEligibilityResult = estimator.estimateSkillsFromLearningEvents([qualityEvents[10]]);
assert.equal(findEstimate(missingEligibilityResult, 'pos.adjective').eligible_evidence_count, 0);
assert.equal(findEstimate(missingEligibilityResult, 'pos.adjective').last_observed_at, null);

const stringEligibilityEvidence = evidence.toSkillEvidence({
  event_id: 'evt-training-eligibility-string',
  training_eligible: 'true',
  learning_unit_id: 'unit-training-eligibility-string',
  occurred_at: '2026-07-19T10:00:00Z',
  skill_tags: ['pos.adjective'],
  rating: 'good',
});
assert.equal(stringEligibilityEvidence.weight, 0);
assert.ok(stringEligibilityEvidence.exclusions.includes('TRAINING_ELIGIBILITY_MISSING'));

const identityEvidence = evidence.eventsToSkillEvidence(fixture.events.identity);
assert.equal(identityEvidence.length, 2);
for (const item of identityEvidence) {
  assert.equal(item.learning_unit_id, null);
  assert.equal(item.weight, 0);
  assert.ok(item.exclusions.includes('MISSING_LEARNING_UNIT_ID'));
  assert.ok(!item.exclusions.includes('LEARNING_UNIT_ID_FALLBACK'));
}

const exactDedupeEvidence = evidence.eventsToSkillEvidence(fixture.events.duplicates.exact);
assert.equal(exactDedupeEvidence.length, 1);
assert.equal(exactDedupeEvidence[0].weight, 1);
assert.equal(evidence.deduplicateLearningEvents(fixture.events.duplicates.exact).length, 1);
const exactDedupeResult = estimator.estimateSkillsFromLearningEvents(fixture.events.duplicates.exact);
assert.equal(findEstimate(exactDedupeResult, 'pos.adverb').eligible_evidence_count, 1);
assert.equal(findEstimate(exactDedupeResult, 'pos.adverb').mastery_mean, 0.6666666667);

const conflictDedupeEvidence = evidence.eventsToSkillEvidence(fixture.events.duplicates.conflict);
assert.equal(conflictDedupeEvidence.length, 1);
assert.equal(conflictDedupeEvidence[0].weight, 0);
assert.ok(conflictDedupeEvidence[0].exclusions.includes('DUPLICATE_EVENT_ID_CONFLICT'));
assert.equal(evidence.deduplicateLearningEvents(fixture.events.duplicates.conflict)[0].event_id_status, 'conflict');
const conflictDedupeResult = estimator.estimateSkillsFromLearningEvents(fixture.events.duplicates.conflict);
assert.equal(findEstimate(conflictDedupeResult, 'pos.adverb').eligible_evidence_count, 0);
assert.equal(findEstimate(conflictDedupeResult, 'pos.adverb').last_observed_at, null);
assert.deepEqual(
  conflictDedupeResult,
  estimator.estimateSkillsFromLearningEvents([...fixture.events.duplicates.conflict].reverse()),
);

const missingIdEvidence = evidence.eventsToSkillEvidence(fixture.events.duplicates.missing_id);
assert.equal(missingIdEvidence.length, 2);
assert.ok(missingIdEvidence.every((item) => (
  item.weight === 0 && item.exclusions.includes('MISSING_EVENT_ID')
)));
const missingIdResult = estimator.estimateSkillsFromLearningEvents(fixture.events.duplicates.missing_id);
assert.equal(findEstimate(missingIdResult, 'pos.adverb').eligible_evidence_count, 0);
assert.equal(findEstimate(missingIdResult, 'pos.adverb').last_observed_at, null);
assert.equal(evidence.SKILL_EVENT_ID_POLICY, 'skill-event-id-required.v1');

function runTimezoneProbe(timeZone, event) {
  const output = execFileSync(process.execPath, [scriptPath, '--tz-probe'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TZ: timeZone,
      PLB_TZ_EVENT_JSON: JSON.stringify(event),
    },
  });
  return JSON.parse(output);
}

const ambiguousOccurredAtEvent = {
  event_id: 'evt-tz-ambiguous',
  training_eligible: true,
  exclusion_reasons: [],
  learning_unit_id: 'unit-tz-ambiguous',
  occurred_at: '2026-07-27T08:00:00',
  skill_tags: ['pos.verb'],
  rating: 'good',
};
const ambiguousUtcProbe = runTimezoneProbe('UTC', ambiguousOccurredAtEvent);
const ambiguousShanghaiProbe = runTimezoneProbe('Asia/Shanghai', ambiguousOccurredAtEvent);
assert.deepEqual(ambiguousUtcProbe, ambiguousShanghaiProbe);
assert.equal(ambiguousUtcProbe.converted.occurred_at, null);
assert.equal(ambiguousUtcProbe.converted.weight, 0);
assert.ok(ambiguousUtcProbe.converted.exclusions.includes('AMBIGUOUS_OCCURRED_AT'));
assert.equal(ambiguousUtcProbe.estimate.last_observed_at, null);
assert.equal(ambiguousUtcProbe.estimate.eligible_evidence_count, 0);

const explicitOffsetEvent = {
  ...ambiguousOccurredAtEvent,
  event_id: 'evt-tz-explicit-offset',
  learning_unit_id: 'unit-tz-explicit-offset',
  occurred_at: '2026-07-27T08:00:00+08:00',
};
const explicitUtcProbe = runTimezoneProbe('UTC', explicitOffsetEvent);
const explicitShanghaiProbe = runTimezoneProbe('Asia/Shanghai', explicitOffsetEvent);
assert.deepEqual(explicitUtcProbe, explicitShanghaiProbe);
assert.equal(explicitUtcProbe.converted.occurred_at, '2026-07-27T00:00:00.000Z');
assert.equal(explicitUtcProbe.converted.weight, 1);
assert.equal(explicitUtcProbe.estimate.last_observed_at, '2026-07-27T00:00:00.000Z');
assert.equal(explicitUtcProbe.estimate.eligible_evidence_count, 1);

const unknownEvidence = evidence.eventsToSkillEvidence(unknownEvents);
assert.ok(findEvidence(unknownEvidence, 'unit-unknown-1').exclusions.includes('UNKNOWN_SKILL'));
assert.equal(findEvidence(unknownEvidence, 'unit-unknown-1').weight, 0);
assert.ok(findEvidence(unknownEvidence, 'unit-known-unknown-1').skill_tags.includes('pos.adverb'));
assert.ok(findEvidence(unknownEvidence, 'unit-known-unknown-1').skill_tags.includes('syntax.future_dimension'));

const directEvidenceInput = {
  learning_unit_id: 'direct-unit',
  occurred_at: '2026-07-16T08:00:00Z',
  skill_tags: ['pos.verb'],
  outcome: 'partial',
  weight: 0.75,
  exclusions: ['LEGACY'],
};
const directEvidenceSnapshot = clone(directEvidenceInput);
const normalizedDirectEvidence = evidence.normalizeSkillEvidence(directEvidenceInput);
assert.deepEqual(directEvidenceInput, directEvidenceSnapshot);
assert.equal(normalizedDirectEvidence.outcome, 'partial');
assert.equal(normalizedDirectEvidence.weight, 0);

const zeroWeightDirectEvidence = evidence.normalizeSkillEvidence({
  learning_unit_id: 'zero-weight-unit',
  occurred_at: '2026-07-26T08:00:00Z',
  skill_tags: ['pos.verb'],
  outcome: 'success',
  weight: 0,
});
const zeroWeightResult = estimator.estimateSkills([zeroWeightDirectEvidence]);
assert.equal(findEstimate(zeroWeightResult, 'pos.verb').last_observed_at, null);
assert.equal(findEstimate(zeroWeightResult, 'pos.verb').eligible_evidence_count, 0);

const emptyResult = estimator.estimateSkills([]);
assert.equal(emptyResult.schema_version, 'skill-estimate.v1');
assert.equal(emptyResult.estimator_version, 'skill-estimator.beta.v1');
assert.equal(emptyResult.method, 'weighted_beta_baseline');
assert.deepEqual(emptyResult.prior, { alpha: 1, beta: 1 });
assert.equal(emptyResult.estimates.length, requiredSkillIds.length);
for (const estimate of emptyResult.estimates) {
  assert.equal(estimate.mastery_mean, 0.5);
  assert.equal(estimate.uncertainty, 1);
  assert.equal(estimate.eligible_evidence_count, 0);
  assert.equal(estimate.last_observed_at, null);
  assert.ok(estimate.reasons.includes('PRIOR_ONLY'));
  assert.ok(estimate.reasons.includes('NO_ELIGIBLE_EVIDENCE'));
}

const mixedResult = estimator.estimateSkillsFromLearningEvents(mixedEvents);
const verbEstimate = findEstimate(mixedResult, 'pos.verb');
assert.equal(verbEstimate.eligible_evidence_count, 3);
assert.equal(verbEstimate.mastery_mean, 0.5);
assert.ok(verbEstimate.uncertainty < 1);
assert.ok(verbEstimate.reasons.includes('MIXED_OUTCOMES'));
assert.ok(verbEstimate.reasons.includes('SKIP_NOT_FAILURE'));
assert.equal(findEstimate(mixedResult, 'pos.noun').mastery_mean, 0.8);
assert.equal(findEstimate(mixedResult, 'pos.noun').eligible_evidence_count, 3);
assert.equal(findEstimate(mixedResult, 'morphology.inflection').eligible_evidence_count, 1);
assert.ok(findEstimate(mixedResult, 'morphology.inflection').reasons.includes('LOW_EVIDENCE'));

const skipOnlyResult = estimator.estimateSkillsFromLearningEvents([mixedEvents[3]]);
const failureOnlyResult = estimator.estimateSkillsFromLearningEvents([mixedEvents[2]]);
assert.equal(findEstimate(skipOnlyResult, 'pos.verb').mastery_mean, 0.5);
assert.equal(findEstimate(skipOnlyResult, 'pos.verb').eligible_evidence_count, 0);
assert.equal(findEstimate(failureOnlyResult, 'pos.verb').mastery_mean, 0.3333333333);
assert.ok(
  findEstimate(skipOnlyResult, 'pos.verb').uncertainty
    > findEstimate(failureOnlyResult, 'pos.verb').uncertainty,
);

const qualityResult = estimator.estimateSkillsFromLearningEvents(qualityEvents);
const adjectiveEstimate = findEstimate(qualityResult, 'pos.adjective');
assert.ok(adjectiveEstimate.reasons.includes('DOWNWEIGHTED_EVIDENCE'));
assert.ok(adjectiveEstimate.reasons.includes('EXCLUDED_EVIDENCE'));
assert.ok(adjectiveEstimate.reasons.includes('ANSWER_REVEALED'));
assert.ok(adjectiveEstimate.reasons.includes('LEGACY'));
assert.ok(adjectiveEstimate.reasons.includes('ABNORMAL_ACTIVE_DURATION'));
assert.ok(adjectiveEstimate.reasons.includes('CONTENT_DIFFICULTY_DOWNWEIGHTED'));
assert.ok(adjectiveEstimate.uncertainty > 0.5);
const legacyOnlyResult = estimator.estimateSkillsFromLearningEvents([qualityEvents[2]]);
assert.ok(findEstimate(legacyOnlyResult, 'pos.adjective').reasons.includes('EXCLUDED_EVIDENCE'));
assert.ok(!findEstimate(legacyOnlyResult, 'pos.adjective').reasons.includes('DOWNWEIGHTED_EVIDENCE'));

const confusionOnlyResult = estimator.estimateSkillsFromLearningEvents([
  findEvent(qualityEvents, 'evt-content-difficulty'),
  findEvent(qualityEvents, 'evt-invalid-content'),
]);
const confusionOnlyAdjective = findEstimate(confusionOnlyResult, 'pos.adjective');
assert.equal(confusionOnlyAdjective.mastery_mean, 0.5);
assert.equal(confusionOnlyAdjective.eligible_evidence_count, 0);
assert.equal(confusionOnlyAdjective.last_observed_at, null);
assert.ok(confusionOnlyAdjective.reasons.includes('EXCLUDED_EVIDENCE'));
assert.ok(!confusionOnlyAdjective.reasons.includes('DOWNWEIGHTED_EVIDENCE'));
assert.ok(confusionOnlyAdjective.reasons.includes('CONTENT_DIFFICULTY_EXCLUDED'));
assert.ok(confusionOnlyAdjective.reasons.includes('INVALID_CONTENT_EXCLUDED'));

const unknownResult = estimator.estimateSkillsFromLearningEvents(unknownEvents);
assert.ok(unknownResult.reasons.includes('UNKNOWN_SKILL_IGNORED'));
assert.equal(unknownResult.estimates.some((item) => item.skill_id === 'syntax.future_dimension'), false);
assert.equal(findEstimate(unknownResult, 'pos.adverb').eligible_evidence_count, 1);

const customResult = estimator.estimateSkillsFromLearningEvents(unknownEvents, {
  taxonomy: customTaxonomy,
});
assert.equal(customResult.taxonomy_version, 'skill-taxonomy.v2-test');
assert.equal(findEstimate(customResult, 'syntax.future_dimension').eligible_evidence_count, 2);
assert.equal(findEstimate(customResult, 'syntax.future_dimension').mastery_mean, 0.75);

const orderedResult = estimator.estimateSkillsFromLearningEvents(allEvents);
const reversedResult = estimator.estimateSkillsFromLearningEvents([...allEvents].reverse());
const repeatedResult = estimator.estimateSkillsFromLearningEvents(clone(allEvents));
assert.deepEqual(orderedResult, reversedResult);
assert.deepEqual(orderedResult, repeatedResult);
assert.deepEqual(allEvents, allEventsSnapshot);
assert.deepEqual(orderedResult.estimates.map((item) => item.skill_id), requiredSkillIds);
assert.ok(orderedResult.reasons.includes('DETERMINISTIC_SKILL_ORDER'));

const config = estimator.getSkillEstimatorConfig();
assert.equal(config.prior.alpha, 1);
assert.equal(config.prior.beta, 1);
assert.equal(config.outcome_contributions.partial.alpha, 0.5);
assert.equal(config.outcome_contributions.partial.beta, 0.5);
assert.equal(config.uncertainty_method, 'sqrt(beta_variance / uniform_beta_1_1_variance)');

const sourceFiles = [
  'skill-taxonomy.js',
  'skill-evidence.js',
  'skill-estimator.js',
];
for (const file of sourceFiles) {
  assert.equal(fs.existsSync(path.join(personalizationRoot, file)), true);
}
assert.equal(fs.existsSync(fixturePath), true);

console.log('vocabulary personalization PL-B verification passed');
console.log(`taxonomy: ${taxonomy.SKILL_TAXONOMY.version} (${requiredSkillIds.length} skills)`);
console.log(`evidence: ${evidence.SKILL_EVIDENCE_SCHEMA_VERSION}; estimator: ${estimator.SKILL_ESTIMATOR_VERSION}`);
console.log('formula: posterior Beta(alpha0 + weighted successes, beta0 + weighted failures)');
console.log('prior: alpha0=1, beta0=1; partial contributes 0.5/0.5; skip contributes 0');
console.log('checks: empty, sparse, mixed, skip, cue/reveal, legacy, duration, unknown, custom, order, replay, immutability');
