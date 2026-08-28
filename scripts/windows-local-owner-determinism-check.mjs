import { readFile } from 'node:fs/promises'
import {
  OWNER_ARTIFACT_FILES,
  REPOSITORY_ROOT,
  artifactSetChecksum,
  assert,
  canonicalJson,
  loadOwnerArtifacts,
  readJson,
} from './lib/windows-local-owner-artifacts.mjs'

const first = await loadOwnerArtifacts()
const second = await loadOwnerArtifacts()
assert(canonicalJson(first) === canonicalJson(second), 'owner artifact set is not deterministic across repeated reads')
for (const filename of OWNER_ARTIFACT_FILES) {
  assert(canonicalJson(first[filename]) === canonicalJson(second[filename]), `${filename} canonical JSON changed between reads`)
}

const compatibilityMap = await readJson('docs/architecture/compatibility-consumer-map.json')
const mapTextA = await readFile(`${REPOSITORY_ROOT}/docs/architecture/compatibility-consumer-map.json`, 'utf8')
const mapTextB = await readFile(`${REPOSITORY_ROOT}/docs/architecture/compatibility-consumer-map.json`, 'utf8')
assert(canonicalJson(compatibilityMap) === canonicalJson(JSON.parse(mapTextA)), 'compatibility map canonicalization changed on first replay')
assert(canonicalJson(compatibilityMap) === canonicalJson(JSON.parse(mapTextB)), 'compatibility map canonicalization changed on second replay')
assert(compatibilityMap.capture?.port === 0, 'compatibility map canonical port must remain 0')

const testInventory = await readJson('docs/architecture/test-inventory.json')
const testInventoryTextA = await readFile(`${REPOSITORY_ROOT}/docs/architecture/test-inventory.json`, 'utf8')
const testInventoryTextB = await readFile(`${REPOSITORY_ROOT}/docs/architecture/test-inventory.json`, 'utf8')
assert(canonicalJson(testInventory) === canonicalJson(JSON.parse(testInventoryTextA)), 'test inventory canonicalization changed on first replay')
assert(canonicalJson(testInventory) === canonicalJson(JSON.parse(testInventoryTextB)), 'test inventory canonicalization changed on second replay')
assert(testInventory.orphans.length === 0, 'test inventory contains orphan scripts')

console.log(`windows local owner determinism passed (artifact set checksum: ${artifactSetChecksum(first)})`)
