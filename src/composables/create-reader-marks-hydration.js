import { youtubeWorkflowClient } from './youtube-workflow-client.js'
import { recordBestEffortFailure } from '../services/runtime/best-effort.js'

function cloneMarks(marks) {
  return (Array.isArray(marks) ? marks : []).map((mark) => (
    mark && typeof mark === 'object' ? { ...mark } : mark
  ))
}

function readerMarksFingerprint(marks) {
  return JSON.stringify(cloneMarks(marks)
    .map((mark) => ({
      globalIndex: Number(mark?.globalIndex),
      word: String(mark?.word || ''),
      start: Number.isFinite(Number(mark?.start)) ? Number(mark.start) : null,
      sourceType: String(mark?.sourceType || 'manual-mark'),
    }))
    .sort((left, right) => left.globalIndex - right.globalIndex))
}

function markIndex(mark) {
  const index = Number(mark?.globalIndex)
  return Number.isInteger(index) && index >= 0 ? index : null
}

function normalizeLocalOperation(operation, currentMarks) {
  const fallback = { type: 'replace', marks: cloneMarks(currentMarks) }
  if (!operation || typeof operation !== 'object') return fallback
  const type = String(operation.type || '').trim().toLowerCase()
  if (type === 'add') {
    const mark = operation.mark && typeof operation.mark === 'object'
      ? { ...operation.mark }
      : null
    if (markIndex(mark) === null) return fallback
    return { type: 'add', mark }
  }
  if (type === 'remove') {
    const globalIndex = markIndex(operation)
    return globalIndex === null ? fallback : { type: 'remove', globalIndex }
  }
  if (type === 'replace') return fallback
  return fallback
}

function applyLocalOperations(baseMarks, operations) {
  const marks = new Map()
  cloneMarks(baseMarks).forEach((mark) => {
    const globalIndex = markIndex(mark)
    if (globalIndex !== null) marks.set(globalIndex, mark)
  })
  for (const operation of Array.isArray(operations) ? operations : []) {
    if (operation?.type === 'replace') {
      marks.clear()
      cloneMarks(operation.marks).forEach((mark) => {
        const globalIndex = markIndex(mark)
        if (globalIndex !== null) marks.set(globalIndex, mark)
      })
    } else if (operation?.type === 'add') {
      const globalIndex = markIndex(operation.mark)
      if (globalIndex !== null) marks.set(globalIndex, { ...operation.mark })
    } else if (operation?.type === 'remove') {
      const globalIndex = markIndex(operation)
      if (globalIndex !== null) marks.delete(globalIndex)
    }
  }
  return Array.from(marks.values())
}

function validRevision(value) {
  if (value === null || value === undefined || value === '') return null
  const revision = Number(value)
  return Number.isInteger(revision) && revision >= 0 ? revision : null
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

  function makeHydration(jobId, { pending = true } = {}) {
    const currentMarks = cloneMarks(getCurrentReaderMarks())
    return {
      jobId,
      baseline: readerMarksFingerprint(currentMarks),
      applying: false,
      pending,
      authorityMarks: null,
      authorityRevision: null,
      authorityApplied: false,
      localDirty: false,
      localSourceRevision: null,
      localEditVersion: 0,
      localOperations: [],
      latestLocalMarks: currentMarks,
      submissionQueued: false,
      promise: pending ? null : Promise.resolve(),
    }
  }

  function getHydration(jobId) {
    return readerMarksHydrations.get(normalizeJobId(jobId))
  }

  function localIntentFor(hydration) {
    if (!hydration?.localDirty) return null
    return {
      jobId: hydration.jobId,
      marks: cloneMarks(hydration.latestLocalMarks),
      source: 'local-edit',
      sourceRevision: hydration.localSourceRevision,
      localVersion: hydration.localEditVersion,
      operations: hydration.localOperations.map((operation) => ({
        ...operation,
        ...(operation.mark ? { mark: { ...operation.mark } } : {}),
        ...(operation.marks ? { marks: cloneMarks(operation.marks) } : {}),
      })),
    }
  }

  async function restoreMarks(hydration, marks) {
    hydration.applying = true
    try {
      await restoreVisibleMarks(cloneMarks(marks))
    } finally {
      hydration.applying = false
    }
  }

  function rememberAuthority(hydration, marks, revision, applied = false) {
    hydration.authorityMarks = cloneMarks(marks)
    hydration.authorityRevision = validRevision(revision)
    if (applied) {
      hydration.authorityApplied = true
      if (!hydration.localDirty) hydration.latestLocalMarks = cloneMarks(marks)
      hydration.baseline = readerMarksFingerprint(marks)
      if (hydration.authorityRevision !== null) {
        rememberMarksRevision(hydration.jobId, hydration.authorityRevision)
      }
    }
  }

  function resubmitRecoveredLocalIntent(hydration) {
    if (!hydration.localDirty || hydration.localSourceRevision === null || hydration.pending) return
    hydration.submissionQueued = true
    Promise.resolve(restoreMarks(hydration, hydration.latestLocalMarks))
      .catch((error) => {
        recordBestEffortFailure(error, {
          operationId: 'reader-marks-recover-local-intent',
          reason: 'the recovered local mark intent remains available even when its visible re-application fails',
        })
      })
      .then(() => {
        if (getCurrentJobId() !== hydration.jobId || !hydration.localDirty || hydration.localSourceRevision === null) return
        submitLocalChanges(localIntentFor(hydration))
      })
  }

  function startReaderMarksHydration(jobId) {
    const normalizedJobId = normalizeJobId(jobId)
    if (!normalizedJobId) return
    const existing = readerMarksHydrations.get(normalizedJobId)
    if (existing) return existing.promise

    const hydration = makeHydration(normalizedJobId)
    readerMarksHydrations.set(normalizedJobId, hydration)
    hydration.promise = (async () => {
      try {
        const payload = await youtubeWorkflowClient.getReaderMarks(normalizedJobId)
        const marks = Array.isArray(payload?.marks) ? cloneMarks(payload.marks) : null
        const revision = validRevision(payload?.revision)
        rememberAuthority(hydration, marks || [], revision, false)
        const hasLocalEdits = hydration.localDirty || hydration.localOperations.length > 0
        if (getCurrentJobId() !== normalizedJobId || !marks) return

        if (hasLocalEdits) {
          const replayedMarks = applyLocalOperations(marks, hydration.localOperations)
          hydration.latestLocalMarks = cloneMarks(replayedMarks)
          if (hydration.localSourceRevision === null) hydration.localSourceRevision = revision
          await restoreMarks(hydration, replayedMarks)
        } else {
          await restoreMarks(hydration, marks)
          rememberAuthority(hydration, marks, revision, true)
        }
      } catch (error) {
        recordBestEffortFailure(error, {
          operationId: 'reader-marks-startup-hydration',
          reason: 'authoritative marks restore is best effort; the visible session remains available when the owner is temporarily offline',
        })
      } finally {
        hydration.pending = false
        if (getCurrentJobId() === normalizedJobId && hydration.localDirty && hydration.localSourceRevision !== null) {
          hydration.submissionQueued = true
          submitLocalChanges(localIntentFor(hydration))
        }
      }
    })()
    return hydration.promise
  }

  function recordLocalEdit(jobId, change = {}) {
    const hydration = getHydration(jobId)
    if (!hydration || hydration.applying) return null
    const currentMarks = cloneMarks(
      Array.isArray(change.marks) ? change.marks : getCurrentReaderMarks()
    )
    if (!hydration.localDirty) hydration.localSourceRevision = hydration.authorityRevision
    hydration.localDirty = true
    hydration.localEditVersion += 1
    const operation = normalizeLocalOperation(change.operation, currentMarks)
    operation.version = hydration.localEditVersion
    hydration.localOperations.push(operation)
    hydration.latestLocalMarks = currentMarks
    return localIntentFor(hydration)
  }

  function deferLocalChange(jobId) {
    const hydration = getHydration(jobId)
    if (!hydration) return false
    if (hydration.applying) return true
    return hydration.pending
  }

  async function handleProgrammaticRestore(jobId) {
    const hydration = getHydration(jobId)
    if (!hydration || hydration.applying) return false
    const marks = hydration.localDirty
      ? hydration.latestLocalMarks
      : hydration.authorityApplied
        ? hydration.authorityMarks
        : null
    if (!Array.isArray(marks)) return false
    await restoreMarks(hydration, marks)
    return true
  }

  function rememberAuthoritativeMarks(jobId, marks, revision, { applied = false } = {}) {
    const normalizedJobId = normalizeJobId(jobId)
    if (!normalizedJobId || !Array.isArray(marks)) return false
    let hydration = getHydration(normalizedJobId)
    if (!hydration) {
      hydration = makeHydration(normalizedJobId, { pending: false })
      readerMarksHydrations.set(normalizedJobId, hydration)
    }
    const hadUnversionedLocalIntent = hydration.localDirty && hydration.localSourceRevision === null
    rememberAuthority(hydration, marks, revision, applied)
    if (applied && hadUnversionedLocalIntent && hydration.authorityRevision !== null) {
      hydration.latestLocalMarks = applyLocalOperations(marks, hydration.localOperations)
      hydration.localSourceRevision = hydration.authorityRevision
      resubmitRecoveredLocalIntent(hydration)
    } else if (applied && !hydration.localDirty) {
      hydration.latestLocalMarks = cloneMarks(marks)
    }
    return true
  }

  function markLocalChangesSaved(jobId, marks, revision, localVersion = null) {
    const hydration = getHydration(jobId)
    if (!hydration || !Array.isArray(marks)) return false
    const savedMarks = cloneMarks(marks)
    const hasSavedVersion = Number.isInteger(localVersion)
    const savedVersion = hasSavedVersion ? localVersion : null
    const previousLocalDirty = hydration.localDirty
    const previousLocalVersion = hydration.localEditVersion
    const previousLatestLocalMarks = cloneMarks(hydration.latestLocalMarks)
    const previousLocalOperations = hydration.localOperations.slice()
    rememberAuthority(hydration, savedMarks, revision, true)
    const localContentMatches = readerMarksFingerprint(previousLatestLocalMarks) === readerMarksFingerprint(savedMarks)
    const localVersionMatches = !hasSavedVersion || previousLocalVersion === savedVersion
    const saveMatchesCurrentLocalIntent = !previousLocalDirty || (localContentMatches && localVersionMatches)
    if (saveMatchesCurrentLocalIntent) {
      hydration.localDirty = false
      hydration.localSourceRevision = null
      hydration.localOperations = []
      hydration.submissionQueued = false
      hydration.latestLocalMarks = savedMarks
      return true
    }
    hydration.latestLocalMarks = previousLatestLocalMarks
    hydration.localSourceRevision = validRevision(revision)
    hydration.localOperations = hasSavedVersion && previousLocalVersion > savedVersion
      ? previousLocalOperations.filter((operation) => operation.version > savedVersion)
      : previousLocalOperations
    hydration.authorityApplied = false
    return true
  }

  function getLocalIntent(jobId) {
    return localIntentFor(getHydration(jobId))
  }

  function clear() {
    readerMarksHydrations.clear()
  }

  return Object.freeze({
    startReaderMarksHydration,
    recordLocalEdit,
    deferLocalChange,
    handleProgrammaticRestore,
    rememberAuthoritativeMarks,
    markLocalChangesSaved,
    getLocalIntent,
    clear,
  })
}
