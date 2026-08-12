import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '..')
const port = Number(process.env.READ_WEB_COMPAT_MAP_PORT || 4195)
const targetUrl = `http://127.0.0.1:${port}/`
const outputArgIndex = process.argv.indexOf('--output')
const outputPath = path.resolve(root, outputArgIndex >= 0 && process.argv[outputArgIndex + 1]
  ? process.argv[outputArgIndex + 1]
  : 'output/architecture/compatibility-consumer-map.json')

const sourceFiles = walk(path.join(root, 'src'))
  .filter((file) => /\.(?:js|vue)$/.test(file))
  .concat(path.join(root, 'index.html'))
const staticMap = new Map()

for (const file of sourceFiles) {
  const source = fs.readFileSync(file, 'utf8')
  const relative = path.relative(root, file).replaceAll('\\', '/')
  const lines = source.split(/\r?\n/)
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/\bwindow\.((?:__)?[A-Za-z_$][\w$]*)/g)) {
      const name = match[1]
      if (isBrowserPrimitive(name)) continue
      const after = line.slice(match.index + match[0].length)
      const kind = /^\s*=/.test(after) && !/^\s*===?/.test(after) ? 'write' : 'read'
      const entry = staticMap.get(name) || { name, reads: [], writes: [] }
      entry[kind === 'write' ? 'writes' : 'reads'].push({ file: relative, line: index + 1 })
      staticMap.set(name, entry)
    }
  })
}

const candidates = [...staticMap.keys()].sort()
const viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js')
let serverProcess = null
let browser = null

try {
  if (await canReach(targetUrl)) throw new Error(`compatibility map port ${port} is already occupied`)
  serverProcess = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--clearScreen', 'false'], {
    cwd: root,
    stdio: 'ignore',
    windowsHide: true
  })
  if (!(await waitForServer(targetUrl, 20_000))) throw new Error(`Vite did not become ready at ${targetUrl}`)

  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === '127.0.0.1') return route.continue()
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
    surfaces: [...staticMap.values()].sort((a, b) => a.name.localeCompare(b.name)).map((entry) => ({
      ...entry,
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
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(`compatibility consumer map written: ${path.relative(root, outputPath)}`)
  console.log(JSON.stringify(report.summary))
} finally {
  if (browser) await browser.close()
  if (serverProcess) killProcessTree(serverProcess)
}

function isBrowserPrimitive(name) {
  return new Set([
    'addEventListener', 'alert', 'clearTimeout', 'confirm', 'history', 'innerHeight', 'innerWidth',
    'localStorage', 'location', 'removeEventListener', 'requestAnimationFrame', 'setTimeout',
    'speechSynthesis', 'SpeechSynthesisUtterance'
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
