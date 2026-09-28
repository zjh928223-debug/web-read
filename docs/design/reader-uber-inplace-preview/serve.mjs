import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'

const root = fileURLToPath(new URL('./dist/', import.meta.url))
const requestedPortIndex = process.argv.indexOf('--port')
const requestedPort = requestedPortIndex >= 0 ? Number(process.argv[requestedPortIndex + 1]) : 4318
const port = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : 4318
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
}

function safePath(urlPath) {
  const pathname = decodeURIComponent(String(urlPath || '/').split('?')[0])
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^[/\\]+/, '')
  const candidate = normalize(join(root, relative))
  return candidate.startsWith(root) ? candidate : join(root, 'index.html')
}

const server = createServer(async (request, response) => {
  const filePath = safePath(request.url)
  try {
    const info = await stat(filePath)
    if (!info.isFile()) throw new Error('not a file')
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream',
    })
    createReadStream(filePath).pipe(response)
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Not found')
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Reader in-place preview: http://127.0.0.1:${port}/`)
})
