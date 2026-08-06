export const REAL_SENTENCE_STATUS = Object.freeze({
  READY: 'ready',
  UNAVAILABLE: 'unavailable',
  ERROR: 'error',
})

export const SENTENCE_SOURCE_REGISTRY_VERSION = 'sentence-source-registry.v1'

export function createSentenceSourceRegistry({ providers = [] } = {}) {
  const registered = new Map()

  function register(provider) {
    const normalized = normalizeProvider(provider)
    if (registered.has(normalized.id)) {
      throw new Error(`Duplicate sentence source provider: ${normalized.id}`)
    }
    registered.set(normalized.id, normalized)
    return api
  }

  function list() {
    return orderedProviders().map(({ findPreviewSentence: _find, ...descriptor }) => ({ ...descriptor }))
  }

  function get(id) {
    return registered.get(normalizeId(id)) || null
  }

  async function findPreviewSentence(item, options = {}) {
    const enabledProviders = orderedProviders().filter((provider) => provider.enabled)
    if (!enabledProviders.length) return unavailable('No real-sentence source is enabled.')

    let fallback = unavailable('No enabled source returned a suitable real sentence.')
    for (const provider of enabledProviders) {
      let result
      try {
        result = await provider.findPreviewSentence(item, options)
      } catch (error) {
        if (error?.name === 'AbortError') throw error
        result = { status: REAL_SENTENCE_STATUS.ERROR, message: `${provider.label} sentence source failed.` }
      }
      if (result?.status === REAL_SENTENCE_STATUS.READY) {
        return { ...result, providerId: provider.id, persistence: provider.persistence || 'none' }
      }
      if (result?.status === REAL_SENTENCE_STATUS.ERROR || fallback.status !== REAL_SENTENCE_STATUS.ERROR) {
        fallback = result || fallback
      }
    }
    return fallback
  }

  function orderedProviders() {
    return [...registered.values()].sort((left, right) => (
      left.priority - right.priority || left.id.localeCompare(right.id)
    ))
  }

  const api = Object.freeze({
    version: SENTENCE_SOURCE_REGISTRY_VERSION,
    register,
    list,
    get,
    findPreviewSentence,
  })
  for (const provider of providers) register(provider)
  return api
}

function normalizeProvider(provider) {
  const id = normalizeId(provider?.id)
  if (!id) throw new TypeError('Sentence source provider id is required.')
  if (typeof provider?.findPreviewSentence !== 'function') {
    throw new TypeError(`Sentence source provider ${id} must implement findPreviewSentence().`)
  }
  return Object.freeze({
    ...provider,
    id,
    label: String(provider.label || id),
    enabled: provider.enabled === true,
    priority: Number.isFinite(provider.priority) ? provider.priority : 100,
  })
}

function normalizeId(value) {
  return String(value || '').trim().toLowerCase()
}

function unavailable(message) {
  return { status: REAL_SENTENCE_STATUS.UNAVAILABLE, message }
}
