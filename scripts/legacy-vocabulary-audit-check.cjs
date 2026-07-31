const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function importAuditModule(repoRoot) {
  const sourcePath = path.join(
    repoRoot,
    'src',
    'services',
    'vocabulary',
    'legacy-vocabulary-audit.js',
  );
  assert.ok(fs.existsSync(sourcePath), 'missing legacy vocabulary audit module');
  const source = fs.readFileSync(sourcePath, 'utf8');
  assert.doesNotMatch(source, /\bindexedDB\b|\bIDB(?:Database|Transaction|ObjectStore)\b/);
  assert.doesNotMatch(source, /\bcreateVocabularyRepository\b|\bcreateVocabularyService\b/);
  const sourceUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(sourceUrl);
}

function itemById(manifest, wordId) {
  const item = manifest.items.find((candidate) => candidate.legacy_word_id === wordId);
  assert.ok(item, `missing audit item: ${wordId}`);
  return item;
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const fixturePath = path.join(
    repoRoot,
    'scripts',
    'fixtures',
    'legacy-vocabulary-audit-cases.json',
  );
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const { auditLegacyVocabularySnapshot } = await importAuditModule(repoRoot);

  const before = JSON.stringify(fixture.snapshot);
  const first = auditLegacyVocabularySnapshot(fixture.snapshot, fixture.options);
  const second = auditLegacyVocabularySnapshot(fixture.snapshot, fixture.options);

  assert.deepEqual(first, second, 'repeated audit must be idempotent');
  assert.equal(JSON.stringify(fixture.snapshot), before, 'audit must not mutate the legacy snapshot');
  assert.deepEqual(Object.keys(first), [
    'schema_version',
    'policy_version',
    'source_snapshot_hmac_sha256',
    'audited_at',
    'items',
  ]);
  assert.equal(first.schema_version, 'legacy-audit-manifest.v1');
  assert.equal(first.policy_version, fixture.options.policy_version);
  assert.equal(
    first.source_snapshot_hmac_sha256,
    fixture.options.source_snapshot_hmac_sha256,
  );

  assert.equal(itemById(first, 'compatible').classification, 'compatible');
  assert.equal(itemById(first, 'needs-context').classification, 'needs_context');
  assert.equal(itemById(first, 'needs-sense').classification, 'needs_sense');
  assert.deepEqual(itemById(first, 'duplicate-a').reason_codes, ['DUPLICATE_LEMMA']);
  assert.equal(itemById(first, 'duplicate-a').classification, 'conflicting');
  assert.equal(itemById(first, 'duplicate-b').classification, 'conflicting');
  assert.equal(itemById(first, 'ignored').classification, 'ignored_or_deleted');
  assert.equal(itemById(first, 'deleted').classification, 'ignored_or_deleted');
  assert.equal(itemById(first, 'bad-date').classification, 'conflicting');
  assert.ok(itemById(first, 'bad-date').reason_codes.includes('BAD_WORD_DATE'));
  assert.ok(itemById(first, 'bad-date').reason_codes.includes('BAD_REVIEW_LOG_DATE'));
  assert.equal(itemById(first, 'multiple-senses').classification, 'conflicting');
  assert.ok(
    itemById(first, 'multiple-senses').reason_codes.includes('MULTIPLE_TARGET_SENSES'),
  );
  assert.deepEqual(itemById(first, 'multiple-states').reason_codes, [
    'MULTIPLE_REVIEW_STATES',
  ]);
  assert.equal(itemById(first, 'multiple-states').classification, 'conflicting');
  assert.deepEqual(itemById(first, 'orphan-state'), {
    legacy_word_id: 'orphan-state',
    classification: 'conflicting',
    reason_codes: ['ORPHAN_REVIEW_STATE'],
    is_legacy: true,
    training_eligible: false,
  });
  assert.deepEqual(itemById(first, 'orphan-log'), {
    legacy_word_id: 'orphan-log',
    classification: 'conflicting',
    reason_codes: ['ORPHAN_REVIEW_LOG'],
    is_legacy: true,
    training_eligible: false,
  });
  first.items.forEach((item) => {
    assert.equal(item.is_legacy, true);
    assert.equal(item.training_eligible, false);
  });

  assert.throws(
    () => auditLegacyVocabularySnapshot(fixture.snapshot, {
      ...fixture.options,
      source_snapshot_hmac_sha256: 'not-a-hash',
    }),
    (error) => error
      && error.code === 'INVALID_FIELD_TYPE'
      && error.details.field === 'options.source_snapshot_hmac_sha256',
  );
  assert.throws(
    () => auditLegacyVocabularySnapshot(fixture.snapshot, {
      ...fixture.options,
      audited_at: 'not-a-date',
    }),
    (error) => error
      && error.code === 'INVALID_TIMESTAMP'
      && error.details.field === 'options.audited_at',
  );
  assert.throws(
    () => auditLegacyVocabularySnapshot({ ...fixture.snapshot, reviewLogs: null }, fixture.options),
    (error) => error
      && error.code === 'INVALID_FIELD_TYPE'
      && error.details.field === 'snapshot.reviewLogs',
  );
  assert.throws(
    () => auditLegacyVocabularySnapshot({ ...fixture.snapshot, schemaVersion: 2 }, fixture.options),
    (error) => error
      && error.code === 'UNSUPPORTED_SCHEMA_VERSION'
      && error.details.field === 'snapshot.schemaVersion',
  );

  const unknownReviewStateSnapshot = JSON.parse(JSON.stringify(fixture.snapshot));
  unknownReviewStateSnapshot.reviewStates[0].state = 'mastered';
  assert.throws(
    () => auditLegacyVocabularySnapshot(unknownReviewStateSnapshot, fixture.options),
    (error) => {
      assert.equal(error && error.code, 'UNKNOWN_REVIEW_STATE');
      assert.deepEqual(error && error.details, {
        field: 'snapshot.reviewStates[0].state',
      });
      assert.doesNotMatch(JSON.stringify(error), /mastered/);
      return true;
    },
    'unknown legacy review state must be rejected without exposing its value',
  );

  for (const state of ['new', 'learning', 'review', 'relearning']) {
    const legalReviewStateSnapshot = JSON.parse(JSON.stringify(fixture.snapshot));
    legalReviewStateSnapshot.reviewStates = [{
      word_id: 'compatible',
      state,
      due_at: '2026-07-28T00:00:00.000Z',
    }];
    const legalBefore = JSON.stringify(legalReviewStateSnapshot);
    assert.doesNotThrow(
      () => auditLegacyVocabularySnapshot(legalReviewStateSnapshot, fixture.options),
      `legacy review state ${state} must remain auditable`,
    );
    assert.equal(
      JSON.stringify(legalReviewStateSnapshot),
      legalBefore,
      `auditing legacy review state ${state} must not mutate input`,
    );
  }

  const classificationCounts = first.items.reduce((counts, item) => {
    counts[item.classification] = (counts[item.classification] || 0) + 1;
    return counts;
  }, {});
  console.log('Legacy vocabulary audit verification passed.');
  console.log(JSON.stringify({ classification_counts: classificationCounts }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
