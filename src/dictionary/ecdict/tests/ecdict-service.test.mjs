import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createEcdictService } from '../application/ecdict-service.mjs';

const moduleRoot = fileURLToPath(new URL('..', import.meta.url));
const buildScript = join(moduleRoot, 'scripts', 'build-ecdict-database.py');
let fixtureDirectory;
let databasePath;

before(() => {
  fixtureDirectory = mkdtempSync(join(tmpdir(), 'ecdict-test-'));
  const csvPath = join(fixtureDirectory, 'ecdict.csv');
  const lemmaPath = join(fixtureDirectory, 'lemma.en.txt');
  databasePath = join(fixtureDirectory, 'ecdict.sqlite');

  writeFileSync(csvPath, [
    'word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio',
    'look,lʊk,to direct your eyes,看,v:80/n:20,5,1,cet4 zk,100,120,p:looked/d:looked,,',
    'cant,kænt,insincere talk,黑话,n:100,0,0,,10000,9000,,,',
    `"can't",kɑːnt,cannot,不能,,5,1,cet4,500,400,,,`,
    'long-time,,lasting a long time,长期的,adj,0,0,,20000,18000,,,',
    'long time,,a considerable period,很久,n,0,0,,21000,19000,,,',
    'give,ɡɪv,to transfer,给,v:100,5,1,cet4,50,40,p:gave/d:given,,',
    'tooth,tuːθ,a hard structure,牙齿,n:100,4,1,cet4,5000,3000,s:teeth,,',
    'left,left,remaining or direction,左边的,adj:50/n:50,4,1,cet4,200,170,,,',
    'leave,liːv,to depart,离开,v:100,5,1,cet4,80,70,p:left/d:left,,',
    'saw,sɔː,a cutting tool,锯,n:100,4,1,cet4,3000,2500,,,',
    'see,siː,to perceive,看见,v:100,5,1,cet4,60,50,p:saw/d:seen,,',
    'found,faʊnd,to establish,建立,v:100,5,1,cet4,150,130,,,',
    'find,faɪnd,to discover,发现,v:100,5,1,cet4,70,60,p:found/d:found,,',
    'better,betə,of higher quality,更好的,adj:80/adv:20,5,1,cet4,90,80,,,',
    'good,ɡʊd,of high quality,好的,adj:100,5,1,cet4,40,30,r:better/t:best,,',
    'well,wel,in a good way,很好地,adv:100,5,1,cet4,35,25,r:better/t:best,,',
    'run into,,to meet unexpectedly,偶遇,phr,0,0,,15000,12000,,,',
  ].join('\n'), 'utf8');

  writeFileSync(lemmaPath, [
    'look -> looked',
    'give -> gave',
    'tooth -> teeth',
    'leave -> left',
    'see -> saw',
    'find -> found',
    'good -> better',
    'well -> better',
  ].join('\n'), 'utf8');

  const build = spawnSync('python', [
    buildScript,
    '--csv', csvPath,
    '--lemma', lemmaPath,
    '--database', databasePath,
  ], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr || build.stdout);
});

after(() => {
  rmSync(fixtureDirectory, { recursive: true, force: true });
});

test('returns a case-insensitive exact match through the public service', async () => {
  const service = createEcdictService({ enabled: true, databasePath });
  const result = await service.lookup('LOOK');

  assert.equal(result.available, true);
  assert.equal(result.matchedBy, 'exact');
  assert.equal(result.directMatch.word, 'look');
  assert.deepEqual(result.directMatch.tags, ['cet4', 'zk']);
  assert.equal(result.directMatch.oxford, true);
  service.close();
});

test('returns every normalized collision without silently choosing one', async () => {
  const service = createEcdictService({ enabled: true, databasePath });
  const result = await service.lookup('C-A-N-T');

  assert.equal(result.matchedBy, 'normalized');
  assert.equal(result.directMatch, null);
  assert.deepEqual(
    result.normalizedCandidates.map((entry) => entry.word),
    ["can't", 'cant'],
  );
  service.close();
});

test('returns all lemma candidates and preserves an ambiguous direct match', async () => {
  const service = createEcdictService({ enabled: true, databasePath });
  const looked = await service.lookup('looked');
  const better = await service.lookup('better');

  assert.equal(looked.matchedBy, 'lemma');
  assert.deepEqual(
    looked.lemmaCandidates.map(({ lemma, entry }) => [lemma, entry.word]),
    [['look', 'look']],
  );
  assert.equal(better.matchedBy, 'exact');
  assert.equal(better.directMatch.word, 'better');
  assert.deepEqual(
    better.lemmaCandidates.map(({ lemma }) => lemma),
    ['good', 'well'],
  );
  assert.equal(better.lemmaCandidates[1].entry.word, 'well');
  service.close();
});

test('handles the required word, phrase, empty, punctuation, and missing cases', async () => {
  const service = createEcdictService({ enabled: true, databasePath });
  const expectations = new Map([
    ['look', 'exact'],
    ['LOOK', 'exact'],
    ['looked', 'lemma'],
    ['gave', 'lemma'],
    ['teeth', 'lemma'],
    ['left', 'exact'],
    ['saw', 'exact'],
    ['found', 'exact'],
    ['better', 'exact'],
    ['long-time', 'exact'],
    ["can't", 'exact'],
    ['cant', 'exact'],
    ['run into', 'exact'],
    ['take for granted', 'none'],
    ['一个不存在的字符串', 'none'],
    ['', 'none'],
    ['!!!', 'none'],
  ]);

  for (const [query, matchedBy] of expectations) {
    const result = await service.lookup(query);
    assert.equal(result.available, true, query);
    assert.equal(result.matchedBy, matchedBy, query);
  }
  assert.deepEqual(
    (await service.lookup('longtime')).normalizedCandidates.map(({ word }) => word),
    ['long time', 'long-time'],
  );
  for (const [form, lemma] of [
    ['left', 'leave'],
    ['saw', 'see'],
    ['found', 'find'],
  ]) {
    const ambiguous = await service.lookup(form);
    assert.equal(ambiguous.directMatch.word, form);
    assert.ok(ambiguous.lemmaCandidates.some((candidate) => candidate.lemma === lemma));
  }
  const missingPhrase = await service.lookup('take for granted');
  assert.equal(missingPhrase.directMatch, null);
  assert.deepEqual(missingPhrase.normalizedCandidates, []);
  assert.deepEqual(missingPhrase.lemmaCandidates, []);
  service.close();
});

test('stays lazy while disabled and isolates unavailable or corrupt databases', async () => {
  let repositoryInitializations = 0;
  const disabled = createEcdictService({
    enabled: false,
    databasePath: join(fixtureDirectory, 'missing.sqlite'),
    repositoryFactory() {
      repositoryInitializations += 1;
      throw new Error('must not initialize');
    },
  });
  assert.equal((await disabled.lookup('look')).errorCode, 'ECDICT_DISABLED');
  assert.equal(repositoryInitializations, 0);

  const missing = createEcdictService({
    enabled: true,
    databasePath: join(fixtureDirectory, 'missing.sqlite'),
  });
  assert.equal(
    (await missing.lookup('look')).errorCode,
    'ECDICT_DATABASE_UNAVAILABLE',
  );

  const corruptPath = join(fixtureDirectory, 'corrupt.sqlite');
  writeFileSync(corruptPath, 'not a SQLite database', 'utf8');
  const corrupt = createEcdictService({ enabled: true, databasePath: corruptPath });
  assert.equal(
    (await corrupt.lookup('look')).errorCode,
    'ECDICT_DATABASE_INVALID',
  );

  const failing = createEcdictService({
    enabled: true,
    databasePath,
    repositoryFactory() {
      return {
        findExact() {
          throw new Error('synthetic query failure');
        },
        close() {},
      };
    },
  });
  assert.equal((await failing.lookup('look')).errorCode, 'ECDICT_QUERY_FAILED');
  failing.close();
});
