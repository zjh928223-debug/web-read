import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const useSource = await fs.readFile(path.join(repoRoot, 'src/features/passage-preview/use-passage-preview.js'), 'utf8')
const dailySource = await fs.readFile(path.join(repoRoot, 'src/features/passage-preview/passage-preview-daily-continuation.js'), 'utf8')
const phase = process.env.N6_S5_PHASE || 'after'

await verifyStaleBatchTransitionCannotOverwriteNewImport()
await verifyStalePreloadCannotOverwriteNewGroup()
const negativeReports = await runFinalSaveScenarios(true)
const successReports = await runFinalSaveScenarios(false)
console.log(JSON.stringify({ phase, negativeReports, successReports }, null, 2))
for (const report of Object.values(negativeReports)) {
  assert.equal(report.openImmediatelyAfterClose, false)
  assert.equal(report.openAfterRelease, phase === 'before')
  assert.equal(report.publishCount, phase === 'before' ? report.expectedPublishCount : 0)
}
for (const report of Object.values(successReports)) {
  assert.equal(report.openAfterRelease, true)
  assert.equal(report.publishCount, report.expectedPublishCount)
}
console.log(phase === 'before'
  ? 'N6 S5 pre-fix final-save close regression reproduced.'
  : 'N6 S5 stale transition, preload, final-save close, and success controls passed.')

async function verifyStaleBatchTransitionCannotOverwriteNewImport() {
  const archiveGate = deferred(); const archiveEntered = deferred(); let durableData = ['A']
  let durableProgress = createInitialProgress()
  const scope = install({
    passagePreviewOpenRequestId: 1, passagePreviewDurableWriteChain: Promise.resolve(),
    isPassagePreviewOpen: { value: true }, passagePreviewOpening: { value: false }, passagePreviewPreparing: { value: false },
    passagePreviewQueueNotice: { value: '' }, passagePreviewPreloaded: { value: {} },
    passagePreviewLearningSavePromise: Promise.resolve(), waitForPassagePreviewAcquisitionRegistrations: () => Promise.resolve(),
    passagePreviewItems: { value: [{ id: 'A' }] }, passagePreviewLearningRevealTimes: new Map(), passagePreviewPreparationMessage: { value: '' },
    ensurePreviewGenerationCapacity: async () => true, loadIeltsDailyPreviewContinuation: async () => ({ consumedBatchDates: [] }),
    loadIeltsDailyPreviewAllocations: async () => ({}), loadPreviewExcludedLemmas: async () => [],
    selectNextIeltsDailyPreviewBatch: () => ({ date: '2026-10-09', words: ['B'] }), formatLocalDate: () => '2026-10-09',
    materializeIeltsDailyPreviewBatch: async () => [{ id: 'B' }], preparePassagePreviewItems: async (items) => items,
    createProgressPreservingContacts: createInitialProgress, addDate: (dates, value) => [...dates, value],
    saveIeltsDailyPreviewArchive: async () => { archiveEntered.resolve(); await archiveGate.promise },
    savePassagePreviewData: async (items) => { durableData = items.map((item) => item.id) },
    savePassagePreviewProgress: async (progress) => { durableProgress = progress }, saveIeltsDailyPreviewContinuation: async () => {},
    updatePassagePreviewContactSummary: () => {}, importVocabularyPreview: (payload) => payload.items,
    setPassagePreviewEntryState: () => {}, PASSAGE_PREVIEW_ENTRY_STATES: { READY: 'ready', READ_ERROR: 'read-error' },
  }, useSource, ['isOpenPassagePreviewRequestCurrent', 'enqueuePassagePreviewWrite', 'closePassagePreview', 'advanceCompletedIeltsPreviewBatch', 'importPassagePreviewFile'])
  vm.runInContext(extractFunction(dailySource, 'commitPassagePreviewBatchTransition'), scope)
  const oldAdvance = scope.advanceCompletedIeltsPreviewBatch('2026-10-08', { completedAt: '2026-10-09T00:00:00Z' }, 1)
  await archiveEntered.promise; await scope.closePassagePreview()
  const newImport = scope.importPassagePreviewFile({ target: { value: 'file', files: [{ text: async () => JSON.stringify({ items: [{ id: 'C' }] }) }] } })
  archiveGate.resolve(); await newImport
  assert.equal(Array.from(durableData).join(','), 'C')
  assert.equal(Array.from(scope.passagePreviewItems.value, (item) => item.id).join(','), 'C')
  assert.equal(await oldAdvance, false); assert.equal(durableProgress.status, 'not_started')
}

async function verifyStalePreloadCannotOverwriteNewGroup() {
  const preloadGate = deferred(); const preloadEntered = deferred(); let cachedItems = [{ id: 'same', meaning: 'new' }]
  const scope = install({
    passagePreviewOpenRequestId: 1, passagePreviewDurableWriteChain: Promise.resolve(),
    passagePreviewItems: { value: [{ id: 'same', meaning: 'old' }] },
    passagePreviewPreloaded: { value: { sentences: { same: { sentence: 'new sentence' } }, translations: {} } },
    passagePreviewPreparationMessage: { value: '' }, loadPassagePreviewSessionCache: () => null,
    preloadPassagePreviewBatch: async () => { preloadEntered.resolve(); return preloadGate.promise },
    savePassagePreviewSessionCache: (payload) => { cachedItems = payload.items }, savePassagePreviewData: async () => {},
    sentenceTranslationKey: (sentence) => sentence, console,
  }, useSource, ['isOpenPassagePreviewRequestCurrent', 'enqueuePassagePreviewWrite', 'isPreparedPassagePreviewCache', 'preparePassagePreviewItems', 'prepareStoredPassagePreviewInBackground'])
  const background = scope.prepareStoredPassagePreviewInBackground(scope.passagePreviewItems.value, 1)
  await preloadEntered.promise; scope.passagePreviewOpenRequestId = 2; scope.passagePreviewItems.value = [{ id: 'same', meaning: 'new' }]
  preloadGate.resolve({ items: [{ id: 'same', meaning: 'old' }], preloadedSentences: { same: { sentence: 'old sentence' } }, translations: {} })
  await background
  assert.equal(scope.passagePreviewItems.value[0].meaning, 'new')
  assert.equal(scope.passagePreviewPreloaded.value.sentences.same.sentence, 'new sentence'); assert.equal(cachedItems[0].meaning, 'new')
}

async function runFinalSaveScenarios(closeBeforeRelease) {
  const cases = [['importFinalProgress', 'import'], ['legacyValidFinalData', 'legacy', 'valid'], ['legacyMigratedFinalData', 'legacy', 'migrated'], ['batchFinalContinuation', 'batch']]
  const reports = {}
  for (const [key, kind, branch] of cases) reports[key] = await runFinalSaveScenario(kind, { branch, closeBeforeRelease })
  return reports
}

async function runFinalSaveScenario(kind, { branch, closeBeforeRelease }) {
  const gate = deferred(); const entered = deferred(); const calls = []; const post = []; const released = { value: false }
  const items = trackedRef([{ id: 'OLD' }], 'items', calls, post, released); const open = trackedRef(true, 'open', calls, post, released)
  const scope = {
    passagePreviewOpenRequestId: 1, passagePreviewDurableWriteChain: Promise.resolve(), passagePreviewItems: items, isPassagePreviewOpen: open,
    passagePreviewOpening: { value: false }, passagePreviewPreparing: { value: false }, passagePreviewPreparationMessage: { value: '' },
    passagePreviewQueueNotice: { value: '' }, passagePreviewPreloaded: { value: { sentences: {}, translations: {} } }, passagePreviewLearningRevealTimes: new Map(),
    passagePreviewLearningSavePromise: Promise.resolve(), waitForPassagePreviewAcquisitionRegistrations: () => Promise.resolve(),
    preparePassagePreviewItems: async (source) => source, createProgressPreservingContacts: createInitialProgress,
    setPassagePreviewEntryState: () => recordUi('entry', calls, post, released), updatePassagePreviewContactSummary: () => recordUi('summary', calls, post, released),
    PASSAGE_PREVIEW_ENTRY_STATES: { READY: 'ready', READ_ERROR: 'read-error' },
  }
  if (kind === 'import') Object.assign(scope, {
    importVocabularyPreview: (payload) => payload.items, savePassagePreviewData: async (source) => { calls.push(`saveData:${source[0].id}`) },
    savePassagePreviewProgress: async () => { calls.push('saveProgress:start'); entered.resolve(); await gate.promise; calls.push('saveProgress:done') },
  })
  if (kind === 'legacy') Object.assign(scope, {
    validatePassagePreviewItems: () => branch === 'valid', importVocabularyPreview: () => [{ id: 'MIGRATED' }], isPassagePreviewOwnerAuthoritative: () => true,
    savePassagePreviewData: async (source) => { calls.push(`saveData:start:${source[0].id}`); entered.resolve(); await gate.promise; calls.push(`saveData:done:${source[0].id}`) },
  })
  if (kind === 'batch') Object.assign(scope, {
    ensurePreviewGenerationCapacity: async () => true, loadIeltsDailyPreviewAllocations: async () => ({}), loadIeltsDailyPreviewContinuation: async () => ({ consumedBatchDates: [] }), loadPreviewExcludedLemmas: async () => [],
    selectNextIeltsDailyPreviewBatch: () => ({ date: '2026-10-09', words: ['NEW'] }), formatLocalDate: () => '2026-10-09', materializeIeltsDailyPreviewBatch: async () => [{ id: 'NEW' }],
    savePassagePreviewData: async (source) => { calls.push(`saveData:${source[0].id}`) }, savePassagePreviewProgress: async () => { calls.push('saveProgress:done') },
    saveIeltsDailyPreviewContinuation: async () => { calls.push('saveContinuation:start'); entered.resolve(); await gate.promise; calls.push('saveContinuation:done') }, refreshPendingPreviewSummary: async () => ({ waiting: 0 }),
  })
  const names = kind === 'import' ? ['isOpenPassagePreviewRequestCurrent', 'enqueuePassagePreviewWrite', 'closePassagePreview', 'importPassagePreviewFile']
    : kind === 'legacy' ? ['isOpenPassagePreviewRequestCurrent', 'enqueuePassagePreviewWrite', 'closePassagePreview', 'openStoredPassagePreviewLegacy']
      : ['isOpenPassagePreviewRequestCurrent', 'enqueuePassagePreviewWrite', 'closePassagePreview', 'openFirstAvailableIeltsPreviewBatch']
  install(scope, useSource, names)
  const operation = kind === 'import'
    ? scope.importPassagePreviewFile({ target: { value: 'file', files: [{ text: async () => JSON.stringify({ items: [{ id: 'NEW' }] }) }] } })
    : kind === 'legacy' ? scope.openStoredPassagePreviewLegacy(1) : scope.openFirstAvailableIeltsPreviewBatch(1)
  await entered.promise; const requestIdAtGate = scope.passagePreviewOpenRequestId; let openImmediatelyAfterClose = null
  if (closeBeforeRelease) { const closing = scope.closePassagePreview(); openImmediatelyAfterClose = open.value; await closing }
  released.value = true; gate.resolve(); const result = await operation
  return { ...(branch ? { branch } : {}), requestIdAtGate, requestIdAfterRelease: scope.passagePreviewOpenRequestId, openImmediatelyAfterClose, openAfterRelease: open.value,
    result: result === undefined ? null : result, publishCount: post.length, expectedPublishCount: kind === 'legacy' ? 3 : 4, calls, postReleaseCalls: post, itemIds: scope.passagePreviewItems.value.map((item) => item.id) }
}

function trackedRef(initialValue, label, calls, post, released) {
  let value = initialValue
  return { get value() { return value }, set value(next) { value = next; recordUi(label, calls, post, released) } }
}

function recordUi(label, calls, post, released) {
  const event = `ui:${label}`; calls.push(event); if (released.value) post.push(event)
}

function createInitialProgress() {
  return { status: 'not_started', currentIndex: 0, revealed: {}, firstContacts: {} }
}

function deferred() {
  let resolve; const promise = new Promise((resolver) => { resolve = resolver }); return { promise, resolve }
}

function install(scope, source, names) {
  vm.createContext(scope); for (const name of names) vm.runInContext(extractFunction(source, name), scope); return scope
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`); if (start < 0) throw new Error(`Missing ${name}`)
  const body = source.indexOf(') {', start) + 2; if (body < 2) throw new Error(`Missing body for ${name}`)
  let depth = 0
  for (let index = body; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}' && --depth === 0) {
      const prefix = source.slice(start - 6, start) === 'async ' ? 'async ' : ''; return `${prefix}${source.slice(start, index + 1)}`
    }
  }
  throw new Error(`Unterminated ${name}`)
}
