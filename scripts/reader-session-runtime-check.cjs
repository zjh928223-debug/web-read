const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
  const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-session-runtime.js'), 'utf8');
  const sessionInitSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');

  assert.ok(
    runtimeSource.includes("import { initReaderSessionRuntime } from './reader-session-runtime.js';"),
    'reader-runtime should import reader session runtime'
  );
  assert.ok(
    runtimeSource.includes('var sessionRuntime = initReaderSessionRuntime({'),
    'reader-runtime should initialize session lifecycle wrappers through the module'
  );
  [
    'var loadChunkNotesForCurrentAudio = sessionRuntime.loadChunkNotesForCurrentAudio;',
    'var setChunkNoteVisible = sessionRuntime.setChunkNoteVisible;',
    'var loadSentenceNotesForCurrentAudio = sessionRuntime.loadSentenceNotesForCurrentAudio;',
    'var switchSentenceNotesDoc = sessionRuntime.switchSentenceNotesDoc;',
    'var applyCurrentAudioMeta = sessionRuntime.applyCurrentAudioMeta;'
  ].forEach((pattern) => {
    assert.ok(runtimeSource.includes(pattern), `reader-runtime should keep local injection binding: ${pattern}`);
  });

  [
    'async function loadChunkNotesForCurrentAudio()',
    'function setChunkNoteVisible(next, persist)',
    'async function loadSentenceNotesForCurrentAudio()',
    'async function switchSentenceNotesDoc(transcriptSource)',
    'function applyCurrentAudioMeta(meta)',
    'const nextAudioState = audioIdentityApi.applyCurrentAudioMeta(meta);',
    '_cnApi.setChunkNoteDraftRestoreDone(nextAudioState.chunkNoteDraftRestoreDone);'
  ].forEach((pattern) => {
    assert.equal(
      runtimeSource.includes(pattern),
      false,
      `reader-runtime should not own session lifecycle wrapper body: ${pattern}`
    );
  });

  [
    'export function initReaderSessionRuntime',
    'async function loadChunkNotesForCurrentAudio()',
    'function setChunkNoteVisible(next, persist)',
    'async function loadSentenceNotesForCurrentAudio()',
    'async function switchSentenceNotesDoc(transcriptSource)',
    'function applyCurrentAudioMeta(meta)',
    'const nextAudioState = audioIdentityApi.applyCurrentAudioMeta(meta);',
    'chunkNotesApi.setChunkNoteDraftRestoreDone(nextAudioState.chunkNoteDraftRestoreDone);'
  ].forEach((pattern) => {
    assert.ok(moduleSource.includes(pattern), `reader-session-runtime should own ${pattern}`);
  });
  assert.equal(moduleSource.includes('window.'), false, 'reader-session-runtime should not read or write window globals');
  assert.equal(moduleSource.includes('document.'), false, 'reader-session-runtime should not read document globals');

  [
    'setChunkNoteVisible(_ns.chunkNoteVisible, false);',
    'applyCurrentAudioMeta(audioMeta);',
    'await loadChunkNotesForCurrentAudio();',
    'await loadSentenceNotesForCurrentAudio();',
    'await switchSentenceNotesDoc(transcriptData);',
    'processTranscript(transcriptData);',
    'processChunkData(chunkData);',
    'window.toggleChunkMode(true);',
    'bridgeToPinia();'
  ].forEach((pattern) => {
    assert.ok(sessionInitSource.includes(pattern), `session-init contract should remain intact: ${pattern}`);
  });

  const encodedSource = Buffer.from(moduleSource, 'utf8').toString('base64');
  const { initReaderSessionRuntime } = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);

  const calls = [];
  const audioState = { currentAudioKey: 'lesson-key', chunkNoteDraftRestoreDone: false };
  const api = initReaderSessionRuntime({
    chunkNotesApi: {
      loadChunkNotesForCurrentAudio() {
        calls.push('load-chunk');
        return Promise.resolve('chunk-notes');
      },
      setChunkNoteVisible(next, persist) {
        calls.push(['visible', next, persist]);
        return 'visible-result';
      },
      setChunkNoteDraftRestoreDone(value) {
        calls.push(['draft-done', value]);
      }
    },
    sentenceNotesApi: {
      loadSentenceNotesForCurrentAudio() {
        calls.push('load-sentence');
        return Promise.resolve('sentence-notes');
      },
      switchSentenceNotesDoc(transcriptSource) {
        calls.push(['switch-doc', transcriptSource]);
        return Promise.resolve('doc-result');
      }
    },
    audioIdentityApi: {
      applyCurrentAudioMeta(meta) {
        calls.push(['audio-meta', meta]);
        return { ...audioState, currentAudioMeta: meta };
      }
    }
  });

  assert.equal(await api.loadChunkNotesForCurrentAudio(), 'chunk-notes');
  assert.equal(api.setChunkNoteVisible(true, false), 'visible-result');
  assert.equal(await api.loadSentenceNotesForCurrentAudio(), 'sentence-notes');
  assert.equal(await api.switchSentenceNotesDoc({ id: 'transcript-a' }), 'doc-result');
  assert.deepEqual(api.applyCurrentAudioMeta({ name: 'lesson.mp3' }), {
    currentAudioKey: 'lesson-key',
    chunkNoteDraftRestoreDone: false,
    currentAudioMeta: { name: 'lesson.mp3' }
  });
  assert.deepEqual(calls, [
    'load-chunk',
    ['visible', true, false],
    'load-sentence',
    ['switch-doc', { id: 'transcript-a' }],
    ['audio-meta', { name: 'lesson.mp3' }],
    ['draft-done', false]
  ]);

  const noDraftApi = initReaderSessionRuntime({
    chunkNotesApi: {
      loadChunkNotesForCurrentAudio() {},
      setChunkNoteVisible() {}
    },
    sentenceNotesApi: {
      loadSentenceNotesForCurrentAudio() {},
      switchSentenceNotesDoc() {}
    },
    audioIdentityApi: {
      applyCurrentAudioMeta() {
        return { chunkNoteDraftRestoreDone: true };
      }
    }
  });
  assert.deepEqual(noDraftApi.applyCurrentAudioMeta(), { chunkNoteDraftRestoreDone: true });

  console.log('reader session runtime check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
