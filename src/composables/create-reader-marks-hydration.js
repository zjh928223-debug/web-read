import { youtubeWorkflowClient } from './youtube-workflow-client.js'
import { recordBestEffortFailure } from '../services/runtime/best-effort.js'

function readerMarksFingerprint(marks) {
  return JSON.stringify((Array.isArray(marks) ? marks : [])
    .map((mark) => ({
      globalIndex: Number(mark.globalIndex),
      word: String(mark.word || ''),
      start: Number.isFinite(Number(mark.start)) ? Number(mark.start) : null,
      sourceType: String(mark.sourceType || 'manual-mark'),
    }))
    .sort((left, right) => left.globalIndex - right.globalIndex))
}

export function createReaderMarksHydration(options = {}) {
  const {
    getCurrentJobId = () => '',
    getCurrentReaderMarks = () => [],
    rememberMarksRevision = () => {},
    restoreVisibleMarks = () => {},
    submitLocalChanges = () => {},
  } = options

  const readerMarksHydrations = new Map()

  function normalizeJobId(jobId) {
    return String(jobId || '').trim()
  }

  function startReaderMarksHydration(jobId) {
    const normalizedJobId = normalizeJobId(jobId)
    if (!normalizedJobId) return
    const existing = readerMarksHydrations.get(normalizedJobId)
    if (existing) return existing.promise

    const hydration = {
      baseline: readerMarksFingerprint(getCurrentReaderMarks()),
      changed: false,
      applying: false,
      pending: true,
    }
    readerMarksHydrations.set(normalizedJobId, hydration)
    hydration.promise = (async () => {
      try {
        const payload = await youtubeWorkflowClient.getReaderMarks(normalizedJobId)
        const revision = Number(payload?.revision)
        if (Number.isInteger(revision) && revision >= 0) rememberMarksRevision(normalizedJobId, revision)
        const localChanged = hydration.changed
          || readerMarksFingerprint(getCurrentReaderMarks()) !== hydration.baseline
        if (getCurrentJobId() !== normalizedJobId || localChanged || !Array.isArray(payload?.marks)) return
        hydration.applying = true
        try {
          await restoreVisibleMarks(payload.marks)
        } finally {
          hydration.applying = false
        }
      } catch (error) {
        recordBestEffortFailure(error, {
          operationId: 'reader-marks-startup-hydration',
          reason: 'authoritative marks restore is best effort; the visible session remains available when the owner is temporarily offline',
        })
      } finally {
        hydration.pending = false
        if (getCurrentJobId() === normalizedJobId && hydration.changed) {
          submitLocalChanges()
        }
      }
    })()
    return hydration.promise
  }

  function deferLocalChange(jobId) {
    const hydration = readerMarksHydrations.get(normalizeJobId(jobId))
    if (!hydration?.pending) return false
    if (!hydration.applying) {
      hydration.changed = readerMarksFingerprint(getCurrentReaderMarks()) !== hydration.baseline
    }
    return true
  }

  function clear() {
    readerMarksHydrations.clear()
  }

  return Object.freeze({ startReaderMarksHydration, deferLocalChange, clear })
}
