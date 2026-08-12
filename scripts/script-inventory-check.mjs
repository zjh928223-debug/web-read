import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const inventoryPath = path.join(repoRoot, 'docs', 'architecture', 'script-inventory.json')
const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'))
const executableExtensions = new Set(['.js', '.cjs', '.mjs', '.py', '.ps1', '.sh'])

assert.equal(inventory.schemaVersion, 1)
for (const category of ['releaseGate', 'devTool', 'archiveDelete']) {
  assert.ok(Array.isArray(inventory[category]), `${category} must be an array`)
  assert.deepEqual(inventory[category], [...inventory[category]].sort(), `${category} must stay sorted`)
}

const liveInventory = [...inventory.releaseGate, ...inventory.devTool]
const everyInventoryPath = [...liveInventory, ...inventory.archiveDelete]
assert.equal(new Set(everyInventoryPath).size, everyInventoryPath.length, 'inventory paths must be unique')

for (const relativePath of liveInventory) {
  assert.ok(fs.existsSync(path.join(repoRoot, relativePath)), `${relativePath} is inventoried but missing`)
}
for (const relativePath of inventory.archiveDelete) {
  assert.ok(!fs.existsSync(path.join(repoRoot, relativePath)), `${relativePath} is retired and must remain absent`)
}

const packageCommands = Object.values(packageJson.scripts || {}).join('\n').replaceAll('\\', '/')
const executableScripts = walk(path.join(repoRoot, 'scripts'))
  .filter((absolutePath) => executableExtensions.has(path.extname(absolutePath)))
  .filter((absolutePath) => !absolutePath.split(path.sep).includes('fixtures'))
  .map(relative)
  .sort()
const packageExternal = executableScripts.filter((relativePath) => !packageCommands.includes(relativePath))

assert.deepEqual(
  packageExternal,
  [...liveInventory].sort(),
  'every package-external executable script must be classified as releaseGate or devTool',
)

const directlyNamedScripts = executableScripts.filter((relativePath) => packageCommands.includes(relativePath))
for (const relativePath of inventory.releaseGate) {
  const basename = path.posix.basename(relativePath)
  const owners = directlyNamedScripts.filter((ownerPath) => {
    const source = fs.readFileSync(path.join(repoRoot, ownerPath), 'utf8')
    return source.includes(basename)
  })
  assert.ok(owners.length > 0, `${relativePath} is labeled releaseGate but has no directly named package owner`)
}

for (const retiredName of ['verify:read26', 'verify:youtube-workflow-startup']) {
  assert.ok(!(retiredName in packageJson.scripts), `${retiredName} must remain retired`)
}
for (const relativePath of inventory.archiveDelete) {
  assert.ok(!packageCommands.includes(relativePath), `${relativePath} must not be referenced by package scripts`)
}

console.log(`script inventory passed (${executableScripts.length} executable scripts, ${packageExternal.length} classified outside package.json)`)

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(absolutePath) : [absolutePath]
  })
}

function relative(absolutePath) {
  return path.relative(repoRoot, absolutePath).replaceAll(path.sep, '/')
}
