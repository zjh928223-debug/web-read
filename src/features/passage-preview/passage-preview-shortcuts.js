export const PASSAGE_PREVIEW_SHORTCUTS_KEY = 'vocabulary.passage-preview.shortcuts.v2'
export const PASSAGE_PREVIEW_SHORTCUTS_SCHEMA = 'passage-preview.shortcuts.v2'
export const PASSAGE_PREVIEW_TRANSLATION_SHORTCUT_KEY = 'vocabulary.passage-preview.shortcut.translation.v1'
export const PASSAGE_PREVIEW_CONTEXT_SHORTCUT_KEY = 'vocabulary.passage-preview.shortcut.context.v1'
export const PASSAGE_PREVIEW_TRANSLATION_DISPLAY_MODE_KEY = 'vocabulary.passage-preview.translation-display-mode.v2'

export const PASSAGE_PREVIEW_TRANSLATION_DISPLAY_MODES = Object.freeze({
  HOLD: 'hold',
  PERSISTENT: 'persistent',
})
export const DEFAULT_PASSAGE_PREVIEW_TRANSLATION_DISPLAY_MODE = PASSAGE_PREVIEW_TRANSLATION_DISPLAY_MODES.HOLD

export const PASSAGE_PREVIEW_SHORTCUT_ACTIONS = Object.freeze([
  Object.freeze({ id: 'revealContent', label: '看看这个词怎么用' }),
  Object.freeze({ id: 'wordAudio', label: '单词发音' }),
  Object.freeze({ id: 'sentenceAudio', label: '句子发音' }),
  Object.freeze({ id: 'translation', label: '句子中文展示 / 隐藏' }),
  Object.freeze({ id: 'previousItem', label: '上一个' }),
  Object.freeze({ id: 'nextItem', label: '下一词' }),
])

export const DEFAULT_PASSAGE_PREVIEW_SHORTCUTS = Object.freeze({
  revealContent: 'space',
  wordAudio: 'r',
  sentenceAudio: 's',
  translation: 'c',
  previousItem: 'arrowleft',
  nextItem: 'arrowright',
})

const ACTION_IDS = new Set(PASSAGE_PREVIEW_SHORTCUT_ACTIONS.map((action) => action.id))

export function loadPassagePreviewShortcuts(storage = globalThis.localStorage) {
  let stored = null
  try {
    stored = JSON.parse(storage?.getItem(PASSAGE_PREVIEW_SHORTCUTS_KEY) || 'null')
  } catch (_error) {}

  const legacyTranslation = normalizeShortcut(
    storage?.getItem(PASSAGE_PREVIEW_TRANSLATION_SHORTCUT_KEY)
      || storage?.getItem('st.chunkCnKey'),
  )
  const candidate = {
    ...DEFAULT_PASSAGE_PREVIEW_SHORTCUTS,
    ...(legacyTranslation ? { translation: legacyTranslation } : {}),
    ...(stored?.schemaVersion === PASSAGE_PREVIEW_SHORTCUTS_SCHEMA ? stored.shortcuts : {}),
  }
  return isValidShortcutMap(candidate)
    ? normalizeShortcutMap(candidate)
    : { ...DEFAULT_PASSAGE_PREVIEW_SHORTCUTS }
}

export function savePassagePreviewShortcuts(shortcuts, storage = globalThis.localStorage) {
  if (!isValidShortcutMap(shortcuts)) return false
  const normalized = normalizeShortcutMap(shortcuts)
  storage?.setItem(PASSAGE_PREVIEW_SHORTCUTS_KEY, JSON.stringify({
    schemaVersion: PASSAGE_PREVIEW_SHORTCUTS_SCHEMA,
    shortcuts: normalized,
  }))
  return normalized
}

export function savePassagePreviewShortcut(kind, value, storage = globalThis.localStorage) {
  if (!ACTION_IDS.has(kind)) return false
  const normalized = normalizeShortcut(value)
  if (!normalized) return false
  const current = loadPassagePreviewShortcuts(storage)
  if (Object.entries(current).some(([id, shortcut]) => id !== kind && shortcut === normalized)) return false
  return savePassagePreviewShortcuts({ ...current, [kind]: normalized }, storage)?.[kind] || false
}

export function loadPassagePreviewTranslationDisplayMode(storage = globalThis.localStorage) {
  return normalizeTranslationDisplayMode(storage?.getItem(PASSAGE_PREVIEW_TRANSLATION_DISPLAY_MODE_KEY))
    || DEFAULT_PASSAGE_PREVIEW_TRANSLATION_DISPLAY_MODE
}

export function savePassagePreviewTranslationDisplayMode(mode, storage = globalThis.localStorage) {
  const normalized = normalizeTranslationDisplayMode(mode)
  if (!normalized) return false
  storage?.setItem(PASSAGE_PREVIEW_TRANSLATION_DISPLAY_MODE_KEY, normalized)
  return normalized
}

export function shortcutFromKeyboardEvent(event) {
  if (event?.ctrlKey || event?.metaKey || event?.altKey) return ''
  const code = String(event?.code || '')
  if (code === 'Space') return 'space'
  if (/^Arrow(?:Left|Right|Up|Down)$/.test(code)) return code.toLowerCase()
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase()
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  const key = String(event?.key || '').trim().toLowerCase()
  if (key === ' ') return 'space'
  return normalizeShortcut(key)
}

export function passagePreviewActionForKeyboardEvent(event, shortcuts) {
  const shortcut = shortcutFromKeyboardEvent(event)
  if (!shortcut) return ''
  return PASSAGE_PREVIEW_SHORTCUT_ACTIONS.find((action) => shortcuts?.[action.id] === shortcut)?.id || ''
}

export function isEditableKeyboardTarget(target) {
  const tagName = String(target?.tagName || '').toLowerCase()
  return tagName === 'input'
    || tagName === 'textarea'
    || tagName === 'select'
    || target?.isContentEditable === true
    || Boolean(target?.closest?.('[contenteditable="true"]'))
}

export function formatPassagePreviewShortcut(value) {
  const normalized = normalizeShortcut(value)
  const labels = {
    space: 'Space',
    arrowleft: '←',
    arrowright: '→',
    arrowup: '↑',
    arrowdown: '↓',
  }
  return labels[normalized] || normalized.toUpperCase()
}

export function normalizeShortcut(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (
    normalized === 'space'
    || /^arrow(?:left|right|up|down)$/.test(normalized)
    || /^[a-z0-9]$/.test(normalized)
  ) return normalized
  return ''
}

export function normalizeTranslationDisplayMode(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return Object.values(PASSAGE_PREVIEW_TRANSLATION_DISPLAY_MODES).includes(normalized) ? normalized : ''
}

function normalizeShortcutMap(shortcuts) {
  return Object.fromEntries(PASSAGE_PREVIEW_SHORTCUT_ACTIONS.map(({ id }) => [
    id,
    normalizeShortcut(shortcuts?.[id]),
  ]))
}

function isValidShortcutMap(shortcuts) {
  const values = PASSAGE_PREVIEW_SHORTCUT_ACTIONS.map(({ id }) => normalizeShortcut(shortcuts?.[id]))
  return values.every(Boolean) && new Set(values).size === values.length
}
