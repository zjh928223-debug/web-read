const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

const previewSource = read('src', 'composables', 'vocabulary-preview-module.js');
const previewStyles = read('styles.css');
const pronunciationSource = read('src', 'services', 'pronunciation', 'aria-american-pronunciation.js');
const videoSource = read('src', 'components', 'VideoPlayerFloat.vue');
const videoModuleSource = read('src', 'composables', 'media-source-module.js');

assert.match(previewSource, /previewButton\.addEventListener\('click', scanPreview\)/);
assert.match(previewSource, /vocabulary-preview-dialog__hint/);
assert.match(previewSource, /form\.append\(modelLabel, keyLabel, statusEl, dictionaryHint, listEl, footer\)/);
assert.match(previewSource, /expandedMeaningIds/);
assert.match(previewSource, /const isMeaningExpanded = .*expandedMeaningIds\.has\(targetId\)/);
assert.match(previewSource, /meaning\.hidden = !isMeaningExpanded/);
assert.match(previewSource, /let settlementOpening = false/);
assert.match(previewSource, /settlementDialog\.openLoading/);
assert.match(previewSource, /function updateSpeakingState/);
assert.match(previewSource, /正在加入/);
assert.match(previewSource, /addAllButton\.textContent =/);
assert.match(previewSource, /pronunciation\.prefetch/);
assert.match(pronunciationSource, /const audioCache = new Map\(\)/);
assert.match(pronunciationSource, /async function prefetch\(/);
assert.match(pronunciationSource, /waitForAudioReady/);
assert.match(previewStyles, /\.vocabulary-preview-dialog\s*\{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\)/);
assert.match(previewStyles, /\.vocabulary-preview-dialog__form\s*\{[\s\S]*?overflow: hidden/);
assert.match(previewStyles, /\.vocabulary-preview-dialog__list\s*\{[\s\S]*?max-height: none/);
assert.match(videoSource, /avoidReaderControls/);
assert.match(videoModuleSource, /previous default was top-right/);

console.log('vocabulary preview UI check passed');
