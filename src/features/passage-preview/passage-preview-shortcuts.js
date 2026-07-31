export const PASSAGE_PREVIEW_TRANSLATION_SHORTCUT_KEY = 'vocabulary.passage-preview.shortcut.translation.v1'
export const PASSAGE_PREVIEW_CONTEXT_SHORTCUT_KEY = 'vocabulary.passage-preview.shortcut.context.v1'

export function loadPassagePreviewShortcuts(storage = globalThis.localStorage) {
  return {
    translation: normalizeShortcut(
      storage?.getItem(PASSAGE_PREVIEW_TRANSLATION_SHORTCUT_KEY)
        || storage?.getItem('st.chunkCnKey')
        || 'c',
      'c',
    ),
    context: normalizeShortcut(
      storage?.getItem(PASSAGE_PREVIEW_CONTEXT_SHORTCUT_KEY) || 'v',
      'v',
    ),
  }
}

export function savePassagePreviewShortcut(kind, value, storage = globalThis.localStorage) {
  const normalized = normalizeShortcut(value)
  if (!normalized) return false
  const key = kind === 'translation'
    ? PASSAGE_PREVIEW_TRANSLATION_SHORTCUT_KEY
    : PASSAGE_PREVIEW_CONTEXT_SHORTCUT_KEY
  storage?.setItem(key, normalized)
  return normalized
}

export function shortcutFromKeyboardEvent(event) {
  if (event?.ctrlKey || event?.metaKey || event?.altKey) return ''
  if (event?.code === 'Space') return 'space'
  const key = String(event?.key || '').toLowerCase()
  return /^[a-z0-9]$/.test(key) ? key : ''
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
  return normalizeShortcut(value) === 'space' ? 'Space' : normalizeShortcut(value).toUpperCase()
}

function normalizeShortcut(value, fallback = '') {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'space' || /^[a-z0-9]$/.test(normalized)) return normalized
  return fallback
}
