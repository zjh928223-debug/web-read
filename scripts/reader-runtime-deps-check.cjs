const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
  const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
  const contextSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-context.js'), 'utf8');
  const bootstrapSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-bootstrap-runtime.js'), 'utf8');
  const featureDepsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime-deps.js'), 'utf8');
  const depsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-deps.js'), 'utf8');
  const sessionInitSource = [
  'session-runtime-assembly.js',
  'session-restore-runtime.js',
  'session-startup-runtime.js',
  'session-startup-cleanup.js',
  'session-ui-settings-restore.js',
  'session-annotation-api-settings-runtime.js',
  'session-annotation-context.js',
  'session-annotation-generated-index.js',
  'session-annotation-marks.js',
  'session-annotation-lightweight-io.js',
  'session-annotation-export-payload.js',
  'session-annotation-import-normalization.js',
  'session-annotation-bundle-merge.js',
  'session-annotation-text.js'
].map((file) => fs.readFileSync(path.join(repoRoot, 'src', 'composables', file), 'utf8')).join('\n');

  assert.ok(
    runtimeSource.includes("import { initReaderRuntimeAssembly } from './reader-runtime-assembly.js';"),
    'reader-runtime should delegate utility globals through reader runtime assembly'
  );
  assert.ok(
    assemblySource.includes("import { initReaderRuntimeContext } from './reader-runtime-context.js';"),
    'reader-runtime-assembly should collect utility globals through reader runtime context'
  );
  assert.ok(
    contextSource.includes("import { initReaderBootstrapRuntime } from './reader-bootstrap-runtime.js';"),
    'reader-runtime-context should collect utility globals through reader bootstrap runtime'
  );
  assert.ok(
    featureDepsSource.includes('var runtimeDeps = bootstrapRuntime.runtimeDeps;'),
    'reader-feature-runtime-deps should receive collected utility deps from the bootstrap module'
  );
  assert.ok(
    bootstrapSource.includes("import { collectReaderRuntimeDeps } from './reader-runtime-deps.js';"),
    'reader-bootstrap-runtime should import runtime dependency collector'
  );
  assert.ok(
    bootstrapSource.includes('var runtimeDeps = collectReaderRuntimeDeps({'),
    'reader-bootstrap-runtime should collect utility globals through the dependency module'
  );

  [
    'window.DataUtils',
    'window.PlaybackIndexHelpers',
    'window.ChunkMatchingHelpers',
    'window.VocabMatchingHelpers',
    'window.IdentityStorageKeys.buildAudioKey',
    'window.ImportExportSharedHelpers.getFirstFileFromEvent'
  ].forEach((pattern) => {
    assert.equal(
      runtimeSource.includes(pattern),
      false,
      `reader-runtime should not directly read helper global: ${pattern}`
    );
  });

  [
    'isFiniteNum',
    'normalizeLooseKey',
    'getLooseProp',
    'looksLikeSegmentArray',
    'clampHelper',
    'findExactMatchHelper',
    'adjustIndexHelper',
    'scoreMatchCandidateHelper',
    'normalizeChunkCandidateBoundsHelper',
    'buildChunkCandidateVariantsHelper',
    'buildChunkMatchWindowHelper',
    'clampChunkMatchCandidateHelper',
    'buildChunkCandidateEndWindowHelper',
    'getChunkCandidateBoundaryWordsHelper',
    'normalizeChunkMatchCandidateHelper'
  ].forEach((pattern) => {
    assert.equal(
      runtimeSource.includes(pattern),
      false,
      `reader-runtime should not keep unused helper alias: ${pattern}`
    );
  });

  assert.ok(depsSource.includes('export function collectReaderRuntimeDeps'), 'dependency collector should export collectReaderRuntimeDeps');
  assert.equal(depsSource.includes('window.'), false, 'dependency collector should receive window through explicit deps');
  assert.equal(depsSource.includes('document.'), false, 'dependency collector should not read document globals');

  [
    'applyCurrentAudioMeta(audioMeta);',
    'await deps.loadChunkNotesForCurrentAudio();',
    'await deps.loadSentenceNotesForCurrentAudio();',
    'await deps.switchSentenceNotesDoc(transcriptData);'
  ].forEach((pattern) => {
    assert.ok(sessionInitSource.includes(pattern), `session-init contract should remain intact: ${pattern}`);
  });

  const calls = [];
  const transcriptState = { segments: [{ text: 'existing' }] };
  const fakeWindow = {
    DataUtils: {
      isPlainObjectRecord: (value) => value && typeof value === 'object',
      validateVisualData: (value) => ({ type: 'visual', value }),
      validateChunkData: (value) => ({ type: 'chunk', value }),
      validateMarksArray: (value) => ({ type: 'marks', value }),
      validateTranscriptData(value, segments) {
        calls.push({ name: 'validateTranscriptData', value, segments });
        return { type: 'transcript', value, segments };
      }
    },
    PlaybackIndexHelpers: {
      findChunkIndexByTime: () => 'chunk-index',
      bsFindActive: () => 'active',
      getCurrentSegmentIndex: () => 'segment-index',
      getSegmentCheckpoints: () => 'checkpoints'
    },
    ChunkMatchingHelpers: {
      cleanText: (value) => `clean:${value}`,
      tokenizeText: (value) => [`token:${value}`],
      findExactMatchRange: () => [1, 2]
    },
    VocabMatchingHelpers: {
      buildVocabMatchMap: () => new Map([[1, 'vocab']])
    },
    IdentityStorageKeys: {
      buildAudioKey: () => 'audio-key',
      getChunkNotesStorageKey: () => 'chunk-notes-key',
      getChunkNoteDraftStorageKey: () => 'chunk-note-draft-key',
      getSentenceNotesStorageKey: () => 'sentence-notes-key',
      getLegacySentenceNotesStorageKey: () => 'legacy-sentence-notes-key',
      buildCurrentSentenceDocId: () => 'sentence-doc-id'
    },
    ImportExportSharedHelpers: {
      buildCurrentAudioMetaState: () => ({ name: 'audio' }),
      getCurrentAudioFilenameBase: () => 'lesson',
      getFirstFileFromEvent: () => ({ name: 'file.json' }),
      markFileLoaded: () => 'loaded',
      readFileAsText: () => 'text'
    }
  };

  const encodedSource = Buffer.from(depsSource, 'utf8').toString('base64');
  const { collectReaderRuntimeDeps } = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);
  const deps = collectReaderRuntimeDeps({
    transcriptState,
    getWindow: () => fakeWindow
  });

  assert.equal(deps.isPlainObjectRecord({}), true);
  assert.deepEqual(deps.validateVisualData({ ok: true }), { type: 'visual', value: { ok: true } });
  assert.deepEqual(deps.validateChunkData([{ text: 'chunk' }]), { type: 'chunk', value: [{ text: 'chunk' }] });
  assert.deepEqual(deps.validateMarksArray([1]), { type: 'marks', value: [1] });
  assert.deepEqual(deps.validateTranscriptData({ transcript: true }), {
    type: 'transcript',
    value: { transcript: true },
    segments: transcriptState.segments
  });
  assert.equal(calls[0].segments, transcriptState.segments, 'transcript validation should use injected transcript state');
  assert.equal(deps.findChunkIndexByTimeHelper(), 'chunk-index');
  assert.equal(deps.bsFindActiveHelper(), 'active');
  assert.equal(deps.getCurrentSegmentIndexHelper(), 'segment-index');
  assert.equal(deps.getSegmentCheckpointsHelper(), 'checkpoints');
  assert.equal(deps.cleanTextHelper('A'), 'clean:A');
  assert.deepEqual(deps.tokenizeTextHelper('B'), ['token:B']);
  assert.deepEqual(deps.findExactMatchRangeHelper(), [1, 2]);
  assert.deepEqual(Array.from(deps.buildVocabMatchMapHelper()), [[1, 'vocab']]);
  assert.equal(deps.buildAudioKey(), 'audio-key');
  assert.equal(deps.getChunkNotesStorageKey(), 'chunk-notes-key');
  assert.equal(deps.getChunkNoteDraftStorageKey(), 'chunk-note-draft-key');
  assert.equal(deps.getSentenceNotesStorageKey(), 'sentence-notes-key');
  assert.equal(deps.getLegacySentenceNotesStorageKey(), 'legacy-sentence-notes-key');
  assert.equal(deps.buildCurrentSentenceDocId(), 'sentence-doc-id');
  assert.deepEqual(deps.buildCurrentAudioMetaState(), { name: 'audio' });
  assert.equal(deps.getCurrentAudioFilenameBase(), 'lesson');
  assert.deepEqual(deps.getFirstFileFromEvent(), { name: 'file.json' });
  assert.equal(deps.markFileLoaded(), 'loaded');
  assert.equal(deps.readFileAsText(), 'text');

  console.log('reader runtime deps check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
