// Real product services, isolated in-memory repository/UOW; no owner or scoring.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadModules, createAcquisitionReader, schedulerStub, candidate, applyArticle } = require('./vocabulary-article-acquisition-check.cjs');
const root = path.resolve(__dirname, '..');
const now = '2026-10-06T00:00:00.000Z';
const bankTargets = () => [
  candidate({ targetId: 'bank-river', target_id: 'bank-river', word: 'bank', lemma: 'bank', meaning: '河岸', context: { sentence: 'He sat on the bank of the river.', meaning: '河岸' } }),
  candidate({ targetId: 'bank-financial', target_id: 'bank-financial', word: 'bank', lemma: 'bank', meaning: '银行', context: { sentence: 'She deposited money in the bank.', meaning: '银行' } }),
];
const counts = (result) => ({ added: result.added, contexts: result.existingContextAdded + result.knownContextAdded, processed: result.processed });
async function main() {
  const api = await loadModules(root);
  const evidence = [];
  function setup(repository = api.createInMemoryVocabularyRepository(), runner = api.createInMemoryVocabularyLearningUnitOfWorkRunner({ now: () => now })) {
    const service = api.createVocabularyService({ repository, scheduler: schedulerStub(), now: () => new Date(now), acquisitionEnabled: true, acquisitionRepository: createAcquisitionReader(runner.snapshot), runVocabularyLearningUnitOfWork: runner.run, runVocabularyLearningBatchSession: runner.runBatchSession });
    return { repository, runner, service };
  }
  const core = setup();
  const coreResult = await applyArticle(api, core.service, bankTargets());
  assert.deepEqual(counts(coreResult), { added: 1, contexts: 1, processed: 2 });
  const coreSnapshot = await core.repository.loadSnapshot();
  const coreRows = core.runner.snapshot();
  const pairs = Object.values(coreRows.find(row => row.id === 'vocabulary.acquisition.store.v1').content.by_learning_unit_id);
  assert.equal(coreSnapshot.words.length, 1);
  assert.equal(coreSnapshot.contexts.length, 2);
  assert.equal(pairs.length, 2);
  assert.deepEqual(pairs.map(pair => pair.learning_unit.word_id), [coreSnapshot.words[0].id, coreSnapshot.words[0].id]);
  assert.deepEqual(coreSnapshot.contexts.map(context => context.meaning).sort(), ['河岸', '银行'].sort());
  assert.deepEqual(pairs.map(pair => pair.learning_unit.target_sense.gloss).sort(), ['河岸', '银行'].sort());
  assert.deepEqual(coreResult.selectedTargetIds, ['bank-river', 'bank-financial']);
  evidence.push({ case: 'bank-two-senses', ...counts(coreResult), words: 1, contextsSaved: 2, units: 2, oneWordId: true, meaningsPreserved: true });
  const repeat = await applyArticle(api, core.service, bankTargets());
  assert.deepEqual(counts(repeat), { added: 0, contexts: 0, processed: 0 });
  assert.deepEqual(await core.repository.loadSnapshot(), coreSnapshot);
  assert.deepEqual(core.runner.snapshot(), coreRows);
  // Direct application also counts actual writes, independent of article filtering.
  const directRepeat = await api.applySrsCandidatesToVocabulary({ vocabularyService: core.service, candidates: bankTargets() });
  assert.deepEqual(counts(directRepeat), { added: 0, contexts: 0, processed: 2 });
  assert.deepEqual(await core.repository.loadSnapshot(), coreSnapshot);
  assert.deepEqual(core.runner.snapshot(), coreRows);
  evidence.push({ case: 'repeat-and-graduated', article: counts(repeat), direct: counts(directRepeat), dataUnchanged: true });

  for (const [label, targets, expectedWords] of [
    ['single', bankTargets().slice(0, 1), 1],
    ['different-words', bankTargets().map((item, index) => ({ ...item, word: index ? 'shore' : 'bank', lemma: index ? 'shore' : 'bank' })), 2],
    ['normalized-lookup', bankTargets().map((item, index) => ({ ...item, word: index ? ' BANK ' : 'bank', lemma: index ? ' BANK ' : 'bank' })), 1],
    ['different-languages', bankTargets().map((item, index) => ({ ...item, language: index ? 'de' : 'en' })), 2],
  ]) {
    const env = setup();
    const result = await applyArticle(api, env.service, targets);
    assert.deepEqual(counts(result), { added: expectedWords, contexts: targets.length - expectedWords, processed: targets.length });
    assert.equal((await env.repository.loadSnapshot()).words.length, expectedWords);
    evidence.push({ case: label, ...counts(result), words: expectedWords });
  }
  for (const status of ['learning', 'known', 'ignored']) {
    const env = setup();
    const legacy = api.createVocabularyService({ repository: env.repository, scheduler: schedulerStub(), now: () => new Date(now) });
    const word = await legacy.addWordLegacy({ ...bankTargets()[0], context: null, legacyCaller: 'count-check' });
    await env.repository.updateSnapshot(snapshot => { snapshot.words[0].status = status; });
    const before = await env.repository.loadSnapshot();
    const result = await applyArticle(api, env.service, bankTargets());
    assert.deepEqual(counts(result), { added: 0, contexts: status === 'ignored' ? 0 : 2, processed: 2 });
    assert.equal(result.knownContextAdded, status === 'known' ? 2 : 0);
    assert.equal(result.ignoredSkipped, status === 'ignored' ? 2 : 0);
    const after = await env.repository.loadSnapshot();
    assert.deepEqual(after.words, before.words);
    assert.deepEqual(after.reviewStates, before.reviewStates);
    assert.deepEqual(after.reviewLogs, before.reviewLogs);
    if (status !== 'learning') {
      const relearn = await applyArticle(api, env.service, bankTargets().map(item => ({ ...item, relearn: true, context: { ...item.context, source_id: 'relearn-source' }, existing_word_id: word.id })));
      assert.equal(relearn.added, 0);
      assert.equal(relearn.relearned, status === 'ignored' ? 2 : 0);
      assert.equal(relearn.existingContextAdded + relearn.knownContextAdded, 2);
      assert.deepEqual((await env.repository.loadSnapshot()).words, before.words);
      assert.deepEqual((await env.repository.loadSnapshot()).reviewStates, before.reviewStates);
    }
    evidence.push({ case: `existing-${status}`, ...counts(result), oldDataPreserved: true });
  }
  // Single-acquisition fallback must share the same transient creation contract.
  const fallback = setup();
  const { queueVocabularyAcquisitions, ...singleService } = fallback.service;
  const singleResult = await api.applySrsCandidatesToVocabulary({ vocabularyService: singleService, candidates: bankTargets() });
  assert.deepEqual(counts(singleResult), { added: 1, contexts: 1, processed: 2 });
  evidence.push({ case: 'single-acquisition-fallback', ...counts(singleResult) });

  for (const point of ['after-chunk', 'before-final', 'after-final']) {
    const base = api.createInMemoryVocabularyRepository();
    const runner = api.createInMemoryVocabularyLearningUnitOfWorkRunner({ now: () => now });
    let write = 0, fail = true, batch = 0;
    const repository = { ...base, async updateSnapshot(...args) {
      write += 1;
      if (point === 'before-final' && write === 2 && fail) { fail = false; throw Error('declared final failure'); }
      const result = await base.updateSnapshot(...args);
      if (point === 'after-final' && write === 2 && fail) { fail = false; throw Error('declared lost response'); }
      return result;
    } };
    const faultRunner = { ...runner, async runBatchSession(...args) {
      const result = await runner.runBatchSession(...args);
      if (point === 'after-chunk' && ++batch === 1 && fail) { fail = false; throw Error('declared chunk interruption'); }
      return result;
    } };
    const env = setup(repository, faultRunner);
    await assert.rejects(() => api.applyArticleSrsSettlement({ vocabularyService: env.service, candidates: bankTargets(), transactionChunkSize: 1 }), /declared/);
    const before = runner.snapshot();
    const reserved = await base.loadSnapshot();
    assert.equal(reserved.words.length, 1);
    const retry = await applyArticle(api, env.service, bankTargets());
    assert.equal(retry.added, 0, 'retry must not report a reserved word as new');
    assert.equal(retry.existingContextAdded, point === 'after-final' ? 0 : 2);
    const final = await base.loadSnapshot();
    assert.equal(final.words.length, 1);
    assert.equal(final.contexts.length, 2);
    assert.deepEqual(final.words.map(word => word.id), reserved.words.map(word => word.id));
    const after = runner.snapshot();
    const beforePairs = Object.entries(before.find(row => row.id === 'vocabulary.acquisition.store.v1').content.by_learning_unit_id);
    const afterPairs = after.find(row => row.id === 'vocabulary.acquisition.store.v1').content.by_learning_unit_id;
    assert.equal(Object.keys(afterPairs).length, 2);
    for (const [id, pair] of beforePairs) assert.deepEqual(afterPairs[id], pair);
    const stable = structuredClone(after);
    await applyArticle(api, env.service, bankTargets());
    assert.deepEqual(runner.snapshot(), stable, 'retry must not duplicate events or states');
    evidence.push({ case: `failure-${point}`, rejected: true, retry: counts(retry), words: 1, contextsSaved: 2, units: 2, committedPairsPreserved: true });
  }
  // Execute the unchanged controller completion seam with the real core result.
  // This is source-seam evidence, not a live Host/UI journey.
  const controller = fs.readFileSync(path.join(root, 'src/composables/vocabulary-preview-module.js'), 'utf8');
  const start = controller.indexOf('  async function runClaimedSettlementApplication(context)');
  const end = controller.indexOf('\n  async function ', start + 10);
  const toasts = [], errors = [];
  const sandbox = { settlementApplicationRunner: async () => coreResult, settlementProgressRepository: { async recordApplication() {} }, refreshSettlementProgressBadge: async () => {}, showToast: (...args) => toasts.push(args), showError: (...args) => errors.push(args), settlementApplicationsInFlight: new Map() };
  const run = vm.runInNewContext(controller.slice(start, end) + '\nrunClaimedSettlementApplication', sandbox);
  await run({ actionIdentity: { currentIdentity: {} }, articleId: 'count-check', claimedTargetIds: coreResult.selectedTargetIds, claimedCandidates: bankTargets(), mode: 'all' });
  assert.deepEqual(errors, []);
  assert.equal(toasts[0][0], '后台整理完成：新增词条 1 个，追加语境 1 个，处理目标 2 个，重新学习 0 个。');
  assert.equal(toasts[0][1], 'success');
  evidence.push({ case: 'original-controller-completion-source-seam', toast: toasts[0][0], liveHostUI: 'NOT_RUN' });
  if (process.env.N5_COUNT_EVIDENCE) fs.writeFileSync(process.env.N5_COUNT_EVIDENCE, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  console.log('PASS candidate word/context/target counts and isolated data preservation.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
