const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { parse, compileScript } = require('@vue/compiler-sfc')
const Vue = require('vue')

const panelPath = path.resolve(__dirname, '..', 'src/components/YouTubeWorkflowPanel.vue')
const configFields = ['model', 'baseUrl', 'proxyUrl', 'cookiesPath', 'outputDir', 'ytDlpPath', 'whisperxPath']
const baseConfig = Object.freeze({
  model: 'base-model',
  baseUrl: 'https://config.example.test',
  proxyUrl: 'http://proxy.example.test',
  cookiesPath: 'C:/workflow/cookies.txt',
  outputDir: 'C:/workflow/output',
  ytDlpPath: 'yt-dlp.exe',
  whisperxPath: 'whisperx.exe',
})

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

class MemoryStorage {
  constructor() {
    this.values = new Map()
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null
  }

  setItem(key, value) {
    this.values.set(String(key), String(value))
  }

  removeItem(key) {
    this.values.delete(String(key))
  }
}

function installWindow() {
  const localStorage = new MemoryStorage()
  global.window = {
    localStorage,
    location: { search: '' },
    clearTimeout,
    setTimeout,
    addEventListener() {},
    removeEventListener() {},
    confirm: () => true,
    __mediaSource: null,
  }
  global.document = {
    body: { contains: () => true },
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: () => ({ click() {}, remove() {}, setAttribute() {} }),
  }
  return localStorage
}

function noop() {}

function createReaderPersistence() {
  return {
    currentJobId: Vue.ref(''),
    readerSessionPersistence: {},
    readerConflictVisible: Vue.ref(false),
    resolveReaderConflict: noop,
    applyReaderMarks: noop,
    syncMarkedWordVisuals: noop,
    syncReaderActivity: noop,
    hasUntrustedMarksNotice: Vue.ref(false),
    readerActivityNotice: Vue.ref(''),
    getPlaybackState: () => null,
    getReaderMedia: () => null,
    subscribeRecentReaderItem: () => noop,
    registerLoadCancellation: () => noop,
  }
}

function createWorkflowLibrary() {
  const queueJobs = Vue.ref([])
  const recentJobs = Vue.ref([])
  return {
    queueJobs,
    recentJobs,
    libraryPending: Vue.ref(false),
    libraryHasMore: Vue.ref(false),
    serviceOnline: Vue.ref(true),
    serviceStatusKnown: Vue.ref(true),
    libraryNotice: Vue.ref(''),
    completionSignal: Vue.ref(false),
    visibleCompletedJobIds: Vue.ref([]),
    refreshQueue: async () => {},
    refreshLibrary: async () => {},
    refreshRecent: async () => {},
    refreshJob: async () => {},
    updateJob: async () => {},
    loadMoreLibrary: async () => {},
    startPolling: noop,
    mergeRecentReaderItem: noop,
    clearMaterialRepairState: noop,
    requestWorkflowSnapshot: async () => ({}),
    dispose: noop,
  }
}

function createWorkflowMutations() {
  return {
    workflowMutationNotice: Vue.ref(''),
    rememberWorkflowRevision: noop,
    runPendingWorkflowAction: async () => {},
    forgetPendingWorkflowAction: noop,
    workflowMutationOptions: {},
    isWorkflowMutationConflict: Vue.ref(false),
    handleWorkflowMutationConflict: noop,
    invalidateWorkflowRevision: noop,
    dispose: noop,
  }
}

function createClient(control) {
  const client = {
    baseUrl: 'http://controlled-client.invalid',
    async getConfig() {
      control.getCalls += 1
      if (control.readError) throw control.readError
      if (control.readResult === undefined) return clone(baseConfig)
      return clone(control.readResult)
    },
    saveConfig(payload) {
      const captured = clone(payload)
      control.saveCalls += 1
      control.payloads.push(captured)
      if (control.saveMode === 'deferred') {
        return new Promise((resolve, reject) => {
          control.resolveSave = (value = captured) => resolve(clone(value))
          control.rejectSave = (error) => reject(error)
        })
      }
      if (control.saveError) return Promise.reject(control.saveError)
      return Promise.resolve(clone(control.saveResult || captured))
    },
    credentialStatus: async () => ({ stored: false, provider: 'controlled-fixture' }),
  }
  return new Proxy(client, {
    get(target, key) {
      if (key in target) return target[key]
      if (key === 'mediaUrl') return () => ''
      return async () => ({})
    },
  })
}

function compilePanelFactory() {
  const source = fs.readFileSync(panelPath, 'utf8')
  const parsed = parse(source, { filename: panelPath })
  if (parsed.errors.length) throw parsed.errors[0]
  const compiled = compileScript(parsed.descriptor, { id: 'youtube-workflow-panel-f01' })
  const exportIndex = compiled.content.indexOf('export default')
  if (exportIndex < 0) throw new Error('compiled Panel setup has no default export')
  const body = compiled.content.slice(exportIndex).replace(/^export default/, 'return')
  const prelude = `
const { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } = vue
const { Button, Input, Textarea, useAudioStore, useChunkStore, useTranscriptStore,
  runtimeState, buildCurrentSentenceDocId, bridgeToPinia,
  scheduleGeneratedAnnotationIndexRefresh, youtubeWorkflowClient,
  createYoutubeWorkflowLoader, createReaderSessionPublisher,
  useReaderSessionPersistenceContext, useWorkflowLibrary,
  createWorkflowMutationCoordinator, createObjectUrlDownloader,
  createDialogController, createPendingActionGuard,
  observeBestEffort, recordBestEffortFailure, readWorkflowOperationReceipt,
  canonicalMaterialKey, exactDateTime, extractYoutubeVideoId,
  findDuplicateMaterial, groupTaskAttempts } = stubs
`
  return new Function('vue', 'stubs', `${prelude}\n${body}`)
}

const createPanel = compilePanelFactory()

function createHarness(options = {}) {
  const localStorage = installWindow()
  const control = {
    getCalls: 0,
    saveCalls: 0,
    payloads: [],
    readResult: options.readResult === undefined ? clone(baseConfig) : clone(options.readResult),
    readError: options.readError || null,
    saveMode: options.saveMode || 'immediate',
    saveError: options.saveError || null,
    saveResult: options.saveResult || null,
    resolveSave: null,
    rejectSave: null,
  }
  const readerPersistence = createReaderPersistence()
  const audioStore = {
    currentAudioMeta: null,
    localTranscriptTitles: {},
    lastLocalImport: Vue.ref(null),
  }
  const chunkStore = {}
  const transcriptStore = { segments: [] }
  const workflowLibrary = createWorkflowLibrary()
  const workflowMutations = createWorkflowMutations()
  const client = createClient(control)
  const stubs = {
    Button: {},
    Input: {},
    Textarea: {},
    useAudioStore: () => audioStore,
    useChunkStore: () => chunkStore,
    useTranscriptStore: () => transcriptStore,
    runtimeState: {},
    buildCurrentSentenceDocId: () => '',
    bridgeToPinia: noop,
    scheduleGeneratedAnnotationIndexRefresh: noop,
    youtubeWorkflowClient: client,
    createYoutubeWorkflowLoader: () => ({ load: async () => {}, cancel: noop }),
    createReaderSessionPublisher: () => ({}),
    useReaderSessionPersistenceContext: () => readerPersistence,
    useWorkflowLibrary: () => workflowLibrary,
    createWorkflowMutationCoordinator: () => workflowMutations,
    createObjectUrlDownloader: () => ({ download: noop }),
    createDialogController: () => ({ dispose: noop, open: noop, close: noop }),
    createPendingActionGuard: ({ onChange } = {}) => ({
      dispose: noop,
      run: async (action) => {
        onChange?.(true)
        try { return await action() } finally { onChange?.(false) }
      },
    }),
    observeBestEffort: noop,
    recordBestEffortFailure: () => ({ notice: { message: 'controlled failure' } }),
    readWorkflowOperationReceipt: () => null,
    canonicalMaterialKey: (value) => String(value || ''),
    exactDateTime: () => '',
    extractYoutubeVideoId: () => '',
    findDuplicateMaterial: () => null,
    groupTaskAttempts: () => [],
  }
  const component = createPanel({ ...Vue, onMounted: noop, onBeforeUnmount: noop }, stubs)
  const scope = Vue.effectScope()
  let api
  scope.run(() => {
    api = component.setup({}, { expose: noop })
  })
  return { api, control, client, localStorage, scope }
}

async function loadConfig(harness) {
  await harness.api.loadBackendConfig()
  await Vue.nextTick()
}

function setField(api, key, value) {
  assert.ok(api[key], `Panel setup did not expose ${key}`)
  api[key].value = value
}

function setAllFields(api, suffix) {
  for (const key of configFields) setField(api, key, `${key}-${suffix}`)
}

function currentValues(api) {
  return Object.fromEntries(configFields.map((key) => [key, api[key].value]))
}

function captureState(harness) {
  return {
    requestCount: { get: harness.control.getCalls, save: harness.control.saveCalls },
    payloads: clone(harness.control.payloads),
    current: currentValues(harness.api),
    backendSnapshot: clone(harness.api.backendConfigSnapshot.value),
    loadState: harness.api.backendConfigLoadState.value,
    saveState: harness.api.backendConfigSaveState.value,
    draftFields: [...harness.api.locallyEditedConfigFields].sort(),
    stateText: harness.api.backendConfigStateText.value,
    notice: harness.api.backendConfigNotice.value,
  }
}

function assertSevenKeyPayload(payload) {
  assert.deepEqual(Object.keys(payload).sort(), [...configFields].sort())
}

async function normalSaveScenario() {
  const harness = createHarness()
  await loadConfig(harness)
  setField(harness.api, 'model', 'normal-A')
  const savePromise = harness.api.saveBackendConfig()
  assert.equal(harness.api.backendConfigSaveState.value, 'saving')
  assert.equal(harness.control.saveCalls, 1)
  assertSevenKeyPayload(harness.control.payloads[0])
  await savePromise
  assert.equal(harness.api.backendConfigSaveState.value, 'saved')
  assert.equal(harness.api.locallyEditedConfigFields.size, 0)
  assert.match(harness.api.backendConfigStateText.value, /已确认保存/)
  const result = captureState(harness)
  harness.scope.stop()
  return result
}

async function interleavedEditScenario() {
  const harness = createHarness({ saveMode: 'deferred' })
  await loadConfig(harness)
  setAllFields(harness.api, 'A')
  const savePromise = harness.api.saveBackendConfig()
  assert.equal(harness.api.backendConfigSaveState.value, 'saving')
  const requestPayload = clone(harness.control.payloads[0])
  setAllFields(harness.api, 'B')
  const readsBeforeReentry = harness.control.getCalls
  harness.api.setWorkflowView('settings')
  await Vue.nextTick()
  assert.equal(harness.control.getCalls, readsBeforeReentry, 'saving re-entry must not start another GET')
  assert.equal(harness.api.backendConfigSaveState.value, 'saving')
  harness.control.resolveSave(requestPayload)
  await savePromise
  assert.equal(harness.api.backendConfigSaveState.value, 'idle')
  assert.match(harness.api.backendConfigNotice.value, /上次提交已保存；当前编辑尚未保存/)
  assert.deepEqual(currentValues(harness.api), Object.fromEntries(configFields.map((key) => [key, `${key}-B`])))
  assert.deepEqual(harness.api.backendConfigSnapshot.value, requestPayload)
  assert.deepEqual([...harness.api.locallyEditedConfigFields].sort(), [...configFields].sort())
  const afterFirstSave = captureState(harness)

  harness.control.readResult = requestPayload
  harness.api.setWorkflowView('settings')
  await Promise.resolve()
  await Vue.nextTick()
  assert.deepEqual(currentValues(harness.api), Object.fromEntries(configFields.map((key) => [key, `${key}-B`])))
  assert.deepEqual([...harness.api.locallyEditedConfigFields].sort(), [...configFields].sort())
  assert.equal(harness.api.backendConfigSaveState.value, 'idle')
  const afterReread = captureState(harness)

  harness.control.saveMode = 'immediate'
  const secondSave = harness.api.saveBackendConfig()
  assert.equal(harness.control.saveCalls, 2)
  assert.deepEqual(harness.control.payloads[1], Object.fromEntries(configFields.map((key) => [key, `${key}-B`])))
  await secondSave
  assert.equal(harness.api.backendConfigSaveState.value, 'saved')
  assert.equal(harness.api.locallyEditedConfigFields.size, 0)
  assert.match(harness.api.backendConfigStateText.value, /已确认保存/)
  const afterSecondSave = captureState(harness)
  harness.scope.stop()
  return { afterFirstSave, afterReread, afterSecondSave }
}

async function failedSaveScenario() {
  const harness = createHarness({ saveMode: 'deferred' })
  await loadConfig(harness)
  setField(harness.api, 'model', 'failed-A')
  const savePromise = harness.api.saveBackendConfig()
  setField(harness.api, 'model', 'failed-B')
  harness.control.rejectSave(new Error('controlled save failure'))
  await savePromise
  assert.equal(harness.api.backendConfigSaveState.value, 'failed')
  assert.equal(harness.api.model.value, 'failed-B')
  assert.equal(harness.api.locallyEditedConfigFields.has('model'), true)
  assert.match(harness.api.backendConfigStateText.value, /保存失败/)
  const afterFailure = captureState(harness)
  harness.control.saveMode = 'immediate'
  const retry = harness.api.saveBackendConfig()
  await retry
  assert.equal(harness.control.saveCalls, 2)
  assert.equal(harness.control.payloads[1].model, 'failed-B')
  assert.equal(harness.api.backendConfigSaveState.value, 'saved')
  const afterRetry = captureState(harness)
  harness.scope.stop()
  return { afterFailure, afterRetry }
}

async function readProtectionScenario() {
  const failedRead = createHarness({ readError: new Error('controlled config read failure') })
  await loadConfig(failedRead)
  await failedRead.api.saveBackendConfig()
  assert.equal(failedRead.control.saveCalls, 0)
  assert.equal(failedRead.api.canSaveBackendConfig.value, false)
  assert.match(failedRead.api.backendConfigStateText.value, /读取失败/)

  const missingField = clone(baseConfig)
  delete missingField.whisperxPath
  const incompleteRead = createHarness({ readResult: missingField })
  await loadConfig(incompleteRead)
  await incompleteRead.api.saveBackendConfig()
  assert.equal(incompleteRead.control.saveCalls, 0)
  assert.equal(incompleteRead.api.canSaveBackendConfig.value, false)
  assert.match(incompleteRead.api.backendConfigStateText.value, /不完整/)

  const result = {
    failedRead: captureState(failedRead),
    incompleteRead: captureState(incompleteRead),
  }
  failedRead.scope.stop()
  incompleteRead.scope.stop()
  return result
}

async function readAssignmentScenario() {
  const harness = createHarness()
  await loadConfig(harness)
  assert.equal(harness.control.getCalls, 1)
  assert.equal(harness.control.saveCalls, 0)
  assert.equal(harness.api.locallyEditedConfigFields.size, 0, 'backend assignment must not become a user draft')
  assert.equal(harness.api.backendConfigSaveState.value, 'idle')
  const result = captureState(harness)
  harness.scope.stop()
  return result
}

async function main() {
  const results = {
    normalSave: await normalSaveScenario(),
    interleavedEdit: await interleavedEditScenario(),
    failedSave: await failedSaveScenario(),
    readProtection: await readProtectionScenario(),
    readAssignment: await readAssignmentScenario(),
  }
  console.log('youtube workflow panel F-01 check passed')
  console.log(JSON.stringify({ configFields, results }, null, 2))
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error)
  process.exitCode = 1
})
