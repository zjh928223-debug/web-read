const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadModules(repoRoot) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-web-p8-check-'));
  const sources = [
    ['src/services/vocabulary/vocabulary-learning-models.js', 'vocabulary-learning-models.mjs'],
    ['src/services/vocabulary/vocabulary-persistence.js', 'vocabulary-persistence.mjs'],
    ['src/services/vocabulary/vocabulary-acquisition-repository.js', 'vocabulary-acquisition-repository.mjs'],
    ['src/services/vocabulary/vocabulary-context-evidence.js', 'vocabulary-context-evidence.mjs'],
    ['src/services/vocabulary/vocabulary-learning-events.js', 'vocabulary-learning-events.mjs'],
    ['src/services/vocabulary/vocabulary-learning-uow.js', 'vocabulary-learning-uow.mjs'],
    ['src/services/vocabulary/vocabulary-acquisition-service.js', 'vocabulary-acquisition-service.mjs'],
    ['src/services/vocabulary/exam-vocabulary-importer.js', 'exam-vocabulary-importer.mjs'],
    ['src/services/vocabulary/exam-vocabulary-context-matcher.js', 'exam-vocabulary-context-matcher.mjs'],
  ];
  try {
    for (const [relativePath, stagedName] of sources) {
      let source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
      source = source
        .replaceAll("from './vocabulary-learning-models.js'", "from './vocabulary-learning-models.mjs'")
        .replaceAll("from './vocabulary-persistence.js'", "from './vocabulary-persistence.mjs'")
        .replaceAll("from './vocabulary-acquisition-repository.js'", "from './vocabulary-acquisition-repository.mjs'")
        .replaceAll("from './vocabulary-context-evidence.js'", "from './vocabulary-context-evidence.mjs'")
        .replaceAll("from './vocabulary-learning-events.js'", "from './vocabulary-learning-events.mjs'")
        .replaceAll("from './vocabulary-learning-uow.js'", "from './vocabulary-learning-uow.mjs'");
      fs.writeFileSync(path.join(tempDir, stagedName), source);
    }
    const modules = await Promise.all(sources.map(([, stagedName]) => import(
      `${pathToFileURL(path.join(tempDir, stagedName)).href}?p8=${Date.now()}`
    )));
    return {
      models: modules[0],
      contexts: modules[3],
      uow: modules[5],
      acquisitionService: modules[6],
      importer: modules[7],
      matcher: modules[8],
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function rowById(snapshot, id) {
  return snapshot.find((row) => row.id === id) ?? null;
}

function command(payload, suffix, occurredAt) {
  return {
    command_id: `p8-command-${suffix}`,
    correlation_id: `p8-correlation-${suffix}`,
    event_partition: occurredAt.slice(0, 7),
    payload,
  };
}

function targetSense() {
  return {
    gloss: '调整使准确',
    normalized_gloss: '调整使准确',
    part_of_speech: 'verb',
    definition: null,
    language: 'en',
  };
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const fixturesDir = path.join(repoRoot, 'scripts', 'fixtures');
  const importFixturePath = path.join(fixturesDir, 'exam-vocabulary-import-v1.json');
  const csvFixturePath = path.join(fixturesDir, 'exam-vocabulary-import-v1.csv');
  const contextFixturePath = path.join(fixturesDir, 'exam-vocabulary-context-v1.json');
  const api = await loadModules(repoRoot);
  const importFixtureText = fs.readFileSync(importFixturePath, 'utf8');
  const csvFixtureText = fs.readFileSync(csvFixturePath, 'utf8');
  const contextFixture = readJson(contextFixturePath);

  assert.deepEqual(readJson(importFixturePath).defaults, {
    language: 'en',
    required_fields: ['lemma', 'exam_category', 'exam_level', 'source_id'],
    optional_fields: ['target_meaning'],
  });
  const jsonPreview = api.importer.previewExamVocabularyImport({
    format: 'json',
    text: importFixtureText,
  });
  assert.equal(jsonPreview.schema_version, 'exam-vocabulary-import-preview.v1');
  assert.equal(jsonPreview.counts.input_rows, 1);
  assert.equal(jsonPreview.counts.confirmable_rows, 1);
  assert.deepEqual(jsonPreview.confirmable_rows[0], {
    schema_version: 'exam-vocabulary-import-row.v1',
    row_number: 1,
    lemma: 'calibrate',
    target_meaning: '调整使准确',
    exam_category: 'synthetic-placement',
    exam_level: 'B2',
    source_id: 'fixture-list-v1',
    status: 'ready',
    existing_word_id: null,
    issues: [],
  });

  const csvPreview = api.importer.previewExamVocabularyImport({
    format: 'csv',
    text: csvFixtureText,
  });
  assert.equal(csvPreview.counts.input_rows, 5);
  assert.equal(csvPreview.counts.confirmable_rows, 3);
  assert.equal(csvPreview.counts.rejected_rows, 2);
  assert.equal(csvPreview.counts.duplicate_rows, 1);
  assert.equal(
    csvPreview.rows.some((row) => row.issues.some((issue) => issue.code === 'EMPTY_ROW')),
    true,
  );
  assert.equal(
    csvPreview.rows.some((row) => row.issues.some((issue) => issue.code === 'DUPLICATE_WORD')),
    true,
  );
  assert.equal(
    csvPreview.rows.some((row) => row.issues.some((issue) => issue.code === 'SAME_LEMMA_DIFFERENT_SENSE')),
    true,
  );

  const existingExactPreview = api.importer.previewExamVocabularyImport({
    format: 'json',
    text: importFixtureText,
  }, {
    existing_learning_units: [{
      learning_unit_id: 'existing-calibrate-sense',
      word_id: 'existing-word-calibrate',
      normalized_form: 'calibrate',
      target_sense: targetSense(),
      archived_at: null,
    }],
  });
  assert.equal(existingExactPreview.counts.confirmable_rows, 0);
  assert.equal(existingExactPreview.rows[0].issues[0].code, 'ALREADY_EXISTS');

  const existingDifferentSensePreview = api.importer.previewExamVocabularyImport({
    format: 'json',
    text: importFixtureText.replace('调整使准确', '校准仪器'),
  }, {
    existing_learning_units: [{
      learning_unit_id: 'existing-calibrate-sense',
      word_id: 'existing-word-calibrate',
      normalized_form: 'calibrate',
      target_sense: targetSense(),
      archived_at: null,
    }],
  });
  assert.equal(existingDifferentSensePreview.counts.confirmable_rows, 1);
  assert.equal(existingDifferentSensePreview.rows[0].existing_word_id, 'existing-word-calibrate');
  assert.equal(existingDifferentSensePreview.rows[0].issues[0].code, 'EXISTING_WORD_DIFFERENT_SENSE');

  assert.throws(
    () => api.importer.previewExamVocabularyImport({ format: 'json', text: '{broken' }),
    (error) => error?.code === 'INVALID_JSON',
  );
  assert.throws(
    () => api.importer.previewExamVocabularyImport({
      format: 'csv',
      text: 'lemma,exam_category,source_id\nword,fixture,list',
    }),
    (error) => error?.code === 'INVALID_CSV' && error?.details?.field === 'exam_level',
  );

  const occurredAt = '2026-07-20T08:00:00.000Z';
  const importRunner = api.uow.createInMemoryVocabularyLearningUnitOfWorkRunner({
    now: () => occurredAt,
  });
  const importResult = await api.importer.confirmExamVocabularyImport(jsonPreview, {
    import_id: 'p8-import-success',
    command_id: 'p8-import-command-success',
    correlation_id: 'p8-import-correlation-success',
    occurred_at: occurredAt,
    runUnitOfWork: importRunner.run,
  });
  assert.equal(importResult.imported_count, 1);
  assert.equal(importResult.review_state_count, 0);
  assert.equal(importResult.due_review_count, 0);
  assert.equal(importResult.candidates[0].status, 'candidate');
  const candidate = importResult.candidates[0];
  const afterImport = importRunner.snapshot();
  const acquisitionAfterImport = rowById(afterImport, 'vocabulary.acquisition.store.v1');
  assert.equal(
    acquisitionAfterImport.content.by_learning_unit_id[candidate.learning_unit_id].learning_unit.target_sense_id,
    null,
  );
  assert.equal(
    acquisitionAfterImport.content.by_learning_unit_id[candidate.learning_unit_id].acquisition_state.status,
    'candidate',
  );
  assert.equal(rowById(afterImport, 'vocabulary.review.store.v2'), null);
  assert.equal(
    afterImport.filter((row) => row.id === 'vocabulary.review.store.v2').length,
    0,
  );

  const multiPreview = api.importer.previewExamVocabularyImport({
    format: 'json',
    text: JSON.stringify({
      rows: [
        readJson(importFixturePath).rows[0],
        {
          lemma: 'resilient',
          target_meaning: '有韧性的',
          exam_category: 'synthetic-placement',
          exam_level: 'B2',
          source_id: 'fixture-list-v1',
        },
      ],
    }),
  });
  const rollbackRunner = api.uow.createInMemoryVocabularyLearningUnitOfWorkRunner({
    now: () => occurredAt,
    failPut({ row }) {
      return row.id.startsWith('vocabulary.learning-events.v1.');
    },
  });
  await assert.rejects(
    api.importer.confirmExamVocabularyImport(multiPreview, {
      import_id: 'p8-import-rollback',
      command_id: 'p8-import-command-rollback',
      correlation_id: 'p8-import-correlation-rollback',
      occurred_at: occurredAt,
      runUnitOfWork: rollbackRunner.run,
    }),
    (error) => error?.code === 'TRANSACTION_ABORTED',
  );
  assert.deepEqual(rollbackRunner.snapshot(), [], 'failed batch import must roll back every candidate row');

  const matchReport = api.matcher.matchExamVocabularyCandidatesToUserContexts([
    candidate,
    {
      learning_unit_id: 'unit-resilient',
      lemma: 'resilient',
      target_meaning: '有韧性的',
    },
  ], contextFixture.user_context_documents);
  assert.equal(matchReport.runtime_api_calls, 0);
  assert.equal(matchReport.review_api_calls, 0);
  assert.deepEqual(matchReport.searched_source_order, [
    'article',
    'subtitle',
    'user_local_exam_material',
  ]);
  const calibrateGap = matchReport.gaps.find((gap) => gap.lemma === 'calibrate');
  assert.deepEqual(calibrateGap.actions.map((action) => action.label), [
    '等待自然遇见',
    '从许可语料导入',
    '可选 AI 候选',
  ]);
  assert.equal(
    calibrateGap.actions.find((action) => action.action === 'request_optional_ai_candidate').allowed_during_review,
    false,
  );
  const resilientResult = matchReport.results.find((result) => result.lemma === 'resilient');
  assert.equal(resilientResult.matches[0].source_kind, 'article');
  assert.equal(resilientResult.matches.some((match) => match.source_kind === 'user_local_exam_material'), true);

  const localMatch = resilientResult.matches.find((match) => (
    match.source_kind === 'user_local_exam_material'
  ));
  const localEvidence = api.matcher.createContextEvidenceFromUserMatch(localMatch, {
    created_at: occurredAt,
    confirmed: true,
  });
  const redactedLocalExport = api.contexts.exportContextEvidence([localEvidence]);
  assert.equal(Object.hasOwn(redactedLocalExport.items[0], 'sentence'), false);
  assert.equal(Object.hasOwn(redactedLocalExport.items[0], 'surrounding_text'), false);
  assert.equal(redactedLocalExport.items[0].source_id, 'fixture-local-material-v1');
  assert.equal(typeof redactedLocalExport.items[0].content_sha256, 'string');
  assert.deepEqual(redactedLocalExport.items[0].source_locator, {
    locator_version: 'source-locator.v1',
    local_locator: 'page:1:item:1',
  });

  const unknownLicenseReport = api.matcher.matchExamVocabularyCandidatesToUserContexts(
    [candidate],
    [{
      source_kind: 'article',
      source_id: 'fixture-unknown-license-article',
      source_title: 'Private import with unconfirmed terms',
      sentences: [{
        sentence: 'Technicians calibrate the sensor before each trial.',
        sentence_index: 0,
      }],
    }],
  );
  const pendingEvidence = api.matcher.createContextEvidenceFromUserMatch(
    unknownLicenseReport.results[0].matches[0],
    {
      created_at: occurredAt,
      confirmed: true,
    },
  );
  assert.equal(pendingEvidence.quality_status, 'pending');
  assert.equal(pendingEvidence.validated_at, null);

  const licensedEvidence = api.matcher.createLicensedCorpusContextEvidence(
    candidate,
    contextFixture.licensed_corpus_record,
    {
      created_at: occurredAt,
      user_confirmed: true,
      context_evidence_id: 'p8-context-calibrate',
    },
  );
  assert.equal(licensedEvidence.source_kind, 'open_corpus');
  assert.equal(licensedEvidence.quality_status, 'validated');
  assert.equal(licensedEvidence.license_kind, 'licensed_open');

  let serviceNow = occurredAt;
  const service = api.acquisitionService.createVocabularyAcquisitionService({
    enabled: true,
    runUnitOfWork: importRunner.run,
    now: () => serviceNow,
  });
  await service.selectTargetSense(command({
    learning_unit_id: candidate.learning_unit_id,
    target_sense_id: 'p8-sense-calibrate',
    target_sense: targetSense(),
    occurred_at: occurredAt,
    event_id: 'p8-event-sense-calibrate',
  }, 'sense-calibrate', occurredAt));
  await service.introduceCandidate(command({
    learning_unit_id: candidate.learning_unit_id,
    episode_id: 'p8-episode-introduction',
    occurred_at: occurredAt,
  }, 'introduce-calibrate', occurredAt));

  await assert.rejects(
    service.markReadyForCheck(command({
      learning_unit_id: candidate.learning_unit_id,
      occurred_at: '2026-07-20T08:01:00.000Z',
    }, 'ready-without-context', '2026-07-20T08:01:00.000Z')),
    (error) => error?.code === 'INVALID_STATE_TRANSITION',
  );
  assert.equal(
    rowById(importRunner.snapshot(), 'vocabulary.review.store.v2'),
    null,
    'a candidate without a sentence cannot graduate or enter review',
  );

  await service.attachContextEvidence(command({
    context_evidence: licensedEvidence,
    occurred_at: '2026-07-20T08:02:00.000Z',
    event_id: 'p8-event-context-calibrate',
  }, 'context-calibrate', '2026-07-20T08:02:00.000Z'));

  serviceNow = '2026-07-21T08:00:00.000Z';
  const attemptResult = await service.recordAcquisitionAttempt(command({
    event_id: 'p8-event-attempt-calibrate',
    attempt: {
      schema_version: 'acquisition-attempt.v1',
      attempt_id: 'p8-attempt-calibrate',
      learning_unit_id: candidate.learning_unit_id,
      target_sense_id: 'p8-sense-calibrate',
      attempt_kind: 'delayed_check',
      episode_id: 'p8-episode-delayed-check',
      session_id: null,
      session_position: null,
      occurred_at: serviceNow,
      prompt_mode: 'original_context',
      cue_level: 'target_sentence',
      rating: 'good',
      answer_revealed_before_rating: false,
      context_evidence_id: licensedEvidence.context_evidence_id,
      duration_ms: 12000,
      active_duration_ms: 9000,
      extensions: {},
    },
  }, 'attempt-calibrate', serviceNow));
  assert.equal(attemptResult.graduation_eligibility.eligible, true);
  assert.equal(attemptResult.graduation_eligibility.elapsed_ms, 86400000);

  const readyAt = '2026-07-21T08:00:01.000Z';
  serviceNow = readyAt;
  await service.markReadyForCheck(command({
    learning_unit_id: candidate.learning_unit_id,
    occurred_at: readyAt,
  }, 'ready-calibrate', readyAt));

  const graduatedAt = '2026-07-21T08:00:02.000Z';
  serviceNow = graduatedAt;
  const graduation = await service.graduateLearningUnit(command({
    learning_unit_id: candidate.learning_unit_id,
    attempt_id: 'p8-attempt-calibrate',
    review_state_id: 'p8-review-calibrate',
    event_id: 'p8-event-graduated-calibrate',
    graduated_at: graduatedAt,
    scheduler_version: 'fsrs.v1',
    scheduler_parameters_version: 'fsrs-parameters.v1',
  }, 'graduate-calibrate', graduatedAt));
  assert.equal(graduation.review_state_id, 'p8-review-calibrate');

  const finalSnapshot = importRunner.snapshot();
  const finalAcquisition = rowById(finalSnapshot, 'vocabulary.acquisition.store.v1');
  const reviewRow = rowById(finalSnapshot, 'vocabulary.review.store.v2');
  assert.equal(
    finalAcquisition.content.by_learning_unit_id[candidate.learning_unit_id].acquisition_state.status,
    'graduated',
  );
  assert.deepEqual(Object.keys(reviewRow.content.by_learning_unit_id), [candidate.learning_unit_id]);
  const reviewState = reviewRow.content.by_learning_unit_id[candidate.learning_unit_id];
  assert.equal(reviewState.state, 'new');
  assert.equal(reviewState.due_at, graduatedAt);
  const formalDueQueue = Object.values(reviewRow.content.by_learning_unit_id)
    .filter((state) => Date.parse(state.due_at) <= Date.parse(graduatedAt));
  assert.deepEqual(formalDueQueue.map((state) => state.learning_unit_id), [candidate.learning_unit_id]);

  const matcherSource = fs.readFileSync(
    path.join(repoRoot, 'src', 'services', 'vocabulary', 'exam-vocabulary-context-matcher.js'),
    'utf8',
  );
  const importerSource = fs.readFileSync(
    path.join(repoRoot, 'src', 'services', 'vocabulary', 'exam-vocabulary-importer.js'),
    'utf8',
  );
  for (const source of [matcherSource, importerSource]) {
    assert.equal(/\bfetch\s*\(/u.test(source), false);
    assert.equal(/\bXMLHttpRequest\b/u.test(source), false);
    assert.equal(/\bindexedDB\b/u.test(source), false);
    assert.equal(/\bSeekPlayerDB\b/u.test(source), false);
    assert.equal(/\bobjectStore\b/u.test(source), false);
  }

  for (const fixturePath of [importFixturePath, csvFixturePath, contextFixturePath]) {
    const fixtureText = fs.readFileSync(fixturePath, 'utf8').toLocaleLowerCase('en-US');
    assert.equal(fixtureText.includes('ielts'), false);
    assert.equal(fixtureText.includes('cambridge'), false);
  }

  console.log('exam vocabulary import closure check passed');
  console.log(JSON.stringify({
    imported_candidate_count: importResult.imported_count,
    review_count_before_graduation: 0,
    gaps_with_three_actions: matchReport.gaps.length,
    review_count_after_graduation: formalDueQueue.length,
    fixture_policy: contextFixture.fixture_policy,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
