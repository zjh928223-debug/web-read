import assert from 'node:assert/strict'
import { once } from 'node:events'
import { PassThrough, Readable } from 'node:stream'
import {
  buildUpstreamHeaders,
  isAllowedRequestHost,
  isAllowedRequestOrigin,
  normalizeTarget,
  parseArgs,
  proxyHttp,
  validateFrontDoorConfig,
} from '../tools/optimization-stable-front-door.mjs'

function frontDoorConfig(overrides = {}) {
  return {
    host: '127.0.0.1',
    port: 5184,
    transportMode: 'loopback',
    configuredLanHost: '',
    targetFile: 'target.json',
    releaseId: 'front-door-v1',
    profileId: 'optimization',
    instanceId: 'front-door-instance',
    activeReleaseFile: 'active-release.json',
    activeHostFile: 'active-host.json',
    ...overrides,
  }
}

const loopback = validateFrontDoorConfig(frontDoorConfig())
assert.equal(isAllowedRequestHost('127.0.0.1:5184', loopback), true)
assert.equal(isAllowedRequestOrigin('http://127.0.0.1:5184', '127.0.0.1:5184', loopback), true)
assert.equal(isAllowedRequestHost('192.168.1.20:5184', loopback), false)
assert.throws(
  () => validateFrontDoorConfig(frontDoorConfig({ host: '192.168.1.20' })),
  /requires a loopback host/,
)

const privateLan = validateFrontDoorConfig(frontDoorConfig({
  host: '192.168.1.20',
  transportMode: 'private-lan',
  configuredLanHost: '192.168.1.20',
}))
assert.equal(isAllowedRequestHost('192.168.1.20:5184', privateLan), true)
assert.equal(isAllowedRequestOrigin('http://192.168.1.20:5184', '192.168.1.20:5184', privateLan), true)
assert.equal(isAllowedRequestOrigin('', '192.168.1.20:5184', privateLan), true)
for (const host of ['192.168.1.21:5184', '192.168.1.20:5174', 'localhost:5184']) {
  assert.equal(isAllowedRequestHost(host, privateLan), false, `unexpected private-LAN Host acceptance: ${host}`)
}
for (const origin of ['http://192.168.1.21:5184', 'http://192.168.1.20:5174', 'http://localhost:5184']) {
  assert.equal(
    isAllowedRequestOrigin(origin, '192.168.1.20:5184', privateLan),
    false,
    `unexpected private-LAN Origin acceptance: ${origin}`,
  )
}
assert.throws(
  () => validateFrontDoorConfig(frontDoorConfig({ host: '192.168.1.20', transportMode: 'private-lan' })),
  /explicit configured LAN host/,
)
assert.throws(
  () => validateFrontDoorConfig(frontDoorConfig({ host: '192.168.1.21', transportMode: 'private-lan', configuredLanHost: '192.168.1.20' })),
  /bind host must match/,
)
assert.throws(
  () => validateFrontDoorConfig(frontDoorConfig({ host: '0.0.0.0', transportMode: 'private-lan', configuredLanHost: '0.0.0.0' })),
  /explicit configured LAN host/,
)

const parsedPrivateLan = parseArgs(['--transport-mode', 'private-lan', '--configured-lan-host', '192.168.1.20'])
assert.equal(parsedPrivateLan.transportMode, 'private-lan')
assert.equal(parsedPrivateLan.configuredLanHost, '192.168.1.20')

const targetIdentity = {
  status: 'active',
  host: '127.0.0.1',
  port: 49152,
  releaseId: 'candidate-v1',
  profileId: 'optimization',
  instanceId: 'candidate-instance',
}
assert.deepEqual(normalizeTarget(targetIdentity, 'optimization'), {
  host: '127.0.0.1',
  port: 49152,
  releaseId: 'candidate-v1',
  profileId: 'optimization',
  instanceId: 'candidate-instance',
})
assert.equal(normalizeTarget({ ...targetIdentity, host: '192.168.1.20' }, 'optimization'), null)
assert.equal(normalizeTarget({ ...targetIdentity, port: 8776 }, 'optimization'), null)

const target = { host: '127.0.0.1', port: 49152 }
assert.deepEqual(buildUpstreamHeaders({
  host: '192.168.1.20:5184',
  origin: 'http://192.168.1.20:5184',
  range: 'bytes=10-19',
  'content-type': 'application/octet-stream',
  'content-length': '12',
  connection: 'keep-alive',
  'transfer-encoding': 'chunked',
}, target), {
  host: '127.0.0.1:49152',
  origin: 'http://127.0.0.1:49152',
  range: 'bytes=10-19',
  'content-type': 'application/octet-stream',
  'content-length': '12',
})

const ordinaryRequest = Readable.from(['ordinary-request'])
ordinaryRequest.headers = { host: '192.168.1.20:5184', 'content-type': 'application/json' }
ordinaryRequest.method = 'POST'
ordinaryRequest.url = '/api/app/owner'
const ordinaryResponse = new PassThrough()
ordinaryResponse.headersSent = false
ordinaryResponse.writeHead = (statusCode, headers) => {
  ordinaryResponse.statusCode = statusCode
  ordinaryResponse.responseHeaders = headers
  ordinaryResponse.headersSent = true
}
let ordinaryRequestBody = ''
let ordinaryResponseBody = ''
ordinaryResponse.on('data', (chunk) => { ordinaryResponseBody += chunk.toString() })
proxyHttp(ordinaryRequest, ordinaryResponse, target, (_options, callback) => {
  const upstreamRequest = new PassThrough()
  upstreamRequest.on('data', (chunk) => { ordinaryRequestBody += chunk.toString() })
  queueMicrotask(() => {
    const upstreamResponse = Readable.from(['ordinary-response'])
    upstreamResponse.statusCode = 200
    upstreamResponse.headers = { 'content-type': 'application/json' }
    callback(upstreamResponse)
  })
  return upstreamRequest
})
await once(ordinaryResponse, 'end')
assert.equal(ordinaryRequestBody, 'ordinary-request')
assert.equal(ordinaryResponse.statusCode, 200)
assert.equal(ordinaryResponse.responseHeaders['content-type'], 'application/json')
assert.equal(ordinaryResponseBody, 'ordinary-response')

const request = Readable.from(['ordinary-body'])
request.headers = { host: '192.168.1.20:5184', range: 'bytes=0-9' }
request.method = 'POST'
request.url = '/api/media/example'

const response = new PassThrough()
response.headersSent = false
response.writeHead = (statusCode, headers) => {
  response.statusCode = statusCode
  response.responseHeaders = headers
  response.headersSent = true
}
let responseBody = ''
response.on('data', (chunk) => { responseBody += chunk.toString() })

let upstreamOptions
let requestBody = ''
let firstChunkObservedBeforeEnd = false
const requestImpl = (options, callback) => {
  upstreamOptions = options
  const upstreamRequest = new PassThrough()
  upstreamRequest.on('data', (chunk) => { requestBody += chunk.toString() })
  queueMicrotask(() => {
    const upstreamResponse = new PassThrough()
    upstreamResponse.statusCode = 206
    upstreamResponse.headers = {
      'content-range': 'bytes 0-9/20',
      'accept-ranges': 'bytes',
      etag: '"media-v1"',
      'x-read-web-media-identity': 'media-v1',
    }
    callback(upstreamResponse)
    upstreamResponse.write('first-')
    setImmediate(() => {
      firstChunkObservedBeforeEnd = responseBody === 'first-'
      upstreamResponse.end('second')
    })
  })
  return upstreamRequest
}

proxyHttp(request, response, target, requestImpl)
await once(response, 'end')
assert.equal(upstreamOptions.host, '127.0.0.1')
assert.equal(upstreamOptions.port, 49152)
assert.equal(upstreamOptions.headers.range, 'bytes=0-9')
assert.equal(requestBody, 'ordinary-body')
assert.equal(response.statusCode, 206)
assert.equal(response.responseHeaders['content-range'], 'bytes 0-9/20')
assert.equal(response.responseHeaders['accept-ranges'], 'bytes')
assert.equal(response.responseHeaders.etag, '"media-v1"')
assert.equal(response.responseHeaders['x-read-web-media-identity'], 'media-v1')
assert.equal(firstChunkObservedBeforeEnd, true)
assert.equal(responseBody, 'first-second')

console.log('Optimization stable front door checks passed.')
