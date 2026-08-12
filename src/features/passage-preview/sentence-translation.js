export const SENTENCE_TRANSLATION_BATCH_SIZE = 25

export async function translateSentenceBatches(rawItems, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') return []
  const items = uniqueSentences(rawItems)
  const translated = []
  for (let index = 0; index < items.length; index += SENTENCE_TRANSLATION_BATCH_SIZE) {
    const batch = items.slice(index, index + SENTENCE_TRANSLATION_BATCH_SIZE)
    const response = await fetchImpl('/api/vocabulary/sentence-translations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: batch }),
      signal: options.signal,
    })
    if (!response.ok) continue
    const payload = await response.json()
    for (const item of Array.isArray(payload?.items) ? payload.items : []) {
      const translationZh = normalizeTranslation(item?.translationZh)
      const sentence = normalizeText(item?.sentence)
      if (sentence && translationZh) translated.push({ id: item.id, sentence, translationZh })
    }
  }
  return translated
}

export function sentenceTranslationKey(sentence) {
  return normalizeText(sentence).toLocaleLowerCase('en-US')
}

function uniqueSentences(rawItems) {
  const result = []
  const seen = new Set()
  for (const item of Array.isArray(rawItems) ? rawItems : []) {
    const sentence = normalizeText(item?.sentence)
    const key = sentenceTranslationKey(sentence)
    if (!sentence || seen.has(key)) continue
    seen.add(key)
    result.push({ id: normalizeId(item?.id) || `sentence-${result.length + 1}`, sentence })
  }
  return result
}

function normalizeId(value) {
  return normalizeText(value).replace(/[^a-zA-Z0-9._:-]/gu, '').slice(0, 128)
}

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
}

function normalizeTranslation(value) {
  return String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim()
}
