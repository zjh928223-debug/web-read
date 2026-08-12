function cloneState(state) {
  return Object.freeze({ ...state })
}

export function createLatestWinsLedger(options = {}) {
  if (typeof options.write !== 'function') {
    throw new TypeError('LatestWinsLedger requires a write function')
  }

  const write = options.write
  const onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : null
  const createOperationId = typeof options.createOperationId === 'function'
    ? options.createOperationId
    : (sequence) => `ledger-${sequence}`
  let sequence = 0
  let savedSequence = 0
  let active = null
  let pending = null
  let failed = null
  let disposed = false
  let state = cloneState({
    status: 'saved',
    dirty: false,
    sequence: 0,
    savedSequence: 0,
    activeSequence: 0,
    error: null,
  })

  function emit(patch) {
    state = cloneState({ ...state, ...patch })
    if (onStateChange) onStateChange(state)
  }

  function makeEntry(snapshot, previous) {
    const nextSequence = previous ? previous.sequence : ++sequence
    return {
      snapshot,
      sequence: nextSequence,
      operationId: previous ? previous.operationId : createOperationId(nextSequence),
    }
  }

  function contextFor(entry) {
    return Object.freeze({ sequence: entry.sequence, operationId: entry.operationId })
  }

  function submit(snapshot) {
    if (disposed) return sequence
    const entry = makeEntry(snapshot)
    failed = null
    emit({
      status: active ? 'saving' : 'dirty',
      dirty: true,
      sequence: entry.sequence,
      error: null,
    })
    if (active) pending = entry
    else start(entry)
    return entry.sequence
  }

  function start(entry) {
    active = entry
    emit({ status: 'saving', dirty: true, activeSequence: entry.sequence, error: null })
    Promise.resolve()
      .then(() => write(entry.snapshot, contextFor(entry)))
      .then(() => settleSuccess(entry), (error) => settleFailure(entry, error))
  }

  function settleSuccess(entry) {
    if (disposed || active !== entry) return
    active = null
    savedSequence = Math.max(savedSequence, entry.sequence)
    if (pending) {
      const next = pending
      pending = null
      start(next)
      emit({ sequence: Math.max(sequence, next.sequence), savedSequence, dirty: true })
      return
    }
    failed = null
    emit({
      status: savedSequence === sequence ? 'saved' : 'dirty',
      dirty: savedSequence !== sequence,
      savedSequence,
      activeSequence: 0,
      error: null,
    })
  }

  function settleFailure(entry, error) {
    if (disposed || active !== entry) return
    active = null
    if (pending) {
      const next = pending
      pending = null
      start(next)
      emit({ savedSequence, dirty: true, error })
      return
    }
    failed = entry
    emit({ status: 'error', dirty: true, savedSequence, activeSequence: 0, error })
  }

  function retry() {
    if (disposed || active) return Promise.resolve(false)
    const entry = pending || failed
    if (!entry) return Promise.resolve(false)
    pending = null
    failed = null
    start(entry)
    return waitForIdle().then(() => state.status === 'saved')
  }

  function waitForIdle() {
    if (!active && !pending) return Promise.resolve(state)
    return new Promise((resolve) => {
      const poll = () => {
        if (!active && !pending) resolve(state)
        else setTimeout(poll, 0)
      }
      poll()
    })
  }

  function dispose() {
    disposed = true
    pending = null
    failed = null
  }

  return Object.freeze({
    dispose,
    getState: () => state,
    retry,
    submit,
    waitForIdle,
  })
}
