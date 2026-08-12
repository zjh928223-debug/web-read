import assert from 'node:assert/strict'
import {
  deriveEnglishLemmaCandidates,
  findEnglishInflectionInSentence,
  generateEnglishInflections,
  isEnglishInflectionOf,
} from '../src/services/vocabulary/english-inflection-match.mjs'
import { validatePreviewSentenceResult } from '../src/features/passage-preview/preview-sentence-target-validation.mjs'

assert.deepEqual(deriveEnglishLemmaCandidates('slates'), ['slate'])
assert.deepEqual(deriveEnglishLemmaCandidates('rates'), ['rate'])
assert.deepEqual(deriveEnglishLemmaCandidates('notes'), ['note'])
assert.ok(deriveEnglishLemmaCandidates('sanctuaries').includes('sanctuary'))
assert.ok(deriveEnglishLemmaCandidates('propping').includes('prop'))
assert.ok(deriveEnglishLemmaCandidates('gauges').includes('gauge'))
assert.equal(isEnglishInflectionOf('slates', 'slat'), false)
assert.equal(isEnglishInflectionOf('rates', 'rat'), false)
assert.equal(isEnglishInflectionOf('notes', 'not'), false)
assert.ok(generateEnglishInflections('rescue').includes('rescued'))
assert.equal(findEnglishInflectionInSentence('The survivors were rescued safely.', 'rescue'), 'rescued')

const validSlate = validatePreviewSentenceResult({ word: 'slates', lemma: 'slates', pos: 'noun' }, {
  status: 'ready',
  sentence: 'There were several slates missing from the roof.',
  matchedLemma: 'slate',
  primaryPartOfSpeech: 'noun',
})
assert.equal(validSlate.accepted, true)
assert.equal(validSlate.result.matchedForm, 'slates')

const wrongSlat = validatePreviewSentenceResult({ word: 'slates', lemma: 'slates', pos: 'noun' }, {
  status: 'ready',
  sentence: 'They peered through the slats.',
  matchedLemma: 'slat',
  primaryPartOfSpeech: 'noun',
})
assert.equal(wrongSlat.accepted, false)

const wrongMission = validatePreviewSentenceResult({ word: 'rescue', lemma: 'rescue' }, {
  status: 'ready',
  sentence: 'She succeeded in her mission of averting a strike.',
  matchedLemma: 'mission',
})
assert.equal(wrongMission.accepted, false)

const validRescue = validatePreviewSentenceResult({ word: 'rescue', lemma: 'rescue', pos: 'verb' }, {
  status: 'ready',
  sentence: 'The survivors were rescued by the Coast Guard.',
  matchedLemma: 'rescue',
  matchedPartOfSpeech: 'verb',
})
assert.equal(validRescue.accepted, true)
assert.equal(validRescue.result.matchedForm, 'rescued')

const validMassNoun = validatePreviewSentenceResult({ word: 'ventilation', lemma: 'ventilation', pos: 'mass noun' }, {
  status: 'ready',
  sentence: 'a room with good ventilation',
  matchedLemma: 'ventilation',
  matchedPartOfSpeech: 'noun',
})
assert.equal(validMassNoun.accepted, true)

const rejectedLongPreview = validatePreviewSentenceResult({ word: 'ventilation', lemma: 'ventilation' }, {
  status: 'ready',
  sentence: 'Modern teaching practices and mechanical means of ventilation all contribute to the number of children.',
  matchedLemma: 'ventilation',
})
assert.equal(rejectedLongPreview.accepted, false)

const staleStoredMission = validatePreviewSentenceResult({ word: 'rescue', lemma: 'rescue' }, {
  sentence: 'She succeeded in her mission of averting a strike.',
  matchedLemma: 'mission',
  source: { name: 'Merriam-Webster' },
})
assert.equal(staleStoredMission.accepted, false, 'an old persisted wrong-target sentence must expire')

const validStoredRescue = validatePreviewSentenceResult({ word: 'rescue', lemma: 'rescue' }, {
  sentence: 'Firefighters rescued the child.',
  matchedLemma: 'rescue',
  source: { name: 'Merriam-Webster' },
})
assert.equal(validStoredRescue.accepted, true)
assert.equal(validStoredRescue.result.status, 'ready')
assert.equal(validStoredRescue.result.matchedForm, 'rescued')

console.log('Preview target validation checks passed.')
