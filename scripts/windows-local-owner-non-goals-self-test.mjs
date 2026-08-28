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
const database = indexedDB;
const probe = database.transaction(['files'], 'readonly').objectStore('files');
if (probe.keyPath !== '${FROZEN_IDB_SCHEMA.keyPath}') throw new Error('schema');
`
const businessOnlyChange = `${schemaFixture}\nconst unrelatedValue = 'allowed';\n`
assert(
  indexedDbSchemaSemanticDiff(
    indexedDbSchemaSemanticFingerprint(schemaFixture),
    indexedDbSchemaSemanticFingerprint(businessOnlyChange),
  ).length === 0,
  'semantic schema guard must allow unrelated source changes',
)
const cacheAndCommentChange = `${schemaFixture}
const cache = new Map();
cache.clear();
// onupgradeneeded createObjectStore('wrong-store')
/* indexedDB.deleteDatabase('wrong-database') */
`
assert(
  indexedDbSchemaSemanticDiff(
    indexedDbSchemaSemanticFingerprint(schemaFixture),
    indexedDbSchemaSemanticFingerprint(cacheAndCommentChange),
  ).length === 0,
  'cache.clear() and commented schema words must not be treated as IDB changes',
)
const noUpgradeHandler = schemaFixture.replace('request.onupgradeneeded = () => {};', '')
assert(
  indexedDbSchemaSemanticDiff(
    indexedDbSchemaSemanticFingerprint(schemaFixture),
    indexedDbSchemaSemanticFingerprint(noUpgradeHandler),
  ).length === 0,
  'removing a legacy onupgradeneeded handler must be allowed',
)
const legacyWriter = `${schemaFixture}
function legacyAdapter(database) {
  const transaction = database.transaction(['files'], 'readwrite');
  const store = transaction.objectStore('files');
  return store.put({ id: 'legacy' });
}
`
const movedOrRemovedWriter = `${schemaFixture}
function replacementAdapter(database) {
  const transaction = database.transaction(['files'], 'readwrite');
  const store = transaction.objectStore('files');
  return store.put({ id: 'moved' });
}
`
assert(
  indexedDbSchemaSemanticDiff(
    indexedDbSchemaSemanticFingerprint(legacyWriter),
    indexedDbSchemaSemanticFingerprint(movedOrRemovedWriter),
  ).length === 0,
  'reducing or moving legacy IDB writer calls must be allowed',
)
assert(
  indexedDbSchemaSemanticDiff(
    indexedDbSchemaSemanticFingerprint(legacyWriter),
    indexedDbSchemaSemanticFingerprint(schemaFixture),
  ).length === 0,
  'removing a legacy IDB adapter call must be allowed',
)
const schemaIdentity = aggregateIndexedDbSchemaSemantics([
  indexedDbSchemaSemanticFingerprint(schemaFixture),
])
assert(schemaIdentity.databaseNames.includes(FROZEN_IDB_SCHEMA.databaseName), 'fixture database identity was not captured')
assert(schemaIdentity.versions.includes(String(FROZEN_IDB_SCHEMA.version)), 'fixture version was not captured')
assert(schemaIdentity.storeNames.includes(FROZEN_IDB_SCHEMA.objectStore), 'fixture store was not captured')
assert(schemaIdentity.keyPaths.includes(FROZEN_IDB_SCHEMA.keyPath), 'fixture key path was not captured')

assertSchemaChangeRejected(
  `${schemaFixture}
const api = indexedDB;
api.open('OtherDB', DB_VERSION);
`,
  'aliased IndexedDB database changes',
)
assertSchemaChangeRejected(
  `${schemaFixture}
const api = indexedDBApi;
const chainedApi = api;
chainedApi.open(DB_NAME, 2);
`,
  'aliased IndexedDB version changes',
)
assertSchemaChangeRejected(
  `${schemaFixture}
const api = indexedDBApi;
const chainedApi = api;
chainedApi.deleteDatabase(DB_NAME);
`,
  'aliased deleteDatabase operations',
)

const existingCreateOperation = `${schemaFixture}
const databaseForSchema = indexedDB;
databaseForSchema.createObjectStore('files', { keyPath: 'id' });
`
const movedCreateOperation = existingCreateOperation.replace(
  'databaseForSchema.createObjectStore',
  'indexedDB.createObjectStore',
)
assert(
  indexedDbSchemaSemanticDiff(
    indexedDbSchemaSemanticFingerprint(existingCreateOperation),
    indexedDbSchemaSemanticFingerprint(movedCreateOperation),
  ).length === 0,
  'moving an existing schema operation must be allowed',
)

function assertSchemaChangeRejected(source, label) {
  assertSchemaDifferenceRejected(schemaFixture, source, label)
}

function assertSchemaDifferenceRejected(expectedSource, actualSource, label) {
  assert(
    indexedDbSchemaSemanticDiff(
      indexedDbSchemaSemanticFingerprint(expectedSource),
      indexedDbSchemaSemanticFingerprint(actualSource),
    ).length > 0,
    `${label} must be rejected`,
  )
}

assertSchemaDifferenceRejected(
  existingCreateOperation,
  `${existingCreateOperation}\nindexedDB.createObjectStore('files', { keyPath: 'id' });\n`,
  'duplicating an IDB schema operation',
)

assertSchemaChangeRejected(schemaFixture.replace("DB_NAME = 'SeekPlayerDB'", "DB_NAME = 'OtherDB'"), 'schema database name changes')
assertSchemaChangeRejected(schemaFixture.replace('DB_VERSION = 1', 'DB_VERSION = 2'), 'schema version changes')
assertSchemaChangeRejected(schemaFixture.replace("STORE_NAME = 'files'", "STORE_NAME = 'other'"), 'schema store changes')
assertSchemaChangeRejected(schemaFixture.replace("keyPath !== 'id'", "keyPath !== 'other'"), 'schema key path changes')
assertSchemaChangeRejected(
  `${schemaFixture}\nconst database = indexedDB; database.createObjectStore('files', { keyPath: 'id' });\n`,
  'new createObjectStore operations',
)
assertSchemaChangeRejected(
  `${schemaFixture}\nconst database = indexedDB; database.deleteObjectStore('files');\n`,
  'new deleteObjectStore operations',
)
assertSchemaChangeRejected(
  `${schemaFixture}\nindexedDB.deleteDatabase(DB_NAME);\n`,
  'new deleteDatabase operations',
)
assertSchemaChangeRejected(
  `${schemaFixture}\nrebuildDatabase(DB_NAME);\n`,
  'new database rebuild operations',
)
assertSchemaChangeRejected(
  `${schemaFixture}
const database = indexedDB;
const transaction = database.transaction(['files'], 'readwrite');
const objectStore = transaction.objectStore('files');
objectStore.clear();
`,
  'real IDB object-store clear operations',
)
assertSchemaChangeRejected(
  `${schemaFixture}\nconst database = indexedDB; database.transaction(['files'], 'readwrite').objectStore('files').clear();\n`,
  'direct IDB object-store clear operations',
)

console.log('windows local owner non-goal self-test passed (unstaged protected edits allowed; schema semantics guarded)')
