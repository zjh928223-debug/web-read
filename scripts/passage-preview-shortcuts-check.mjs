import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const source = await fs.readFile(new URL('../src/features/passage-preview/passage-preview-shortcuts.js', import.meta.url), 'utf8')
const shortcutsModule = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const {
  DEFAULT_PASSAGE_PREVIEW_SHORTCUTS,
  DEFAULT_PASSAGE_PREVIEW_TRANSLATION_DISPLAY_MODE,
  PASSAGE_PREVIEW_SHORTCUTS_KEY,
  PASSAGE_PREVIEW_TRANSLATION_SHORTCUT_KEY,
  PASSAGE_PREVIEW_TRANSLATION_DISPLAY_MODES,
  formatPassagePreviewShortcut,
  isEditableKeyboardTarget,
  loadPassagePreviewShortcuts,
  loadPassagePreviewTranslationDisplayMode,
  passagePreviewActionForKeyboardEvent,
  savePassagePreviewShortcut,
  savePassagePreviewShortcuts,
  savePassagePreviewTranslationDisplayMode,
  shortcutFromKeyboardEvent,
} = shortcutsModule

const storage = createMemoryStorage()
assert.deepEqual(loadPassagePreviewShortcuts(storage), DEFAULT_PASSAGE_PREVIEW_SHORTCUTS)

assert.equal(savePassagePreviewShortcut('wordAudio', 'q', storage), 'q')
assert.equal(savePassagePreviewShortcut('sentenceAudio', 'q', storage), false)
assert.equal(savePassagePreviewShortcut('unknown', 'w', storage), false)
assert.deepEqual(loadPassagePreviewShortcuts(storage), {
  ...DEFAULT_PASSAGE_PREVIEW_SHORTCUTS,
  wordAudio: 'q',
})

assert.equal(savePassagePreviewShortcuts({
  revealContent: 'f',
  wordAudio: 'q',
  sentenceAudio: 'w',
  translation: 'e',
  previousItem: 'a',
  nextItem: 'd',
}, storage).nextItem, 'd')
assert.equal(passagePreviewActionForKeyboardEvent(keyEvent('KeyF', 'f'), loadPassagePreviewShortcuts(storage)), 'revealContent')
assert.equal(passagePreviewActionForKeyboardEvent(keyEvent('KeyQ', 'q'), loadPassagePreviewShortcuts(storage)), 'wordAudio')
assert.equal(passagePreviewActionForKeyboardEvent(keyEvent('KeyW', 'w'), loadPassagePreviewShortcuts(storage)), 'sentenceAudio')
assert.equal(passagePreviewActionForKeyboardEvent(keyEvent('KeyE', 'e'), loadPassagePreviewShortcuts(storage)), 'translation')
assert.equal(passagePreviewActionForKeyboardEvent(keyEvent('KeyA', 'a'), loadPassagePreviewShortcuts(storage)), 'previousItem')
assert.equal(passagePreviewActionForKeyboardEvent(keyEvent('KeyD', 'd'), loadPassagePreviewShortcuts(storage)), 'nextItem')

assert.equal(shortcutFromKeyboardEvent(keyEvent('Space', ' ')), 'space')
assert.equal(shortcutFromKeyboardEvent(keyEvent('ArrowLeft', 'ArrowLeft')), 'arrowleft')
assert.equal(shortcutFromKeyboardEvent({ ...keyEvent('KeyR', 'r'), ctrlKey: true }), '')
assert.equal(formatPassagePreviewShortcut('arrowright'), '→')
assert.equal(formatPassagePreviewShortcut('space'), 'Space')

const displayModeStorage = createMemoryStorage()
assert.equal(loadPassagePreviewTranslationDisplayMode(displayModeStorage), DEFAULT_PASSAGE_PREVIEW_TRANSLATION_DISPLAY_MODE)
assert.equal(savePassagePreviewTranslationDisplayMode(PASSAGE_PREVIEW_TRANSLATION_DISPLAY_MODES.HOLD, displayModeStorage), 'hold')
assert.equal(loadPassagePreviewTranslationDisplayMode(displayModeStorage), 'hold')
assert.equal(savePassagePreviewTranslationDisplayMode('invalid', displayModeStorage), false)
assert.equal(loadPassagePreviewTranslationDisplayMode(displayModeStorage), 'hold')
assert.equal(savePassagePreviewTranslationDisplayMode(PASSAGE_PREVIEW_TRANSLATION_DISPLAY_MODES.PERSISTENT, displayModeStorage), 'persistent')
assert.equal(loadPassagePreviewTranslationDisplayMode(displayModeStorage), 'persistent')

const legacyStorage = createMemoryStorage()
legacyStorage.setItem(PASSAGE_PREVIEW_TRANSLATION_SHORTCUT_KEY, 'x')
assert.equal(loadPassagePreviewShortcuts(legacyStorage).translation, 'x')

const previousV2Storage = createMemoryStorage()
previousV2Storage.setItem(PASSAGE_PREVIEW_SHORTCUTS_KEY, JSON.stringify({
  schemaVersion: 'passage-preview.shortcuts.v2',
  shortcuts: {
    wordAudio: 'q',
    sentenceAudio: 'w',
    translation: 'e',
    previousItem: 'a',
    nextItem: 'd',
  },
}))
assert.deepEqual(loadPassagePreviewShortcuts(previousV2Storage), {
  revealContent: 'space',
  wordAudio: 'q',
  sentenceAudio: 'w',
  translation: 'e',
  previousItem: 'a',
  nextItem: 'd',
})

const corruptStorage = createMemoryStorage()
corruptStorage.setItem(PASSAGE_PREVIEW_SHORTCUTS_KEY, JSON.stringify({
  schemaVersion: 'passage-preview.shortcuts.v2',
  shortcuts: {
    wordAudio: 'q',
    sentenceAudio: 'q',
    translation: 'e',
    previousItem: 'a',
    nextItem: 'd',
  },
}))
assert.deepEqual(loadPassagePreviewShortcuts(corruptStorage), DEFAULT_PASSAGE_PREVIEW_SHORTCUTS)

assert.equal(isEditableKeyboardTarget({ tagName: 'INPUT' }), true)
assert.equal(isEditableKeyboardTarget({ tagName: 'DIV', isContentEditable: true }), true)
assert.equal(isEditableKeyboardTarget({ tagName: 'BUTTON' }), false)

console.log('Passage preview shortcut settings verification passed.')

function keyEvent(code, key) {
  return { code, key, ctrlKey: false, metaKey: false, altKey: false }
}

function createMemoryStorage() {
  const values = new Map()
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null },
    setItem(key, value) { values.set(key, String(value)) },
  }
}
