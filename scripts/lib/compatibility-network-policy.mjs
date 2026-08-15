export function shouldContinueStaticRequest(requestUrl, targetOrigin) {
  let request
  let origin
  try {
    request = new URL(requestUrl)
    origin = new URL(targetOrigin).origin
  } catch {
    return false
  }
  if (request.origin !== origin) return false
  return !isApiPath(request.pathname)
}

function isApiPath(pathname) {
  let decoded = pathname
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    }
  } catch {
    return true
  }

  const segments = []
  for (const rawSegment of decoded.replaceAll('\\', '/').split('/')) {
    if (!rawSegment || rawSegment === '.') continue
    if (rawSegment === '..') {
      segments.pop()
      continue
    }
    segments.push(rawSegment)
  }
  return segments[0]?.toLowerCase() === 'api'
}
