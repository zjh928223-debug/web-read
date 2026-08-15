import { spawn, spawnSync } from 'node:child_process'
import os from 'node:os'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import { isBrowserSafePort } from './lib/browser-port-policy.mjs'
import {
  createIsolatedRuntimeConfig,
  createIsolatedServiceToken,
  createIsolatedViteEnvironment,
  rejectExplicitReadWebUrl,
} from './lib/compatibility-isolation.mjs'
import { shouldContinueStaticRequest } from './lib/compatibility-network-policy.mjs'

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '..')
rejectExplicitReadWebUrl(process.env)
const configuredPort = process.env.READ_WEB_COMPAT_MAP_PORT
const port = configuredPort ? Number(configuredPort) : await findFreePort()
if (!isBrowserSafePort(port)) {
  throw new Error(`invalid compatibility map port: ${configuredPort || port}`)
}
const targetUrl = `http://127.0.0.1:${port}/`
const updateMode = process.argv.includes('--update')
const runtimeOutputPath = path.resolve(root, optionValue('--output') || 'output/architecture/compatibility-consumer-map.runtime.json')
const canonicalPath = path.resolve(root, 'docs/architecture/compatibility-consumer-map.json')
const canonicalOutputPath = path.resolve(root, optionValue('--canonical-output') || canonicalPath)
if (runtimeOutputPath === canonicalPath) {
  throw new Error('runtime output must be ignored; use --update to write the canonical map')
}
if (!isWithin(path.resolve(root, 'output', 'architecture'), runtimeOutputPath)) {
  throw new Error('runtime output must be under ignored output/architecture; use --canonical-output for a canonical update')
}

const retiredCompatibilityGlobals = [
  '__uiStore',
  '__transcriptStore',
  '__chunkStore',
  '__annotationStore'
]
const retiredCompatibilityScripts = [
  '/src/stores/ui.js',
  '/src/stores/transcript.js',
  '/src/stores/chunk.js',
  '/src/stores/annotation.js'
]

const sourceFiles = walk(path.join(root, 'src'))
  .filter((file) => /\.(?:js|vue)$/.test(file))
  .sort((left, right) => left.localeCompare(right))
  .concat(path.join(root, 'index.html'))
const staticMap = new Map()
const globalAccessPatterns = [
  /(?<![\w$.])window\.((?:__)?[A-Za-z_$][\w$]*)/g,
  /(?<![\w$.])(?:globalThis|globalObject|windowObject)\.((?:__)?[A-Za-z_$][\w$]*)/g,
  /(?<![\w$.])getWindow\(\)\.((?:__)?[A-Za-z_$][\w$]*)/g
]

for (const file of sourceFiles) {
  const source = fs.readFileSync(file, 'utf8')
  const relative = path.relative(root, file).replaceAll('\\', '/')
  const lines = source.split(/\r?\n/)
  lines.forEach((line, index) => {
    for (const pattern of globalAccessPatterns) {
      for (const match of line.matchAll(pattern)) {
        const name = match[1]
        if (isBrowserPrimitive(name)) continue
        const after = line.slice(match.index + match[0].length)
        const kind = /^\s*=/.test(after) && !/^\s*===?/.test(after) ? 'write' : 'read'
        const entry = staticMap.get(name) || { name, reads: [], writes: [] }
        entry[kind === 'write' ? 'writes' : 'reads'].push({ file: relative, line: index + 1 })
        staticMap.set(name, entry)
      }
    }
  })
}

const candidates = [...staticMap.keys()].sort()
const viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js')
const isolationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'read-web-compatibility-map-'))
const dataRoot = path.join(isolationRoot, 'data')
const runtimeConfigPath = path.join(isolationRoot, 'runtime.json')
const backendPort = await findFreePort()
const serviceToken = createIsolatedServiceToken('compatibility-map')
fs.mkdirSync(dataRoot, { recursive: true })
fs.writeFileSync(runtimeConfigPath, `${JSON.stringify(createIsolatedRuntimeConfig({
  frontendPort: port,
  backendPort,
  dataRoot,
}), null, 2)}\n`, 'utf8')
const isolatedViteEnv = createIsolatedViteEnvironment({
  frontendPort: port,
  backendPort,
  dataRoot,
  runtimeConfigPath,
  serviceToken,
})
let serverProcess = null
let browser = null

try {
  if (await canReach(targetUrl)) throw new Error(`compatibility map port ${port} is already occupied`)
  serverProcess = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--clearScreen', 'false'], {
    cwd: root,
    env: isolatedViteEnv,
    stdio: 'ignore',
    windowsHide: true
  })
  if (!(await waitForServer(targetUrl, 20_000))) throw new Error(`Vite did not become ready at ${targetUrl}`)

  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (shouldContinueStaticRequest(url.href, targetUrl)) return route.continue()
    return route.fulfill({ status: 204, body: '' })
  })
  await page.addInitScript((names) => {
    const counters = Object.create(null)
    Object.defineProperty(window, '__compatibilityConsumerCounters', {
      configurable: true,
      value: counters
    })
    for (const name of names) {
      let assigned
      let exposed
      counters[name] = { reads: 0, calls: 0, assigned: false, type: 'undefined' }
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get() {
          counters[name].reads += 1
          return exposed
        },
        set(value) {
          assigned = value
          counters[name].assigned = true
          counters[name].type = typeof value
          if (typeof value === 'function') {
            exposed = function (...args) {
              counters[name].calls += 1
              return Reflect.apply(assigned, this, args)
            }
          } else {
            exposed = value
          }
        }
      })
    }
  }, candidates)

  const consoleErrors = []
  const pageErrors = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto(targetUrl, { waitUntil: 'load', timeout: 30_000 })
  await page.waitForTimeout(1_000)

  const runtime = await page.evaluate((names) => ({
    counters: window.__compatibilityConsumerCounters,
    globals: names.map((name) => ({
      name,
      defined: Boolean(window.__compatibilityConsumerCounters[name].assigned),
      type: window.__compatibilityConsumerCounters[name].type
    })),
    scripts: [...document.scripts].map((script) => ({
      src: script.src ? new URL(script.src).pathname : '',
      type: script.type || 'classic',
      inline: !script.src
    })),
    inlineHandlers: [...document.querySelectorAll('*')].flatMap((element) =>
      [...element.attributes]
        .filter((attribute) => /^on/i.test(attribute.name))
        .map((attribute) => ({
          element: element.id ? `#${element.id}` : element.tagName.toLowerCase(),
          attribute: attribute.name,
          expression: attribute.value
        })))
  }), candidates)

  const runtimeProbes = {
    state: await probePropertyReads(page, ['__state'], () => document.querySelector('#transcript-container')?.dispatchEvent(new Event('click', { bubbles: true }))),
    bridge: await probePropertyReads(page, ['bridgeToPinia'], () => window.bridgeToPinia?.())
  }

  const globalsByName = new Map(runtime.globals.map((item) => [item.name, item]))
  const report = {
    schemaVersion: 1,
    capture: {
      mode: 'isolated-vite-runtime',
      port,
      sourceRoot: 'src + index.html',
      consoleErrors,
      pageErrors
    },
    summary: {
      compatibilitySurfaces: candidates.length,
      staticReaders: [...staticMap.values()].filter((entry) => entry.reads.length).length,
      staticWriters: [...staticMap.values()].filter((entry) => entry.writes.length).length,
      runtimeDefined: runtime.globals.filter((item) => item.defined).length,
      runtimeCalled: Object.values(runtime.counters).filter((item) => item.calls > 0).length,
      inlineHandlers: runtime.inlineHandlers.length,
      loadedScripts: runtime.scripts.filter((script) => !script.inline).length
    },
    negativeAssertions: {
      retiredCompatibilityGlobalsAbsent: retiredCompatibilityGlobals,
      retiredCompatibilityScriptsAbsent: retiredCompatibilityScripts
    },
    storeConsumers: buildStoreConsumers(staticMap, runtime.scripts),
    criticalSurfaces: buildCriticalSurfaces(staticMap),
    surfaces: [...staticMap.values()].sort((a, b) => a.name.localeCompare(b.name)).map((entry) => ({
      ...entry,
      reads: sortLocations(entry.reads),
      writes: sortLocations(entry.writes),
      runtime: {
        ...globalsByName.get(entry.name),
        ...runtime.counters[entry.name]
      }
    })),
    runtimeProbes,
    scripts: runtime.scripts,
    inlineHandlers: runtime.inlineHandlers
  }

  if (consoleErrors.length || pageErrors.length) {
    throw new Error(`runtime capture reported errors: ${[...consoleErrors, ...pageErrors].join(' | ')}`)
  }
  assertRetiredCompatibilityAbsent(report)
  const runtimeJson = `${JSON.stringify(report, null, 2)}\n`
  const canonicalJson = `${JSON.stringify(canonicalizeReport(report), null, 2)}\n`
  fs.mkdirSync(path.dirname(runtimeOutputPath), { recursive: true })
  fs.writeFileSync(runtimeOutputPath, runtimeJson, 'utf8')

  if (updateMode) {
    fs.mkdirSync(path.dirname(canonicalOutputPath), { recursive: true })
    fs.writeFileSync(canonicalOutputPath, canonicalJson, 'utf8')
    console.log(`compatibility consumer map updated: ${path.relative(root, canonicalOutputPath)}`)
  } else {
    if (!fs.existsSync(canonicalPath)) {
      throw new Error(`canonical compatibility map is missing: ${path.relative(root, canonicalPath)}`)
    }
    const expected = fs.readFileSync(canonicalPath, 'utf8')
    if (expected !== canonicalJson) {
      throw new Error('canonical compatibility map is stale; run `node scripts/compatibility-consumer-map.mjs --update`')
    }
    console.log(`compatibility consumer map verified: ${path.relative(root, canonicalPath)}`)
  }
  console.log(JSON.stringify(report.summary))
} finally {
  if (browser) await browser.close()
  if (serverProcess) killProcessTree(serverProcess)
  fs.rmSync(isolationRoot, { recursive: true, force: true })
}

function optionValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function findFreePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const freePort = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  if (!isBrowserSafePort(freePort)) return findFreePort()
  return freePort
}

function isWithin(directory, target) {
  const relative = path.relative(directory, target)
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function canonicalizeReport(report) {
  return {
    ...report,
    capture: {
      ...report.capture,
      port: 0
    },
    surfaces: report.surfaces.map((surface) => ({
      ...surface,
      runtime: canonicalizeRuntime(surface.runtime)
    }))
  }
}

function canonicalizeRuntime(runtime) {
  if (!runtime) return runtime
  return {
    ...runtime,
    reads: runtime.reads > 0 ? 1 : 0
  }
}

function buildStoreConsumers(map, scripts) {
  const storesDirectory = path.join(root, 'src', 'stores')
  if (!fs.existsSync(storesDirectory)) return []
  return walk(storesDirectory)
    .filter((file) => /\.js$/.test(file))
    .sort((left, right) => left.localeCompare(right))
    .map((file) => {
      const relative = path.relative(root, file).replaceAll('\\', '/')
      const source = fs.readFileSync(file, 'utf8')
      const surfaces = [...source.matchAll(/\bwindow\.((?:__)?[A-Za-z_$][\w$]*)\s*=/g)]
        .map((match) => match[1])
        .filter((name) => name.startsWith('__'))
        .sort()
      const globalSurfaces = [...new Set(surfaces)]
      const consumers = globalSurfaces.reduce((result, name) => {
        const entry = map.get(name)
        if (!entry) return result
        result.readers.push(...entry.reads.filter((location) => location.file !== relative))
        result.writers.push(...entry.writes.filter((location) => location.file !== relative))
        return result
      }, { readers: [], writers: [] })
      return {
        file: relative,
        loaded: scripts.some((script) => script.src === `/${relative}`),
        globalSurfaces,
        readers: uniqueSortedLocations(consumers.readers),
        writers: uniqueSortedLocations(consumers.writers)
      }
    })
}

function buildCriticalSurfaces(map) {
  return Object.fromEntries(['__state', 'bridgeToPinia'].map((name) => {
    const entry = map.get(name) || { reads: [], writes: [] }
    return [name, {
      readers: sortLocations(entry.reads),
      writers: sortLocations(entry.writes)
    }]
  }))
}

function uniqueSortedLocations(locations) {
  const unique = new Map(locations.map((location) => [`${location.file}:${location.line}`, location]))
  return sortLocations([...unique.values()])
}

function sortLocations(locations) {
  return [...locations].sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line)
}

function assertRetiredCompatibilityAbsent(report) {
  const presentGlobals = new Set(report.surfaces.map((surface) => surface.name))
  const presentScripts = new Set(report.scripts.map((script) => script.src))
  const presentGlobalsList = retiredCompatibilityGlobals.filter((name) => presentGlobals.has(name))
  const presentScriptsList = retiredCompatibilityScripts.filter((src) => presentScripts.has(src))
  if (presentGlobalsList.length || presentScriptsList.length) {
    throw new Error(`retired compatibility surfaces reappeared: globals=${presentGlobalsList.join(',')} scripts=${presentScriptsList.join(',')}`)
  }
}

function isBrowserPrimitive(name) {
  return new Set([
    'addEventListener', 'alert', 'clearInterval', 'clearTimeout', 'confirm', 'crypto', 'document',
    'fetch', 'focus', 'getSelection', 'history', 'indexedDB', 'innerHeight', 'innerWidth', 'localStorage',
    'location', 'matchMedia', 'navigator', 'open', 'parent', 'performance', 'removeEventListener',
    'requestAnimationFrame', 'setInterval', 'setTimeout', 'speechSynthesis',
    'self', 'SpeechSynthesisUtterance', 'top', 'URL', 'window'
  ]).has(name)
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(target) : [target]
  })
}

function canReach(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => { response.resume(); resolve(true) })
    request.on('error', () => resolve(false))
    request.setTimeout(1_000, () => { request.destroy(); resolve(false) })
  })
}

async function waitForServer(url, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await canReach(url)) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}

function killProcessTree(child) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    child.kill('SIGTERM')
  }
}

async function probePropertyReads(page, names, action) {
  return page.evaluate(({ names, actionSource }) => {
    const reads = Object.fromEntries(names.map((name) => [name, 0]))
    const restores = []
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(window, name)
      if (!descriptor || !descriptor.configurable) continue
      const value = window[name]
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get() { reads[name] += 1; return value },
        set(next) { Object.defineProperty(window, name, { configurable: true, enumerable: descriptor.enumerable, writable: true, value: next }) }
      })
      restores.push(() => Object.defineProperty(window, name, descriptor))
    }
    try {
      const fn = (0, eval)(`(${actionSource})`)
      fn()
    } finally {
      restores.reverse().forEach((restore) => restore())
    }
    return reads
  }, { names, actionSource: action.toString() })
}
