const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const featureSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime.js'), 'utf8');
const playbackRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-playback-runtime.js'), 'utf8');
const componentSource = fs.readFileSync(path.join(repoRoot, 'src', 'components', 'TranscriptContainer.vue'), 'utf8');
const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'transcript-interactions.js'), 'utf8');

assert.ok(
  appSource.includes("import { initReaderFeatureRuntime } from './reader-feature-runtime.js';"),
  'reader-runtime should delegate transcript interactions through reader-feature-runtime'
);
assert.ok(
  featureSource.includes("import { initReaderInteractionRuntime } from './reader-interaction-runtime.js';"),
  'reader-feature-runtime should configure transcript interactions through reader interaction runtime'
);
assert.equal(
  appSource.includes("transcriptContainer.addEventListener('click'"),
  false,
  'app.js should not own normal transcript click listeners'
);
assert.equal(appSource.includes('configureTranscriptInteractions({'), false);
assert.ok(appSource.includes('transcriptContainer: transcriptContainer'));
assert.ok(playbackRuntimeSource.includes("import { configureTranscriptInteractions } from './transcript-interactions.js'"));
assert.ok(playbackRuntimeSource.includes('configureTranscriptInteractions({'));
assert.ok(playbackRuntimeSource.includes('legacyTranscriptContainer: deps.transcriptContainer'));

assert.ok(componentSource.includes("from '../composables/transcript-interactions.js'"));
assert.ok(componentSource.includes('handleTranscriptWordClick({ word: word, event: event, transcriptStore: ts })'));
assert.ok(componentSource.includes('handleTranscriptWordContextMenu({ word: word, event: event })'));
assert.equal(componentSource.includes('window.forceUpdateUI'), false);
assert.equal(componentSource.includes('window.notifyAnnotationBubbleWordClick'), false);
assert.equal(componentSource.includes("document.getElementById('audio-player')"), false);

assert.ok(moduleSource.includes('export function configureTranscriptInteractions'));
assert.ok(moduleSource.includes('export function handleTranscriptWordClick'));
assert.ok(moduleSource.includes('export function handleTranscriptWordContextMenu'));
assert.ok(moduleSource.includes("addEventListener('click'"));
assert.equal(moduleSource.includes('window.'), false, 'transcript interactions should not create or read window globals');

console.log('transcript interactions check passed');
