const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { parse } = require('@babel/parser')

const sourcePath = path.resolve(__dirname, '../src/services/persistence/application-backup.js')
const source = fs.readFileSync(sourcePath, 'utf8')
const readWebTargetSource = fs.readFileSync(
  path.resolve(__dirname, '../src/services/persistence/read-web-application-backup.js'),
  'utf8',
)
const productionTargetSource = fs.readFileSync(
  path.resolve(__dirname, './lib/read-web-production-backup.mjs'),
  'utf8',
)
const ast = parse(source, {
  sourceType: 'module',
  plugins: ['optionalChaining', 'objectRestSpread', 'topLevelAwait'],
})

const restoreCore = findFunction(ast, 'restoreWithCapability')
assert.ok(restoreCore, 'restoreWithCapability must remain an explicit capability-only core')
assert.deepEqual(parameterNames(restoreCore), ['artifact', 'invocation', 'capability'])
assertNoPublicTargetSurface(restoreCore, 'restoreWithCapability')
assertNoIdentifier(restoreCore, 'restoreOptions', 'restoreWithCapability must not re-read caller restoreOptions')
assertNoIdentifier(restoreCore, 'transaction', 'restoreWithCapability must not re-read a mutable transaction surface')
assertHasCall(restoreCore, 'bindTransactionCapability')
assertHasCall(restoreCore, 'readCommittedRevisionEvidence')
assertHasMemberCall(restoreCore, 'capability', 'beginTransaction')
assertHasMemberCall(restoreCore, 'capability', 'verifyApplied')
assertHasMemberCall(restoreCore, 'transactionCapability', 'commit')
assertHasMemberCall(restoreCore, 'transactionCapability', 'rollback')

const dryRunCore = findFunction(ast, 'dryRunRestoreForService')
assert.ok(dryRunCore, 'dryRunRestoreForService must remain capability-parameterized')
assertNoPublicTargetSurface(dryRunCore, 'dryRunRestoreForService')

const transactionBinder = findFunction(ast, 'bindTransactionCapability')
assert.ok(transactionBinder, 'bindTransactionCapability must remain explicit')
assertHasMemberCall(transactionBinder, 'applyDomain', 'bind')
assertHasMemberCall(transactionBinder, 'commit', 'bind')
assertHasMemberCall(transactionBinder, 'rollback', 'bind')
assertHasCall(transactionBinder, 'lookupPropertyDescriptor')
assertHasCall(transactionBinder, 'stableMethod')
assertHasCall(transactionBinder, 'Object.freeze')

const restoreEntry = findFunction(ast, 'restore')
assert.ok(restoreEntry, 'restore entry must remain explicit')
assertHasCall(restoreEntry, 'createRestoreInvocationSnapshot')
assertHasCall(restoreEntry, 'resolveTrustedTarget')
assertNoAwait(restoreEntry, 'restore must snapshot invocation inputs before its first await')

const invocationSnapshot = findFunction(ast, 'createRestoreInvocationSnapshot')
assert.ok(invocationSnapshot, 'restore invocation snapshot helper must remain explicit')
assertHasCall(invocationSnapshot, 'freezeCapabilityData')
assertHasCall(invocationSnapshot, 'Object.freeze')
assertHasMemberRead(invocationSnapshot, 'options', 'signal')

const bundleFactory = findFunction(ast, 'createTargetCapabilityBundle')
assert.ok(bundleFactory, 'createTargetCapabilityBundle must remain explicit')
assertHasCall(bundleFactory, 'Object.freeze')
assertHasCall(bundleFactory, 'createBoundAdapterCapability')
assertHasCall(bundleFactory, 'createBoundObjectCapability')
assertHasMemberCall(bundleFactory, 'methodCapabilities', 'captureRestoreOperation')
assertHasObjectProperty(bundleFactory, 'operation')

assert.match(
  readWebTargetSource,
  /const configuredCapacityBytes = Number\.isFinite\(options\.capacityBytes\) \? options\.capacityBytes : null/,
  'browser restore target must capture capacity policy in a private closure',
)
assert.doesNotMatch(readWebTargetSource, /target\.capacityBytes/, 'browser estimate capability must not read the public target')
assert.match(
  productionTargetSource,
  /const configuredCapacityBytes = Number\.isFinite\(options\.capacityBytes\) \? options\.capacityBytes : 256 \* 1024 \* 1024/,
  'file-backed restore target must capture capacity policy in a private closure',
)
assert.doesNotMatch(productionTargetSource, /target\.capacityBytes/, 'file-backed estimate capability must not read the public target')

// Self-test: a future alias, destructure, or bracket read of the public target
// must fail this guard even if the spelling is not target.foo.
const badAlias = parse('function f(target) { const alias = target; return alias["beginTransaction"](); }', { sourceType: 'script' })
assert.throws(
  () => assertNoPublicTargetSurface(findFunction(badAlias, 'f'), 'self-test'),
  /public target surface/,
)

const badRestoreOptions = parse('function f(restoreOptions) { const { resolutions } = restoreOptions; return resolutions["reader-session"]; }', { sourceType: 'script' })
assert.throws(
  () => assertNoIdentifier(findFunction(badRestoreOptions, 'f'), 'restoreOptions', 'self-test reads restoreOptions'),
  /restoreOptions/,
)

console.log('application backup capability structure guard passed (AST target/transaction boundary)')

function findFunction(root, name) {
  let found = null
  walk(root, (node) => {
    if (found) return
    if ((node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression')
      && node.id?.name === name) found = node
  })
  return found
}

function parameterNames(fn) {
  return (fn?.params || []).map((param) => {
    if (param.type === 'Identifier') return param.name
    if (param.type === 'AssignmentPattern' && param.left.type === 'Identifier') return param.left.name
    return param.type
  })
}

function assertNoPublicTargetSurface(fn, label) {
  assert.ok(fn, `${label} function is required`)
  walk(fn, (node) => {
    if (node.type === 'Identifier' && node.name === 'target') {
      throw new Error(`${label} reads the public target surface through an identifier`)
    }
    if (node.type === 'MemberExpression' && node.computed && node.object?.type === 'Identifier' && node.object.name === 'capability') {
      // Capability bracket reads are permitted only for the same local bundle;
      // this branch documents that the guard is AST-aware rather than regex-only.
      return
    }
  })
}

function assertNoIdentifier(fn, name, message) {
  walk(fn, (node) => {
    if (node.type === 'Identifier' && node.name === name) throw new Error(message)
  })
}

function assertNoAwait(fn, message) {
  walk(fn, (node) => {
    if (node.type === 'AwaitExpression') throw new Error(message)
  })
}

function assertHasCall(fn, calleeName) {
  let found = false
  walk(fn, (node) => {
    if (node.type !== 'CallExpression') return
    if (node.callee.type === 'Identifier' && node.callee.name === calleeName) found = true
    if (node.callee.type === 'MemberExpression'
      && node.callee.object.type === 'Identifier'
      && node.callee.object.name === calleeName.split('.')[0]
      && node.callee.property.type === 'Identifier'
      && node.callee.property.name === calleeName.split('.')[1]) found = true
  })
  assert.ok(found, `${calleeName} call must remain in the capability boundary`)
}

function assertHasMemberCall(fn, objectName, propertyName) {
  let found = false
  walk(fn, (node) => {
    if (!['CallExpression', 'OptionalCallExpression'].includes(node.type)
      || !['MemberExpression', 'OptionalMemberExpression'].includes(node.callee.type)
      || node.callee.computed) return
    if (node.callee.object.type === 'Identifier'
      && node.callee.object.name === objectName
      && node.callee.property.type === 'Identifier'
      && node.callee.property.name === propertyName) found = true
  })
  assert.ok(found, `${objectName}.${propertyName}() must remain in the capability boundary`)
}

function assertHasMemberRead(fn, objectName, propertyName) {
  let found = false
  walk(fn, (node) => {
    if (!['MemberExpression', 'OptionalMemberExpression'].includes(node.type) || node.computed) return
    if (node.object.type === 'Identifier'
      && node.object.name === objectName
      && node.property.type === 'Identifier'
      && node.property.name === propertyName) found = true
  })
  assert.ok(found, `${objectName}.${propertyName} must be captured in the invocation snapshot`)
}

function assertHasObjectProperty(fn, propertyName) {
  let found = false
  walk(fn, (node) => {
    if (!['ObjectProperty', 'ObjectMethod'].includes(node.type)) return
    if (!node.computed && node.key.type === 'Identifier' && node.key.name === propertyName) found = true
  })
  assert.ok(found, `${propertyName} must be part of the capability object`)
}

function walk(node, visitor) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visitor))
    return
  }
  if (typeof node.type === 'string') visitor(node)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra') continue
    if (value && typeof value === 'object') walk(value, visitor)
  }
}
