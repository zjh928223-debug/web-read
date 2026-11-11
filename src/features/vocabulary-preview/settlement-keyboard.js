export function getSettlementKeyboardAction(event, { isTopmost, inList, confirmingSkip, recording } = {}) {
  if (!event || event.defaultPrevented || !isTopmost || confirmingSkip || recording
    || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  const target = event.target;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(String(target?.tagName || '').toUpperCase())
    || target?.isContentEditable || target?.closest?.('[contenteditable]:not([contenteditable="false"])')) return null;
  if (!event.repeat && event.key === '2') return 'speak';
  if (!event.repeat && (event.key === 'Enter' || event.key === ' ')
    && target?.classList?.contains('vocabulary-preview-dialog__item-main')) return 'speak';
  if (event.key === 'ArrowUp') return 'previous';
  if (event.key === 'ArrowDown') return 'next';
  if (event.repeat) return null;
  if (event.key === 'r' || event.key === 'R' || event.key === 'ArrowRight') return 'speak';
  if (!inList) return null;
  return { r: 'speak', m: 'remove', d: 'meaning' }[String(event.key || '').toLowerCase()] || null;
}

export function resolveSettlementActiveTarget(rows, targetId, previousIndex = 0) {
  const current = rows.find(row => row.dataset.targetId === targetId);
  return current || rows[Math.min(Math.max(previousIndex, 0), rows.length - 1)] || null;
}
