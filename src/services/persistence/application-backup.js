const BACKUP_FORMAT = 'read-web.application-backup'
const FORMAT_VERSION = 1
const SCHEMA_VERSION = 1
const DEFAULT_MAX_BACKUP_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_RECORD_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_MEDIA_REFERENCE_BYTES = 64 * 1024
const MEDIA_POLICY_MODE = 'identity-metadata-rebind'

const REQUIRED_DOMAINS = Object.freeze([
  'reader-session',
  'marks-activity',
  'vocabulary-srs',
  'passage-preview',
  'annotation',
  'workflow',
])

const SENSITIVE_KEY = /(?:api[_-]?key|access[_-]?token|authorization|cookie|password|passwd|secret|credential|private[_-]?key|proxy[_-]?auth|session[_-]?token|^token$|^auth$|^jwt$|^bearer$)/i
const SENSITIVE_URL_PARAMETER = /(?:api[_-]?key|access[_-]?token|authorization|cookie|password|passwd|secret|credential|proxy[_-]?auth|session[_-]?token|^token$|^auth$|^jwt$|^bearer$|signature|^sig$)/i
const EMBEDDED_MEDIA_KEY = /(?:blob|arraybuffer|typedarray|binary|base64|datauri|inline(?:data|media)?|media(?:data|bytes)|audio(?:data|blob)|video(?:data|blob))/i
const PRIVATE_PATH_VALUE = /^(?:[a-zA-Z]:[\\/]|\\\\|\/(?:Users|home|private|var|tmp)\/)/i
const ISOLATION_CERTIFICATE_SCHEMA_VERSION = 1
const ISOLATION_ISSUER_TOKEN = null
const TRUSTED_ISOLATION_CERTIFICATES = new WeakSet()
const TRUSTED_ISOLATION_TARGETS = new WeakMap()
const TARGET_METHOD_NAMES = Object.freeze([
  'estimateCapacity',
  'readJournal',
  'writeJournal',
  'beginTransaction',
  'restoreSnapshot',
  'verifyApplied',
  'mergeDomain',
  'recoverPendingRestore',
  'readState',
  'captureRestoreOperation',
  'setFaults',
])
const TARGET_PATH_NAMES = Object.freeze([
  'isolationRoot',
  'profileDir',
  'statePath',
  'journalPath',
  'rollbackDir',
  'quarantineDir',
  'pythonStateDir',
  'pythonOutputDir',
])
const TARGET_VALUE_NAMES = Object.freeze([
  'isolated',
  'isolationCertificate',
  'isolationLayout',
  'restoreCapabilities',
  'faults',
  'adapters',
  'journal',
  'resolutions',
  'rollbackStore',
  'quarantine',
  'rollbackStoreSeparate',
  'capacityBytes',
  ...TARGET_PATH_NAMES,
])
const MUTABLE_ADAPTER_DATA_NAMES = new Set(['records', 'revision', 'writes', 'failed'])
const MUTABLE_STORE_DATA_NAMES = new Set(['entries', 'last', 'value', 'attempts', 'revision'])
const ADAPTER_METHOD_NAMES = Object.freeze(['exportRecords', 'collect', 'export', 'validateReferences', 'merge', 'restoreRecords'])

export const APPLICATION_BACKUP_FORMAT = BACKUP_FORMAT
export const APPLICATION_BACKUP_FORMAT_VERSION = FORMAT_VERSION
export const APPLICATION_BACKUP_SCHEMA_VERSION = SCHEMA_VERSION
export const APPLICATION_BACKUP_REQUIRED_DOMAINS = REQUIRED_DOMAINS
export const APPLICATION_BACKUP_TARGET_INTEGRITY_MEMBERS = Object.freeze([
  ...new Set([...TARGET_METHOD_NAMES, ...TARGET_VALUE_NAMES]),
].sort())
export const APPLICATION_BACKUP_MEDIA_POLICY = Object.freeze({
  mode: MEDIA_POLICY_MODE,
  fullMediaIncluded: false,
  rebindRequired: true,
  maxMediaReferenceBytes: DEFAULT_MAX_MEDIA_REFERENCE_BYTES,
})

export function createApplicationBackupIsolationCertificate({ isolationRoot, paths, issuerToken } = {}) {
  if (typeof isolationRoot !== 'string' || !isolationRoot.trim()
    || !paths || typeof paths !== 'object' || Array.isArray(paths)
    || !Object.keys(paths).length
    || Object.values(paths).some((value) => typeof value !== 'string' || !value.trim())) {
    throw new Error('Application backup isolation certificate requires a root and concrete target paths')
  }
  const certificate = Object.freeze({
    schemaVersion: ISOLATION_CERTIFICATE_SCHEMA_VERSION,
    isolationRoot: isolationRoot.trim(),
    paths: Object.freeze(Object.fromEntries(
      Object.entries(paths).map(([name, value]) => [name, value.trim()]),
    )),
  })
  if (typeof ISOLATION_ISSUER_TOKEN === 'string' && issuerToken === ISOLATION_ISSUER_TOKEN) {
    TRUSTED_ISOLATION_CERTIFICATES.add(certificate)
  }
  return certificate
}

export function isApplicationBackupIsolationCertificate(value) {
  return !!value
    && TRUSTED_ISOLATION_CERTIFICATES.has(value)
    && value.schemaVersion === ISOLATION_CERTIFICATE_SCHEMA_VERSION
    && typeof value.isolationRoot === 'string'
    && value.isolationRoot.length > 0
    && value.paths
    && typeof value.paths === 'object'
    && !Array.isArray(value.paths)
    && Object.keys(value.paths).length > 0
    && Object.values(value.paths).every((entry) => typeof entry === 'string' && entry.length > 0)
}

function isObjectLike(value) {
  return !!value && (typeof value === 'object' || typeof value === 'function')
}

function hasDataDescriptor(descriptor) {
  return Object.prototype.hasOwnProperty.call(descriptor, 'value')
}

function captureImmutableValue(value, context = { seen: new WeakMap(), next: 0 }) {
  if (!isObjectLike(value)) return value
  if (context.seen.has(value)) return Object.freeze({ cycle: context.seen.get(value) })
  const marker = context.next
  context.next += 1
  context.seen.set(value, marker)
  const entries = Reflect.ownKeys(value).map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (hasDataDescriptor(descriptor)) {
      return Object.freeze({
        key,
        kind: 'data',
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        writable: descriptor.writable,
        value: captureImmutableValue(descriptor.value, context),
      })
    }
    return Object.freeze({
      key,
      kind: 'accessor',
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set: descriptor.set,
    })
  })
  return Object.freeze({
    prototype: Object.getPrototypeOf(value),
    entries: Object.freeze(entries),
  })
}

function sameImmutableValue(value, snapshot, context = { seen: new WeakMap(), next: 0 }) {
  if (!snapshot || !isObjectLike(value)) return Object.is(value, snapshot)
  if (snapshot.cycle !== undefined) return context.seen.get(value)?.marker === snapshot.cycle
  if (Object.getPrototypeOf(value) !== snapshot.prototype) return false
  if (context.seen.has(value)) return context.seen.get(value).snapshot === snapshot
  const marker = context.next
  context.next += 1
  context.seen.set(value, { marker, snapshot })
  const keys = Reflect.ownKeys(value)
  if (keys.length !== snapshot.entries.length) return false
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]
    const current = Object.getOwnPropertyDescriptor(value, key)
    const expected = snapshot.entries[index]
    if (key !== expected.key || !current
      || (hasDataDescriptor(current) ? expected.kind !== 'data' : expected.kind !== 'accessor')
      || current.configurable !== expected.configurable
      || current.enumerable !== expected.enumerable) return false
    if (expected.kind === 'data') {
      if (current.writable !== expected.writable || !sameImmutableValue(current.value, expected.value, context)) return false
    } else if (current.get !== expected.get || current.set !== expected.set) return false
  }
  return true
}

function captureDescriptorSurface(value, { valueNames = new Set(), compareDataValues = false, deepDataValues = false, ignoredDataNames = new Set() } = {}) {
  if (!isObjectLike(value)) return null
  const descriptors = Reflect.ownKeys(value).map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    const data = hasDataDescriptor(descriptor)
    const namedValue = typeof key === 'string' && valueNames.has(key)
    const compareValue = data && !ignoredDataNames.has(key)
      && (compareDataValues || namedValue || typeof descriptor.value === 'function')
    return Object.freeze({
      key,
      kind: data ? 'data' : 'accessor',
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      writable: data ? descriptor.writable : undefined,
      value: compareValue && !deepDataValues ? descriptor.value : undefined,
      valueSnapshot: compareValue && deepDataValues ? captureImmutableValue(descriptor.value) : undefined,
      compareValue,
      deepValue: compareValue && deepDataValues,
      get: data ? undefined : descriptor.get,
      set: data ? undefined : descriptor.set,
    })
  })
  return Object.freeze({
    value,
    prototype: Object.getPrototypeOf(value),
    descriptors: Object.freeze(descriptors),
  })
}

function sameDescriptorSurface(value, snapshot) {
  if (!snapshot || value !== snapshot.value || !isObjectLike(value)) return !snapshot && !value
  if (Object.getPrototypeOf(value) !== snapshot.prototype) return false
  const keys = Reflect.ownKeys(value)
  if (keys.length !== snapshot.descriptors.length) return false
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    const expected = snapshot.descriptors[index]
    if (key !== expected.key || !descriptor
      || (hasDataDescriptor(descriptor) ? expected.kind !== 'data' : expected.kind !== 'accessor')
      || descriptor.configurable !== expected.configurable
      || descriptor.enumerable !== expected.enumerable) return false
    if (expected.kind === 'data') {
      if (descriptor.writable !== expected.writable) return false
      if (expected.compareValue && expected.deepValue
        ? !sameImmutableValue(descriptor.value, expected.valueSnapshot)
        : expected.compareValue && !Object.is(descriptor.value, expected.value)) return false
    } else if (descriptor.get !== expected.get || descriptor.set !== expected.set) return false
  }
  return true
}

function lookupPropertyDescriptor(value, name) {
  let current = value
  while (isObjectLike(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, name)
    if (descriptor) return descriptor
    current = Object.getPrototypeOf(current)
  }
  return null
}

function readPropertyWithoutInvokingGetter(value, name) {
  const descriptor = lookupPropertyDescriptor(value, name)
  if (!descriptor) return undefined
  return hasDataDescriptor(descriptor) ? descriptor.value : descriptor.get
}

function captureIsolationTargetBinding(target, isolationCertificate, isolationLayout) {
  const targetSurface = captureDescriptorSurface(target, { valueNames: new Set(TARGET_VALUE_NAMES) })
  const adapters = captureDescriptorSurface(target.adapters, { compareDataValues: true })
  const adapterMethods = adapters
    ? Object.freeze(Object.fromEntries(
        Reflect.ownKeys(target.adapters).map((key) => [key, captureDescriptorSurface(target.adapters[key], {
          compareDataValues: true,
          deepDataValues: true,
          ignoredDataNames: MUTABLE_ADAPTER_DATA_NAMES,
        })]),
      ))
    : null
  return Object.freeze({
    isolationCertificate,
    certificateSurface: captureDescriptorSurface(isolationCertificate, { compareDataValues: true, deepDataValues: true }),
    isolationLayout,
    isolationLayoutSurface: captureDescriptorSurface(isolationLayout, { compareDataValues: true, deepDataValues: true }),
    isolated: readPropertyWithoutInvokingGetter(target, 'isolated'),
    restoreCapabilities: readPropertyWithoutInvokingGetter(target, 'restoreCapabilities'),
    restoreCapabilitiesSurface: captureDescriptorSurface(readPropertyWithoutInvokingGetter(target, 'restoreCapabilities'), {
      compareDataValues: true,
      deepDataValues: true,
    }),
    faults: readPropertyWithoutInvokingGetter(target, 'faults'),
    methods: Object.freeze(Object.fromEntries(TARGET_METHOD_NAMES.map((name) => [name, readPropertyWithoutInvokingGetter(target, name)]))),
    targetSurface,
    adapters,
    adapterMethods,
    journal: readPropertyWithoutInvokingGetter(target, 'journal'),
    journalSurface: captureDescriptorSurface(readPropertyWithoutInvokingGetter(target, 'journal'), {
      compareDataValues: true,
      deepDataValues: true,
      ignoredDataNames: MUTABLE_STORE_DATA_NAMES,
    }),
    resolutions: readPropertyWithoutInvokingGetter(target, 'resolutions'),
    resolutionsSurface: captureDescriptorSurface(readPropertyWithoutInvokingGetter(target, 'resolutions'), {
      compareDataValues: true,
      deepDataValues: true,
    }),
    rollbackStore: readPropertyWithoutInvokingGetter(target, 'rollbackStore'),
    rollbackStoreSurface: captureDescriptorSurface(readPropertyWithoutInvokingGetter(target, 'rollbackStore'), {
      compareDataValues: true,
      deepDataValues: true,
      ignoredDataNames: MUTABLE_STORE_DATA_NAMES,
    }),
    quarantine: readPropertyWithoutInvokingGetter(target, 'quarantine'),
    quarantineSurface: captureDescriptorSurface(readPropertyWithoutInvokingGetter(target, 'quarantine'), {
      compareDataValues: true,
      deepDataValues: true,
      ignoredDataNames: MUTABLE_STORE_DATA_NAMES,
    }),
  })
}

function isSameIsolationTargetBinding(target, binding) {
  if (!target || !binding
    || !sameDescriptorSurface(target, binding.targetSurface)
    || readPropertyWithoutInvokingGetter(target, 'isolated') !== binding.isolated
    || readPropertyWithoutInvokingGetter(target, 'isolationCertificate') !== binding.isolationCertificate
    || !sameDescriptorSurface(readPropertyWithoutInvokingGetter(target, 'isolationCertificate'), binding.certificateSurface)
    || readPropertyWithoutInvokingGetter(target, 'isolationLayout') !== binding.isolationLayout
    || !sameDescriptorSurface(readPropertyWithoutInvokingGetter(target, 'isolationLayout'), binding.isolationLayoutSurface)
    || readPropertyWithoutInvokingGetter(target, 'restoreCapabilities') !== binding.restoreCapabilities
    || !sameDescriptorSurface(readPropertyWithoutInvokingGetter(target, 'restoreCapabilities'), binding.restoreCapabilitiesSurface)
    || readPropertyWithoutInvokingGetter(target, 'faults') !== binding.faults
    || readPropertyWithoutInvokingGetter(target, 'journal') !== binding.journal
    || !sameDescriptorSurface(readPropertyWithoutInvokingGetter(target, 'journal'), binding.journalSurface)
    || readPropertyWithoutInvokingGetter(target, 'resolutions') !== binding.resolutions
    || !sameDescriptorSurface(readPropertyWithoutInvokingGetter(target, 'resolutions'), binding.resolutionsSurface)) return false
  for (const [name, method] of Object.entries(binding.methods)) {
    if (readPropertyWithoutInvokingGetter(target, name) !== method) return false
  }
  if (!sameDescriptorSurface(readPropertyWithoutInvokingGetter(target, 'adapters'), binding.adapters)) return false
  if (binding.adapterMethods) {
    for (const key of Reflect.ownKeys(binding.adapterMethods)) {
      if (!sameDescriptorSurface(
        readPropertyWithoutInvokingGetter(readPropertyWithoutInvokingGetter(target, 'adapters'), key),
        binding.adapterMethods[key],
      )) return false
    }
  }
  return sameDescriptorSurface(readPropertyWithoutInvokingGetter(target, 'rollbackStore'), binding.rollbackStoreSurface)
    && sameDescriptorSurface(readPropertyWithoutInvokingGetter(target, 'quarantine'), binding.quarantineSurface)
}

export function registerApplicationBackupIsolationTarget({ target, isolationCertificate, isolationLayout, issuerToken } = {}) {
  if (typeof ISOLATION_ISSUER_TOKEN !== 'string' || issuerToken !== ISOLATION_ISSUER_TOKEN
    || !target || typeof target !== 'object'
    || !isApplicationBackupIsolationCertificate(isolationCertificate)
    || target.isolationCertificate !== isolationCertificate
    || !isolationLayout || typeof isolationLayout !== 'object'
    || typeof isolationLayout.isolationRoot !== 'string'
    || !isolationLayout.paths || typeof isolationLayout.paths !== 'object'
    || Array.isArray(isolationLayout.paths)
    || !Object.isFrozen(isolationLayout)
    || !Object.isFrozen(isolationLayout.paths)) return false
  const certificatePaths = Object.entries(isolationCertificate.paths)
  const layoutPaths = Object.entries(isolationLayout.paths)
  if (isolationCertificate.isolationRoot !== isolationLayout.isolationRoot
    || certificatePaths.length !== layoutPaths.length
    || certificatePaths.some(([name, value]) => isolationLayout.paths[name] !== value)) return false
  TRUSTED_ISOLATION_TARGETS.set(target, captureIsolationTargetBinding(target, isolationCertificate, isolationLayout))
  return true
}

function isTrustedApplicationBackupIsolationTarget(target) {
  const binding = TRUSTED_ISOLATION_TARGETS.get(target)
  return isSameIsolationTargetBinding(target, binding)
}

function freezeCapabilityData(value, seen = new WeakMap()) {
  if (!isObjectLike(value)) return value
  if (typeof value === 'function') throw backupError('RESTORE_TARGET_UNSAFE', 'Restore capability data cannot contain functions')
  if (seen.has(value)) return seen.get(value)
  const clone = Array.isArray(value) ? [] : Object.create(null)
  seen.set(value, clone)
  if (Array.isArray(value)) clone.length = value.length
  for (const key of Reflect.ownKeys(value).filter((entry) => !(Array.isArray(value) && entry === 'length'))) {
    if (typeof key !== 'string') throw backupError('RESTORE_TARGET_UNSAFE', 'Restore capability data cannot contain symbol keys')
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !hasDataDescriptor(descriptor) || !descriptor.enumerable) {
      throw backupError('RESTORE_TARGET_UNSAFE', 'Restore capability data must have enumerable data properties')
    }
    clone[key] = freezeCapabilityData(descriptor.value, seen)
  }
  Object.freeze(clone)
  return clone
}

function cloneMutableCapabilityData(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol') {
      throw backupError('RESTORE_TARGET_UNSAFE', 'Restore capability state cannot contain functions or symbols')
    }
    return value
  }
  if (seen.has(value)) return seen.get(value)
  if (value instanceof Date) {
    const clone = new Date(value.getTime())
    seen.set(value, clone)
    return clone
  }
  if (value instanceof Map) {
    const clone = new Map()
    seen.set(value, clone)
    for (const [key, entry] of value.entries()) {
      clone.set(cloneMutableCapabilityData(key, seen), cloneMutableCapabilityData(entry, seen))
    }
    return clone
  }
  if (value instanceof Set) {
    const clone = new Set()
    seen.set(value, clone)
    for (const entry of value.values()) clone.add(cloneMutableCapabilityData(entry, seen))
    return clone
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value)) {
    throw backupError('RESTORE_TARGET_UNSAFE', 'Restore capability state must be a plain mutable value')
  }
  const clone = Array.isArray(value) ? [] : Object.create(prototype)
  seen.set(value, clone)
  if (Array.isArray(value)) clone.length = value.length
  for (const key of Reflect.ownKeys(value).filter((entry) => !(Array.isArray(value) && entry === 'length'))) {
    if (typeof key !== 'string') throw backupError('RESTORE_TARGET_UNSAFE', 'Restore capability state cannot contain symbol keys')
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !hasDataDescriptor(descriptor) || !descriptor.enumerable) {
      throw backupError('RESTORE_TARGET_UNSAFE', 'Restore capability state must have enumerable data properties')
    }
    Object.defineProperty(clone, key, {
      configurable: true,
      enumerable: descriptor.enumerable,
      writable: true,
      value: cloneMutableCapabilityData(descriptor.value, seen),
    })
  }
  return clone
}

function stableDataValue(value, name) {
  const descriptor = lookupPropertyDescriptor(value, name)
  if (!descriptor) return undefined
  return hasDataDescriptor(descriptor) ? descriptor.value : undefined
}

function stableMethod(value, name) {
  const descriptor = lookupPropertyDescriptor(value, name)
  if (!descriptor || !hasDataDescriptor(descriptor) || typeof descriptor.value !== 'function') return null
  return descriptor.value
}

function defineCapabilityProperty(receiver, key, descriptor) {
  Object.defineProperty(receiver, key, {
    configurable: false,
    enumerable: descriptor.enumerable !== false,
    writable: descriptor.writable !== false,
    value: descriptor.value,
  })
}

function createBoundObjectCapability(source, { methodNames = [], dynamicNames = new Set() } = {}) {
  if (!isObjectLike(source)) return null
  const receiver = Object.create(null)
  const keys = new Set([...Reflect.ownKeys(source), ...methodNames])
  for (const key of keys) {
    const descriptor = lookupPropertyDescriptor(source, key)
    if (!descriptor) continue
    if (!hasDataDescriptor(descriptor)) throw backupError('RESTORE_TARGET_UNSAFE', `Restore capability member ${String(key)} cannot be an accessor`)
    if (dynamicNames.has(key)) {
      let dynamicValue = cloneMutableCapabilityData(descriptor.value)
      Object.defineProperty(receiver, key, {
        configurable: false,
        enumerable: descriptor.enumerable !== false,
        get: () => dynamicValue,
        set: (value) => { dynamicValue = cloneMutableCapabilityData(value) },
      })
      continue
    }
    if (typeof descriptor.value === 'function') {
      defineCapabilityProperty(receiver, key, { ...descriptor, value: descriptor.value.bind(receiver), writable: false })
    } else {
      defineCapabilityProperty(receiver, key, { ...descriptor, value: freezeCapabilityData(descriptor.value), writable: false })
    }
  }
  return Object.freeze(receiver)
}

function createBoundAdapterCapability(adapter) {
  const receiver = createBoundObjectCapability(adapter, {
    methodNames: ADAPTER_METHOD_NAMES,
    dynamicNames: MUTABLE_ADAPTER_DATA_NAMES,
  })
  if (!receiver) return null
  const collector = getCollector(receiver)
  if (typeof collector !== 'function') return null
  return receiver
}

function bindTargetMethod(target, name) {
  const method = stableMethod(target, name)
  return method ? method.bind(target) : null
}

function createTargetCapabilityBundle(target, binding, { requiredDomains, fallbackAdapters } = {}) {
  const registeredTarget = binding.targetSurface.value
  const methodCapabilities = Object.fromEntries(TARGET_METHOD_NAMES.map((name) => [name, bindTargetMethod(registeredTarget, name)]))
  if (typeof methodCapabilities.captureRestoreOperation !== 'function') {
    throw backupError('RESTORE_TARGET_UNSAFE', 'Restore target must provide a synchronous operation snapshot capability')
  }
  let operation
  try {
    operation = methodCapabilities.captureRestoreOperation()
  } catch (error) {
    throw backupError('RESTORE_TARGET_UNSAFE', 'Restore target operation snapshot could not be captured', { cause: error?.code || 'operation-capture-failed' })
  }
  if (!operation || typeof operation !== 'object' || typeof operation.then === 'function') {
    throw backupError('RESTORE_TARGET_UNSAFE', 'Restore target operation snapshot must be a synchronous object capability')
  }
  Object.freeze(operation)
  const targetAdapterSource = binding.adapters?.value || fallbackAdapters
  let normalizedAdapters
  try {
    normalizedAdapters = normalizeAdapterMap(targetAdapterSource, requiredDomains)
  } catch (error) {
    throw backupError('RESTORE_TARGET_UNSAFE', 'Restore target adapters could not be bound safely', { cause: error?.code || 'adapter-binding-failed' })
  }
  const adapters = Object.freeze(Object.fromEntries(requiredDomains.map((key) => {
    const adapter = createBoundAdapterCapability(normalizedAdapters[key])
    if (!adapter) throw backupError('RESTORE_TARGET_UNSAFE', `Restore adapter ${key} could not be bound safely`)
    return [key, adapter]
  })))
  const journal = createBoundObjectCapability(binding.journal, { methodNames: ['read', 'write'], dynamicNames: MUTABLE_STORE_DATA_NAMES })
  const rollbackStore = createBoundObjectCapability(binding.rollbackStore, { methodNames: ['read', 'write'], dynamicNames: MUTABLE_STORE_DATA_NAMES })
  const quarantine = createBoundObjectCapability(binding.quarantine, { methodNames: ['write'], dynamicNames: MUTABLE_STORE_DATA_NAMES })
  const readJournal = methodCapabilities.readJournal || journal?.read
  const writeJournal = methodCapabilities.writeJournal || journal?.write
  const readRollback = rollbackStore?.read
  const writeRollback = rollbackStore?.write
  const writeQuarantine = quarantine?.write
  const capacityBytes = stableDataValue(registeredTarget, 'capacityBytes')
  const rollbackStoreSeparate = stableDataValue(registeredTarget, 'rollbackStoreSeparate')
  const estimateCapacity = methodCapabilities.estimateCapacity
  const restoreCapabilities = stableDataValue(registeredTarget, 'restoreCapabilities')
  const capabilities = Object.freeze({
    atomicRevisionCommit: restoreCapabilities?.atomicRevisionCommit,
    commitRevisionEvidence: restoreCapabilities?.commitRevisionEvidence,
    verifyAppliedRevision: restoreCapabilities?.verifyAppliedRevision,
  })
  if (capabilities.atomicRevisionCommit !== true
    || capabilities.commitRevisionEvidence !== true
    || capabilities.verifyAppliedRevision !== true) {
    throw backupError('RESTORE_TARGET_UNSAFE', 'Restore target cannot provide a complete immutable capability bundle')
  }
  if (typeof methodCapabilities.beginTransaction !== 'function') {
    throw backupError('RESTORE_ATOMIC_UNAVAILABLE', 'Restore target must provide an atomic transaction')
  }
  if (typeof methodCapabilities.restoreSnapshot !== 'function') {
    throw backupError('RESTORE_ROLLBACK_UNAVAILABLE', 'Restore target must provide atomic snapshot rollback')
  }
  if (typeof methodCapabilities.verifyApplied !== 'function') {
    throw backupError('RESTORE_TARGET_UNSAFE', 'Restore target must provide revision-bearing applied-state verification')
  }
  if (typeof readJournal !== 'function' || typeof writeJournal !== 'function') {
    throw backupError('RESTORE_JOURNAL_UNAVAILABLE', 'Restore target must provide a durable journal reader and writer')
  }
  if (typeof readRollback !== 'function' || typeof writeRollback !== 'function') {
    throw backupError('RESTORE_ROLLBACK_UNAVAILABLE', 'Restore target must provide a durable rollback backup store')
  }
  if (typeof writeQuarantine !== 'function') {
    throw backupError('RESTORE_QUARANTINE_UNAVAILABLE', 'Restore target must provide corrupt quarantine')
  }
  if ((capacityBytes !== null && capacityBytes !== undefined && !Number.isFinite(capacityBytes))
    || (typeof estimateCapacity !== 'function' && !Number.isFinite(capacityBytes))) {
    throw backupError('RESTORE_TARGET_UNSAFE', 'Restore target cannot provide a complete immutable capacity policy')
  }
  let resolutions = binding.resolutions
  if (resolutions === null || resolutions === undefined) resolutions = {}
  resolutions = freezeCapabilityData(resolutions)
  return Object.freeze({
    operation,
    isolation: Object.freeze({
      isolationRoot: binding.isolationLayout.isolationRoot,
      layout: binding.isolationLayout,
    }),
    adapters,
    capacityBytes,
    rollbackStoreSeparate,
    estimateCapacity,
    journal: Object.freeze({ read: readJournal, write: writeJournal }),
    rollback: Object.freeze({ read: readRollback, write: writeRollback }),
    quarantine: Object.freeze({ write: writeQuarantine }),
    beginTransaction: methodCapabilities.beginTransaction,
    restoreSnapshot: methodCapabilities.restoreSnapshot,
    verifyApplied: methodCapabilities.verifyApplied,
    mergeDomain: methodCapabilities.mergeDomain,
    recoverPendingRestore: methodCapabilities.recoverPendingRestore,
    readState: methodCapabilities.readState,
    restoreCapabilities: capabilities,
    resolutions,
  })
}

function resolveTrustedTarget(target, { requiredDomains, fallbackAdapters } = {}) {
  const binding = TRUSTED_ISOLATION_TARGETS.get(target)
  if (!target || !binding || !isTrustedApplicationBackupIsolationTarget(target)) {
    throw backupError('RESTORE_TARGET_UNSAFE', 'Restore requires an explicitly registered and unmodified isolated target')
  }
  try {
    return createTargetCapabilityBundle(target, binding, { requiredDomains, fallbackAdapters })
  } catch (error) {
    if (['RESTORE_TARGET_UNSAFE', 'RESTORE_ATOMIC_UNAVAILABLE', 'RESTORE_ROLLBACK_UNAVAILABLE', 'RESTORE_JOURNAL_UNAVAILABLE', 'RESTORE_QUARANTINE_UNAVAILABLE'].includes(error?.code)) throw error
    throw backupError('RESTORE_TARGET_UNSAFE', 'Restore target capability bundle construction failed')
  }
}

function bindTransactionCapability(transactionResult) {
  if (!isObjectLike(transactionResult)) {
    throw backupError('RESTORE_ATOMIC_UNAVAILABLE', 'Restore transaction is unavailable')
  }
  const applyDomain = stableMethod(transactionResult, 'applyDomain')
  const commit = stableMethod(transactionResult, 'commit')
  const rollback = stableMethod(transactionResult, 'rollback')
  if (typeof applyDomain !== 'function' || typeof commit !== 'function' || typeof rollback !== 'function') {
    throw backupError('RESTORE_ATOMIC_UNAVAILABLE', 'Restore transaction must expose immutable apply, commit, and rollback capabilities')
  }
  const committedRevisionDescriptor = lookupPropertyDescriptor(transactionResult, 'committedRevision')
  const committedRevisionGetter = committedRevisionDescriptor
    && !hasDataDescriptor(committedRevisionDescriptor)
    && typeof committedRevisionDescriptor.get === 'function'
    ? committedRevisionDescriptor.get.bind(transactionResult)
    : null
  const committedRevisionMethod = stableMethod(transactionResult, 'getCommittedRevision')
  const readCommittedRevision = committedRevisionMethod
    ? committedRevisionMethod.bind(transactionResult)
    : committedRevisionGetter
  const facade = Object.freeze({
    applyDomain: applyDomain.bind(transactionResult),
    commit: commit.bind(transactionResult),
    rollback: rollback.bind(transactionResult),
  })
  return Object.freeze({
    applyDomain: facade.applyDomain,
    commit: facade.commit,
    rollback: facade.rollback,
    readCommittedRevision,
    facade,
  })
}

function backupError(code, message, details = {}) {
  const error = new Error(message)
  error.name = 'ApplicationBackupError'
  error.code = code
  error.category = classifyBackupError(code)
  error.retryable = ['BACKUP_QUOTA_EXCEEDED', 'RESTORE_INTERRUPTED', 'RESTORE_ROLLBACK_FAILED'].includes(code)
  Object.assign(error, safeDetails(details))
  return error
}

function classifyBackupError(code) {
  if (String(code).includes('SCHEMA') || String(code).includes('DOMAIN')) return 'validation'
  if (String(code).includes('CHECKSUM') || String(code).includes('CORRUPT')) return 'corrupt'
  if (String(code).includes('QUOTA') || String(code).includes('CAPACITY')) return 'storage'
  if (String(code).includes('CONFLICT') || String(code).includes('REVISION')) return 'conflict'
  if (String(code).includes('TARGET') || String(code).includes('RESTORE')) return 'storage'
  if (String(code).includes('SECRET') || String(code).includes('BINARY') || String(code).includes('MEDIA') || String(code).includes('PATH')) return 'validation'
  return 'internal'
}

function safeDetails(details) {
  if (!details || typeof details !== 'object') return {}
  const result = {}
  for (const [key, value] of Object.entries(details)) {
    if (SENSITIVE_KEY.test(key)) continue
    if (typeof value === 'string' && looksLikeUrl(value)) {
      result[key] = redactUrl(value)
    } else if (key === 'artifact' || key === 'payload' || key === 'records') {
      result[key] = '[omitted]'
    } else {
      result[key] = value
    }
  }
  return result
}

function normalizeRequiredDomains(domains) {
  const values = Array.isArray(domains) ? domains : REQUIRED_DOMAINS
  const normalized = values.map((value) => String(value || '').trim()).filter(Boolean)
  if (!normalized.length || new Set(normalized).size !== normalized.length) {
    throw backupError('BACKUP_INVALID_DOMAIN_REGISTRY', 'Backup domain registry must contain unique domains')
  }
  return normalized
}

function normalizeAdapterMap(adapters, requiredDomains) {
  const source = adapters instanceof Map ? Object.fromEntries(adapters.entries()) : adapters
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw backupError('BACKUP_ADAPTER_MISSING', 'Backup adapters are required for every durable domain')
  }
  const result = {}
  for (const key of requiredDomains) {
    const adapter = source[key]
    if (!adapter || typeof adapter !== 'object' || typeof getCollector(adapter) !== 'function') {
      throw backupError('BACKUP_ADAPTER_MISSING', `Backup adapter is missing for durable domain ${key}`, { domain: key })
    }
    if (adapter.key && adapter.key !== key) {
      throw backupError('BACKUP_ADAPTER_DOMAIN_MISMATCH', `Backup adapter key does not match ${key}`, { domain: key })
    }
    result[key] = adapter
  }
  for (const key of Object.keys(source)) {
    if (!requiredDomains.includes(key)) {
      throw backupError('BACKUP_UNKNOWN_DOMAIN', `Backup adapter declares an unknown domain ${key}`, { domain: key })
    }
  }
  return result
}

function getCollector(adapter) {
  if (typeof adapter.exportRecords === 'function') return adapter.exportRecords
  if (typeof adapter.collect === 'function') return adapter.collect
  if (typeof adapter.export === 'function') return adapter.export
  return null
}

function getAdapterSchemaVersion(adapter, collected) {
  const value = collected?.schemaVersion ?? adapter.schemaVersion
  if (typeof value !== 'string' && !Number.isInteger(value)) {
    throw backupError('BACKUP_SCHEMA_VERSION_MISSING', 'Every backup domain must declare a schema version')
  }
  return value
}

function supportedSchemaVersions(adapter) {
  const values = adapter.supportedSchemaVersions
    || (adapter.schemaVersion !== undefined ? [adapter.schemaVersion] : [])
  return Array.isArray(values) ? values : [values]
}

function isSupportedSchema(adapter, schemaVersion) {
  return supportedSchemaVersions(adapter).some((value) => value === schemaVersion)
}

function normalizeRevision(value, field = 'revision', { integerOnly = false } = {}) {
  if (value === undefined || value === null || value === '') return null
  if (Number.isInteger(value) && value >= 0) return value
  if (!integerOnly && typeof value === 'string' && value.trim() && value.length <= 256) return value.trim()
  throw backupError('BACKUP_REVISION_INVALID', `${field} must be a non-negative integer or stable revision id`)
}

function revisionNumber(value) {
  if (Number.isInteger(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  return null
}

function compareRevisions(left, right) {
  const leftNumber = revisionNumber(left)
  const rightNumber = revisionNumber(right)
  if (leftNumber !== null && rightNumber !== null) return Math.sign(leftNumber - rightNumber)
  if (left === right) return 0
  if (left === null || left === undefined) return -1
  if (right === null || right === undefined) return 1
  return String(left) > String(right) ? 1 : -1
}

function maxRecordRevision(records) {
  const revisions = records.map((record) => revisionNumber(record.revision)).filter((value) => value !== null)
  return revisions.length ? Math.max(...revisions) : 0
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function isBinaryValue(value) {
  if (value === null || value === undefined) return false
  if (typeof Blob !== 'undefined' && value instanceof Blob) return true
  if (typeof File !== 'undefined' && value instanceof File) return true
  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) return true
  if (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer) return true
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)) return true
  return false
}

function assertNoBinaryValue(value, path = '$', seen = new WeakSet()) {
  if (isBinaryValue(value)) {
    throw backupError('BACKUP_BINARY_PAYLOAD_REJECTED', `Binary payload is not allowed in application backups at ${path}`)
  }
  if (!value || typeof value !== 'object') return
  if (seen.has(value)) throw backupError('BACKUP_CYCLIC_PAYLOAD', `Cyclic payload is not allowed at ${path}`)
  seen.add(value)
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoBinaryValue(entry, `${path}[${index}]`, seen))
  } else if (value instanceof Date) {
    return
  } else {
    for (const [key, child] of Object.entries(value)) {
      assertNoBinaryValue(child, `${path}.${key}`, seen)
    }
  }
  seen.delete(value)
}

function looksLikeUrl(value) {
  return typeof value === 'string' && /^(?:https?|wss?):\/\//i.test(value.trim())
}

function looksLikePrivatePath(value) {
  return typeof value === 'string' && PRIVATE_PATH_VALUE.test(value.trim())
}

export function redactUrl(value) {
  if (!looksLikeUrl(value)) return value
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_URL_PARAMETER.test(key) && decodeURIComponent(url.searchParams.get(key) || '') !== '[REDACTED]') {
        url.searchParams.set(key, '[REDACTED]')
      }
    }
    url.hash = ''
    return url.toString()
  } catch {
    return '[REDACTED_URL]'
  }
}

function createSanitizeState() {
  return { redactions: 0 }
}

function sanitizeValue(value, state, path = '$', seen = new WeakSet()) {
  assertNoBinaryValue(value, path)
  if (value === null || value === undefined) return value
  if (typeof value === 'string') {
    if (looksLikeUrl(value)) return redactUrl(value)
    if (looksLikePrivatePath(value)) {
      state.redactions += 1
      return '[REDACTED_PATH]'
    }
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return String(value)
  if (value instanceof Date) return value.toISOString()
  if (typeof value !== 'object') return String(value)
  if (seen.has(value)) throw backupError('BACKUP_CYCLIC_PAYLOAD', `Cyclic payload is not allowed at ${path}`)
  seen.add(value)
  let result
  if (Array.isArray(value)) {
    result = value.map((entry, index) => sanitizeValue(entry, state, `${path}[${index}]`, seen))
  } else {
    result = {}
    for (const [key, child] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) {
        state.redactions += 1
        continue
      }
      result[key] = sanitizeValue(child, state, `${path}.${key}`, seen)
    }
  }
  seen.delete(value)
  return result
}

function containsEmbeddedMedia(value, key = '') {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return /^data:/i.test(value.trim())
  if (isBinaryValue(value)) return true
  if (typeof value !== 'object') return EMBEDDED_MEDIA_KEY.test(key)
  if (Array.isArray(value)) return value.some((entry) => containsEmbeddedMedia(entry, key))
  return Object.entries(value).some(([childKey, child]) => {
    if (EMBEDDED_MEDIA_KEY.test(childKey)) return true
    if (/^media$/i.test(key) && /^(?:data|content|bytes|size)$/i.test(childKey)) return true
    return containsEmbeddedMedia(child, childKey)
  })
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength
}

function canonicalize(value) {
  if (value === null) return 'null'
  if (value === undefined) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw backupError('BACKUP_NON_FINITE_VALUE', 'Non-finite numbers are not allowed in backups')
    return JSON.stringify(value)
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(',')}]`
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => (
      `${JSON.stringify(key)}:${canonicalize(value[key])}`
    )).join(',')}}`
  }
  return JSON.stringify(String(value))
}

async function checksumCanonical(value) {
  if (!globalThis.crypto?.subtle || typeof TextEncoder !== 'function') {
    throw backupError('BACKUP_CRYPTO_UNAVAILABLE', 'SHA-256 is unavailable for application backup verification')
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalize(value)))
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function withoutKey(value, key) {
  const clone = { ...value }
  delete clone[key]
  return clone
}

function normalizeReferences(references, state) {
  if (references === undefined) return []
  if (!Array.isArray(references)) throw backupError('BACKUP_REFERENCES_INVALID', 'Backup references must be an array')
  return references.map((reference, index) => {
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
      throw backupError('BACKUP_REFERENCES_INVALID', `Backup reference ${index} is invalid`)
    }
    return sanitizeValue(reference, state, `$.references[${index}]`)
  })
}

function normalizeMediaReferences(references, state, limits) {
  if (references === undefined) return []
  if (!Array.isArray(references)) throw backupError('BACKUP_MEDIA_REFERENCES_INVALID', 'Media references must be an array')
  return references.map((reference, index) => {
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
      throw backupError('BACKUP_MEDIA_REFERENCES_INVALID', `Media reference ${index} is invalid`)
    }
    if (containsEmbeddedMedia(reference)) {
      throw backupError('BACKUP_MEDIA_PAYLOAD_REJECTED', `Embedded media content is not allowed at media reference ${index}`)
    }
    const sanitized = sanitizeValue({ ...reference, strategy: reference.strategy || MEDIA_POLICY_MODE }, state, `$.mediaReferences[${index}]`)
    const bytes = byteLength(canonicalize(sanitized))
    if (bytes > limits.maxMediaReferenceBytes) {
      throw backupError('BACKUP_MEDIA_REFERENCE_TOO_LARGE', 'Media reference exceeds the configured size ceiling', {
        maxMediaReferenceBytes: limits.maxMediaReferenceBytes,
      })
    }
    if (![MEDIA_POLICY_MODE, 'remote-url', 'file-handle'].includes(sanitized.strategy)) {
      throw backupError('BACKUP_MEDIA_REFERENCE_INVALID', 'Media reference strategy is unsupported')
    }
    return sanitized
  })
}

async function normalizeRecord(record, domain, state, limits) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw backupError('BACKUP_RECORD_INVALID', `Backup record in ${domain.key} is invalid`, { domain: domain.key })
  }
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  if (!id) throw backupError('BACKUP_RECORD_ID_MISSING', `Backup record in ${domain.key} has no id`, { domain: domain.key })
  if (!hasOwn(record, 'payload') && !hasOwn(record, 'content') && !hasOwn(record, 'value')) {
    throw backupError('BACKUP_RECORD_PAYLOAD_MISSING', `Backup record ${id} has no payload`, { domain: domain.key })
  }
  const rawPayload = hasOwn(record, 'payload') ? record.payload : (hasOwn(record, 'content') ? record.content : record.value)
  if (rawPayload === undefined) throw backupError('BACKUP_RECORD_PAYLOAD_MISSING', `Backup record ${id} has no payload`, { domain: domain.key })
  assertNoBinaryValue(rawPayload, `$.domains.${domain.key}.${id}`)
  if (containsEmbeddedMedia(rawPayload)) {
    throw backupError('BACKUP_MEDIA_PAYLOAD_REJECTED', `Embedded media content is not allowed in record ${id}`, { domain: domain.key })
  }
  const payload = sanitizeValue(rawPayload, state, `$.domains.${domain.key}.${id}`)
  const references = normalizeReferences(record.references, state)
  const mediaReferences = normalizeMediaReferences(record.mediaReferences, state, limits)
  if (record.contentId !== undefined && record.contentId !== null && typeof record.contentId !== 'string') {
    throw backupError('BACKUP_CONTENT_ID_INVALID', `Backup record ${id} has an invalid contentId`, { domain: domain.key })
  }
  const normalized = {
    id,
    schemaVersion: record.schemaVersion ?? domain.schemaVersion,
    revision: normalizeRevision(record.revision),
    contentId: record.contentId === undefined || record.contentId === null ? null : record.contentId,
    payload,
    references,
    mediaReferences,
  }
  if (normalized.schemaVersion === undefined || normalized.schemaVersion === null) {
    throw backupError('BACKUP_SCHEMA_VERSION_MISSING', `Record ${id} has no schema version`, { domain: domain.key })
  }
  const recordChecksum = await checksumCanonical(normalized)
  const serializedBytes = byteLength(canonicalize({ ...normalized, checksum: recordChecksum }))
  if (serializedBytes > limits.maxRecordBytes) {
    throw backupError('BACKUP_RECORD_TOO_LARGE', `Record ${id} exceeds the configured size ceiling`, {
      domain: domain.key,
      maxRecordBytes: limits.maxRecordBytes,
    })
  }
  return { ...normalized, checksum: recordChecksum }
}

async function collectDomain(adapter, key, limits) {
  const collector = getCollector(adapter)
  const collected = await collector.call(adapter, { domain: key, limits })
  if (!collected || typeof collected !== 'object' || Array.isArray(collected)) {
    throw backupError('BACKUP_ADAPTER_UNAVAILABLE', `Backup adapter ${key} did not provide a domain snapshot`, { domain: key })
  }
  const schemaVersion = getAdapterSchemaVersion(adapter, collected)
  if (!isSupportedSchema(adapter, schemaVersion)) {
    throw backupError('BACKUP_UNKNOWN_SCHEMA', `Backup adapter ${key} returned an unsupported schema`, {
      domain: key,
      schemaVersion,
    })
  }
  if (!Array.isArray(collected.records)) {
    throw backupError('BACKUP_RECORDS_MISSING', `Backup adapter ${key} did not provide records`, { domain: key })
  }
  const state = createSanitizeState()
  const domainInfo = {
    key,
    schemaVersion,
    adapterVersion: adapter.adapterVersion ?? 1,
  }
  const records = []
  const recordIds = new Set()
  for (const record of collected.records) {
    const normalized = await normalizeRecord(record, domainInfo, state, limits)
    if (recordIds.has(normalized.id)) throw backupError('BACKUP_DUPLICATE_RECORD', `Duplicate record ${normalized.id}`, { domain: key })
    recordIds.add(normalized.id)
    records.push(normalized)
  }
  const references = normalizeReferences(collected.references, state)
  const mediaReferences = normalizeMediaReferences(collected.mediaReferences, state, limits)
  const revision = normalizeRevision(collected.revision) ?? maxRecordRevision(records)
  const normalized = { schemaVersion, adapterVersion: domainInfo.adapterVersion, revision, records, references, mediaReferences }
  const checksum = await checksumCanonical(normalized)
  return { ...normalized, checksum, redactions: state.redactions }
}

function normalizeReleaseIdentity(release = {}) {
  const sanitized = sanitizeValue({
    applicationVersion: release.applicationVersion ?? release.frontendVersion ?? null,
    backendVersion: release.backendVersion ?? null,
    gitSha: release.gitSha ?? release.commitSha ?? null,
    releaseId: release.releaseId ?? null,
    manifestSha: release.manifestSha ?? null,
  }, createSanitizeState())
  return sanitized
}

function createManifestCore({ release, createdAt, domains, redactions, artifactBytes, maxBackupBytes }) {
  const recordCounts = Object.fromEntries(domains.map(([key, value]) => [key, value.records.length]))
  const domainChecksums = Object.fromEntries(domains.map(([key, value]) => [key, value.checksum]))
  const recordChecksums = {}
  const references = {}
  const mediaReferences = {}
  const domainRegistry = domains.map(([key, value]) => ({
    key,
    schemaVersion: value.schemaVersion,
    adapterVersion: value.adapterVersion,
    required: true,
  }))
  for (const [key, value] of domains) {
    references[key] = value.references
    mediaReferences[key] = value.mediaReferences
    for (const record of value.records) recordChecksums[`${key}:${record.id}`] = record.checksum
  }
  return {
    formatVersion: FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    release,
    createdAt,
    domainRegistry,
    recordCounts,
    totalRecordCount: Object.values(recordCounts).reduce((total, count) => total + count, 0),
    domainChecksums,
    recordChecksums,
    references,
    mediaReferences,
    mediaPolicy: { ...APPLICATION_BACKUP_MEDIA_POLICY },
    redactions,
    artifactBytes,
    maxBackupBytes,
  }
}

async function buildArtifact({ release, createdAt, domains, redactions, limits }) {
  let artifactBytes = 0
  let artifact = null
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const manifestCore = createManifestCore({
      release,
      createdAt,
      domains,
      redactions,
      artifactBytes,
      maxBackupBytes: limits.maxBackupBytes,
    })
    const manifest = { ...manifestCore, checksum: await checksumCanonical(manifestCore) }
    const domainPayload = Object.fromEntries(domains.map(([key, value]) => [key, {
      schemaVersion: value.schemaVersion,
      adapterVersion: value.adapterVersion,
      revision: value.revision,
      records: value.records,
      references: value.references,
      mediaReferences: value.mediaReferences,
    }]))
    const artifactCore = { format: BACKUP_FORMAT, manifest, domains: domainPayload }
    artifact = { ...artifactCore, artifactChecksum: await checksumCanonical(artifactCore) }
    const nextBytes = byteLength(JSON.stringify(artifact))
    if (nextBytes === artifactBytes) break
    artifactBytes = nextBytes
  }
  if (!artifact) throw backupError('BACKUP_BUILD_FAILED', 'Application backup artifact could not be built')
  const size = byteLength(JSON.stringify(artifact))
  if (size > limits.maxBackupBytes) {
    throw backupError('BACKUP_QUOTA_EXCEEDED', 'Application backup exceeds the configured capacity limit', {
      sizeBytes: size,
      maxBackupBytes: limits.maxBackupBytes,
    })
  }
  return artifact
}

function parseArtifact(input) {
  if (input && typeof input === 'object' && !(input instanceof Uint8Array)) {
    // Validate the caller-provided object before JSON cloning it; cloning a
    // typed array would otherwise turn it into an ordinary object and defeat
    // the binary-payload guard.
    assertNoBinaryValue(input)
  }
  try {
    if (typeof input === 'string') return JSON.parse(input)
    if (input instanceof Uint8Array) return JSON.parse(new TextDecoder().decode(input))
    if (!input || typeof input !== 'object') throw new Error('backup artifact must be an object or JSON string')
    return JSON.parse(JSON.stringify(input))
  } catch (error) {
    throw backupError('BACKUP_ARTIFACT_INVALID', 'Backup artifact is not valid JSON', { causeCode: error?.code || 'PARSE_FAILED' })
  }
}

// Keep verifier canonicalization independent from exporter canonicalization.
// The verifier must be able to detect a producer bug instead of trusting the
// same helper that produced the checksums.
function verificationCanonicalize(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw backupError('BACKUP_NON_FINITE_VALUE', 'Non-finite numbers are not allowed in backups')
    return JSON.stringify(value)
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) return `[${value.map((entry) => verificationCanonicalize(entry)).join(',')}]`
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort().filter((key) => value[key] !== undefined)
    return `{${keys.map((key) => `${JSON.stringify(key)}:${verificationCanonicalize(value[key])}`).join(',')}}`
  }
  return JSON.stringify(String(value))
}

async function verificationChecksumCanonical(value) {
  if (!globalThis.crypto?.subtle || typeof TextEncoder !== 'function') {
    throw backupError('BACKUP_CRYPTO_UNAVAILABLE', 'SHA-256 is unavailable for independent backup verification')
  }
  const bytes = new TextEncoder().encode(verificationCanonicalize(value))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function verificationContainsEmbeddedMedia(value, key = '') {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return /^data:/i.test(value.trim())
  if (isBinaryValue(value)) return true
  if (typeof value !== 'object') return /(?:blob|arraybuffer|typedarray|binary|base64|datauri|inline(?:data|media)?|media(?:data|bytes)|audio(?:data|blob)|video(?:data|blob))/i.test(key)
  if (Array.isArray(value)) return value.some((entry) => verificationContainsEmbeddedMedia(entry, key))
  return Object.entries(value).some(([childKey, child]) => (
    /(?:blob|arraybuffer|typedarray|binary|base64|datauri|inline(?:data|media)?|media(?:data|bytes)|audio(?:data|blob)|video(?:data|blob))/i.test(childKey)
      || verificationContainsEmbeddedMedia(child, childKey)
  ))
}

function verificationValidateReferences(value, path) {
  if (!Array.isArray(value)) throw backupError('BACKUP_REFERENCES_INVALID', `Backup references are invalid at ${path}`)
  for (const [index, reference] of value.entries()) {
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
      throw backupError('BACKUP_REFERENCES_INVALID', `Backup reference ${path}[${index}] is invalid`)
    }
  }
}

function verificationValidateMediaReferences(value, path, maxBytes) {
  if (!Array.isArray(value)) throw backupError('BACKUP_MEDIA_REFERENCES_INVALID', `Backup media references are invalid at ${path}`)
  for (const [index, reference] of value.entries()) {
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
      throw backupError('BACKUP_MEDIA_REFERENCES_INVALID', `Backup media reference ${path}[${index}] is invalid`)
    }
    if (verificationContainsEmbeddedMedia(reference)) {
      throw backupError('BACKUP_MEDIA_PAYLOAD_REJECTED', `Embedded media content is not allowed at ${path}[${index}]`)
    }
    if (!['identity-metadata-rebind', 'remote-url', 'file-handle'].includes(reference.strategy)) {
      throw backupError('BACKUP_MEDIA_REFERENCE_INVALID', `Backup media reference strategy is unsupported at ${path}[${index}]`)
    }
    if (byteLength(verificationCanonicalize(reference)) > maxBytes) {
      throw backupError('BACKUP_MEDIA_REFERENCE_TOO_LARGE', `Backup media reference exceeds the size ceiling at ${path}[${index}]`)
    }
  }
}

function rejectUnsafeVerificationValue(value, path = '$', seen = new WeakSet()) {
  if (isBinaryValue(value)) throw backupError('BACKUP_BINARY_PAYLOAD_REJECTED', `Binary payload found at ${path}`)
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'string' && /^data:/i.test(value.trim())) {
      throw backupError('BACKUP_MEDIA_PAYLOAD_REJECTED', `Inline media data found at ${path}`)
    }
    if (looksLikePrivatePath(value)) {
      throw backupError('BACKUP_PRIVATE_PATH_PRESENT', `Private machine path found at ${path}`)
    }
    if (looksLikeUrl(value)) {
      const redacted = redactUrl(value)
      if (redacted !== value) throw backupError('BACKUP_SECRET_PRESENT', `Credential-bearing URL found at ${path}`)
    }
    return
  }
  if (seen.has(value)) throw backupError('BACKUP_CYCLIC_PAYLOAD', `Cyclic artifact found at ${path}`)
  seen.add(value)
  if (Array.isArray(value)) value.forEach((entry, index) => rejectUnsafeVerificationValue(entry, `${path}[${index}]`, seen))
  else for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key) && child !== '[REDACTED]') {
      throw backupError('BACKUP_SECRET_PRESENT', `Secret-bearing field found at ${path}.${key}`)
    }
    rejectUnsafeVerificationValue(child, `${path}.${key}`, seen)
  }
  seen.delete(value)
}

async function verifyArtifactOrThrow(input, options = {}) {
  const artifact = parseArtifact(input)
  const requiredDomains = normalizeRequiredDomains(options.requiredDomains)
  const limits = normalizeLimits(options)
  if (artifact.format !== BACKUP_FORMAT) throw backupError('BACKUP_FORMAT_UNSUPPORTED', 'Backup artifact format is unsupported')
  const manifest = artifact.manifest
  if (!manifest || typeof manifest !== 'object') throw backupError('BACKUP_MANIFEST_MISSING', 'Backup manifest is missing')
  if (manifest.formatVersion !== FORMAT_VERSION || manifest.schemaVersion !== SCHEMA_VERSION) {
    throw backupError('BACKUP_SCHEMA_UNSUPPORTED', 'Backup manifest schema is unsupported', {
      formatVersion: manifest.formatVersion ?? null,
      schemaVersion: manifest.schemaVersion ?? null,
    })
  }
  if (typeof manifest.createdAt !== 'string' || Number.isNaN(Date.parse(manifest.createdAt))) {
    throw backupError('BACKUP_MANIFEST_INVALID', 'Backup manifest createdAt is invalid')
  }
  if (!manifest.release || typeof manifest.release !== 'object' || Array.isArray(manifest.release)) {
    throw backupError('BACKUP_RELEASE_IDENTITY_MISSING', 'Backup manifest release identity is missing')
  }
  for (const field of ['applicationVersion', 'backendVersion', 'gitSha', 'releaseId', 'manifestSha']) {
    if (!hasOwn(manifest.release, field)) throw backupError('BACKUP_RELEASE_IDENTITY_MISSING', `Backup release identity is missing ${field}`)
  }
  if (!Number.isInteger(manifest.artifactBytes) || manifest.artifactBytes < 0) {
    throw backupError('BACKUP_MANIFEST_INVALID', 'Backup manifest artifactBytes is invalid')
  }
  if (!Number.isInteger(manifest.maxBackupBytes) || manifest.maxBackupBytes < 1) {
    throw backupError('BACKUP_MANIFEST_INVALID', 'Backup manifest maxBackupBytes is invalid')
  }
  if (!Number.isInteger(manifest.redactions) || manifest.redactions < 0) {
    throw backupError('BACKUP_MANIFEST_INVALID', 'Backup manifest redactions is invalid')
  }
  if (verificationCanonicalize(manifest.mediaPolicy) !== verificationCanonicalize(APPLICATION_BACKUP_MEDIA_POLICY)) {
    throw backupError('BACKUP_MEDIA_POLICY_INVALID', 'Backup manifest media policy is unsupported')
  }
  if (!Array.isArray(manifest.domainRegistry)) throw backupError('BACKUP_DOMAIN_REGISTRY_MISSING', 'Backup domain registry is missing')
  const registered = manifest.domainRegistry.map((entry) => entry?.key)
  if (registered.some((key) => typeof key !== 'string' || !key.trim())) {
    throw backupError('BACKUP_DOMAIN_REGISTRY_INVALID', 'Backup domain registry contains an invalid key')
  }
  if (new Set(registered).size !== registered.length) throw backupError('BACKUP_DOMAIN_REGISTRY_INVALID', 'Backup domain registry contains duplicates')
  for (const entry of manifest.domainRegistry) {
    if (!requiredDomains.includes(entry.key)) continue
    if (entry.required !== true || !Number.isInteger(entry.adapterVersion) || entry.adapterVersion < 1) {
      throw backupError('BACKUP_DOMAIN_REGISTRY_INVALID', `Backup domain registry entry ${entry.key} is invalid`, { domain: entry.key })
    }
    if (typeof entry.schemaVersion !== 'string' && !Number.isInteger(entry.schemaVersion)) {
      throw backupError('BACKUP_DOMAIN_SCHEMA_MISMATCH', `Backup domain ${entry.key} has no schema version`, { domain: entry.key })
    }
  }
  for (const key of registered) if (!requiredDomains.includes(key)) throw backupError('BACKUP_UNKNOWN_DOMAIN', `Backup contains unknown domain ${key}`, { domain: key })
  for (const key of requiredDomains) if (!registered.includes(key)) throw backupError('BACKUP_DOMAIN_MISSING', `Backup domain ${key} is missing`, { domain: key })
  if (manifest.domainRegistry.length !== requiredDomains.length) {
    throw backupError('BACKUP_DOMAIN_REGISTRY_INVALID', 'Backup domain registry does not match the required domain set')
  }
  if (!artifact.domains || typeof artifact.domains !== 'object' || Array.isArray(artifact.domains)) {
    throw backupError('BACKUP_DOMAINS_MISSING', 'Backup domain payload is missing')
  }
  const actualDomainKeys = Object.keys(artifact.domains)
  if (actualDomainKeys.length !== registered.length || actualDomainKeys.some((key) => !registered.includes(key))) {
    throw backupError('BACKUP_UNKNOWN_DOMAIN', 'Backup domain payload keys do not match the domain registry')
  }
  const manifestMapFields = ['recordCounts', 'domainChecksums', 'references', 'mediaReferences']
  for (const field of manifestMapFields) {
    const value = manifest[field]
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw backupError('BACKUP_MANIFEST_INVALID', `Backup manifest ${field} is invalid`)
    }
    const keys = Object.keys(value)
    if (keys.length !== registered.length || keys.some((key) => !registered.includes(key))) {
      throw backupError('BACKUP_MANIFEST_INVALID', `Backup manifest ${field} does not match the domain registry`)
    }
  }
  if (!manifest.recordChecksums || typeof manifest.recordChecksums !== 'object' || Array.isArray(manifest.recordChecksums)) {
    throw backupError('BACKUP_MANIFEST_INVALID', 'Backup manifest recordChecksums is invalid')
  }
  const totalRecords = []
  const domainSummaries = []
  const expectedRecordChecksumKeys = []
  for (const entry of manifest.domainRegistry) {
    const key = entry.key
    const domain = artifact.domains[key]
    if (!domain || typeof domain !== 'object' || !Array.isArray(domain.records)) throw backupError('BACKUP_DOMAIN_PAYLOAD_MISSING', `Backup domain ${key} payload is missing`, { domain: key })
    if (domain.schemaVersion !== entry.schemaVersion || domain.adapterVersion !== entry.adapterVersion) throw backupError('BACKUP_DOMAIN_SCHEMA_MISMATCH', `Backup domain ${key} schema does not match its registry`, { domain: key })
    if (!Array.isArray(domain.references) || !Array.isArray(domain.mediaReferences)) throw backupError('BACKUP_DOMAIN_METADATA_INVALID', `Backup domain ${key} metadata is invalid`, { domain: key })
    if (domain.revision !== null && domain.revision !== undefined
      && !(Number.isInteger(domain.revision) && domain.revision >= 0)
      && !(typeof domain.revision === 'string' && domain.revision.trim() && domain.revision.length <= 256)) {
      throw backupError('BACKUP_REVISION_INVALID', `Backup domain ${key} revision is invalid`, { domain: key })
    }
    verificationValidateReferences(domain.references, `$.domains.${key}.references`)
    verificationValidateMediaReferences(domain.mediaReferences, `$.domains.${key}.mediaReferences`, Math.min(limits.maxMediaReferenceBytes, APPLICATION_BACKUP_MEDIA_POLICY.maxMediaReferenceBytes))
    const recordIds = new Set()
    const normalizedRecords = []
    for (const record of domain.records) {
      const id = String(record?.id || '').trim()
      if (!id || recordIds.has(id)) throw backupError('BACKUP_RECORD_INVALID', `Backup domain ${key} has an invalid or duplicate record id`, { domain: key })
      if (!record || typeof record !== 'object' || Array.isArray(record) || record.id !== id) {
        throw backupError('BACKUP_RECORD_INVALID', `Backup domain ${key} has an invalid record id`, { domain: key })
      }
      recordIds.add(id)
      if (typeof record.checksum !== 'string') throw backupError('BACKUP_RECORD_CHECKSUM_MISSING', `Backup record ${key}:${id} has no checksum`, { domain: key })
      if ((typeof record.schemaVersion !== 'string' && !Number.isInteger(record.schemaVersion))
        || (record.revision !== null && record.revision !== undefined
          && !(Number.isInteger(record.revision) && record.revision >= 0)
          && !(typeof record.revision === 'string' && record.revision.trim() && record.revision.length <= 256))
        || (record.contentId !== null && record.contentId !== undefined && typeof record.contentId !== 'string')
        || !hasOwn(record, 'payload')) {
        throw backupError('BACKUP_RECORD_INVALID', `Backup record ${key}:${id} has invalid envelope fields`, { domain: key })
      }
      verificationValidateReferences(record.references, `$.domains.${key}.${id}.references`)
      verificationValidateMediaReferences(record.mediaReferences, `$.domains.${key}.${id}.mediaReferences`, Math.min(limits.maxMediaReferenceBytes, APPLICATION_BACKUP_MEDIA_POLICY.maxMediaReferenceBytes))
      rejectUnsafeVerificationValue(record, `$.domains.${key}.${id}`)
      const recordCore = withoutKey(record, 'checksum')
      const actualRecordChecksum = await verificationChecksumCanonical(recordCore)
      if (actualRecordChecksum !== record.checksum) throw backupError('BACKUP_CHECKSUM_MISMATCH', `Backup record checksum mismatch for ${key}:${id}`, { domain: key })
      const expectedRecordChecksum = manifest.recordChecksums?.[`${key}:${id}`]
      if (expectedRecordChecksum !== record.checksum) throw backupError('BACKUP_CHECKSUM_MISMATCH', `Backup manifest record checksum mismatch for ${key}:${id}`, { domain: key })
      expectedRecordChecksumKeys.push(`${key}:${id}`)
      normalizedRecords.push(record)
      totalRecords.push(record)
    }
    const domainCore = {
      schemaVersion: domain.schemaVersion,
      adapterVersion: domain.adapterVersion,
      revision: domain.revision ?? maxRecordRevision(normalizedRecords),
      records: normalizedRecords,
      references: domain.references,
      mediaReferences: domain.mediaReferences,
    }
    const actualDomainChecksum = await verificationChecksumCanonical(domainCore)
    if (actualDomainChecksum !== manifest.domainChecksums?.[key]) throw backupError('BACKUP_CHECKSUM_MISMATCH', `Backup domain checksum mismatch for ${key}`, { domain: key })
    if (manifest.recordCounts?.[key] !== normalizedRecords.length) throw backupError('BACKUP_RECORD_COUNT_MISMATCH', `Backup record count mismatch for ${key}`, { domain: key })
    if (verificationCanonicalize(manifest.references[key]) !== verificationCanonicalize(domain.references)) {
      throw backupError('BACKUP_REFERENCE_MISMATCH', `Backup manifest references mismatch for ${key}`, { domain: key })
    }
    if (verificationCanonicalize(manifest.mediaReferences[key]) !== verificationCanonicalize(domain.mediaReferences)) {
      throw backupError('BACKUP_MEDIA_REFERENCE_MISMATCH', `Backup manifest media references mismatch for ${key}`, { domain: key })
    }
    domainSummaries.push({ key, recordCount: normalizedRecords.length, checksum: actualDomainChecksum, revision: domain.revision ?? maxRecordRevision(normalizedRecords) })
  }
  const actualRecordChecksumKeys = Object.keys(manifest.recordChecksums)
  if (actualRecordChecksumKeys.length !== expectedRecordChecksumKeys.length
    || actualRecordChecksumKeys.some((key) => !expectedRecordChecksumKeys.includes(key))) {
    throw backupError('BACKUP_MANIFEST_INVALID', 'Backup manifest recordChecksums do not match the records')
  }
  rejectUnsafeVerificationValue(artifact, '$')
  const expectedManifestChecksum = await verificationChecksumCanonical(withoutKey(manifest, 'checksum'))
  if (expectedManifestChecksum !== manifest.checksum) throw backupError('BACKUP_CHECKSUM_MISMATCH', 'Backup manifest checksum mismatch')
  const expectedArtifactChecksum = await verificationChecksumCanonical({ format: artifact.format, manifest: artifact.manifest, domains: artifact.domains })
  if (expectedArtifactChecksum !== artifact.artifactChecksum) throw backupError('BACKUP_CHECKSUM_MISMATCH', 'Backup artifact checksum mismatch')
  const actualBytes = byteLength(JSON.stringify(artifact))
  if (manifest.artifactBytes !== actualBytes) throw backupError('BACKUP_SIZE_MISMATCH', 'Backup artifact byte count mismatch')
  if (actualBytes > Math.min(manifest.maxBackupBytes, limits.maxBackupBytes)) {
    throw backupError('BACKUP_QUOTA_EXCEEDED', 'Backup artifact exceeds the configured capacity limit', { sizeBytes: actualBytes })
  }
  if (manifest.totalRecordCount !== totalRecords.length) throw backupError('BACKUP_RECORD_COUNT_MISMATCH', 'Backup total record count mismatch')
  return {
    valid: true,
    artifact,
    summary: {
      totalRecords: totalRecords.length,
      domainKeys: manifest.domainRegistry.map((entry) => entry.key),
      domains: domainSummaries,
      sizeBytes: actualBytes,
    },
  }
}

export async function verifyBackupArtifact(input, options = {}) {
  try {
    return await verifyArtifactOrThrow(input, options)
  } catch (error) {
    return {
      valid: false,
      error: {
        code: error?.code || 'BACKUP_VERIFY_FAILED',
        category: error?.category || 'internal',
        message: error?.message || 'Backup verification failed',
        ...(safeDetails(error || {})),
      },
    }
  }
}

export async function assertValidBackupArtifact(input, options = {}) {
  const report = await verifyBackupArtifact(input, options)
  if (!report.valid) throw backupError(report.error.code, report.error.message, report.error)
  return report
}

async function readRollbackBackup(capability, restoreId) {
  if (typeof capability?.rollback?.read !== 'function') return null
  return capability.rollback.read({ restoreId })
}

async function writeRollbackBackup(capability, restoreId, artifact) {
  if (typeof capability?.rollback?.write !== 'function') throw backupError('RESTORE_TARGET_UNSAFE', 'Restore target must provide a durable rollback backup store')
  return capability.rollback.write(
    { restoreId, artifact, createdAt: new Date().toISOString() },
    { operation: capability.operation },
  )
}

function rollbackBaseRevision(entry) {
  const revision = entry?.rawState?.revision ?? entry?.expectedBaseRevision
  return isValidRevision(revision) ? revision : null
}

function isValidRevision(value) {
  return Number.isInteger(value) && value >= 0
}

function invalidCommitEvidence(restoreId, value) {
  return backupError('RESTORE_COMMIT_EVIDENCE_UNAVAILABLE', 'Restore commit exposed an invalid durable committed revision', {
    restoreId,
    committedRevision: value,
    commitMayHaveApplied: true,
  })
}

function readCommittedRevisionEvidence(transactionCapability, commitResult, restoreId) {
  const resultRevision = commitResult?.revision
  if (resultRevision !== undefined && resultRevision !== null) {
    if (!isValidRevision(resultRevision)) throw invalidCommitEvidence(restoreId, resultRevision)
    return resultRevision
  }
  if (typeof transactionCapability?.readCommittedRevision === 'function') {
    const exposedRevision = transactionCapability.readCommittedRevision()
    if (exposedRevision !== undefined && exposedRevision !== null) {
      if (!isValidRevision(exposedRevision)) throw invalidCommitEvidence(restoreId, exposedRevision)
      return exposedRevision
    }
  }
  return null
}

function readFailedCommitEvidence(transactionCapability, error, restoreId) {
  if (error && Object.prototype.hasOwnProperty.call(error, 'committedRevision')) {
    if (!isValidRevision(error.committedRevision)) throw invalidCommitEvidence(restoreId, error.committedRevision)
    return error.committedRevision
  }
  return readCommittedRevisionEvidence(transactionCapability, undefined, restoreId)
}

async function quarantineArtifact(capability, entry) {
  if (typeof capability?.quarantine?.write !== 'function') return { written: false }
  await capability.quarantine.write({
    schemaVersion: 1,
    quarantinedAt: new Date().toISOString(),
    ...entry,
  })
  return { written: true }
}

function normalizeLimits(options = {}) {
  return {
    maxBackupBytes: Number.isFinite(options.maxBackupBytes) ? Math.max(1, Math.floor(options.maxBackupBytes)) : DEFAULT_MAX_BACKUP_BYTES,
    maxRecordBytes: Number.isFinite(options.maxRecordBytes) ? Math.max(1, Math.floor(options.maxRecordBytes)) : DEFAULT_MAX_RECORD_BYTES,
    maxMediaReferenceBytes: Number.isFinite(options.maxMediaReferenceBytes)
      ? Math.min(DEFAULT_MAX_MEDIA_REFERENCE_BYTES, Math.max(1, Math.floor(options.maxMediaReferenceBytes)))
      : DEFAULT_MAX_MEDIA_REFERENCE_BYTES,
  }
}

async function collectForAdapters(adapters, requiredDomains, limits) {
  const values = []
  let redactions = 0
  for (const key of requiredDomains) {
    const value = await collectDomain(adapters[key], key, limits)
    values.push([key, value])
    redactions += value.redactions
  }
  return { values, redactions }
}

function normalizeTargetAdapters(target, fallback, requiredDomains) {
  return normalizeAdapterMap(target?.adapters || fallback, requiredDomains)
}

function createUntrustedDryRunCapability(target, adapters, resolutions = {}) {
  return {
    adapters,
    capacityBytes: target?.capacityBytes,
    rollbackStoreSeparate: target?.rollbackStoreSeparate,
    estimateCapacity: typeof target?.estimateCapacity === 'function' ? target.estimateCapacity.bind(target) : null,
    mergeDomain: typeof target?.mergeDomain === 'function' ? target.mergeDomain.bind(target) : null,
    resolutions: resolutions || target?.resolutions || {},
    validationTarget: target,
  }
}

async function buildCurrentDomainSnapshot(adapter, key, limits) {
  return collectDomain(adapter, key, limits)
}

async function validateReferences(adapter, key, domain, target) {
  if (typeof adapter.validateReferences !== 'function') return { ok: true }
  try {
    const result = await adapter.validateReferences(domain, { target, domain: key })
    if (result === false || result?.ok === false) return { ok: false, reason: result?.reason || 'reference-validation-failed' }
    return { ok: true, details: result }
  } catch (error) {
    return { ok: false, reason: error?.code || 'reference-validation-failed' }
  }
}

function resolutionForRecord(resolution, recordId) {
  if (typeof resolution === 'string') return resolution
  if (!resolution || typeof resolution !== 'object') return null
  if (resolution.records && typeof resolution.records === 'object') {
    const value = resolution.records[recordId]
    if (typeof value === 'string') return value
    if (value && typeof value === 'object' && typeof value.decision === 'string') return value.decision
  }
  return typeof resolution.decision === 'string' ? resolution.decision : null
}

function recordConflictReason(record, targetRecord) {
  if (!targetRecord) return null
  if (record.contentId !== targetRecord.contentId
    && (record.contentId !== null && record.contentId !== undefined
      || targetRecord.contentId !== null && targetRecord.contentId !== undefined)) {
    return 'record-content-id-conflict'
  }
  if (compareRevisions(targetRecord.revision, record.revision) > 0) return 'newer-target-record-revision'
  if (compareRevisions(targetRecord.revision, record.revision) === 0) return 'record-same-revision-different-content'
  return null
}

function buildRecordDryRunReport(sourceRecords, targetRecords, resolution) {
  const targetById = new Map(targetRecords.map((record) => [record.id, record]))
  const sourceIds = new Set(sourceRecords.map((record) => record.id))
  const reports = []
  for (const sourceRecord of sourceRecords) {
    const targetRecord = targetById.get(sourceRecord.id) || null
    const explicit = resolutionForRecord(resolution, sourceRecord.id)
    const conflictReason = recordConflictReason(sourceRecord, targetRecord)
    let decision = 'restore'
    let reason = targetRecord ? 'backup-is-newer' : 'target-record-missing'
    if (targetRecord?.checksum === sourceRecord.checksum) {
      decision = 'keep'
      reason = 'already-current'
    } else if (explicit === 'keep') {
      decision = 'keep'
      reason = conflictReason ? `explicit-keep-${conflictReason}` : 'explicit-keep'
    } else if (explicit === 'restore') {
      decision = 'restore'
      reason = conflictReason ? `explicit-restore-${conflictReason}` : 'explicit-restore'
    } else if (explicit === 'merge') {
      decision = 'merge'
      reason = conflictReason ? `explicit-merge-${conflictReason}` : 'explicit-merge'
    } else if (conflictReason) {
      decision = 'blocked'
      reason = conflictReason
    }
    reports.push({
      id: sourceRecord.id,
      decision,
      reason,
      sourceRevision: sourceRecord.revision,
      targetRevision: targetRecord?.revision ?? null,
      sourceContentId: sourceRecord.contentId ?? null,
      targetContentId: targetRecord?.contentId ?? null,
      sourceChecksum: sourceRecord.checksum,
      targetChecksum: targetRecord?.checksum ?? null,
    })
  }
  for (const targetRecord of targetRecords) {
    if (sourceIds.has(targetRecord.id)) continue
    const explicit = resolutionForRecord(resolution, targetRecord.id)
    const decision = explicit === 'restore' ? 'restore' : explicit === 'merge' ? 'merge' : explicit === 'keep' ? 'keep' : 'blocked'
    reports.push({
      id: targetRecord.id,
      decision,
      reason: decision === 'blocked' ? 'target-record-not-in-backup' : `explicit-${decision}-target-record-not-in-backup`,
      sourceRevision: null,
      targetRevision: targetRecord.revision,
      sourceContentId: null,
      targetContentId: targetRecord.contentId ?? null,
      sourceChecksum: null,
      targetChecksum: targetRecord.checksum,
    })
  }
  return reports
}

function domainReasonForRecordConflict(recordReports) {
  const firstBlocked = recordReports.find((record) => record.decision === 'blocked')
  if (!firstBlocked) return null
  if (firstBlocked.reason === 'newer-target-record-revision') return 'newer-target-revision'
  if (firstBlocked.reason === 'record-content-id-conflict') return 'record-content-id-conflict'
  if (firstBlocked.reason === 'record-same-revision-different-content') return 'same-revision-different-content'
  return firstBlocked.reason
}

async function dryRunRestoreForService({ artifact, capability, requiredDomains, limits }) {
  const verification = await assertValidBackupArtifact(artifact, { requiredDomains })
  const source = verification.artifact
  const capacityResult = await resolveCapacity(capability, verification.summary.sizeBytes)
  const domains = []
  for (const key of requiredDomains) {
    const adapter = capability.adapters[key]
    const sourceDomain = source.domains[key]
    const current = await buildCurrentDomainSnapshot(adapter, key, limits)
    const sourceRevision = sourceDomain.revision ?? maxRecordRevision(sourceDomain.records)
    const targetRevision = current.revision ?? maxRecordRevision(current.records)
    const sameChecksum = current.checksum === source.manifest.domainChecksums[key]
    const resolution = capability.resolutions?.[key] ?? null
    const requested = typeof resolution === 'string' ? resolution : resolution?.decision || null
    const referenceResult = await validateReferences(adapter, key, sourceDomain, capability.validationTarget || capability)
    const recordReports = buildRecordDryRunReport(sourceDomain.records, current.records, resolution)
    const recordBlocked = recordReports.filter((record) => record.decision === 'blocked')
    let decision = 'blocked'
    let reason = 'revision-conflict'
    if (!isSupportedSchema(adapter, sourceDomain.schemaVersion)) {
      reason = 'unsupported-schema'
    } else if (!referenceResult.ok) {
      reason = referenceResult.reason
    } else if (recordBlocked.length) {
      reason = domainReasonForRecordConflict(recordReports) || 'record-conflict'
    } else if (sameChecksum) {
      decision = 'keep'
      reason = 'already-current'
    } else if (requested === 'keep') {
      decision = 'keep'
      reason = 'explicit-keep'
    } else if (requested === 'merge') {
      if (typeof adapter.merge === 'function' || typeof capability.mergeDomain === 'function') {
        decision = 'merge'
        reason = 'explicit-merge'
      } else {
        reason = 'merge-not-supported'
      }
    } else if (requested === 'restore') {
      decision = 'restore'
      reason = compareRevisions(targetRevision, sourceRevision) > 0 ? 'explicit-restore-newer-target' : 'explicit-restore'
    } else if (compareRevisions(targetRevision, sourceRevision) > 0) {
      reason = 'newer-target-revision'
    } else if (compareRevisions(targetRevision, sourceRevision) === 0 && current.records.length && sourceDomain.records.length) {
      reason = 'same-revision-different-content'
    } else {
      decision = 'restore'
      reason = 'backup-is-newer-or-target-empty'
    }
    domains.push({
      key,
      decision,
      reason,
      sourceRevision,
      targetRevision,
      sourceChecksum: source.manifest.domainChecksums[key],
      targetChecksum: current.checksum,
      sourceRecordCount: sourceDomain.records.length,
      targetRecordCount: current.records.length,
      reference: referenceResult,
      records: recordReports,
      blockedRecordCount: recordBlocked.length,
    })
  }
  if (!capacityResult.ok) {
    for (const domain of domains) {
      if (domain.decision === 'restore' || domain.decision === 'merge') {
        domain.decision = 'blocked'
        domain.reason = 'insufficient-capacity'
      }
    }
  }
  const blocked = domains.filter((domain) => domain.decision === 'blocked')
  return {
    mode: 'dry-run',
    write: false,
    ok: blocked.length === 0 && capacityResult.ok,
    artifactChecksum: source.artifactChecksum,
    sizeBytes: verification.summary.sizeBytes,
    capacity: capacityResult,
    domains,
    blocked: blocked.flatMap((domain) => {
      const entries = [{ domain: domain.key, reason: domain.reason }]
      for (const record of domain.records || []) {
        if (record.decision === 'blocked') entries.push({ domain: domain.key, recordId: record.id, reason: record.reason })
      }
      return entries
    }),
    conflictCount: domains.reduce((count, domain) => count
      + (domain.reason.includes('revision') || domain.reason.includes('content') ? 1 : 0)
      + (domain.records || []).filter((record) => record.decision === 'blocked').length, 0),
    referenceCount: Object.values(source.manifest.references || {}).reduce((count, values) => count + values.length, 0),
    mediaReferences: source.manifest.mediaReferences,
  }
}

async function resolveCapacity(capability, backupBytes) {
  const requiredBytes = backupBytes * (capability?.rollbackStoreSeparate === true ? 1 : 2)
  if (typeof capability?.estimateCapacity === 'function' && !Number.isFinite(capability?.capacityBytes)) {
    try {
      const result = await capability.estimateCapacity({ requiredBytes })
      const availableBytes = Number(result?.availableBytes ?? result?.remainingBytes)
      return {
        ok: result?.ok !== false && Number.isFinite(availableBytes) && availableBytes >= requiredBytes,
        requiredBytes,
        availableBytes: Number.isFinite(availableBytes) ? availableBytes : null,
      }
    } catch (error) {
      return { ok: false, requiredBytes, availableBytes: null, reason: error?.code || 'capacity-check-failed' }
    }
  }
  if (Number.isFinite(capability?.capacityBytes)) {
    return { ok: capability.capacityBytes >= requiredBytes, requiredBytes, availableBytes: capability.capacityBytes }
  }
  return { ok: true, requiredBytes, availableBytes: null }
}

export function createApplicationBackupService(options = {}) {
  const requiredDomains = normalizeRequiredDomains(options.requiredDomains)
  const configuredAdapters = normalizeAdapterMap(options.adapters || options.domains, requiredDomains)
  const limits = normalizeLimits(options)
  const release = normalizeReleaseIdentity(options.release)
  const now = options.now || Date.now
  const configuredTarget = options.target || null

  async function createBackup(backupOptions = {}) {
    const activeAdapters = normalizeAdapterMap(backupOptions.adapters || configuredAdapters, requiredDomains)
    const backupLimits = normalizeLimits({ ...limits, ...(backupOptions.limits || {}) })
    const collected = await collectForAdapters(activeAdapters, requiredDomains, backupLimits)
    const timestampValue = typeof backupOptions.now === 'function'
      ? backupOptions.now()
      : (Number.isFinite(backupOptions.now) ? backupOptions.now : now())
    const createdAt = new Date(timestampValue).toISOString()
    const domains = collected.values.map(([key, value]) => [key, {
      ...value,
      redactions: undefined,
    }])
    return buildArtifact({
      release,
      createdAt,
      domains,
      redactions: collected.redactions,
      limits: backupLimits,
    })
  }

  async function dryRunRestore(artifact, dryRunOptions = {}) {
    const target = dryRunOptions.target || configuredTarget || {}
    const targetAdapters = normalizeTargetAdapters(target, configuredAdapters, requiredDomains)
    const capability = createUntrustedDryRunCapability(target, targetAdapters, dryRunOptions.resolutions || {})
    try {
      return await dryRunRestoreForService({
        artifact,
        capability,
        requiredDomains,
        limits,
      })
    } catch (error) {
      const details = error?.details && typeof error.details === 'object' ? { ...error.details } : {}
      return {
        mode: 'dry-run',
        write: false,
        ok: false,
        artifactChecksum: null,
        sizeBytes: null,
        capacity: { ok: false, reason: 'verification-failed' },
        domains: requiredDomains.map((key) => ({
          key,
          decision: 'blocked',
          reason: error?.code || 'verification-failed',
        })),
        blocked: requiredDomains.map((key) => ({ domain: key, reason: error?.code || 'verification-failed' })),
        conflictCount: 0,
        referenceCount: 0,
        mediaReferences: {},
        error: {
          code: error?.code || 'BACKUP_VERIFY_FAILED',
          ...(Object.keys(details).length ? { details } : {}),
        },
      }
    }
  }

  function createRestoreInvocationSnapshot(restoreOptions, capability) {
    const options = restoreOptions && typeof restoreOptions === 'object' ? restoreOptions : {}
    const restoreId = String(options.restoreId || `restore-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)
    const resolutionsInput = options.resolutions === undefined || options.resolutions === null
      ? (capability.resolutions || {})
      : options.resolutions
    return Object.freeze({
      restoreId,
      resolutions: freezeCapabilityData(resolutionsInput),
      signal: options.signal,
    })
  }

  async function restore(artifact, restoreOptions = {}) {
    const options = restoreOptions && typeof restoreOptions === 'object' ? restoreOptions : {}
    const restoreTarget = options.target || configuredTarget
    const capability = resolveTrustedTarget(restoreTarget, {
      requiredDomains,
      fallbackAdapters: configuredAdapters,
    })
    const invocation = createRestoreInvocationSnapshot(options, capability)
    return restoreWithCapability(artifact, invocation, capability)
  }

  async function restoreWithCapability(artifact, invocation, capability) {
    const { restoreId, resolutions, signal } = invocation
    let verification
    try {
      verification = await assertValidBackupArtifact(artifact, { requiredDomains })
    } catch (error) {
      await quarantineArtifact(capability, { restoreId, kind: 'invalid-backup', reason: error.code || 'BACKUP_VERIFY_FAILED', source: serializeForQuarantine(artifact) })
      throw error
    }
    const sourceArtifact = verification.artifact
    capability = Object.freeze({
      ...capability,
      resolutions,
    })
    const readJournal = capability.journal.read
    const writeJournal = capability.journal.write
    const targetAdapters = capability.adapters
    let priorJournal
    try {
      priorJournal = await readJournal({ restoreId })
    } catch (error) {
      try {
        const evidence = error?.details && typeof error.details === 'object' ? error.details : {}
        await quarantineArtifact(capability, {
          restoreId,
          kind: 'invalid-journal',
          reason: error?.code || 'RESTORE_JOURNAL_CORRUPT',
          sourceKey: evidence.sourceKey,
          rawValue: evidence.rawValue,
          checksumEvidence: evidence.checksumEvidence,
        })
      } catch { /* Preserve the durable-journal failure below. */ }
      throw backupError('RESTORE_JOURNAL_UNAVAILABLE', 'Restore journal could not be read safely', { restoreId })
    }
    if (priorJournal?.artifactChecksum && priorJournal.artifactChecksum !== sourceArtifact.artifactChecksum) {
      throw backupError('RESTORE_ID_CONFLICT', 'Restore id was already used for another backup artifact')
    }
    if (priorJournal?.status === 'completed') return { status: 'already-complete', restoreId, journal: priorJournal }
    if (priorJournal?.status === 'rollback-failed') {
      throw backupError('RESTORE_ROLLBACK_FAILED', 'A previous restore attempt did not confirm rollback; manual recovery is required', { restoreId })
    }
    if (priorJournal && !['started', 'applying', 'committing', 'committed', 'rolled-back'].includes(priorJournal.status)) {
      try {
        await quarantineArtifact(capability, {
          restoreId,
          kind: 'invalid-journal',
          reason: 'RESTORE_JOURNAL_INVALID',
        })
      } catch { /* Preserve the journal validation failure below. */ }
      throw backupError('RESTORE_JOURNAL_INVALID', 'Restore journal has an unsupported status', { restoreId })
    }

    let rollbackEntry
    try {
      rollbackEntry = await readRollbackBackup(capability, restoreId)
    } catch (error) {
      try {
        const evidence = error?.details && typeof error.details === 'object' ? error.details : {}
        await quarantineArtifact(capability, {
          restoreId,
          kind: 'invalid-rollback-backup',
          reason: error?.code || 'RESTORE_ROLLBACK_CORRUPT',
          sourceKey: evidence.sourceKey,
          rawValue: evidence.rawValue,
          checksumEvidence: evidence.checksumEvidence,
        })
      } catch { /* Preserve the durable rollback failure below. */ }
      throw backupError('RESTORE_ROLLBACK_UNAVAILABLE', 'The rollback backup could not be read safely', { restoreId })
    }
    if (priorJournal && !rollbackEntry?.artifact) {
      throw backupError('RESTORE_ROLLBACK_UNAVAILABLE', 'An incomplete restore has no durable rollback backup', { restoreId })
    }
    if (rollbackEntry?.artifact) {
      try {
        await assertValidBackupArtifact(rollbackEntry.artifact, { requiredDomains, maxBackupBytes: limits.maxBackupBytes })
      } catch (error) {
        await quarantineArtifact(capability, {
          restoreId,
          kind: 'invalid-rollback-backup',
          reason: error?.code || 'BACKUP_VERIFY_FAILED',
        })
        throw backupError('RESTORE_ROLLBACK_UNAVAILABLE', 'The rollback backup is corrupt and cannot be used safely', { restoreId })
      }
    }
    if (rollbackEntry?.artifact && rollbackBaseRevision(rollbackEntry) === null) {
      await quarantineArtifact(capability, {
        restoreId,
        kind: 'invalid-rollback-backup',
        reason: 'RESTORE_ROLLBACK_BASE_REVISION_MISSING',
      })
      throw backupError('RESTORE_ROLLBACK_UNAVAILABLE', 'The rollback backup has no bound base revision', { restoreId })
    }
    if (priorJournal?.status === 'committing') {
      const expectedBaseRevision = Number.isInteger(priorJournal.expectedBaseRevision)
        ? priorJournal.expectedBaseRevision
        : rollbackBaseRevision(rollbackEntry)
      let appliedEvidence
      try {
        appliedEvidence = await capability.verifyApplied({ restoreId, artifact: sourceArtifact, report: null })
      } catch (error) {
        appliedEvidence = { ok: false, reason: error?.code || 'RESTORE_COMMIT_EVIDENCE_UNAVAILABLE' }
      }
      const currentRevision = Number.isInteger(appliedEvidence?.revision) ? appliedEvidence.revision : null
      if (!isValidRevision(currentRevision)) {
        try {
          await writeJournal({
            ...priorJournal,
            status: 'rollback-failed',
            failureCode: 'RESTORE_COMMIT_EVIDENCE_UNAVAILABLE',
            manualRecoveryRequired: true,
            failedAt: new Date().toISOString(),
          })
        } catch { /* Preserve the typed evidence failure if journaling is unavailable. */ }
        throw backupError('RESTORE_COMMIT_EVIDENCE_UNAVAILABLE', 'A committing restore has no durable revision evidence; manual recovery is required', { restoreId })
      }
      if (appliedEvidence?.ok === true) {
        const committed = {
          ...priorJournal,
          status: 'committed',
          committedRevision: currentRevision,
          committedAt: new Date().toISOString(),
        }
        await writeJournal(committed)
        const completed = { ...committed, status: 'completed', completedAt: new Date().toISOString() }
        await writeJournal(completed)
        return { status: 'completed', restoreId, recovered: true, journal: completed }
      }
      if (!isValidRevision(expectedBaseRevision) || currentRevision !== expectedBaseRevision) {
        try {
          await writeJournal({
            ...priorJournal,
            status: 'rollback-failed',
            failureCode: 'RESTORE_REVISION_CONFLICT',
            currentRevision,
            manualRecoveryRequired: true,
            failedAt: new Date().toISOString(),
          })
        } catch { /* Preserve the typed conflict if journaling is unavailable. */ }
        throw backupError('RESTORE_REVISION_CONFLICT', 'A committing restore does not match its source and concurrent data advanced the target; manual recovery is required', { restoreId })
      }
    }
    if (priorJournal?.status === 'committed') {
      if (!isValidRevision(priorJournal.committedRevision)) {
        throw backupError('RESTORE_ROLLBACK_UNAVAILABLE', 'A committed restore has no durable committed revision evidence', { restoreId })
      }
      try {
        await capability.restoreSnapshot(rollbackEntry.artifact, {
          restoreId,
          reason: 'restore-retry-recover-baseline',
          expectedRevision: priorJournal.committedRevision,
        })
      } catch (error) {
        if (error?.code === 'RESTORE_REVISION_CONFLICT') {
          throw backupError('RESTORE_REVISION_CONFLICT', 'Concurrent data changed after the restore commit; manual recovery is required', { restoreId })
        }
        throw backupError('RESTORE_ROLLBACK_FAILED', 'A committed restore could not recover its baseline safely', { restoreId })
      }
    }
    let dryRun
    try {
      dryRun = await dryRunRestoreForService({
        artifact: sourceArtifact,
        capability,
        requiredDomains,
        limits,
      })
    } catch (error) {
      // A target collector can discover corrupt durable input before it can
      // produce a normal report. Preserve its structured evidence in the
      // target quarantine before surfacing the fail-closed error.
      const evidence = error?.details && typeof error.details === 'object' ? error.details : {}
      await quarantineArtifact(capability, {
        restoreId,
        kind: 'dry-run-error',
        reason: error?.code || 'RESTORE_DRY_RUN_FAILED',
        sourceKey: evidence.sourceKey,
        rawValue: evidence.rawValue,
        checksumEvidence: evidence.checksumEvidence,
        report: { mode: 'dry-run', write: false, error: { code: error?.code || 'RESTORE_DRY_RUN_FAILED', details: evidence } },
      })
      throw error
    }
    if (!dryRun.ok) {
      await quarantineArtifact(capability, { restoreId, kind: 'dry-run-blocked', reason: 'RESTORE_DRY_RUN_BLOCKED', report: dryRun })
      throw backupError('RESTORE_DRY_RUN_BLOCKED', 'Restore dry-run is blocked by schema, capacity, reference, or revision checks', {
        restoreId,
        blockedDomains: dryRun.blocked.map((item) => item.domain),
      })
    }

    if (!rollbackEntry?.artifact) {
      const rollbackArtifact = await createBackup({ adapters: targetAdapters, now })
      await assertValidBackupArtifact(rollbackArtifact, { requiredDomains })
      await writeRollbackBackup(capability, restoreId, rollbackArtifact)
      rollbackEntry = await readRollbackBackup(capability, restoreId)
    }
    const expectedBaseRevision = Number.isInteger(priorJournal?.rollbackRevision)
      ? priorJournal.rollbackRevision
      : (Number.isInteger(priorJournal?.expectedBaseRevision)
        ? priorJournal.expectedBaseRevision
        : rollbackBaseRevision(rollbackEntry))
    if (!isValidRevision(expectedBaseRevision)) {
      throw backupError('RESTORE_ROLLBACK_UNAVAILABLE', 'Restore cannot start without a durable rollback base revision', { restoreId })
    }
    const started = {
      schemaVersion: 1,
      restoreId,
      status: 'started',
      artifactChecksum: sourceArtifact.artifactChecksum,
      rollbackBackupChecksum: rollbackEntry.artifact.artifactChecksum,
      expectedBaseRevision,
      appliedDomains: [],
      startedAt: new Date().toISOString(),
    }
    await writeJournal(started)

    let transactionCapability = null
    let committedRevision = null
    let commitReturned = false
    try {
      const beginResult = await capability.beginTransaction({
        restoreId,
        artifact: sourceArtifact,
        dryRun,
        signal,
        operation: capability.operation,
        expectedBaseRevision,
      })
      transactionCapability = bindTransactionCapability(beginResult)
      const appliedDomains = []
      for (const domainReport of dryRun.domains) {
        if (signal?.aborted) throw backupError('RESTORE_INTERRUPTED', 'Restore was interrupted before commit')
        if (domainReport.decision !== 'restore' && domainReport.decision !== 'merge') continue
        const domain = sourceArtifact.domains[domainReport.key]
        if (domainReport.decision === 'merge' && typeof capability.mergeDomain === 'function') {
          await capability.mergeDomain(transactionCapability.facade, domainReport.key, domain, { restoreId })
        } else {
          await transactionCapability.applyDomain(domainReport.key, domain, { decision: domainReport.decision, restoreId })
        }
        appliedDomains.push(domainReport.key)
        await writeJournal({ ...started, status: 'applying', appliedDomains: [...appliedDomains] })
      }
      if (signal?.aborted) throw backupError('RESTORE_INTERRUPTED', 'Restore was interrupted before commit')
      await writeJournal({ ...started, status: 'committing', appliedDomains })
      const commitResult = await transactionCapability.commit()
      commitReturned = true
      committedRevision = readCommittedRevisionEvidence(transactionCapability, commitResult, restoreId)
      if (!isValidRevision(committedRevision)) {
        throw backupError('RESTORE_COMMIT_EVIDENCE_UNAVAILABLE', 'Restore commit did not expose a durable committed revision', {
          restoreId,
          commitMayHaveApplied: true,
        })
      }
      await writeJournal({
        ...started,
        status: 'committed',
        appliedDomains,
        ...(isValidRevision(committedRevision) ? { committedRevision } : {}),
      })
      const applied = await capability.verifyApplied({ restoreId, artifact: sourceArtifact, report: dryRun })
      if (applied === false || applied?.ok === false) throw backupError('RESTORE_POST_VERIFY_FAILED', 'Restored target did not match the backup artifact')
      if (!isValidRevision(applied?.revision) || applied.revision !== committedRevision) {
        throw backupError('RESTORE_COMMIT_EVIDENCE_UNAVAILABLE', 'Applied-state verification did not return the committed revision', {
          restoreId,
          committedRevision,
          verifiedRevision: applied?.revision,
          commitMayHaveApplied: true,
        })
      }
      const completed = {
        ...started,
        status: 'completed',
        appliedDomains,
        committedRevision,
        completedAt: new Date().toISOString(),
      }
      await writeJournal(completed)
      return { status: 'completed', restoreId, report: dryRun, journal: completed }
    } catch (error) {
      let rollbackError = null
      try { await transactionCapability?.rollback?.() } catch (rollbackFailure) { rollbackError = rollbackFailure }
      if (!isValidRevision(committedRevision) && !commitReturned) {
        try {
          committedRevision = readFailedCommitEvidence(transactionCapability, error, restoreId)
        } catch (evidenceError) {
          error = evidenceError
        }
      }
      const shouldRestoreSnapshot = isValidRevision(committedRevision)
      let rollbackRevision = null
      if (shouldRestoreSnapshot) {
        try {
          const rollbackResult = await capability.restoreSnapshot(rollbackEntry.artifact, {
            restoreId,
            reason: 'restore-failed',
            expectedRevision: committedRevision,
          })
          rollbackRevision = isValidRevision(rollbackResult?.revision) ? rollbackResult.revision : null
        } catch (rollbackFailure) { rollbackError = rollbackError || rollbackFailure }
      }
      let quarantineError = null
      try {
        await quarantineArtifact(capability, {
          restoreId,
          kind: 'restore-failure',
          reason: error?.code || 'RESTORE_FAILED',
          journal: { restoreId, artifactChecksum: sourceArtifact.artifactChecksum },
        })
      } catch (failure) { quarantineError = failure }
      const rollbackFailed = rollbackError || error?.code === 'RESTORE_COMMIT_EVIDENCE_UNAVAILABLE' || error?.code === 'RESTORE_ROLLBACK_FAILED'
      const failedStatus = rollbackFailed
        ? 'rollback-failed'
        : 'rolled-back'
      const manualRecoveryRequired = (
        error?.code === 'RESTORE_COMMIT_EVIDENCE_UNAVAILABLE'
        || error?.code === 'RESTORE_ROLLBACK_FAILED'
      ) && !isValidRevision(committedRevision)
      const failedJournal = {
        ...started,
        status: failedStatus,
        failureCode: error?.code || 'RESTORE_FAILED',
        ...(isValidRevision(committedRevision) ? { committedRevision } : {}),
        ...(isValidRevision(rollbackRevision) ? { rollbackRevision } : {}),
        rollbackComplete: !rollbackError && error?.code !== 'RESTORE_ROLLBACK_FAILED' && !manualRecoveryRequired,
        quarantineComplete: !quarantineError,
        ...(manualRecoveryRequired ? { manualRecoveryRequired: true } : {}),
        failedAt: new Date().toISOString(),
      }
      await writeJournal(failedJournal)
      if (rollbackError) {
        const code = rollbackError.code === 'RESTORE_REVISION_CONFLICT'
          ? 'RESTORE_REVISION_CONFLICT'
          : 'RESTORE_ROLLBACK_FAILED'
        throw backupError(code, code === 'RESTORE_REVISION_CONFLICT'
          ? 'Concurrent data changed before rollback could be applied; manual recovery is required'
          : 'Restore failed and rollback could not be confirmed', { restoreId })
      }
      throw backupError(error?.code || 'RESTORE_FAILED', error?.message || 'Restore failed; target was rolled back', { restoreId })
    }
  }

  return Object.freeze({
    createBackup,
    exportBackup: createBackup,
    dryRunRestore,
    restore,
    verifyBackup(input, verifyOptions = {}) {
      return verifyBackupArtifact(input, { requiredDomains, ...verifyOptions })
    },
    requiredDomains: [...requiredDomains],
    limits: { ...limits },
  })
}

export function createLocalStorageDomainAdapter(options = {}) {
  const storage = options.storage || globalThis.localStorage
  const key = String(options.key || '').trim()
  const domainKey = String(options.domainKey || '').trim()
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') throw backupError('BACKUP_STORAGE_UNAVAILABLE', 'localStorage adapter requires a storage implementation')
  if (!key || !domainKey) throw backupError('BACKUP_ADAPTER_INVALID', 'localStorage adapter requires key and domainKey')
  const schemaVersion = options.schemaVersion
  const requiredFields = options.requiredFields || {}

  function readEnvelope() {
    const raw = storage.getItem(key)
    if (raw === null || raw === undefined) return null
    let value
    try { value = JSON.parse(raw) } catch { throw backupError('BACKUP_LOCAL_STORAGE_INVALID_ENVELOPE', `localStorage key ${key} is not valid JSON`) }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw backupError('BACKUP_LOCAL_STORAGE_INVALID_ENVELOPE', `localStorage key ${key} is not an object envelope`)
    if (schemaVersion !== undefined && value.schemaVersion !== schemaVersion) throw backupError('BACKUP_LOCAL_STORAGE_UNKNOWN_SCHEMA', `localStorage key ${key} has an unsupported schema`, { domain: domainKey })
    for (const [field, type] of Object.entries(requiredFields)) {
      const fieldValue = value[field]
      if (type === 'integer' && (!Number.isInteger(fieldValue) || fieldValue < 0)) throw backupError('BACKUP_LOCAL_STORAGE_INVALID_ENVELOPE', `localStorage key ${key} has an invalid ${field}`)
      if (type === 'string' && (typeof fieldValue !== 'string' || !fieldValue.trim())) throw backupError('BACKUP_LOCAL_STORAGE_INVALID_ENVELOPE', `localStorage key ${key} has an invalid ${field}`)
    }
    return value
  }

  return {
    key: domainKey,
    schemaVersion,
    adapterVersion: options.adapterVersion ?? 1,
    supportedSchemaVersions: options.supportedSchemaVersions || [schemaVersion],
    async collect() {
      const value = readEnvelope()
      if (!value) return { schemaVersion, revision: 0, records: [], references: [], mediaReferences: [] }
      return {
        schemaVersion: value.schemaVersion,
        revision: value.revision ?? 0,
        records: [{
          id: key,
          schemaVersion: value.schemaVersion,
          revision: value.revision ?? 0,
          contentId: value.contentId ?? null,
          payload: value,
        }],
        references: typeof options.references === 'function' ? await options.references(value) : [],
        mediaReferences: typeof options.mediaReferences === 'function' ? await options.mediaReferences(value) : [],
      }
    },
    async restoreRecord(record) {
      if (!record?.payload || typeof record.payload !== 'object') throw backupError('BACKUP_LOCAL_STORAGE_INVALID_ENVELOPE', `localStorage restore for ${key} is invalid`)
      storage.setItem(key, JSON.stringify(record.payload))
    },
  }
}

export function createIndexedDbDomainAdapter(options = {}) {
  const domainKey = String(options.domainKey || '').trim()
  if (!domainKey || typeof options.readRows !== 'function') throw backupError('BACKUP_ADAPTER_INVALID', 'IndexedDB adapter requires domainKey and readRows')
  const rowFilter = typeof options.rowFilter === 'function' ? options.rowFilter : () => true
  const schemaVersion = options.schemaVersion ?? 1
  return {
    key: domainKey,
    schemaVersion,
    adapterVersion: options.adapterVersion ?? 1,
    supportedSchemaVersions: options.supportedSchemaVersions || [schemaVersion],
    async collect() {
      const rows = await options.readRows()
      if (!Array.isArray(rows)) throw backupError('BACKUP_ADAPTER_UNAVAILABLE', `IndexedDB adapter ${domainKey} did not return rows`)
      if (typeof options.assertRows === 'function') await options.assertRows(rows)
      const selectedRows = rows.filter(rowFilter)
      return {
        schemaVersion,
        revision: options.revision ? await options.revision(selectedRows) : maxRecordRevision(selectedRows),
        records: selectedRows.map((row) => ({
          id: row.id,
          schemaVersion: row.schemaVersion ?? schemaVersion,
          revision: row.revision ?? 0,
          contentId: row.contentId ?? null,
          payload: row.content ?? row.payload ?? row,
          references: row.references || [],
          mediaReferences: row.mediaReferences || [],
        })),
      }
    },
  }
}

function serializeForQuarantine(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    const state = createSanitizeState()
    return sanitizeValue(parsed, state)
  } catch {
    return '[unserializable-or-sensitive-backup-artifact]'
  }
}
