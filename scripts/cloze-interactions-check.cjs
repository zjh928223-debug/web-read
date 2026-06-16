const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const cardSource = fs.readFileSync(path.join(repoRoot, 'src', 'components', 'ClozeCard.vue'), 'utf8');
const quizSource = fs.readFileSync(path.join(repoRoot, 'src', 'components', 'ClozeQuizView.vue'), 'utf8');
const importModuleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'import-module.js'), 'utf8');
const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'cloze-interactions.js'), 'utf8');

assert.ok(cardSource.includes("from '../composables/cloze-interactions.js'"));
assert.ok(cardSource.includes('updateClozeDraftAnswer(cloze, props.index, e.target.value)'));
assert.equal(cardSource.includes('document.querySelector'), false, 'ClozeCard.vue should not query the DOM for answer input state');
assert.equal(cardSource.includes('window.'), false, 'ClozeCard.vue should not use window globals');

assert.ok(quizSource.includes("from '../composables/cloze-interactions.js'"));
assert.ok(quizSource.includes('buildClozeCards(items, state)'));
assert.ok(quizSource.includes('checkClozeStoreAnswer(cloze, index)'));
assert.equal(quizSource.includes('window.ClozeViewModelHelpers'), false, 'ClozeQuizView.vue should not use window cloze view-model helpers');
assert.equal(quizSource.includes('window.__clozeCheck'), false, 'ClozeQuizView.vue should not call the legacy cloze check facade');
assert.equal(quizSource.includes('window.'), false, 'ClozeQuizView.vue should not use window globals');

assert.ok(importModuleSource.includes("import { createClozeAnswerState, checkClozeAnswerState } from './cloze-interactions.js';"));
assert.ok(importModuleSource.includes('state.clozeAnswerState = createClozeAnswerState(state.clozeItems);'));
assert.ok(importModuleSource.includes('var result = checkClozeAnswerState({'));
assert.ok(importModuleSource.includes('window.__clozeCheck = handleClozeCheck;'), 'legacy cloze facade should remain until render facades are removed');

assert.ok(moduleSource.includes('export function buildClozeCards'));
assert.ok(moduleSource.includes('export function updateClozeDraftAnswer'));
assert.ok(moduleSource.includes('export function checkClozeAnswerState'));
assert.ok(moduleSource.includes('export function checkClozeStoreAnswer'));
assert.equal(moduleSource.includes('window.'), false, 'cloze interactions should not create or read window globals');
assert.equal(moduleSource.includes('document.'), false, 'cloze interactions should not read DOM globals');

console.log('cloze interactions check passed');
