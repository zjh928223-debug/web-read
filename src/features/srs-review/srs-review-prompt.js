const CUE_LEVELS = new Set(['none', 'target_sentence', 'surrounding_context'])

export function initialReviewCueLevel({ source, promptMode } = {}) {
  if (source === 'legacy') return 'surrounding_context'
  return promptMode === 'word_only' ? 'none' : 'target_sentence'
}

export function normalizeVisibleCueLevel(value) {
  return CUE_LEVELS.has(value) ? value : 'none'
}

export function hasSurroundingReviewContext(paragraphs) {
  const items = Array.isArray(paragraphs) ? paragraphs : []
  return items.some((paragraph) => (
    !paragraph?.target
    || Boolean(String(paragraph?.before || '').trim())
    || Boolean(String(paragraph?.after || '').trim())
  ))
}

export function visibleReviewParagraphs(paragraphs, cueLevel) {
  const items = Array.isArray(paragraphs) ? paragraphs : []
  const normalizedCue = normalizeVisibleCueLevel(cueLevel)
  if (normalizedCue === 'none') return []
  if (normalizedCue === 'surrounding_context') return items
  return items
    .filter((paragraph) => paragraph?.target)
    .map((paragraph) => ({
      ...paragraph,
      before: '',
      after: '',
    }))
}
