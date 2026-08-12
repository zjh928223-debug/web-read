function defaultRevokeObjectURL(url) {
  if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(url)
  }
}

function isBlobUrl(url) {
  return typeof url === 'string' && url.startsWith('blob:')
}

export function createMediaResourceOwner(options = {}) {
  const mediaElement = options.mediaElement
  const revokeObjectURL = options.revokeObjectURL ?? defaultRevokeObjectURL
  if (!mediaElement || typeof mediaElement !== 'object') {
    throw new TypeError('MediaResourceOwner requires a mediaElement')
  }
  if (typeof revokeObjectURL !== 'function') {
    throw new TypeError('MediaResourceOwner requires a revokeObjectURL function')
  }

  let currentUrl = null

  function releaseCurrent() {
    if (currentUrl === null) return
    const releasedUrl = currentUrl
    currentUrl = null
    try { mediaElement.pause?.() } catch { /* Cleanup continues. */ }
    try { mediaElement.removeAttribute?.('src') } catch { /* Cleanup continues. */ }
    try { mediaElement.load?.() } catch { /* Cleanup continues. */ }
    if (isBlobUrl(releasedUrl)) {
      try { revokeObjectURL(releasedUrl) } catch { /* Ownership is still released. */ }
    }
  }

  return Object.freeze({
    replace(url) {
      if (typeof url !== 'string' || url.length === 0) {
        throw new TypeError('MediaResourceOwner.replace requires a non-empty URL')
      }
      if (url === currentUrl) return false
      releaseCurrent()
      mediaElement.src = url
      currentUrl = url
      return true
    },

    dispose() {
      releaseCurrent()
    },
  })
}
