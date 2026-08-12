const DEFAULT_DICTIONARY_BASE_URL = import.meta.env?.VITE_LOCAL_SERVICE_BASE_URL
  || 'http://127.0.0.1:8765'
const MAX_BATCH_SIZE = 50
const GENERAL_MEANING_SOURCE = 'merriam-webster-collegiate+gemini:v2'
const MERRIAM_GEMINI_SOURCE_PREFIX = 'merriam-webster-collegiate+gemini'

export async function hydrateReviewGeneralMeanings(entries, service, options = {}) {
  if (!service || typeof service.cacheGeneralMeanings !== 'function') {
    return { requested: 0, cached: 0 }
  }
  const pendingEntries = (Array.isArray(entries) ? entries : []).filter((entry) => (
    entry?.word?.id
    && entry?.word?.word
    && needsGeneralMeaningRefresh(entry.word)
  ))
  const entriesByLookup = new Map()
  pendingEntries.forEach((entry) => {
    const lookup = normalizeLookup(entry.word.word)
    if (!lookup) return
    if (!entriesByLookup.has(lookup)) entriesByLookup.set(lookup, [])
    entriesByLookup.get(lookup).push(entry)
  })
  const words = [...entriesByLookup.keys()]
  if (!words.length) return { requested: 0, cached: 0 }

  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') return { requested: words.length, cached: 0 }
  const baseUrl = String(options.baseUrl || DEFAULT_DICTIONARY_BASE_URL).replace(/\/+$/, '')
  let cached = 0

  for (let index = 0; index < words.length; index += MAX_BATCH_SIZE) {
    const batch = words.slice(index, index + MAX_BATCH_SIZE)
    let response
    try {
      response = await fetchImpl(`${baseUrl}/api/dictionary/general-meanings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ words: batch }),
        signal: options.signal,
      })
    } catch (_error) {
      continue
    }
    if (!response.ok) continue
    const payload = await response.json()
    const updates = []
    for (const item of Array.isArray(payload?.items) ? payload.items : []) {
      const lookup = normalizeLookup(item?.word)
      const generalMeaning = String(item?.generalMeaning || '').trim()
      if (!lookup || !generalMeaning) continue
      for (const entry of entriesByLookup.get(lookup) || []) {
        updates.push({
          wordId: entry.word.id,
          generalMeaning,
          dictionaryDefinition: String(item?.englishDefinition || '').trim() || null,
          dictionarySource: String(item?.source || '').trim() || GENERAL_MEANING_SOURCE,
        })
      }
    }
    if (!updates.length) continue
    const storedWords = await service.cacheGeneralMeanings(updates)
    const storedById = new Map((Array.isArray(storedWords) ? storedWords : []).map((word) => [word.id, word]))
    pendingEntries.forEach((entry) => {
      const stored = storedById.get(entry.word.id)
      if (stored) entry.word = { ...entry.word, ...stored }
    })
    cached += storedById.size
  }

  return { requested: words.length, cached }
}

function normalizeLookup(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function needsGeneralMeaningRefresh(word) {
  const meaning = String(word?.general_meaning || word?.generalMeaning || '').trim()
  if (!meaning) return true
  const source = String(word?.dictionary_source || word?.dictionarySource || '').trim()
  return source.startsWith(MERRIAM_GEMINI_SOURCE_PREFIX) && source !== GENERAL_MEANING_SOURCE
}
