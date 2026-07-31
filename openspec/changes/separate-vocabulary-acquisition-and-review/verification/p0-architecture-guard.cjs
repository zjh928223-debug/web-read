const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { parse } = require('@babel/parser')

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..')
const protectedEntrypoints = new Map([
  ['src/composables/reader-runtime.js', 'bfd74109d8d93e20518f10d888dc114f0e76114820e7bc87fbdb57926ebf0a33'],
  ['src/composables/session-init.js', '29688c0b0f22541800bfd942b1ef66578491d651ad08417de909f21632b7a19c'],
])
const frozenLegacyIdbSeams = new Map([
  ['src/stores/audio.js', '6dfe05eb77bf1b8d7c6c86264d5be6484ca283dd1928cadd840f777f7dfa6121'],
  ['src/pinia-stores/audio.js', 'd65dd9b165468a1b2467c2fafdf52fd2c212f9aaace2156e05962298efb4ab84'],
  ['src/services/vocabulary/vocabulary-repository.js', 'ba90bdb615b41f844e285455c883bb6d9fbafe08ab2b05e690f36835c5a7dc88'],
  ['src/services/vocabulary/srs-pending-candidates.js', 'db87ae8c311d47f368ed8170109f26bb360c675347c4e5d6af4506259e702392'],
  ['src/services/vocabulary/article-srs-settlement-progress.js', '0967c00e3e77d7fbc0765dbc9c4dec92714b565b1d45da6be80bc0ffdc27b561'],
  ['src/services/vocabulary/vocabulary-service.js', '722971632b43acafe088a858be3b27c59d88ef313413816d143bad6873347203'],
])
const schemaOverrideNames = new Set(['dbName', 'dbVersion', 'storeName'])
const fileHash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const listJs = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(directory, entry.name)
  if (entry.isDirectory()) return listJs(full)
  return entry.isFile() && /\.(?:c|m)?js$/.test(entry.name) ? [full] : []
})

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  visit(node)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra') continue
    if (Array.isArray(value)) value.forEach((entry) => walk(entry, visit))
    else if (value && typeof value === 'object' && typeof value.type === 'string') walk(value, visit)
  }
}

function propertyName(node) {
  if (!node) return null
  if (!node.computed && node.property?.type === 'Identifier') return node.property.name
  if (node.computed && (node.property?.type === 'StringLiteral' || node.property?.type === 'Literal')) {
    return node.property.value
  }
  return null
}

const isMemberExpression = (node) => node?.type === 'MemberExpression' || node?.type === 'OptionalMemberExpression'
const isCallExpression = (node) => node?.type === 'CallExpression' || node?.type === 'OptionalCallExpression'

function objectPropertyName(node) {
  if (!node || (node.type !== 'ObjectProperty' && node.type !== 'ObjectMethod')) return null
  if (!node.computed && node.key?.type === 'Identifier') return node.key.name
  if (node.key?.type === 'StringLiteral' || node.key?.type === 'Literal') return node.key.value
  return null
}

function identifierName(node) {
  return node?.type === 'Identifier' ? node.name : null
}

function unwrapBind(node) {
  if (
    isCallExpression(node)
    && isMemberExpression(node.callee)
    && propertyName(node.callee) === 'bind'
  ) return node.callee.object
  return node
}

function isGlobalIndexedDb(node, aliases) {
  if (node?.type === 'Identifier') return aliases.has(node.name)
  return isMemberExpression(node)
    && propertyName(node) === 'indexedDB'
    && ['globalThis', 'window', 'self'].includes(identifierName(node.object))
}

function expressionKind(node, aliases) {
  const unwrapped = unwrapBind(node)
  if (isGlobalIndexedDb(unwrapped, aliases.idb)) return 'idb'
  if (unwrapped?.type === 'Identifier') {
    if (aliases.open.has(unwrapped.name)) return 'open'
    if (aliases.createStore.has(unwrapped.name)) return 'createStore'
    if (aliases.factory.has(unwrapped.name) || /^createIndexedDb/.test(unwrapped.name)) return 'factory'
    return null
  }
  if (isMemberExpression(unwrapped)) {
    const name = propertyName(unwrapped)
    if (name === 'open' && isGlobalIndexedDb(unwrapped.object, aliases.idb)) return 'open'
    if (name === 'createObjectStore') return 'createStore'
    if (/^createIndexedDb/.test(name || '')) return 'factory'
  }
  return null
}

function isDatabaseExpression(node, aliases) {
  return node?.type === 'Identifier' && aliases.database.has(node.name)
}

function collectAliases(ast) {
  const aliases = {
    idb: new Set(['indexedDB', 'indexedDBApi']),
    database: new Set(['db', 'database', 'idbDatabase']),
    openRequest: new Set(),
    open: new Set(),
    createStore: new Set(),
    factory: new Set(),
  }
  walk(ast, (node) => {
    if (
      (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression')
      && /^createIndexedDb/.test(node.id?.name || '')
    ) aliases.factory.add(node.id.name)
    if (node.type === 'ImportSpecifier' && /^createIndexedDb/.test(node.imported?.name || '')) {
      aliases.factory.add(node.local.name)
    }
  })
  let changed = true
  while (changed) {
    changed = false
    walk(ast, (node) => {
      const add = (set, name) => {
        if (name && !set.has(name)) {
          set.add(name)
          changed = true
        }
      }
      const target = node.type === 'VariableDeclarator' ? node.id : node.type === 'AssignmentExpression' ? node.left : null
      const value = node.type === 'VariableDeclarator' ? node.init : node.type === 'AssignmentExpression' ? node.right : null
      if (!target) return
      if (target.type === 'Identifier') {
        const kind = expressionKind(value, aliases)
        if (kind === 'idb') add(aliases.idb, target.name)
        if (kind === 'open') add(aliases.open, target.name)
        if (kind === 'createStore') add(aliases.createStore, target.name)
        if (kind === 'factory') add(aliases.factory, target.name)
        if (isDatabaseExpression(value, aliases)) add(aliases.database, target.name)
        if (isCallExpression(value) && expressionKind(value.callee, aliases) === 'open') {
          add(aliases.openRequest, target.name)
        }
        if (
          isMemberExpression(value)
          && propertyName(value) === 'result'
          && aliases.openRequest.has(identifierName(value.object))
        ) add(aliases.database, target.name)
      } else if (target.type === 'ObjectPattern') {
        for (const property of target.properties) {
          const imported = objectPropertyName(property)
          const local = identifierName(property.value)
          if (imported === 'open' && isGlobalIndexedDb(value, aliases.idb)) add(aliases.open, local)
          if (imported === 'createObjectStore') add(aliases.createStore, local)
        }
      }
    })
  }
  return aliases
}

function isStringLiteral(node, value) {
  return (node?.type === 'StringLiteral' || node?.type === 'Literal') && node.value === value
}

function isNumberLiteral(node, value) {
  return (node?.type === 'NumericLiteral' || node?.type === 'Literal') && node.value === value
}

function checkOpen(node, relative) {
  assert.equal(node.arguments.length, 2, `${relative} indexedDB.open requires exactly two arguments`)
  assert.ok(isStringLiteral(node.arguments[0], 'SeekPlayerDB'), `${relative} DB name must be literal "SeekPlayerDB"`)
  assert.ok(isNumberLiteral(node.arguments[1], 1), `${relative} DB version must be literal 1`)
}

function checkCreateStore(node, relative) {
  assert.equal(node.arguments.length, 2, `${relative} createObjectStore requires exactly two arguments`)
  assert.ok(isStringLiteral(node.arguments[0], 'files'), `${relative} store name must be literal "files"`)
  const options = node.arguments[1]
  assert.equal(options?.type, 'ObjectExpression', `${relative} createObjectStore options must be an object literal`)
  assert.equal(options.properties.length, 1, `${relative} createObjectStore options may contain only keyPath`)
  const keyPath = options.properties[0]
  assert.equal(objectPropertyName(keyPath), 'keyPath', `${relative} createObjectStore requires keyPath`)
  assert.ok(isStringLiteral(keyPath.value, 'id'), `${relative} createObjectStore requires keyPath: "id"`)
}

function checkFactoryCall(node, relative) {
  assert.ok(node.arguments.length <= 1, `${relative} IndexedDB repository factory accepts at most one options object`)
  if (node.arguments.length === 0) return
  const options = node.arguments[0]
  assert.equal(
    options.type,
    'ObjectExpression',
    `${relative} runtime IndexedDB repository options are forbidden`,
  )
  for (const property of options.properties) {
    assert.notEqual(property.type, 'SpreadElement', `${relative} spread IndexedDB repository options are forbidden`)
    const name = objectPropertyName(property)
    assert.equal(name, 'indexedDBApi', `${relative} IndexedDB schema override ${name || '<computed>'} is forbidden`)
  }
}

function analyzeSource(source, relative, { frozenLegacy = false } = {}) {
  const ast = parse(source, {
    sourceType: 'unambiguous',
    errorRecovery: false,
    plugins: ['jsx', 'topLevelAwait', 'importAttributes'],
  })
  const aliases = collectAliases(ast)
  const findings = { opens: 0, creates: 0, factories: 0 }
  walk(ast, (node) => {
    if (isMemberExpression(node) && !frozenLegacy) {
      const name = propertyName(node)
      if (isGlobalIndexedDb(node.object, aliases.idb) && node.computed && name === null) {
        assert.fail(`${relative} dynamic indexedDB member access is forbidden`)
      }
      assert.ok(!schemaOverrideNames.has(name), `${relative} runtime IndexedDB schema access ${name} is forbidden`)
    }
    if (node.type === 'ObjectProperty' && !frozenLegacy) {
      const name = objectPropertyName(node)
      assert.ok(!schemaOverrideNames.has(name), `${relative} IndexedDB schema override ${name} is forbidden`)
    }
    if (!isCallExpression(node)) return
    if (
      isMemberExpression(node.callee)
      && node.callee.computed
      && propertyName(node.callee) === null
      && isDatabaseExpression(node.callee.object, aliases)
    ) assert.fail(`${relative} dynamic IndexedDB database member call is forbidden`)
    if (
      isMemberExpression(node.callee)
      && ['call', 'apply'].includes(propertyName(node.callee))
      && ['open', 'createStore', 'factory'].includes(expressionKind(node.callee.object, aliases))
    ) assert.fail(`${relative} indirect IndexedDB call/apply is forbidden`)
    if (
      isMemberExpression(node.callee)
      && identifierName(node.callee.object) === 'Reflect'
      && propertyName(node.callee) === 'apply'
      && ['open', 'createStore', 'factory'].includes(expressionKind(node.arguments[0], aliases))
    ) assert.fail(`${relative} Reflect.apply of IndexedDB capability is forbidden`)
    const kind = expressionKind(node.callee, aliases)
    if (kind === 'open') {
      findings.opens += 1
      if (!frozenLegacy) checkOpen(node, relative)
    } else if (kind === 'createStore') {
      findings.creates += 1
      if (!frozenLegacy) checkCreateStore(node, relative)
    } else if (kind === 'factory') {
      findings.factories += 1
      if (!frozenLegacy) checkFactoryCall(node, relative)
    }
  })
  return findings
}

const rejectedSelfTests = [
  ['bracket open', "indexedDB['open']('OtherDB', 2)"],
  ['optional open', "indexedDB?.open?.('OtherDB', 2)"],
  ['bound open alias', "const openDb = indexedDB.open.bind(indexedDB); openDb(name, version)"],
  ['assigned open alias', "let openDb; openDb = indexedDB.open; openDb(name, version)"],
  ['indirect open apply', "indexedDB.open.apply(indexedDB, runtimeArguments)"],
  ['dynamic indexedDB member', "const method = 'open'; indexedDB[method]('SeekPlayerDB', 1)"],
  ['dynamic database member', "db[method]('evil', { keyPath: 'uuid' })"],
  [
    'Reflect.apply open',
    "Reflect.apply(indexedDB.open, indexedDB, ['OtherDB', 2])",
  ],
  ['bracket create store', "db['createObjectStore']('files', { keyPath: 'uuid' })"],
  ['optional create store', "db?.createObjectStore?.('files', { keyPath: 'uuid' })"],
  [
    'destructured create store alias',
    "const { createObjectStore: makeStore } = db; makeStore('files', { keyPath: 'uuid' })",
  ],
  [
    'bound create store alias',
    "const makeStore = db.createObjectStore.bind(db); makeStore('files', { keyPath: runtimeKey })",
  ],
  ['runtime factory options', 'createIndexedDbVocabularyRepository(runtimeOptions)'],
  ['spread factory options', 'createIndexedDbVocabularyRepository({ ...runtimeOptions })'],
  ['schema override property', "createIndexedDbVocabularyRepository({ dbVersion: 2 })"],
]
for (const [name, source] of rejectedSelfTests) {
  assert.throws(() => analyzeSource(source, `self-test/${name}.js`), undefined, `${name} must be rejected`)
}
analyzeSource(
  "indexedDB['open']('SeekPlayerDB', 1); db['createObjectStore']('files', { keyPath: 'id' })",
  'self-test/safe-literals.js',
)

for (const [relative, expected] of [...protectedEntrypoints, ...frozenLegacyIdbSeams]) {
  assert.equal(fileHash(path.join(repoRoot, relative)), expected, `${relative} changed from frozen P0 baseline`)
}

const checked = []
for (const file of listJs(path.join(repoRoot, 'src'))) {
  const source = fs.readFileSync(file, 'utf8')
  const relative = path.relative(repoRoot, file).replaceAll('\\', '/')
  const frozenLegacy = frozenLegacyIdbSeams.has(relative)
  const findings = analyzeSource(source, relative, { frozenLegacy })
  if (findings.opens || findings.creates || findings.factories) {
    checked.push({ file: relative, frozen_legacy_seam: frozenLegacy, ...findings })
  }
}
assert.ok(checked.some((entry) => entry.opens > 0), 'expected at least one IndexedDB open site')
assert.ok(checked.some((entry) => entry.creates > 0), 'expected at least one object store creation site')

process.stdout.write(`${JSON.stringify({
  guard_version: 'separate-vocabulary-acquisition-and-review.p0-architecture-guard.v5',
  parser: '@babel/parser',
  seek_player_db_version: 1,
  allowed_object_store: 'files',
  required_key_path: 'id',
  self_tests_rejected: rejectedSelfTests.map(([name]) => name),
  protected_entrypoints: [...protectedEntrypoints.keys()],
  frozen_legacy_idb_seams: [...frozenLegacyIdbSeams.keys()],
  checked_sites: checked,
}, null, 2)}\n`)
