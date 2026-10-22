import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { proxyHttp } from '../tools/optimization-stable-front-door.mjs'

// This deployment gateway uses the existing streaming proxy. It does not own data.
const config = JSON.parse(readFileSync(new URL('../daily-deployment.json', import.meta.url)))
const origin = new URL(config.publicOrigin)
const port = config.publicPort
const allowedHosts = new Set([origin.host, `127.0.0.1:${port}`, `localhost:${port}`])
const allowedOrigins = new Set([origin.origin, `http://127.0.0.1:${port}`, `http://localhost:${port}`])
if (origin.protocol !== 'https:' || Number(origin.port) !== port || !origin.hostname.endsWith('.ts.net')) {
  throw new Error('A fixed Tailscale HTTPS origin is required')
}
const target = { host: '127.0.0.1', port: config.hostPort }
const server = createServer((request, response) => {
  const host = request.headers.host || ''
  const requestOrigin = request.headers.origin || ''
  if (!allowedHosts.has(host) || (requestOrigin && !allowedOrigins.has(requestOrigin))) {
    response.writeHead(403).end('Origin not allowed')
    return
  }
  if (request.method === 'GET' && request.url === '/api/app/front-door-process-health') {
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      status: 'ready', service: 'read-web-frozen-daily-gateway',
      releaseId: process.env.READ_WEB_RELEASE_ID,
      profileId: process.env.READ_WEB_PROFILE_ID,
      instanceId: process.env.READ_WEB_INSTANCE_ID,
    }))
    return
  }
  proxyHttp(request, response, target, undefined, { redactPublicHealth: host === origin.host })
})
server.listen(port, '127.0.0.1')
process.once('SIGTERM', () => server.close())
process.once('SIGINT', () => server.close())
