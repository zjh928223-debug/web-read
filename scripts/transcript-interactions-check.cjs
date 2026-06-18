const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const componentSource = fs.readFileSync(path.join(repoRoot, 'src', 'components', 'TranscriptContainer.vue'), 'utf8');
const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'transcript-interactions.js'), 'utf8');

assert.ok(
  appSource.includes("import { configureTranscriptInteractions } from './transcript-interactions.js';"),
  'app.js should configure transcript interactions through the module'
);
assert.equal(
  appSource.includes("transcriptContainer.addEventListener('click'"),
  false,
  'app.js should not own normal transcript click listeners'
);
assert.ok(appSource.includes('configureTranscriptInteractions({'));
assert.ok(appSource.includes('legacyTranscriptContainer: transcriptContainer'));

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
