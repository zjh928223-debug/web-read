export function getChunkNoteWrapTokens(text) {
  var value = String(text || '')
  if (!value) return []
  if (/\s/.test(value)) return value.split(/(\s+)/).filter(Boolean)
  return Array.from(value)
}

export function splitTokenToFitWidth(ctx, token, maxWidth) {
  if (!token) return ['']
  if (ctx.measureText(token).width <= maxWidth) return [token]
  var parts = []
  var buffer = ''
  Array.from(token).forEach(function (ch) {
    var candidate = buffer + ch
    if (buffer && ctx.measureText(candidate).width > maxWidth) {
      parts.push(buffer)
      buffer = ch
    } else {
      buffer = candidate
    }
  })
  if (buffer) parts.push(buffer)
  return parts.length ? parts : [token]
}

export function wrapChunkNoteTextForCanvas(ctx, text, maxWidth) {
  var tokens = getChunkNoteWrapTokens(text)
  if (!tokens.length) return ['']
  var lines = []
  var line = ''
  tokens.forEach(function (rawToken) {
    splitTokenToFitWidth(ctx, rawToken, maxWidth).forEach(function (token) {
      var candidate = line + token
      if (!line || ctx.measureText(candidate).width <= maxWidth) {
        line = candidate
      } else {
        lines.push(line)
        line = token.trimStart()
      }
    })
  })
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

export function truncateCanvasLine(ctx, text, maxWidth) {
  var source = String(text || '')
  if (!source) return ''
  if (ctx.measureText(source).width <= maxWidth) return source
  var ellipsis = '...'
  var low = 0
  var high = source.length
  while (low < high) {
    var mid = Math.ceil((low + high) / 2)
    var candidate = source.slice(0, mid) + ellipsis
    if (ctx.measureText(candidate).width <= maxWidth) low = mid
    else high = mid - 1
  }
  return source.slice(0, Math.max(0, low)) + ellipsis
}

window.ChunkNoteLayoutHelpers = {
  getChunkNoteWrapTokens: getChunkNoteWrapTokens,
  splitTokenToFitWidth: splitTokenToFitWidth,
  wrapChunkNoteTextForCanvas: wrapChunkNoteTextForCanvas,
  truncateCanvasLine: truncateCanvasLine
}
