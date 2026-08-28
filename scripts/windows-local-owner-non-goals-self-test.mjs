import {
  FROZEN_IDB_SCHEMA,
  aggregateIndexedDbSchemaSemantics,
  assert,
  indexedDbSchemaSemanticDiff,
  indexedDbSchemaSemanticFingerprint,
  protectedPathViolations,
} from './lib/windows-local-owner-artifacts.mjs'

const protectedPath = 'tools/subtitle-workflow/chunker/chunk_rules.py'

assert(
  protectedPathViolations({
    milestonePaths: [],
    stagedPaths: [],
    protectedPaths: [protectedPath],
  }).length === 0,
  'unstaged protected working-tree edits must not be treated as milestone changes',
)
assert(
  protectedPathViolations({
    milestonePaths: [protectedPath],
    stagedPaths: [],
    protectedPaths: [protectedPath],
  }).length === 1,
  'a protected path committed in the milestone range must be rejected',
)
assert(
  protectedPathViolations({
    milestonePaths: [],
    stagedPaths: [protectedPath],
    protectedPaths: [protectedPath],
  }).length === 1,
  'a protected path staged for the next commit must be rejected',
)

const schemaFixture = `
const DB_NAME = '${FROZEN_IDB_SCHEMA.databaseName}';
const DB_VERSION = ${FROZEN_IDB_SCHEMA.version};
const STORE_NAME = '${FROZEN_IDB_SCHEMA.objectStore}';
const request = indexedDB.open(DB_NAME, DB_VERSION);
request.onupgradeneeded = () => {};
const schema = { keyPath: '${FROZEN_IDB_SCHEMA.keyPath}' };
`
const businessOnlyChange = `${schemaFixture}\nconst unrelatedValue = 'allowed';\n`
assert(
  indexedDbSchemaSemanticDiff(
    indexedDbSchemaSemanticFingerprint(schemaFixture),
    indexedDbSchemaSemanticFingerprint(businessOnlyChange),
  ).length === 0,
  'semantic schema guard must allow unrelated source changes',
)
const schemaIdentity = aggregateIndexedDbSchemaSemantics([
  indexedDbSchemaSemanticFingerprint(schemaFixture),
])
assert(schemaIdentity.databaseNames.includes(FROZEN_IDB_SCHEMA.databaseName), 'fixture database identity was not captured')
assert(schemaIdentity.versions.includes(String(FROZEN_IDB_SCHEMA.version)), 'fixture version was not captured')
assert(schemaIdentity.storeNames.includes(FROZEN_IDB_SCHEMA.objectStore), 'fixture store was not captured')
assert(schemaIdentity.keyPaths.includes(FROZEN_IDB_SCHEMA.keyPath), 'fixture key path was not captured')

const schemaChange = schemaFixture.replace('DB_VERSION = 1', 'DB_VERSION = 2')
assert(
  indexedDbSchemaSemanticDiff(
    indexedDbSchemaSemanticFingerprint(schemaFixture),
    indexedDbSchemaSemanticFingerprint(schemaChange),
  ).length > 0,
  'schema version changes must be rejected',
)
const destructiveChange = `${schemaFixture}\nstore.clear();\n`
assert(
  indexedDbSchemaSemanticDiff(
    indexedDbSchemaSemanticFingerprint(schemaFixture),
    indexedDbSchemaSemanticFingerprint(destructiveChange),
  ).length > 0,
  'new destructive clear operations must be rejected',
)

console.log('windows local owner non-goal self-test passed (unstaged protected edits allowed; schema semantics guarded)')
