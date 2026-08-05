#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function importWorkspaceModule(repoRoot, relativePath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-web-personalization-'));
  const tempPath = path.join(tempDir, path.basename(relativePath).replace(/\.js$/u, '.mjs'));
  fs.copyFileSync(path.join(repoRoot, relativePath), tempPath);
  try {
    return await import(`${pathToFileURL(tempPath).href}?v=${Date.now()}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function hasReason(result, code) {
  return result.reason_codes.includes(code)
    || result.reasons.some((item) => item.code === code)
    || result.hard_failures?.some((item) => item.code === code);
}

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const fixturePath = path.join(repoRoot, 'scripts', 'fixtures', 'vocabulary-personalization-content.fixture.json');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assert.equal(fixture.schema_version, 'vocabulary-personalization-content-fixtures.v1');

  const primary = await importWorkspaceModule(repoRoot, 'src/services/vocabulary/personalization/primary-sense-policy.js');
  const source = await importWorkspaceModule(repoRoot, 'src/services/vocabulary/personalization/sentence-source-policy.js');
  const ranking = await importWorkspaceModule(repoRoot, 'src/services/vocabulary/personalization/sentence-candidate-ranking.js');

  assert.equal(primary.PRIMARY_SENSE_POLICY_VERSION, 'primary-sense-policy.v1');
  assert.equal(source.SENTENCE_SOURCE_POLICY_VERSION, 'sentence-source-policy.v1');
  assert.equal(ranking.SENTENCE_CANDIDATE_RANKING_VERSION, 'sentence-candidate-ranking.v1');

  const emptySense = primary.resolvePrimarySense(fixture.primary_sense.empty);
  assert.equal(emptySense.status, 'unresolved');
  assert.ok(hasReason(emptySense, 'EMPTY_INPUT'));

  const unknownPos = primary.resolvePrimarySense(fixture.primary_sense.pos_unknown);
  assert.equal(unknownPos.status, 'unresolved');
  assert.equal(unknownPos.primary_sense_key, null);
  assert.ok(hasReason(unknownPos, 'POS_UNKNOWN'));

  const twoWayInput = clone(fixture.primary_sense.two_way_consensus);
  const twoWayBefore = clone(twoWayInput);
  const twoWay = primary.resolvePrimarySense(twoWayInput);
  assert.equal(twoWay.status, 'resolved');
  assert.equal(twoWay.primary_sense_key, 'run-verb-01');
  assert.ok(hasReason(twoWay, 'INDEPENDENT_SOURCE_AGREEMENT'));
  assert.deepEqual(twoWayInput, twoWayBefore, 'primary-sense policy must not mutate evidence input');

  const twoOneMajority = primary.resolvePrimarySense(fixture.primary_sense.two_one_majority);
  assert.equal(twoOneMajority.status, 'resolved');
  assert.equal(twoOneMajority.primary_sense_key, 'set-verb-01');
  assert.equal(twoOneMajority.majority_source_count, 2);
  assert.equal(twoOneMajority.runner_up_source_count, 1);
  assert.equal(twoOneMajority.has_majority, true);
  assert.ok(hasReason(twoOneMajority, 'MINORITY_EVIDENCE_DISAGREEMENT'));

  const threeWay = primary.resolvePrimarySense(fixture.primary_sense.three_way_disagreement);
  assert.equal(threeWay.status, 'unresolved');
  assert.equal(threeWay.primary_sense_key, null);
  assert.ok(hasReason(threeWay, 'THREE_WAY_DISAGREEMENT'));

  const ecdictOnly = primary.resolvePrimarySense(fixture.primary_sense.ecdict_only);
  assert.equal(ecdictOnly.status, 'unresolved');
  assert.equal(ecdictOnly.primary_sense_key, null);
  assert.ok(hasReason(ecdictOnly, 'ECDICT_WHOLE_WORD_FREQUENCY_IGNORED'));
  assert.equal(ecdictOnly.evidence_sources.every((item) => item.evidence_count === 0), true);

  const internalTieInput = clone(fixture.primary_sense.internal_tie_bank_a_b);
  const internalTie = primary.resolvePrimarySense(internalTieInput);
  const reversedInternalTie = primary.resolvePrimarySense({
    ...fixture.primary_sense.internal_tie_bank_a_b,
    evidence: fixture.primary_sense.internal_tie_bank_a_b.evidence.slice().reverse(),
  });
  assert.equal(internalTie.status, 'unresolved');
  assert.equal(internalTie.primary_sense_key, null);
  assert.equal(internalTie.majority_source_count, 1);
  assert.equal(internalTie.runner_up_source_count, 1);
  assert.ok(hasReason(internalTie, 'SOURCE_INTERNAL_CONFLICT'));
  assert.ok(hasReason(internalTie, 'NO_EVIDENCE_MAJORITY'));
  assert.deepEqual(internalTie, reversedInternalTie, 'internal source ties must be input-order independent');
  const learnerInternalTie = internalTie.evidence_sources.find((item) => item.source === 'learner_dictionary');
  assert.equal(learnerInternalTie.selected_sense_key, null);
  assert.equal(learnerInternalTie.abstained, true);
  assert.equal(learnerInternalTie.internal_conflict, true);
  assert.deepEqual(learnerInternalTie.conflicting_sense_keys, ['bank-a', 'bank-b']);
  assert.deepEqual(internalTie.source_internal_conflicts, [{
    source: 'learner_dictionary',
    conflicting_sense_keys: ['bank-a', 'bank-b'],
    evidence_count: 2,
  }]);

  const scoreTie = primary.resolvePrimarySense(fixture.primary_sense.internal_tie_score);
  const reversedScoreTie = primary.resolvePrimarySense({
    ...fixture.primary_sense.internal_tie_score,
    evidence: fixture.primary_sense.internal_tie_score.evidence.slice().reverse(),
  });
  assert.equal(scoreTie.status, 'unresolved');
  assert.equal(scoreTie.primary_sense_key, null);
  assert.ok(hasReason(scoreTie, 'SOURCE_INTERNAL_CONFLICT'));
  assert.deepEqual(scoreTie, reversedScoreTie, 'equal scores must not use input order or sense-key voting');

  const duplicateEvidence = primary.resolvePrimarySense(fixture.primary_sense.duplicate_evidence);
  const reversedDuplicateEvidence = primary.resolvePrimarySense({
    ...fixture.primary_sense.duplicate_evidence,
    evidence: fixture.primary_sense.duplicate_evidence.evidence.slice().reverse(),
  });
  assert.equal(duplicateEvidence.status, 'resolved');
  assert.equal(duplicateEvidence.primary_sense_key, 'bank-a');
  assert.equal(duplicateEvidence.majority_source_count, 2);
  assert.equal(duplicateEvidence.runner_up_source_count, 1);
  assert.equal(duplicateEvidence.evidence_sources.find((item) => item.source === 'learner_dictionary').evidence_count, 2);
  assert.deepEqual(duplicateEvidence, reversedDuplicateEvidence, 'duplicate evidence must not make results input-order dependent');

  const normalizedOpen = source.normalizeSentenceSource(fixture.sentence_sources.open_validated);
  assert.equal(normalizedOpen.source_kind, 'open_corpus');
  assert.equal(normalizedOpen.license_kind, 'licensed_open');
  assert.equal(normalizedOpen.content_status, 'authentic');
  assert.equal(normalizedOpen.generated, false);
  assert.equal(normalizedOpen.validated_authentic_anchor, true);

  const unknownLicense = source.normalizeSentenceProvenance(fixture.sentence_sources.unknown_license);
  assert.equal(unknownLicense.license_kind, 'unknown');
  assert.equal(unknownLicense.quality_status, 'pending');
  assert.equal(unknownLicense.validated_authentic_anchor, false);
  assert.ok(hasReason(unknownLicense, 'LICENSE_UNKNOWN'));

  const sourceKindOnly = source.normalizeSentenceSource(fixture.sentence_sources.source_kind_only);
  assert.equal(sourceKindOnly.license_kind, 'unknown');
  assert.equal(sourceKindOnly.ownership, 'unknown');
  assert.equal(sourceKindOnly.content_status, 'unknown');
  assert.equal(sourceKindOnly.quality_status, 'pending');
  assert.equal(sourceKindOnly.validated_authentic_anchor, false);
  assert.equal(sourceKindOnly.is_publicly_redistributable, false);
  const sourceKindOnlyRanking = ranking.rankSentenceCandidates({
    target_sense_key: 'calm-1',
    candidates: [{
      ...fixture.sentence_sources.source_kind_only,
      candidate_id: 'source-kind-only-candidate',
      target_sense_key: 'calm-1',
      independent_comprehensibility: true,
    }],
  });
  assert.equal(sourceKindOnlyRanking.status, 'unresolved');
  assert.ok(hasReason(sourceKindOnlyRanking.rejected_candidates[0], 'LICENSE_UNKNOWN'));
  assert.ok(hasReason(sourceKindOnlyRanking.rejected_candidates[0], 'PROVENANCE_INCOMPLETE'));

  const pendingOpen = source.normalizeSentenceSource(fixture.sentence_sources.pending_open);
  assert.equal(pendingOpen.license_kind, 'licensed_open');
  assert.equal(pendingOpen.provenance_complete, true);
  assert.equal(pendingOpen.validated_authentic_anchor, false);
  assert.ok(hasReason(pendingOpen, 'AUTHENTICITY_PENDING_VALIDATION'));
  const pendingEvaluation = source.evaluateSentenceSource(fixture.sentence_sources.pending_open);
  assert.equal(pendingEvaluation.eligible, false);
  assert.ok(hasReason(pendingEvaluation, 'NOT_VALIDATED_AUTHENTIC_ANCHOR'));

  const generated = source.normalizeSentenceSource(fixture.sentence_sources.ai_generated);
  assert.equal(generated.source_kind, 'ai_candidate');
  assert.equal(generated.license_kind, 'ai_generated');
  assert.equal(generated.content_status, 'generated');
  assert.equal(generated.quality_status, 'pending');
  assert.equal(generated.validated_authentic_anchor, false);
  assert.ok(hasReason(generated, 'AI_GENERATED_AUXILIARY_ONLY'));

  const serializedGenerated = source.normalizeSentenceSource(fixture.sentence_sources.ai_generated_serialized_flag);
  assert.equal(serializedGenerated.generated, true);
  assert.equal(serializedGenerated.content_status, 'generated');
  assert.equal(serializedGenerated.generated_flag_valid, true);
  assert.equal(serializedGenerated.validated_authentic_anchor, false);

  const ambiguousGenerated = source.normalizeSentenceSource(fixture.sentence_sources.ai_generated_ambiguous_flag);
  assert.equal(ambiguousGenerated.generated, true);
  assert.equal(ambiguousGenerated.generated_flag_valid, false);
  assert.ok(hasReason(ambiguousGenerated, 'GENERATED_FLAG_INVALID_ASSUMED_GENERATED'));

  const localExam = source.normalizeSentenceSource(fixture.sentence_sources.local_exam);
  assert.equal(localExam.usage_scope, 'late_context_transfer');
  assert.equal(localExam.is_local_only, true);
  assert.equal(localExam.validated_authentic_anchor, true);

  const firstPreviewInput = {
    target_sense_key: fixture.ranking.target_sense_key,
    candidates: fixture.ranking.first_preview_candidates,
  };
  const firstPreviewBefore = clone(firstPreviewInput);
  const firstPreview = ranking.rankSentenceCandidates(firstPreviewInput);
  assert.equal(firstPreview.status, 'selected');
  assert.equal(firstPreview.selected_candidate_id, 'open-short');
  assert.deepEqual(firstPreviewInput, firstPreviewBefore, 'ranking must not mutate candidate input');
  assert.ok(firstPreview.rejected_candidates.some((item) => item.candidate_id === 'unknown-license' && hasReason(item, 'LICENSE_UNKNOWN')));
  assert.ok(firstPreview.rejected_candidates.some((item) => item.candidate_id === 'generated-helper' && hasReason(item, 'GENERATED_NOT_AUTHENTIC_ANCHOR')));
  assert.ok(firstPreview.rejected_candidates.some((item) => item.candidate_id === 'pending-anchor' && hasReason(item, 'NOT_VALIDATED_AUTHENTIC_ANCHOR')));
  assert.ok(firstPreview.rejected_candidates.some((item) => item.candidate_id === 'local-exam' && hasReason(item, 'LOCAL_EXAM_NOT_FIRST_PREVIEW')));
  assert.ok(firstPreview.rejected_candidates.some((item) => item.candidate_id === 'too-many-unknowns' && hasReason(item, 'NON_TARGET_UNKNOWN_RATIO_TOO_HIGH')));
  assert.ok(firstPreview.rejected_candidates.some((item) => item.candidate_id === 'context-dependent' && hasReason(item, 'NOT_INDEPENDENTLY_COMPREHENSIBLE')));

  const allInvalid = ranking.rankSentenceCandidates({
    target_sense_key: fixture.ranking.target_sense_key,
    candidates: fixture.ranking.all_invalid_candidates,
  });
  assert.equal(allInvalid.status, 'unresolved');
  assert.equal(allInvalid.selected_candidate_id, null);
  assert.ok(hasReason(allInvalid, 'NO_ELIGIBLE_CANDIDATE'));

  const tieInput = {
    target_sense_key: fixture.ranking.target_sense_key,
    candidates: fixture.ranking.tie_break_candidates,
  };
  const tieResult = ranking.rankSentenceCandidates(tieInput);
  const reversedTieResult = ranking.rankSentenceCandidates({
    ...tieInput,
    candidates: tieInput.candidates.slice().reverse(),
  });
  assert.equal(tieResult.selected_candidate_id, 'candidate-a');
  assert.equal(reversedTieResult.selected_candidate_id, 'candidate-a');
  assert.ok(hasReason(tieResult.ranked_candidates[0], 'TIE_BREAK_CANDIDATE_ID'));

  const duplicateResult = ranking.rankSentenceCandidates({
    target_sense_key: fixture.ranking.target_sense_key,
    candidates: fixture.ranking.duplicate_id_candidates,
  });
  const duplicateEntries = duplicateResult.candidates.filter((item) => item.candidate_id === 'duplicate-open');
  assert.equal(duplicateEntries.length, 1, 'duplicate candidate ids must be emitted once');
  assert.equal(duplicateResult.selected_candidate_id, 'duplicate-open');
  assert.equal(duplicateEntries[0].duplicate_input_count, 2);
  assert.ok(hasReason(duplicateEntries[0], 'DUPLICATE_CANDIDATE_ID_DEDUPED'));
  const reversedDuplicateResult = ranking.rankSentenceCandidates({
    target_sense_key: fixture.ranking.target_sense_key,
    candidates: fixture.ranking.duplicate_id_candidates.slice().reverse(),
  });
  assert.equal(reversedDuplicateResult.selected_candidate.source.source_id, 'open-duplicate-a');

  const lateTransfer = ranking.rankSentenceCandidates({
    target_sense_key: fixture.ranking.target_sense_key,
    candidates: fixture.ranking.late_transfer_candidates,
  }, { use_case: 'late_context_transfer' });
  assert.equal(lateTransfer.status, 'selected');
  assert.equal(lateTransfer.selected_candidate_id, 'local-late-transfer');

  for (const relativePath of [
    'src/services/vocabulary/personalization/primary-sense-policy.js',
    'src/services/vocabulary/personalization/sentence-source-policy.js',
    'src/services/vocabulary/personalization/sentence-candidate-ranking.js',
  ]) {
    const moduleSource = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    assert.equal(/\b(window|document|indexedDB)\b/iu.test(moduleSource), false, `${relativePath} must remain runtime-independent`);
    assert.equal(/fetch\s*\(|XMLHttpRequest|WebSocket|EventSource/iu.test(moduleSource), false, `${relativePath} must not use network APIs`);
    assert.equal(/from ['"](?:vue|pinia)|from ['"].*openai/iu.test(moduleSource), false, `${relativePath} must not add runtime dependencies`);
  }
  const fixtureSource = fs.readFileSync(fixturePath, 'utf8');
  assert.equal(/\bIELTS\b/iu.test(fixtureSource), false, 'fixture must not embed protected exam wording');

  console.log('vocabulary personalization content verification passed');
  console.log(JSON.stringify({
    modules: [
      'primary-sense-policy.js',
      'sentence-source-policy.js',
      'sentence-candidate-ranking.js',
    ],
    versions: {
      primary_sense: primary.PRIMARY_SENSE_POLICY_VERSION,
      sentence_source: source.SENTENCE_SOURCE_POLICY_VERSION,
      sentence_ranking: ranking.SENTENCE_CANDIDATE_RANKING_VERSION,
    },
    scenarios: [
      'empty input',
      'unknown POS',
      'two-source consensus',
      'two-to-one source majority',
      'three-way disagreement',
      'ECDICT whole-word frequency ignored',
      'source-internal equal-strength conflict abstention',
      'equal-score source-internal conflict',
      'duplicate primary-sense evidence',
      'source-kind-only fail-closed normalization',
      'unknown license',
      'pending anchor rejected in first preview',
      'AI generated auxiliary',
      'serialized and ambiguous generated flags',
      'all candidates rejected',
      'deterministic tie-break',
      'duplicate candidate-id deduplication',
      'local late context transfer',
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
