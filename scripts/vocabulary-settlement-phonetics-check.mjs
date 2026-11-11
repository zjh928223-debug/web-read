import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const source = fileURLToPath(new URL('../src/services/vocabulary/', import.meta.url));
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-phonetics-check-'));
for (const name of ['vocabulary-models', 'srs-candidates', 'article-srs-settlement', 'article-srs-settlement-progress', 'settlement-meaning-refinement', 'settlement-phonetics']) {
  fs.writeFileSync(path.join(fixture, `${name}.mjs`), fs.readFileSync(path.join(source, `${name}.js`), 'utf8').replace(/from '\.\/([^']+)\.js'/g, "from './$1.mjs'"));
}
const { createSettlementPhoneticResolver, normalizeSettlementPhonetic } = await import(pathToFileURL(path.join(fixture, 'settlement-phonetics.mjs')));
const { applySettlementMeaningRefinementResult, buildSettlementMeaningRefinementTemplate, getSettlementMeaningRefinementCandidates, isSettlementSimpleMeaningReady } = await import(pathToFileURL(path.join(fixture, 'settlement-meaning-refinement.mjs')));
const { applyArticleSrsSettlementProgress, createInMemoryArticleSrsSettlementProgressRepository } = await import(pathToFileURL(path.join(fixture, 'article-srs-settlement-progress.mjs')));
const { createIeltsLearningPoolVitePlugin } = await import('../src/services/vocabulary/ielts-learning-pool-vite-plugin.mjs');

const word = () => ({ targetId: 'emerging', markedText: 'emerging', lemma: 'emerging', entry_type: 'word', eligible: true,
  meaning: '逐渐出现', simple_meaning: '浮现', context: { sentence: 'Details are emerging.', meaning: '逐渐出现', simple_meaning: '浮现' } });
assert.equal(normalizeSettlementPhonetic('ɪˈmɜːrdʒɪŋ'), '/ɪˈmɜːrdʒɪŋ/');
assert.equal(normalizeSettlementPhonetic("'efәt"), '/ˈefət/');
for (const value of ['汉字', 'https://example.test', '<script>', '/abc/extra/', 'x'.repeat(100)]) assert.equal(normalizeSettlementPhonetic(value), '');

let queries = 0;
const resolver = createSettlementPhoneticResolver({ async lookup(query) {
  queries++;
  return { available: true, directMatch: query === 'emerging' ? { word: query, phonetic: 'ɪˈmɜːrdʒɪŋ' } : null,
    normalizedCandidates: [], lemmaCandidates: [{ entry: { word: 'emerge', phonetic: 'ɪˈmɜːrdʒ' } }] };
} });
const local = word();
const phrase = { ...word(), targetId: 'phrase', markedText: 'in front of', entry_type: 'phrase' };
await resolver([local, phrase]);
assert.equal(queries, 1, 'phrases need no dictionary IPA lookup');
assert.equal(local.phonetic, '/ɪˈmɜːrdʒɪŋ/');
await resolver([word()]);
assert.equal(queries, 1, 'dictionary lookups share the session cache');
const inflected = { ...word(), markedText: 'emerged' };
await resolver([inflected]);
assert.equal(inflected.phonetic, undefined, 'never substitute lemma IPA for the displayed inflection');
const unavailable = createSettlementPhoneticResolver({ async lookup() { throw Error('offline'); } });
await unavailable([word()]);

let batches = 0;
const poolResolver = createSettlementPhoneticResolver(null, { async lookupMany(words) {
  batches++;
  assert.deepEqual(words, ['effort', 'attempt']);
  return [{ word: 'effort', phonetic: "'efәt" }, { word: 'attempt', phonetic: "ә'tempt" }];
} });
const pooled = ['effort', 'attempt'].map(text => ({ ...word(), markedText: text }));
await poolResolver(pooled);
await poolResolver(['effort', 'attempt'].map(text => ({ ...word(), markedText: text })));
assert.equal(batches, 1, 'local pool lookups are batched and cached');
assert.equal(pooled[0].phonetic, '/ˈefət/');

const poolPath = path.join(fixture, 'pool.json');
fs.writeFileSync(poolPath, JSON.stringify({ candidates: [
  { lemma: 'effort', phonetic: "'efәt", priority: false },
  { lemma: 'attempt', phonetic: "ә'tempt", priority: true },
] }));
let handler;
createIeltsLearningPoolVitePlugin({ candidatesPath: poolPath }).configureServer({ middlewares: { use(value) { handler = value; } } });
function queryPool(url) {
  let result;
  handler({ url, method: 'GET' }, { setHeader() {}, end(value) { result = JSON.parse(value); } });
  return result;
}
assert.equal(queryPool('/api/vocabulary/ielts-learning-pool').items.length, 1, 'daily learning still uses only priority candidates');
assert.equal(queryPool('/api/vocabulary/ielts-learning-pool?phonetics=effort').items[0].word, 'effort', 'phonetics lookup includes non-priority dictionary entries');
assert.equal(queryPool('/api/vocabulary/ielts-learning-pool?phonetics=effort').schemaVersion, 'settlement-phonetics.v1');
assert.equal(queryPool('/api/vocabulary/ielts-learning-pool?phonetics=efforts').items.length, 0, 'no inflection inference for phonetic lookup');

assert.equal(getSettlementMeaningRefinementCandidates([word()], { automatic: true, includeMissingPhonetics: true }).length, 0, 'saved meanings do not trigger automatic AI work');
const template = buildSettlementMeaningRefinementTemplate({ candidates: [word(), phrase], sourceId: 'article', includeMissingPhonetics: true });
assert.equal(template.items.length, 1);
assert.equal(template.items[0].preserveSimpleMeaning, true);
assert.equal(template.items[0].requestPhonetic, true);
assert.equal(template.items[0].currentSimpleMeaning, '浮现');

const repo = createInMemoryArticleSrsSettlementProgressRepository();
await repo.recordRefinement('article', [word()]);
assert.equal((await repo.claimRefinementAttempt('article', [word()])).claimedTargetIds.length, 0, 'ordinary completed refinement claims remain idempotent');
const claim = await repo.claimRefinementAttempt('article', [word()], { includeMissingPhonetics: true });
assert.deepEqual(claim.claimedTargetIds, ['emerging']);
const pending = applyArticleSrsSettlementProgress({ candidates: [word()] }, claim.progress).candidates[0];
assert.equal(pending.refinement_phonetic_only, true);
assert.equal(isSettlementSimpleMeaningReady(pending), true, 'optional IPA work must not invalidate an already saved meaning');
applySettlementMeaningRefinementResult([pending], { items: [{ targetId: 'emerging', simpleMeaning: '不应覆盖', phonetic: '/ɪˈmɜːrdʒɪŋ/' }] });
assert.equal(pending.simple_meaning, '浮现');
const saved = await repo.recordRefinement('article', [pending], { claimToken: claim.claimToken });
const restored = applyArticleSrsSettlementProgress({ candidates: [word()] }, saved).candidates[0];
assert.equal(restored.phonetic, '/ɪˈmɜːrdʒɪŋ/');
assert.equal(restored.simple_meaning, '浮现');
assert.equal((await repo.claimRefinementAttempt('article', [restored], { includeMissingPhonetics: true })).claimedTargetIds.length, 0);

const localProgress = await repo.recordRefinement('dictionary-only', [local]);
assert.equal(localProgress.refinements[0].phonetic, null, 'ECDICT suggestions never enter durable refinement rows');
const missing = { ...word(), simple_meaning: '', context: { meaning: '逐渐出现', sentence: 'Details are emerging.' } };
applySettlementMeaningRefinementResult([missing, phrase], { items: [
  { targetId: 'emerging', simpleMeaning: '浮现', phonetic: 'https://wrong' },
  { targetId: 'phrase', simpleMeaning: '在前面', phonetic: '/ɪn frʌnt/' },
] });
assert.equal(missing.simple_meaning, '浮现');
assert.equal(missing.phonetic, undefined, 'invalid IPA cannot spoil a valid meaning');
assert.equal(phrase.phonetic, undefined, 'phrases never receive IPA labels');
console.log('PASS dictionary cache/failure, exact inflections, preserved meanings, IPA claims/persistence, phrase and invalid-output boundaries.');
