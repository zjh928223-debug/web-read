#!/usr/bin/env node

import { createServer, request as requestUpstream } from 'node:http'
import { connect as connectUpstream, isIP } from 'node:net'
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const isMainModule = import.meta.url === pathToFileURL(process.argv[1] || '').href
const config = isMainModule ? parseArgs(process.argv.slice(2)) : null
if (config) validateFrontDoorConfig(config)
const omitExecutableIdentityForTest = process.env.READ_WEB_OPTIMIZATION_TEST_FAILURE === 'front-door-health-identity'

const RESERVED_TARGET_PORTS = new Set([5173, 8765, 5174, 8766, 5184, 8776])

const server = config ? createServer((request, response) => {
  if (!isAllowedRequestHost(request.headers.host || '', config)) {
    sendJson(response, 400, { detail: 'invalid host' })
    return
  }
  if (!isAllowedRequestOrigin(request.headers.origin || '', request.headers.host || '', config)) {
    sendJson(response, 403, { detail: 'origin not allowed' })
    return
  }
  const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname
  if (request.method === 'GET' && pathname === '/api/app/front-door-process-health') {
    const ready = !config.failReady
    sendJson(response, 200, {
      status: ready ? 'ready' : 'degraded',
      service: 'read-web-optimization-front-door-process',
      releaseId: config.releaseId,
      profileId: config.profileId,
      instanceId: config.instanceId,
      ...(shouldOmitExecutableIdentity() ? {} : { executableIdentity: config.executableIdentity }),
      detail: ready ? undefined : 'synthetic readiness failure',
    })
    return
  }
  if (request.method === 'GET' && pathname === '/api/app/front-door-health') {
    const visible = readVisibleTarget()
    const target = visible.target
    const ready = target !== null
    sendJson(response, ready ? 200 : 503, {
      status: ready ? 'ready' : 'degraded',
      service: 'read-web-optimization-front-door',
      releaseId: config.releaseId,
      profileId: config.profileId,
      instanceId: config.instanceId,
      executableIdentity: config.executableIdentity,
      target,
      commitVisibility: visible.visibility,
      detail: ready ? undefined : 'active target is missing, invalid, or identity-inconsistent',
    })
    return
  }
  const target = readVisibleTarget().target
  if (!target) {
    sendJson(response, 503, { status: 'degraded', service: 'read-web-optimization-front-door', detail: 'no active target' })
    return
  }
  proxyHttp(request, response, target)
}) : null

server?.on('upgrade', (request, socket, head) => {
  if (!isAllowedRequestHost(request.headers.host || '', config) || !isAllowedRequestOrigin(request.headers.origin || '', request.headers.host || '', config)) {
    writeSocketError(socket, 403, 'origin not allowed')
    return
  }
  const target = readVisibleTarget().target
  if (!target) {
    writeSocketError(socket, 503, 'no active target')
    return
  }
  const upstream = connectUpstream(target.port, target.host)
  let connected = false
  upstream.once('connect', () => {
    connected = true
    const headers = []
    for (const [name, value] of Object.entries(request.headers)) {
      const lower = name.toLowerCase()
      if (lower === 'host') {
        headers.push(`Host: ${targetAuthority(target)}`)
      } else if (lower === 'origin') {
        headers.push(`Origin: http://${targetAuthority(target)}`)
      } else if (Array.isArray(value)) {
        for (const item of value) headers.push(`${name}: ${item}`)
      } else {
        headers.push(`${name}: ${value}`)
      }
    }
    if (!request.headers.host) headers.push(`Host: ${targetAuthority(target)}`)
    upstream.write(`${request.method} ${request.url || '/'} HTTP/${request.httpVersion}\r\n${headers.join('\r\n')}\r\n\r\n`)
    if (head?.length) upstream.write(head)
    socket.pipe(upstream)
    upstream.pipe(socket)
  })
  const close = () => {
    if (!connected) writeSocketError(socket, 503, 'target unavailable')
    socket.destroy()
  }
  upstream.once('error', close)
  socket.once('error', () => upstream.destroy())
  socket.once('close', () => upstream.destroy())
})

if (server) {
  server.listen(config.port, config.host, () => {
    process.stdout.write(`${JSON.stringify({ status: 'ready', service: 'read-web-optimization-front-door', host: config.host, port: config.port })}\n`)
  })
}

let closing = false
const close = () => {
  if (closing) return
  closing = true
  server?.close(() => { process.exitCode = 0 })
}
if (server) {
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
}

function proxyHttp(request, response, target, requestImpl = requestUpstream) {
  const headers = buildUpstreamHeaders(request.headers, target)
  const upstream = requestImpl({
    host: target.host,
    port: target.port,
    method: request.method,
    path: request.url || '/',
    headers,
    agent: false,
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers)
    upstreamResponse.pipe(response)
  })
  upstream.once('error', () => {
    if (!response.headersSent) sendJson(response, 503, { detail: 'target unavailable' })
    else response.destroy()
  })
  request.pipe(upstream)
}

function buildUpstreamHeaders(requestHeaders, target) {
  const headers = { ...requestHeaders }
  delete headers.connection
  delete headers['proxy-connection']
  delete headers['keep-alive']
  delete headers['transfer-encoding']
  delete headers.upgrade
  headers.host = targetAuthority(target)
  if (headers.origin) headers.origin = `http://${targetAuthority(target)}`
  return headers
}

function readTarget() {
  return readVisibleTarget().target
}

function shouldOmitExecutableIdentity() {
  return omitExecutableIdentityForTest || Boolean(config.healthIdentityTestFile && existsSync(config.healthIdentityTestFile))
}

function readVisibleTarget() {
  const journalFile = readOptionalJsonFile(config.activationJournalFile)
  const targetFile = readOptionalJsonFile(config.targetFile)
  const target = normalizeTarget(targetFile.value)
  if (!target) {
    return { target: null, visibility: { status: 'none', reason: targetFile.exists ? 'target-invalid' : 'target-missing' } }
  }
  const committedFile = config.committedTargetFile ? readOptionalJsonFile(config.committedTargetFile) : null
  const committedTarget = config.committedTargetFile
    ? normalizeTarget(committedFile.value)
    : target
  if (config.committedTargetFile && !committedTarget) {
    return { target: null, visibility: { status: 'none', reason: committedFile.exists ? 'committed-target-invalid' : 'committed-target-missing' } }
  }
  if (journalFile.exists) {
    const journal = journalFile.value
    if (!isValidActivationJournal(journal)) {
      return { target: null, visibility: { status: 'none', reason: 'invalid-activation-journal' } }
    }
    const journalStatus = String(journal.status)
    const journalPhase = String(journal.phase || '')
    if (journalStatus !== 'committed') {
      // A journal is a transaction boundary, not a candidate routing hint.
      // Until the launcher records committed, only the old three-pointer
      // snapshot is visible.  This keeps a crash after any individual pointer
      // write on the last committed Host instead of exposing a half-switched
      // candidate or returning an avoidable public outage.
      const previousCommittedTarget = normalizeTarget(readSnapshotJson(journal.oldCommittedTargetSnapshot) || readSnapshotJson(journal.oldTargetSnapshot))
      const commitReceiptIsSafe = !config.committedTargetFile
        || sameTarget(committedTarget, previousCommittedTarget)
        || targetMatchesActivationCandidate(committedTarget, journal)
      const previous = commitReceiptIsSafe
        ? readJournalPreviousTarget(journal, target, previousCommittedTarget)
        : null
      if (previous) {
        return {
          target: previous,
          visibility: { status: 'previous-release', journalStatus, journalPhase },
        }
      }
      return { target: null, visibility: { status: 'none', journalStatus, journalPhase } }
    }

    if (journalPhase === 'commit-pointer-pending' && !sameTarget(target, committedTarget)) {
      // The launcher records durable commit intent before replacing the
      // committed-target file. Keep the last committed target visible during
      // that tiny interval; once the replacement file matches, the normal
      // committed branch below exposes the new target.
      const previousCommittedTarget = normalizeTarget(readSnapshotJson(journal.oldCommittedTargetSnapshot) || readSnapshotJson(journal.oldTargetSnapshot))
      const previous = readJournalPreviousTarget(journal, target, previousCommittedTarget)
      if (previous) {
        return {
          target: previous,
          visibility: { status: 'previous-release', journalStatus, journalPhase },
        }
      }
      return { target: null, visibility: { status: 'none', journalStatus, journalPhase } }
    }

    if (!committedTarget || !sameTarget(target, committedTarget) || !targetMatchesActivePointers(committedTarget) || !targetMatchesCommittedJournal(committedTarget, journal)) {
      return { target: null, visibility: { status: 'none', journalStatus, journalPhase } }
    }
    return { target: committedTarget, visibility: { status: 'committed', journalStatus, journalPhase } }
  }

  if (!committedTarget || !sameTarget(target, committedTarget) || !targetMatchesActivePointers(committedTarget)) {
    return { target: null, visibility: { status: 'none', reason: 'active-pointers-invalid' } }
  }
  return { target: committedTarget, visibility: { status: 'committed', journalStatus: 'absent', journalPhase: 'none' } }
}

function readTargetFile() {
  const targetFile = readOptionalJsonFile(config.targetFile)
  return normalizeTarget(targetFile.value)
}

function normalizeTarget(value, expectedProfileId = config?.profileId) {
  if (!value || value.status !== 'active') return null
  const target = {
    host: String(value.host || ''),
    port: Number(value.port),
    releaseId: String(value.releaseId || ''),
    profileId: String(value.profileId || ''),
    instanceId: String(value.instanceId || ''),
  }
  if (!isBareLoopbackHost(target.host) || !Number.isInteger(target.port) || target.port < 1 || target.port > 65535) return null
  if (RESERVED_TARGET_PORTS.has(target.port)) return null
  if (!target.releaseId || !target.profileId || !target.instanceId || target.profileId !== expectedProfileId) return null
  return target
}

function readJournalPreviousTarget(journal, currentTarget, previousCommittedTarget) {
  // A journal may select the previous committed identity while the current
  // target pointer is in-flight, but it may not turn a missing or malformed
  // target pointer into a ready front door.  The public pointer must remain a
  // valid, loopback-only target at every observable boundary.
  if (!currentTarget || !previousCommittedTarget) return null
  const target = normalizeTarget(readSnapshotJson(journal.oldCommittedTargetSnapshot) || readSnapshotJson(journal.oldTargetSnapshot))
  const activeRelease = readSnapshotJson(journal.oldActiveReleaseSnapshot)
  const activeHost = readSnapshotJson(journal.oldActiveHostSnapshot)
  if (!target || !targetMatchesPointers(target, activeRelease, activeHost)) return null
  if (!sameTarget(previousCommittedTarget, target)) return null
  if (!sameTarget(currentTarget, target) && !targetMatchesActivationCandidate(currentTarget, journal)) return null
  return target
}

function targetMatchesActivationCandidate(target, journal) {
  const releaseId = String(journal.newReleaseId || '')
  const instanceId = String(journal.newInstanceId || '')
  const hostPort = Number(journal.newHostPort)
  return Boolean(target && releaseId && instanceId)
    && target.releaseId === releaseId
    && target.instanceId === instanceId
    && Number.isInteger(hostPort)
    && hostPort >= 1
    && target.port === hostPort
}

function sameTarget(left, right) {
  return Boolean(left && right)
    && left.host === right.host
    && left.port === right.port
    && left.releaseId === right.releaseId
    && left.profileId === right.profileId
    && left.instanceId === right.instanceId
}

function targetMatchesActivePointers(target) {
  return targetMatchesPointers(target, readJsonFile(config.activeReleaseFile), readJsonFile(config.activeHostFile))
}

function targetMatchesPointers(target, activeRelease, activeHost) {
  if (!target || !activeRelease || !activeHost || activeRelease.status !== 'active' || activeHost.status !== 'active') return false
  const releaseMatches = String(activeRelease.profileId || '') === config.profileId
    && String(activeRelease.releaseId || '') === target.releaseId
  const hostMatches = String(activeHost.profileId || '') === config.profileId
    && String(activeHost.releaseId || '') === target.releaseId
    && String(activeHost.instanceId || '') === target.instanceId
    && Number(activeHost.port) === target.port
  return releaseMatches && hostMatches
}

function targetMatchesCommittedJournal(target, journal) {
  const releaseId = String(journal.newReleaseId || '')
  const instanceId = String(journal.newInstanceId || '')
  const hostPort = Number(journal.newHostPort)
  return Boolean(releaseId && instanceId)
    && target.releaseId === releaseId
    && target.instanceId === instanceId
    && Number.isInteger(hostPort)
    && hostPort >= 1
    && target.port === hostPort
}

function isValidActivationJournal(value) {
  return Boolean(value)
    && Number(value.schemaVersion) === 1
    && String(value.profileId || '') === config.profileId
    && ['prepared', 'switching', 'committed'].includes(String(value.status || ''))
    && Boolean(String(value.phase || ''))
}

function readSnapshotJson(value) {
  if (value && typeof value === 'object') return value
  if (!value || typeof value !== 'string') return null
  try { return JSON.parse(value) } catch { return null }
}

function readJsonFile(filename) {
  return readOptionalJsonFile(filename).value
}

function readOptionalJsonFile(filename) {
  if (!filename) return { exists: false, value: null }
  try { return { exists: true, value: JSON.parse(readFileSync(filename, 'utf8')) } } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, value: null }
    return { exists: true, value: null }
  }
}

function targetAuthority(target) {
  return `${formatHost(target.host)}:${target.port}`
}

function validateFrontDoorConfig(value) {
  const mode = String(value.transportMode || 'loopback').trim()
  if (!['loopback', 'private-lan'].includes(mode)) throw new Error(`unsupported transport mode: ${mode}`)
  value.transportMode = mode
  if (mode === 'loopback') {
    if (!isLoopbackHost(value.host)) throw new Error('optimization front door requires a loopback host')
    if (value.configuredLanHost) throw new Error('--configured-lan-host requires --transport-mode private-lan')
  } else {
    const configuredHost = normalizeConfiguredLanHost(value.configuredLanHost)
    if (!configuredHost) throw new Error('private-lan requires an explicit configured LAN host')
    if (normalizeBareHost(value.host) !== configuredHost) throw new Error('private-lan bind host must match the configured LAN host')
    value.configuredLanHost = configuredHost
  }
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw new Error('invalid front door port')
  if (!value.targetFile) throw new Error('--target-file is required')
  if (!value.profileId || !value.instanceId || !value.releaseId) throw new Error('front door identity is required')
  if (!value.activeReleaseFile || !value.activeHostFile) throw new Error('front door active pointer files are required')
  return value
}
function isAllowedRequestHost(value, selected) {
  if (selected.transportMode !== 'private-lan') return isLoopbackHost(value)
  const authority = parseHostAuthority(value)
  return Boolean(authority) && authority.host === selected.configuredLanHost && authority.port === selected.port
}
function isAllowedRequestOrigin(value, requestHost, selected) {
  if (selected.transportMode !== 'private-lan') return isAllowedLoopbackOrigin(value, requestHost)
  if (!isAllowedRequestHost(requestHost, selected)) return false
  if (!value) return true
  try {
    const origin = new URL(String(value))
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) return false
    const authority = parseHostAuthority(origin.host)
    return Boolean(authority) && authority.host === selected.configuredLanHost && authority.port === selected.port
      && origin.host.toLowerCase() === String(requestHost).trim().toLowerCase()
  } catch { return false }
}
function isLoopbackHost(value) {
  try {
    const hostname = new URL(`http://${String(value || '').trim()}`).hostname.replace(/^\[|\]$/g, '').toLowerCase()
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch { return false }
}
function isBareLoopbackHost(value) {
  try {
    const parsed = new URL(`http://${String(value || '').trim()}`)
    return isLoopbackHost(parsed.hostname) && !parsed.port && !parsed.username && !parsed.password
      && parsed.pathname === '/' && !parsed.search && !parsed.hash
  } catch { return false }
}
function formatHost(value) {
  const host = String(value).trim()
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}
function normalizeConfiguredLanHost(value) {
  const host = normalizeBareHost(value)
  if (!host || isLoopbackHost(host)) return ''
  const family = isIP(host)
  if (family === 4) {
    const [a, b] = host.split('.').map(Number)
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ? host : ''
  }
  if (family === 6) return /^(?:fc|fd|fe[89ab])/i.test(host) ? host.toLowerCase() : ''
  const labels = host.split('.')
  return host.length <= 253 && !labels.every((label) => /^\d+$/.test(label))
    && labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) ? host.toLowerCase() : ''
}
function normalizeBareHost(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const parsed = parseHostAuthority(isIP(raw) === 6 ? `[${raw}]` : raw)
  return parsed && parsed.port === null ? parsed.host : ''
}
function parseHostAuthority(value) {
  try {
    const parsed = new URL(`http://${String(value || '').trim()}`)
    if (!parsed.hostname || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null
    return { host: parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase(), port: parsed.port ? Number(parsed.port) : null }
  } catch { return null }
}
function isAllowedLoopbackOrigin(value, requestHost) {
  if (!value) return true
  try {
    const origin = new URL(String(value))
    return ['http:', 'https:'].includes(origin.protocol) && isLoopbackHost(origin.host)
      && origin.host.toLowerCase() === String(requestHost || '').toLowerCase()
  } catch { return false }
}

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value))
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length })
  response.end(body)
}

function writeSocketError(socket, status, message) {
  if (!socket.destroyed) {
    socket.end(`HTTP/1.1 ${status} Error\r\nConnection: close\r\nContent-Length: ${message.length}\r\n\r\n${message}`)
  }
}

function parseArgs(values) {
  const result = {
    host: '127.0.0.1',
    port: 5184,
    transportMode: 'loopback',
    configuredLanHost: '',
    targetFile: '',
    releaseId: '',
    profileId: '',
    instanceId: '',
    executableIdentity: '',
    activeReleaseFile: '',
    activeHostFile: '',
    activationJournalFile: '',
    committedTargetFile: '',
    healthIdentityTestFile: '',
    failReady: false,
  }
  for (let index = 0; index < values.length; index += 1) {
    const name = values[index]
    if (!name.startsWith('--')) throw new Error(`unexpected argument: ${name}`)
    const key = name.slice(2).replaceAll('-', '')
    if (key === 'host') result.host = values[++index]
    else if (key === 'port') result.port = Number.parseInt(values[++index] || '', 10)
    else if (key === 'transportmode') result.transportMode = values[++index]
    else if (key === 'configuredlanhost') result.configuredLanHost = values[++index]
    else if (key === 'targetfile') result.targetFile = values[++index]
    else if (key === 'releaseid') result.releaseId = values[++index]
    else if (key === 'profileid') result.profileId = values[++index]
    else if (key === 'instanceid') result.instanceId = values[++index]
    else if (key === 'executableidentity') result.executableIdentity = values[++index]
    else if (key === 'activereleasefile') result.activeReleaseFile = values[++index]
    else if (key === 'activehostfile') result.activeHostFile = values[++index]
    else if (key === 'activationjournalfile') result.activationJournalFile = values[++index]
    else if (key === 'committedtargetfile') result.committedTargetFile = values[++index]
    else if (key === 'healthidentitytestfile') result.healthIdentityTestFile = values[++index]
    else if (key === 'failready') result.failReady = true
    else throw new Error(`unknown argument: ${name}`)
  }
  return result
}

export {
  buildUpstreamHeaders,
  isAllowedLoopbackOrigin,
  isAllowedRequestHost,
  isAllowedRequestOrigin,
  isLoopbackHost,
  normalizeTarget,
  parseArgs,
  proxyHttp,
  readTarget,
  validateFrontDoorConfig,
}
