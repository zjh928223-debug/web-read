function defaultSchedule(callback) {
  const timerId = setTimeout(callback, 0)
  return () => clearTimeout(timerId)
}

export function createObjectUrlDownloader(options = {}) {
  const documentObject = options.documentObject ?? globalThis.document
  const urlApi = options.urlApi ?? globalThis.URL
  const schedule = options.schedule ?? defaultSchedule

  if (!documentObject?.body || typeof documentObject.createElement !== 'function') {
    throw new TypeError('ObjectUrlDownloader requires a document body')
  }
  if (typeof urlApi?.createObjectURL !== 'function'
    || typeof urlApi?.revokeObjectURL !== 'function') {
    throw new TypeError('ObjectUrlDownloader requires Object URL APIs')
  }
  if (typeof schedule !== 'function') {
    throw new TypeError('ObjectUrlDownloader requires a scheduler')
  }

  const pending = new Map()

  function release(url) {
    const entry = pending.get(url)
    if (!entry) return false
    pending.delete(url)
    try { entry.cancel?.() } catch { /* Cleanup still owns URL revocation. */ }
    urlApi.revokeObjectURL(url)
    return true
  }

  function download(blob, filename) {
    if (!blob) throw new TypeError('download requires a Blob')
    if (typeof filename !== 'string' || !filename.trim()) {
      throw new TypeError('download requires a filename')
    }

    const url = urlApi.createObjectURL(blob)
    const entry = { cancel: null }
    pending.set(url, entry)
    let anchor = null
    let attached = false
    let scheduled = false
    try {
      anchor = documentObject.createElement('a')
      anchor.href = url
      anchor.download = filename
      documentObject.body.appendChild(anchor)
      attached = true
      anchor.click()
      documentObject.body.removeChild(anchor)
      attached = false
      entry.cancel = schedule(() => release(url))
      scheduled = true
      return { filename, url }
    } finally {
      try {
        if (attached) documentObject.body.removeChild(anchor)
      } finally {
        if (!scheduled) release(url)
      }
    }
  }

  function dispose() {
    for (const url of [...pending.keys()]) {
      try { release(url) } catch { /* Dispose all remaining URLs. */ }
    }
  }

  return Object.freeze({ download, dispose })
}
