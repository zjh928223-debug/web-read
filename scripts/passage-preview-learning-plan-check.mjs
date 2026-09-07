import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const sourceRoot = fileURLToPath(new URL('..', import.meta.url))
const tempDir = await mkdtemp(join(tmpdir(), 'read-web-learning-plan-'))
const source = (await readFile(join(
  sourceRoot,
  'src/features/passage-preview/passage-preview-learning-history.js',
), 'utf8'))
  .replace("'./passage-preview-durable-state.js'", "'./passage-preview-durable-state.mjs'")
  .replace("'./passage-preview-storage.js'", "'./passage-preview-storage.mjs'")
await writeFile(join(tempDir, 'passage-preview-durable-state.mjs'), [
  "export const PASSAGE_PREVIEW_DURABLE_KEY = 'vocabulary.passage-preview.durable-state.v1'",
  'export const derivePassagePreviewBatchId = (items) => `batch:${(items || []).length}`',
  "export const loadPassagePreviewDurableState = (storage) => { const raw = storage?.getItem(PASSAGE_PREVIEW_DURABLE_KEY); return raw ? JSON.parse(raw) : { revision: 0, learningHistory: null } }",
  "export const updatePassagePreviewDurableState = (mutator, storage) => { const current = loadPassagePreviewDurableState(storage); const next = mutator({ ...current }) || current; next.revision = (current.revision || 0) + 1; storage.setItem(PASSAGE_PREVIEW_DURABLE_KEY, JSON.stringify(next)); return next }",
].join('\n'), 'utf8')
await writeFile(join(tempDir, 'passage-preview-storage.mjs'), [
  'export const commitPassagePreviewOwnerDurableUpdate = async () => null',
  'export const isPassagePreviewOwnerAuthoritative = () => false',
  'export const loadPassagePreviewRecordsFromOwner = async () => null',
].join('\n'), 'utf8')
await writeFile(join(tempDir, 'passage-preview-learning-history.mjs'), source, 'utf8')

const {
  createEmptyPassagePreviewLearningHistory,
  createPassagePreviewLearningSession,
  getIeltsAdaptivePreviewPlan,
  loadPassagePreviewLearningSettings,
  loadPassagePreviewLearningHistory,
  savePassagePreviewLearningSettings,
  savePassagePreviewLearningSession,
  upsertPassagePreviewLearningSession,
} = await import(`${pathToFileURL(join(tempDir, 'passage-preview-learning-history.mjs')).href}?v=${Date.now()}`)

const firstSession = createPassagePreviewLearningSession({
  batchId: 'batch:2026-09-01-a',
  timeZone: 'Asia/Shanghai',
  now: '2026-09-01T09:00:00.000Z',
  progress: {
    startedAt: '2026-09-01T09:00:00.000Z',
    completedAt: '2026-09-01T09:02:30.000Z',
  },
  items: [
    { id: 'ielts-reading:2026-09-01:a', lemma: 'alpha', word: 'alpha' },
    { id: 'ielts-reading:2026-09-01:b', lemma: 'beta', word: 'beta' },
  ],
  revealedAtByItem: {
    'ielts-reading:2026-09-01:a': '2026-09-01T09:00:40.000Z',
    'ielts-reading:2026-09-01:b': '2026-09-01T09:02:20.000Z',
  },
})

assert.equal(firstSession.status, 'completed')
assert.equal(firstSession.calendarDate, '2026-09-01')
assert.equal(firstSession.durationMs, 150000)
assert.equal(firstSession.items[0].learnedAt, '2026-09-01T09:00:40.000Z')
assert.equal(firstSession.items[1].learnedAt, '2026-09-01T09:02:20.000Z')

let history = upsertPassagePreviewLearningSession(
  createEmptyPassagePreviewLearningHistory(),
  firstSession,
)
assert.equal(history.sessions.length, 1)
assert.equal(getIeltsAdaptivePreviewPlan(history, { batchSize: 37 }).completedDays, 1)
assert.equal(getIeltsAdaptivePreviewPlan(history, { batchSize: 37 }).completedSessions, 1)
assert.equal(getIeltsAdaptivePreviewPlan(history, { batchSize: 37 }).batchSize, 37)
assert.equal(getIeltsAdaptivePreviewPlan(history, { batchSize: 37 }).stage, 0)

const sameDaySecondSession = createPassagePreviewLearningSession({
  batchId: 'batch:2026-09-01-b',
  timeZone: 'Asia/Shanghai',
  progress: {
    startedAt: '2026-09-01T14:00:00.000Z',
    completedAt: '2026-09-01T14:01:00.000Z',
  },
  items: [{ id: 'ielts-reading:2026-09-01:c', lemma: 'gamma', word: 'gamma' }],
})
history = upsertPassagePreviewLearningSession(history, sameDaySecondSession)
assert.equal(history.sessions.length, 2)
assert.equal(getIeltsAdaptivePreviewPlan(history, { batchSize: 37 }).completedDays, 1)
assert.equal(getIeltsAdaptivePreviewPlan(history, { batchSize: 37 }).completedSessions, 2)
assert.equal(getIeltsAdaptivePreviewPlan(history, { batchSize: 37 }).batchSize, 37)
assert.equal(getIeltsAdaptivePreviewPlan(history, { batchSize: 37 }).stage, 0)

const nextDaySession = createPassagePreviewLearningSession({
  batchId: 'batch:2026-09-02-a',
  timeZone: 'Asia/Shanghai',
  progress: {
    startedAt: '2026-09-02T09:00:00.000Z',
    completedAt: '2026-09-02T09:03:00.000Z',
  },
  items: [{ id: 'ielts-reading:2026-09-02:d', lemma: 'delta', word: 'delta' }],
})
history = upsertPassagePreviewLearningSession(history, nextDaySession)
assert.equal(getIeltsAdaptivePreviewPlan(history, { batchSize: 37 }).completedDays, 2)
assert.equal(getIeltsAdaptivePreviewPlan(history, { batchSize: 37 }).completedSessions, 3)
assert.equal(getIeltsAdaptivePreviewPlan(history, { batchSize: 37 }).batchSize, 37)
assert.equal(getIeltsAdaptivePreviewPlan(history, { batchSize: 37 }).stage, 0)

const afterThirdDay = upsertPassagePreviewLearningSession(history, createPassagePreviewLearningSession({
  batchId: 'batch:2026-09-03-a',
  timeZone: 'Asia/Shanghai',
  progress: {
    startedAt: '2026-09-03T09:00:00.000Z',
    completedAt: '2026-09-03T09:03:00.000Z',
  },
  items: [{ id: 'ielts-reading:2026-09-03:e', lemma: 'epsilon', word: 'epsilon' }],
}))
assert.equal(getIeltsAdaptivePreviewPlan(afterThirdDay, { batchSize: 37 }).completedDays, 3)
assert.equal(getIeltsAdaptivePreviewPlan(afterThirdDay, { batchSize: 37 }).completedSessions, 4)
assert.equal(getIeltsAdaptivePreviewPlan(afterThirdDay, { batchSize: 37 }).batchSize, 37)
assert.equal(getIeltsAdaptivePreviewPlan(afterThirdDay, { batchSize: 37 }).stage, 0)

const afterFifthSession = upsertPassagePreviewLearningSession(afterThirdDay, createPassagePreviewLearningSession({
  batchId: 'batch:2026-09-03-b',
  timeZone: 'Asia/Shanghai',
  progress: {
    startedAt: '2026-09-03T14:00:00.000Z',
    completedAt: '2026-09-03T14:03:00.000Z',
  },
  items: [{ id: 'ielts-reading:2026-09-03:f', lemma: 'zeta', word: 'zeta' }],
}))
assert.equal(getIeltsAdaptivePreviewPlan(afterFifthSession, { batchSize: 37 }).completedDays, 3)
assert.equal(getIeltsAdaptivePreviewPlan(afterFifthSession, { batchSize: 37 }).completedSessions, 5)
assert.equal(getIeltsAdaptivePreviewPlan(afterFifthSession, { batchSize: 37 }).stage, 1)

let afterSeventhDay = afterThirdDay
for (const [date, word] of [['2026-09-04', 'zeta'], ['2026-09-05', 'eta'], ['2026-09-06', 'theta'], ['2026-09-07', 'iota']]) {
  afterSeventhDay = upsertPassagePreviewLearningSession(afterSeventhDay, createPassagePreviewLearningSession({
    batchId: `batch:${date}-a`,
    timeZone: 'Asia/Shanghai',
    progress: {
      startedAt: `${date}T09:00:00.000Z`,
      completedAt: `${date}T09:03:00.000Z`,
    },
    items: [{ id: `ielts-reading:${date}:word`, lemma: word, word }],
  }))
}
assert.equal(getIeltsAdaptivePreviewPlan(afterSeventhDay, { batchSize: 37 }).completedDays, 7)
assert.equal(getIeltsAdaptivePreviewPlan(afterSeventhDay, { batchSize: 37 }).completedSessions, 8)
assert.equal(getIeltsAdaptivePreviewPlan(afterSeventhDay, { batchSize: 37 }).batchSize, 37)
assert.equal(getIeltsAdaptivePreviewPlan(afterSeventhDay, { batchSize: 37 }).stage, 1)

const replaced = upsertPassagePreviewLearningSession(afterThirdDay, {
  ...firstSession,
  durationMs: 180000,
})
assert.equal(replaced.sessions.length, 4)
assert.equal(replaced.sessions.find((session) => session.sessionId === firstSession.sessionId).durationMs, 180000)

const storage = createMemoryStorage()
assert.equal((await loadPassagePreviewLearningSettings(storage)).batchSize, 20)
assert.equal((await savePassagePreviewLearningSettings({ batchSize: 37 }, storage)).batchSize, 37)
assert.equal((await loadPassagePreviewLearningSettings(storage)).batchSize, 37)
await savePassagePreviewLearningSession(firstSession, storage)
const persisted = await loadPassagePreviewLearningHistory(storage)
assert.equal(persisted.sessions.length, 1)
assert.equal(persisted.dailySummaries[0].wordCount, 2)

console.log('Passage preview adaptive learning plan checks passed.')

function createMemoryStorage() {
  const values = new Map()
  return {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, String(value)) },
  }
}
