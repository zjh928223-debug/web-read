import assert from 'node:assert/strict'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scriptsRoot = path.join(repositoryRoot, 'scripts')
const packagePath = path.join(repositoryRoot, 'package.json')
const inventoryPath = path.join(repositoryRoot, 'docs', 'architecture', 'test-inventory.json')
const executableExtensions = new Set(['.js', '.cjs', '.mjs'])
const packageScriptPattern = /(?:npm|npm\.cmd)\s+run\s+([\w:.-]+)/g
const pathPattern = /(?:^|["'\s(])((?:scripts|tools\/subtitle-workflow\/scripts)\/[A-Za-z0-9_./-]+\.(?:cjs|mjs|js|py|ps1|sh))/g
const explicitCommandLayers = new Map([
  ['verify:fast', ['architecture', 'behavior']],
  ['verify:full', ['architecture', 'behavior', 'browser']],
  ['verify:release', ['architecture', 'behavior', 'browser', 'performance', 'release']],
])
const architectureEvidenceOwnedByOtherGates = new Set([
  'scripts/exam-vocabulary-import-closure-check.cjs',
  'scripts/learning-page-launcher-check.mjs',
  'scripts/legacy-vocabulary-audit-check.cjs',
  'scripts/legacy-vocabulary-migration-check.mjs',
  'scripts/local-sentence-warehouse-check.mjs',
  'scripts/merriam-webster-sentence-check.mjs',
  'scripts/passage-preview-check.cjs',
  'scripts/personalization-shadow-activation-check.mjs',
  'scripts/personalization-shadow-diagnostics-check.mjs',
  'scripts/production-host-lifecycle-check.mjs',
  'scripts/runtime-config-integration-check.mjs',
  'scripts/srs-review-check.cjs',
  'scripts/srs-review-ui-v2-check.cjs',
  'scripts/verify-vocabulary-personalization-content.mjs',
  'scripts/verify-vocabulary-personalization-shadow.mjs',
  'scripts/vocabulary-context-evidence-check.cjs',
  'scripts/vocabulary-preview-service-check.cjs',
  'scripts/youtube-workflow-loader-check.cjs',
  'scripts/youtube-workflow-panel-check.cjs',
])

const sourceShapeNames = [
  'source', 'moduleSource', 'appSource', 'assemblySource', 'featureSource', 'runtimeSource',
  'html', 'indexSource', 'stylesSource', 'templateSource', 'packageSource', 'configSource',
  'manifestSource', 'scriptSource', 'text',
]
const sourceShapeIdentifier = sourceShapeNames.join('|')

const packageJson = JSON.parse(await readFile(packagePath, 'utf8'))
const allPackageScripts = Object.entries(packageJson.scripts || {})
  .sort(([left], [right]) => left.localeCompare(right))
const packageScripts = allPackageScripts
  .filter(([name]) => /^(verify|test|release|dictionary:)/.test(name))
  .sort(([left], [right]) => left.localeCompare(right))

const scriptPaths = (await walk(scriptsRoot))
  .filter((absolutePath) => executableExtensions.has(path.extname(absolutePath)))
  .filter((absolutePath) => !absolutePath.split(path.sep).includes('fixtures'))
  .map(toRelative)
  .sort()

const sourceByPath = new Map()
for (const relativePath of scriptPaths) {
  sourceByPath.set(relativePath, await readFile(path.join(repositoryRoot, relativePath), 'utf8'))
}

const packageInvocations = new Map()
for (const [name, command] of allPackageScripts) {
  packageInvocations.set(name, collectCommandPaths(command))
}

const ownersByPath = new Map(scriptPaths.map((relativePath) => [relativePath, new Set()]))
const packageDepthByPath = new Map(scriptPaths.map((relativePath) => [relativePath, Number.POSITIVE_INFINITY]))
const visitedCommands = new Set()

function visitPackageScript(name, depth = 0) {
  if (visitedCommands.has(name)) return
  visitedCommands.add(name)
  const command = packageJson.scripts?.[name]
  if (typeof command !== 'string') return
  for (const relativePath of packageInvocations.get(name) || []) {
    if (!ownersByPath.has(relativePath)) continue
    ownersByPath.get(relativePath).add(`package.json#scripts.${name}`)
    packageDepthByPath.set(relativePath, Math.min(packageDepthByPath.get(relativePath), depth))
  }
  for (const nestedName of collectNestedPackageScripts(command)) {
    visitPackageScript(nestedName, depth + 1)
    for (const [relativePath, owners] of ownersByPath.entries()) {
      if (owners.has(`package.json#scripts.${nestedName}`)) {
        owners.add(`package.json#scripts.${name}`)
        packageDepthByPath.set(relativePath, Math.min(packageDepthByPath.get(relativePath), depth + 1))
      }
    }
  }
}

for (const [name] of allPackageScripts) visitPackageScript(name)

const scriptInventory = await readJsonIfPresent(path.join(repositoryRoot, 'docs', 'architecture', 'script-inventory.json'))
const inventoryOwnership = new Map()
for (const category of ['releaseGate', 'devTool', 'archiveDelete']) {
  for (const relativePath of scriptInventory?.[category] || []) {
    if (!inventoryOwnership.has(relativePath)) inventoryOwnership.set(relativePath, [])
    inventoryOwnership.get(relativePath).push(`docs/architecture/script-inventory.json#${category}`)
  }
}

const tests = scriptPaths.map((relativePath) => {
  const source = sourceByPath.get(relativePath)
  const owners = [...(ownersByPath.get(relativePath) || [])].sort()
  const evidence = classifyEvidence(relativePath, source)
  const layers = classifyLayers(relativePath, source, evidence, owners)
  const inventoryOwners = inventoryOwnership.get(relativePath) || []
  const allOwners = [...new Set([...owners, ...inventoryOwners])].sort()
  if (layers.includes('architecture') && !allOwners.length) {
    allOwners.push('package.json#scripts.verify:architecture:source-shape')
  }
  return {
    path: relativePath,
    category: primaryCategory(layers),
    layers,
    aggregates: layers.includes('architecture')
      && !layers.some((layer) => ['browser', 'performance', 'release'].includes(layer))
      && !architectureEvidenceOwnedByOtherGates.has(relativePath)
      ? ['architecture:source-shape']
      : [],
    owner: allOwners[0] || null,
    owners: allOwners,
    invocation: Number.isFinite(packageDepthByPath.get(relativePath))
      ? packageDepthByPath.get(relativePath) === 0 ? 'direct' : 'transitive'
      : inventoryOwners.length ? 'inventory-only' : 'orphan',
    evidence,
  }
})

const packageCommands = packageScripts.map(([name, command]) => {
  const directPaths = packageInvocations.get(name) || []
  const layers = resolveCommandLayers(name)
  return {
    name,
    command,
    category: primaryCategory(layers),
    layers,
    invokes: directPaths,
    owner: `package.json#scripts.${name}`,
  }
})

function resolveCommandLayers(name, visiting = new Set()) {
  if (explicitCommandLayers.has(name)) return [...explicitCommandLayers.get(name)].sort(categoryOrder)
  if (visiting.has(name)) return []
  const nextVisiting = new Set(visiting).add(name)
  const command = packageJson.scripts?.[name] || ''
  const nestedLayers = collectNestedPackageScripts(command)
    .flatMap((nestedName) => resolveCommandLayers(nestedName, nextVisiting))
  return classifyCommand(name, command, packageInvocations.get(name) || [], tests, nestedLayers)
}

const result = {
  schemaVersion: 2,
  generatedBy: 'scripts/test-inventory.mjs',
  scope: 'Package verification/test/release commands and every transitive Node script under scripts/.',
  categories: Object.fromEntries(['architecture', 'behavior', 'browser', 'performance', 'release'].map((category) => [
    category,
    tests.filter((test) => test.category === category).length,
  ])),
  packageScriptCount: packageCommands.length,
  executableScriptCount: tests.length,
  packageCommands,
  tests,
  orphans: tests.filter((test) => test.invocation === 'orphan').map((test) => test.path),
}

if (process.argv.includes('--self-test')) {
  runSelfTest()
  console.log('test inventory classifier self-test passed')
  process.exit(0)
}

if (process.argv.includes('--write')) {
  await writeFile(inventoryPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(`wrote ${path.relative(repositoryRoot, inventoryPath)} (${tests.length} scripts, ${packageCommands.length} package commands)`)
  process.exit(0)
}

const expected = await readJsonIfPresent(inventoryPath)
if (!expected) {
  console.error(`missing ${path.relative(repositoryRoot, inventoryPath)}; run npm run verify:test-inventory:update`)
  process.exit(1)
}
assert.deepEqual(result, expected, 'test inventory is stale; run npm run verify:test-inventory:update and review the diff')
assert.equal(result.orphans.length, 0, `orphan test scripts: ${result.orphans.join(', ')}`)
for (const category of ['architecture', 'behavior', 'browser', 'performance', 'release']) {
  assert.ok(result.categories[category] > 0, `${category} classification must not be empty`)
}
console.log(`test inventory passed (${tests.length} scripts, ${packageCommands.length} package commands; ${JSON.stringify(result.categories)})`)

function collectCommandPaths(command) {
  const paths = []
  for (const match of command.replaceAll('\\', '/').matchAll(pathPattern)) {
    const relativePath = match[1]
    if (relativePath.startsWith('scripts/')) paths.push(relativePath)
  }
  return [...new Set(paths)].sort()
}

function collectNestedPackageScripts(command) {
  return [...command.matchAll(packageScriptPattern)].map((match) => match[1]).filter((name) => name in (packageJson.scripts || {}))
}

function classifyEvidence(relativePath, source) {
  const sourceShape = []
  const normalized = source.replaceAll('\\', '/')
  const sourceRead = /(?:readFileSync|readFile|fs\.read|Get-Content)[\s\S]{0,180}(?:src|index\.html|styles\.css|package\.json)/i.test(normalized)
  if (new RegExp(`(?:${sourceShapeIdentifier})\\.includes\\s*\\(`).test(source)) sourceShape.push('includes-source-text')
  if (new RegExp(`(?:${sourceShapeIdentifier})\\.match(?:All)?\\s*\\(`).test(source)) sourceShape.push('matches-source-text')
  if (new RegExp(`(?:${sourceShapeIdentifier})\\.indexOf\\s*\\(`).test(source)) sourceShape.push('indexes-source-text')
  if (new RegExp(`assert\\.(?:match|ok|equal|notEqual)\\([^\\n]*(?<![\\w$])(?:${sourceShapeIdentifier})(?![\\w$])`).test(source)) {
    sourceShape.push('asserts-source-text')
  }
  if (/existsSync\(|readdirSync\(|statSync\(/.test(source)) sourceShape.push('asserts-file-shape')

  return {
    sourceShape: [...new Set(sourceShape)].sort(),
    sourceRead,
    browser: /(?:browser|journey|vite)-/.test(relativePath)
      || /(?:from\s+['"]playwright['"]|require\(['"]playwright['"]\)|chromium\.launch\s*\()/i.test(source),
    performance: /(?:^|\/)(?:perf|performance)(?:\/|-)|benchmark|budget/i.test(relativePath)
      || /(?:performance\.now\s*\(|PerformanceObserver\s*\()/i.test(source),
    release: /release|clean-room|supply-chain|repository-hygiene|script-inventory|current-documentation|license|secret-scan/i.test(relativePath),
    behaviorAssertions: /node:assert|assert\.(?:equal|deepEqual|deepStrictEqual|ok|rejects|throws|match)/.test(source),
    executesModule: /data:text\/javascript|import\s*\(|require\s*\(/.test(source),
    startsBrowser: /playwright|chromium|launch\s*\(/i.test(source),
  }
}

function classifyLayers(relativePath, source, evidence, owners) {
  if (relativePath === 'scripts/test-inventory.mjs') return ['architecture']
  if (relativePath === 'scripts/verify-architecture.mjs') return ['architecture']
  if (relativePath === 'scripts/verify-behavior.mjs') return ['behavior']
  const layers = new Set()
  const name = `${relativePath} ${owners.join(' ')}`.toLowerCase()
  const behaviorOnlyModuleTest = !evidence.sourceShape.length && evidence.behaviorAssertions && evidence.executesModule
  if (evidence.sourceShape.length || (!behaviorOnlyModuleTest && /verify:architecture:|source-shape|facade|boundary|legacy|deletion|drain|script-order|runtime-(?:assembly|context|deps|source)|state-facade/.test(name))) {
    layers.add('architecture')
  }
  if (evidence.browser || /verify:(?:vite|interactions|playback|.*browser|.*journey)/.test(name)) layers.add('browser')
  if (evidence.performance || /verify:performance|perf\//.test(name)) layers.add('performance')
  if (evidence.release || /verify:(?:release|clean-room|supply-chain|repository-hygiene|script-inventory|current-documentation)|release:/.test(name)) layers.add('release')
  if (evidence.behaviorAssertions || evidence.executesModule || !layers.size) layers.add('behavior')
  return [...layers].sort(categoryOrder)
}

function classifyCommand(name, command, directPaths, tests, inheritedLayers = []) {
  if (/^verify:architecture:/.test(name)) return ['architecture']
  if (/^verify:behavior:/.test(name)) return ['behavior']
  const direct = [
    ...inheritedLayers,
    ...directPaths.flatMap((relativePath) => tests.find((test) => test.path === relativePath)?.layers || []),
  ]
  if (/verify:architecture:|source-shape/i.test(name)) direct.push('architecture')
  if (/verify:behavior/i.test(name)) direct.push('behavior')
  if (/verify:performance|benchmark|perf(?::|$)/i.test(name)) direct.push('performance')
  if (/verify:release|release:|clean-room|supply-chain|manifest|hygiene/i.test(name)) direct.push('release')
  if (/browser|journey|vite|interaction/i.test(name)) direct.push('browser')
  if (!direct.length) direct.push('behavior')
  return [...new Set(direct)].sort(categoryOrder)
}

function primaryCategory(layers) {
  return [...layers].sort((left, right) => categoryOrder(left) - categoryOrder(right))[0] || 'behavior'
}

function categoryOrder(category) {
  return { release: 0, performance: 1, browser: 2, architecture: 3, behavior: 4 }[category] ?? 99
}

async function readJsonIfPresent(filename) {
  try {
    return JSON.parse(await readFile(filename, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walk(absolutePath))
    else files.push(absolutePath)
  }
  return files
}

function toRelative(absolutePath) {
  return path.relative(repositoryRoot, absolutePath).replaceAll(path.sep, '/')
}

function runSelfTest() {
  const staticShape = classifyEvidence('scripts/example-check.cjs', "const source = fs.readFileSync('src/example.js', 'utf8'); assert.ok(source.includes('owner'))")
  assert.ok(staticShape.sourceShape.includes('includes-source-text'))
  assert.equal(staticShape.browser, false)
  const browser = classifyEvidence('scripts/example-browser-journey.mjs', "import { chromium } from 'playwright'; await chromium.launch()")
  assert.equal(browser.browser, true)
  assert.equal(browser.startsBrowser, true)
  const performance = classifyEvidence('scripts/perf/example-budget.mjs', 'assert.equal(p95, 100)')
  assert.equal(performance.performance, true)
  const release = classifyEvidence('scripts/verify-release.mjs', 'generate release manifest and clean-room install')
  assert.equal(release.release, true)
  const behavior = classifyEvidence('scripts/example-check.mjs', "import assert from 'node:assert/strict'; assert.deepEqual(actual, expected)")
  assert.equal(behavior.behaviorAssertions, true)
  assert.deepEqual(classifyLayers('scripts/test-inventory.mjs', '', release, []), ['architecture'])
  assert.deepEqual(classifyCommand('verify:behavior:migrated-interfaces', 'node scripts/verify-behavior.mjs', [], []), ['behavior'])
  const excludedWords = classifyEvidence(
    'scripts/example-check.mjs',
    "assert.ok(!source.includes('release secret performance browser'))",
  )
  assert.equal(excludedWords.browser, false)
  assert.equal(excludedWords.performance, false)
  assert.equal(excludedWords.release, false)
  assert.deepEqual(classifyCommand('verify:fast', 'node scripts/verify-fast.mjs', [], []), ['behavior'])
}
