export async function runReviewPlaybackSequence(options = {}) {
  const isCurrent = typeof options.isCurrent === 'function' ? options.isCurrent : () => true
  if (!isCurrent()) return false
  if (typeof options.playWord === 'function') await options.playWord()
  if (!isCurrent()) return false
  if (typeof options.playSentence === 'function') await options.playSentence()
  return isCurrent()
}

export function getReviewNavigationDelta(key) {
  if (key === 'ArrowLeft' || key === 'ArrowUp') return -1
  if (key === 'ArrowRight' || key === 'ArrowDown') return 1
  return 0
}

export function isPlaybackPauseKey(event) {
  return event?.code === 'Space' || event?.key === ' '
}

export function normalizeReviewReplayShortcut(value) {
  const text = String(value || '').trim()
  if ([...text].length !== 1 || /\s/.test(text) || /^[1-5]$/.test(text)) return ''
  return text.toLocaleLowerCase('en-US')
}

export function isReviewReplayKey(event, shortcut = 'r') {
  const expected = normalizeReviewReplayShortcut(shortcut)
  const actual = normalizeReviewReplayShortcut(event?.key)
  return Boolean(expected && actual && actual === expected)
}
