const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
  const bootstrapSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-bootstrap-runtime.js'), 'utf8');
  const notesRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-notes-runtime.js'), 'utf8');
  const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'audio-identity-module.js'), 'utf8');
  const sessionRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-session-runtime.js'), 'utf8');
  const bindingsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'runtime-state-bindings.js'), 'utf8');
  const sessionInitSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');

  assert.ok(
    runtimeSource.includes("import { initReaderBootstrapRuntime } from './reader-bootstrap-runtime.js';"),
    'reader-runtime should initialize audio identity through reader bootstrap runtime'
  );
  assert.ok(
    runtimeSource.includes('var audioIdentityApi = bootstrapRuntime.audioIdentityApi;'),
    'reader-runtime should receive audio identity API from bootstrap runtime'
  );
  assert.equal(
    runtimeSource.includes("import { initAudioIdentity } from './audio-identity-module.js';"),
    false,
    'reader-runtime should not import audio identity module directly'
  );
  assert.equal(
    runtimeSource.includes('var audioIdentityApi = initAudioIdentity({'),
    false,
    'reader-runtime should not initialize audio identity directly'
  );
  assert.ok(
    bootstrapSource.includes("import { initAudioIdentity } from './audio-identity-module.js';"),
    'reader-bootstrap-runtime should import audio identity module'
  );
  assert.ok(
    bootstrapSource.includes('var audioIdentityApi = initAudioIdentity({'),
    'reader-bootstrap-runtime should initialize audio identity through the module'
  );
  assert.ok(
    bindingsSource.includes("defineRuntimeStateBinding(runtimeState, 'currentAudioMeta', () => audioIdentityApi.currentAudioMeta"),
    'runtimeState.currentAudioMeta should read from audio identity module'
  );
  assert.ok(
    bindingsSource.includes("defineRuntimeStateBinding(runtimeState, 'currentAudioKey', () => audioIdentityApi.currentAudioKey"),
    'runtimeState.currentAudioKey should read from audio identity module'
  );
  assert.ok(
    runtimeSource.includes("import { initReaderSessionRuntime } from './reader-session-runtime.js';"),
    'reader-runtime should initialize audio identity session wrappers through reader-session-runtime'
  );
  assert.ok(
    runtimeSource.includes('var applyCurrentAudioMeta = sessionRuntime.applyCurrentAudioMeta;'),
    'reader-runtime should receive applyCurrentAudioMeta from reader-session-runtime'
  );
  assert.ok(
    sessionRuntimeSource.includes('const nextAudioState = audioIdentityApi.applyCurrentAudioMeta(meta);'),
    'applyCurrentAudioMeta wrapper should delegate state changes to audio identity module'
  );
  assert.ok(
    sessionRuntimeSource.includes('chunkNotesApi.setChunkNoteDraftRestoreDone(nextAudioState.chunkNoteDraftRestoreDone);'),
    'applyCurrentAudioMeta wrapper should preserve chunk note draft restore side effect'
  );

  [
    'let currentAudioMeta',
    'let currentAudioKey',
    'var __cak',
    'const buildAudioKey',
    'const buildTranscriptKey',
    'const getChunkNotesStorageKey = audioIdentityApi.getChunkNotesStorageKey',
    'const getChunkNoteDraftStorageKey = audioIdentityApi.getChunkNoteDraftStorageKey',
    'const getSentenceNotesStorageKey = audioIdentityApi.getSentenceNotesStorageKey',
    'const getLegacySentenceNotesStorageKey = audioIdentityApi.getLegacySentenceNotesStorageKey',
    'const buildCurrentSentenceDocId = audioIdentityApi.buildCurrentSentenceDocId',
    'const getCurrentAudioFilenameBase = audioIdentityApi.getCurrentAudioFilenameBase',
    'window.IdentityStorageKeys.getChunkNotesStorageKey(currentAudioKey)',
    'window.IdentityStorageKeys.buildCurrentSentenceDocId(transcriptSource, currentAudioKey'
  ].forEach((pattern) => {
    assert.equal(
      runtimeSource.includes(pattern),
      false,
      `reader-runtime should not own audio identity state/helper: ${pattern}`
    );
  });

  [
    'audioIdentityApi: audioIdentityApi',
    'var sessionRuntime = initReaderSessionRuntime({'
  ].forEach((pattern) => {
    assert.ok(
      runtimeSource.includes(pattern),
      `reader-runtime should pass audio identity API through focused runtime modules: ${pattern}`
    );
  });

  [
    'getChunkNotesStorageKey: deps.audioIdentityApi.getChunkNotesStorageKey',
    'getChunkNoteDraftStorageKey: deps.audioIdentityApi.getChunkNoteDraftStorageKey',
    'getSentenceNotesStorageKey: deps.audioIdentityApi.getSentenceNotesStorageKey',
    'getLegacySentenceNotesStorageKey: deps.audioIdentityApi.getLegacySentenceNotesStorageKey',
    'buildCurrentSentenceDocId: deps.audioIdentityApi.buildCurrentSentenceDocId'
  ].forEach((pattern) => {
    assert.ok(
      notesRuntimeSource.includes(pattern),
      `reader-notes-runtime should inject audio identity API directly: ${pattern}`
    );
  });

  [
    'export function initAudioIdentity',
    'function applyCurrentAudioMeta(meta)',
    'function getChunkNotesStorageKey()',
    'function getChunkNoteDraftStorageKey()',
    'function buildCurrentSentenceDocId(transcriptSource = null)'
  ].forEach((pattern) => {
    assert.ok(
      moduleSource.includes(pattern),
      `audio-identity module should own ${pattern}`
    );
  });

  [
    'applyCurrentAudioMeta(audioMeta);',
    'applyCurrentAudioMeta({ name: audioBlob.name',
    'currentAudioKey: st.currentAudioKey'
  ].forEach((pattern) => {
    assert.ok(
      sessionInitSource.includes(pattern),
      `session-init audio identity contract should remain intact: ${pattern}`
    );
  });

  const encodedSource = Buffer.from(moduleSource, 'utf8').toString('base64');
  const { initAudioIdentity } = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);

  const segments = [{ id: 's1' }];
  const api = initAudioIdentity({
    buildAudioKey(meta) {
      return meta && meta.name ? `audio::${meta.name}` : 'default-audio';
    },
    buildCurrentAudioMetaState(meta, buildAudioKey) {
      return {
        currentAudioMeta: meta ? { ...meta, normalized: true } : null,
        currentAudioKey: buildAudioKey(meta),
        chunkNoteDraftRestoreDone: false
      };
    },
    getCurrentAudioFilenameBase(meta, fallback) {
      return meta && meta.name ? meta.name.replace(/\.[^.]+$/, '') : fallback;
    },
    getChunkNotesStorageKey(audioKey) {
      return `chunkNotes::${audioKey}`;
    },
    getChunkNoteDraftStorageKey(audioKey) {
      return `chunkDraft::${audioKey}`;
    },
    getSentenceNotesStorageKey() {
      return 'sentenceNotes::current';
    },
    getLegacySentenceNotesStorageKey(audioKey) {
      return `legacySentenceNotes::${audioKey}`;
    },
    buildCurrentSentenceDocId(transcriptSource, audioKey, fallbackSegments) {
      return JSON.stringify({
        source: transcriptSource && transcriptSource.id ? transcriptSource.id : null,
        audioKey,
        segmentCount: fallbackSegments.length
      });
    },
    getSegments: () => segments
  });

  assert.equal(api.currentAudioKey, 'default-audio');
  assert.equal(api.currentAudioMeta, null);
  assert.equal(api.getChunkNotesStorageKey(), 'chunkNotes::default-audio');

  const next = api.applyCurrentAudioMeta({ name: 'lesson-one.mp3', size: 10 });
  assert.deepEqual(next, {
    currentAudioMeta: { name: 'lesson-one.mp3', size: 10, normalized: true },
    currentAudioKey: 'audio::lesson-one.mp3',
    chunkNoteDraftRestoreDone: false
  });
  assert.deepEqual(api.currentAudioMeta, { name: 'lesson-one.mp3', size: 10, normalized: true });
  assert.equal(api.currentAudioKey, 'audio::lesson-one.mp3');
  assert.equal(api.getCurrentAudioFilenameBase('fallback'), 'lesson-one');
  assert.equal(api.getChunkNotesStorageKey(), 'chunkNotes::audio::lesson-one.mp3');
  assert.equal(api.getChunkNoteDraftStorageKey(), 'chunkDraft::audio::lesson-one.mp3');
  assert.equal(api.getSentenceNotesStorageKey(), 'sentenceNotes::current');
  assert.equal(api.getLegacySentenceNotesStorageKey(), 'legacySentenceNotes::audio::lesson-one.mp3');
  assert.equal(
    api.buildCurrentSentenceDocId({ id: 'transcript-a' }),
    JSON.stringify({ source: 'transcript-a', audioKey: 'audio::lesson-one.mp3', segmentCount: 1 })
  );

  api.setCurrentAudioMeta({ name: 'manual.wav' });
  api.setCurrentAudioKey('manual-key');
  assert.deepEqual(api.currentAudioMeta, { name: 'manual.wav' });
  assert.equal(api.currentAudioKey, 'manual-key');
  assert.equal(api.getCurrentAudioFilenameBase('fallback'), 'manual');
  assert.equal(api.getLegacySentenceNotesStorageKey(), 'legacySentenceNotes::manual-key');
}

main().then(() => {
  console.log('audio identity module check passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
