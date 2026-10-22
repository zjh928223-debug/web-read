export function isReaderShortcutEventAllowed(event, doc = document) {
  if (!event || event.defaultPrevented || event.isComposing || event.keyCode === 229) return false
  const target = event.target
  const tag = String(target && target.tagName || '').toUpperCase()
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return false
  if (target && (target.isContentEditable || target.closest?.('[contenteditable]:not([contenteditable="false"])'))) return false
  if ([' ', 'Enter'].includes(event.key) && target?.closest?.('button, a, summary, [role="button"]')) return false
  const overlays = doc.querySelectorAll?.('[aria-modal="true"], .srs-review-page') || []
  for (const overlay of overlays) {
    if (overlay.hidden || !overlay.getClientRects().length) continue
    if (doc.defaultView?.getComputedStyle(overlay).visibility === 'hidden') continue
    return false
  }
  return true
}
