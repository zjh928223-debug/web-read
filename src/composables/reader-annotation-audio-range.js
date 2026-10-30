export function resolveReaderAnnotationAudioRange(annotation, words, wordIndex) {
  if (!Array.isArray(words) || !Number.isInteger(wordIndex) || !words[wordIndex]) return null
  const tokenize = text => String(text || '').toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  const boundary = tokenize(annotation?.boundary || annotation?.markedText)
  if (!boundary.length) return null
  function range(first, last) {
    return {
      start: words[first]?.start, end: words[last]?.end,
      previousEnd: words[first - 1]?.end, nextStart: words[last + 1]?.start
    }
  }
  if (boundary.length === 1) return range(wordIndex, wordIndex)

  const tokens = []
  const segment = words[wordIndex].segIndex
  for (let index = Math.max(0, wordIndex - 12); index <= Math.min(words.length - 1, wordIndex + 12); index++) {
    if (segment != null && words[index].segIndex !== segment) continue
    for (const text of tokenize(words[index].word || words[index].text)) tokens.push({ text, index })
  }
  const matches = (text, token) => text === token
    || (text === 'oneself' && /^(my|your|him|her|it|our|them)sel(f|ves)$/.test(token))
  const candidates = new Map()
  function add(first, last) {
    const start = tokens[first].index, end = tokens[last].index
    if (wordIndex < start || wordIndex > end) return
    for (let index = start; index < end; index++) {
      if (/[.!?]["')]*$/.test(words[index].word || words[index].text || '')) return
    }
    candidates.set(`${start}:${end}`, range(start, end))
  }
  for (let first = 0; first + boundary.length <= tokens.length; first++) {
    if (boundary.every((text, offset) => matches(text, tokens[first + offset].text))) {
      add(first, first + boundary.length - 1)
    }
  }
  // Separable two-part phrases such as "shut off" can contain "himself".
  if (!candidates.size && boundary.length === 2) {
    for (let first = 0; first < tokens.length; first++) {
      if (!matches(boundary[0], tokens[first].text)) continue
      for (let last = first + 1; last <= Math.min(tokens.length - 1, first + 4); last++) {
        if (matches(boundary[1], tokens[last].text)) add(first, last)
      }
    }
  }
  return candidates.size === 1 ? [...candidates.values()][0] : null
}
