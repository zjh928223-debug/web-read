import { recordBestEffortFailure } from '../runtime/best-effort.js'

const READER_OUTBOX_KEY = 'read-web.reader-save-outbox.v1'
const READER_OUTBOX_SCHEMA_VERSION = 1
const READER_OUTBOX_ENTRY_PREFIX = 'read-web.reader-save-outbox.v2.'
const READER_OUTBOX_ENTRY_SCHEMA_VERSION = 2
const READER_OUTBOX_QUARANTINE_PREFIX = 'read-web.reader-save-outbox-quarantine.v1.'

function isPlainReaderOutboxObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isSafeReaderOutboxText(value, maxLength = 200) {
  const text = String(value || '')
  return !!text && text.length <= maxLength && !/[\\/]/.test(text) && !/[\u0000-\u001f]/.test(text)
}

function hasOnlyReaderOutboxKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function isValidReaderOutboxEntry(entry) {
  if (!isPlainReaderOutboxObject(entry)
    || !hasOnlyReaderOutboxKeys(entry, ['jobId', 'kind', 'operationId', 'expectedRevision', 'intent'])
    || !isSafeReaderOutboxText(entry.jobId)
    || !['marks', 'activity'].includes(entry.kind)
    || !isSafeReaderOutboxText(entry.operationId)
    || !Number.isInteger(entry.expectedRevision)
    || entry.expectedRevision < 0
    || !isPlainReaderOutboxObject(entry.intent)) return false
  if (entry.kind === 'marks') {
    return hasOnlyReaderOutboxKeys(entry.intent, ['marks'])
      && Array.isArray(entry.intent.marks)
      && entry.intent.marks.every((mark) => isPlainReaderOutboxObject(mark)
        && hasOnlyReaderOutboxKeys(mark, ['globalIndex', 'word', 'start', 'sourceType'])
        && Number.isInteger(mark.globalIndex)
        && mark.globalIndex >= 0
        && typeof mark.word === 'string'
        && typeof mark.sourceType === 'string'
        && (mark.start === null || Number.isFinite(mark.start)))
  }
  return hasOnlyReaderOutboxKeys(entry.intent, [
    'event',
    'sessionId',
    'sessionStartedAt',
    'positionSeconds',
    'durationSeconds',
    'intervals',
    'coverageRatio',
    'markCount',
  ])
    && typeof entry.intent.event === 'string'
    && typeof entry.intent.sessionId === 'string'
    && typeof entry.intent.sessionStartedAt === 'string'
    && Number.isFinite(entry.intent.positionSeconds)
    && Number.isFinite(entry.intent.durationSeconds)
    && Number.isFinite(entry.intent.coverageRatio)
    && Number.isInteger(entry.intent.markCount)
    && entry.intent.markCount >= 0
    && Array.isArray(entry.intent.intervals)
    && entry.intent.intervals.every((interval) => Array.isArray(interval)
      && interval.length === 2
      && interval.every((value) => Number.isFinite(value)))
}

function readerOutboxKeyPart(value) {
  return Array.from(String(value || ''))
    .map((character) => character.codePointAt(0).toString(16))
    .join('_')
}

function readerOutboxEntryKey(entry) {
  return `${READER_OUTBOX_ENTRY_PREFIX}${readerOutboxKeyPart(entry.jobId)}.${entry.kind}.${readerOutboxKeyPart(entry.operationId)}`
}

function readerOutboxRecord(entry) {
  return {
    schemaVersion: READER_OUTBOX_ENTRY_SCHEMA_VERSION,
    ...entry,
  }
}

function isValidReaderOutboxRecord(record) {
  if (!isPlainReaderOutboxObject(record)
    || !hasOnlyReaderOutboxKeys(record, [
      'schemaVersion',
      'jobId',
      'kind',
      'operationId',
      'expectedRevision',
      'intent',
    ])
    || record.schemaVersion !== READER_OUTBOX_ENTRY_SCHEMA_VERSION) return false
  const { schemaVersion, ...entry } = record
  return schemaVersion === READER_OUTBOX_ENTRY_SCHEMA_VERSION && isValidReaderOutboxEntry(entry)
}

function readerOutboxQuarantineKey(sourceKey) {
  return `${READER_OUTBOX_QUARANTINE_PREFIX}${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 10)}.${readerOutboxKeyPart(sourceKey)}`
}

function quarantineReaderOutbox(reason, rawValue = '', sourceKey = READER_OUTBOX_KEY) {
  const quarantineKey = readerOutboxQuarantineKey(sourceKey)
  const serialized = JSON.stringify({
    schemaVersion: READER_OUTBOX_SCHEMA_VERSION,
    sourceKey,
    detectedAt: new Date().toISOString(),
    reason: String(reason || 'invalid-envelope'),
    rawValue: String(rawValue),
  })
  try {
    window.localStorage.setItem(quarantineKey, serialized)
    if (window.localStorage.getItem(quarantineKey) !== serialized) {
      throw new Error('Reader outbox quarantine could not be verified')
    }
  } catch (error) {
    recordBestEffortFailure(error, {
      operationId: 'reader-outbox-quarantine',
      reason: 'reader outbox quarantine was unavailable; the invalid source remains blocked from replay',
    })
    return false
  }
  try {
    window.localStorage.removeItem(sourceKey)
    return true
  } catch (error) {
    recordBestEffortFailure(error, {
      operationId: 'reader-outbox-quarantine-remove',
      reason: 'reader outbox quarantine was preserved but the invalid source could not be removed; it remains blocked from replay',
    })
    return false
  }
}

function migrateLegacyReaderOutbox() {
  let raw = ''
  try {
    raw = window.localStorage.getItem(READER_OUTBOX_KEY) || ''
  } catch (error) {
    recordBestEffortFailure(error, {
      operationId: 'reader-outbox-legacy-read',
      reason: 'legacy reader outbox migration is deferred; current in-memory intent remains dirty',
    })
    return false
  }
  if (!raw) return true
  let envelope
  try {
    envelope = JSON.parse(raw)
  } catch (error) {
    quarantineReaderOutbox('malformed-json', raw)
    recordBestEffortFailure(new Error('Reader outbox JSON could not be parsed'), {
      operationId: 'reader-outbox-legacy-parse',
      reason: 'malformed legacy reader outbox is quarantined without being replayed',
    })
    return true
  }
  if (!isPlainReaderOutboxObject(envelope)
    || !hasOnlyReaderOutboxKeys(envelope, ['schemaVersion', 'entries'])
    || envelope.schemaVersion !== READER_OUTBOX_SCHEMA_VERSION
    || !Array.isArray(envelope.entries)
    || !envelope.entries.every(isValidReaderOutboxEntry)) {
    quarantineReaderOutbox('unknown-or-invalid-envelope', raw)
    return true
  }
  try {
    envelope.entries.forEach((entry) => {
      window.localStorage.setItem(
        readerOutboxEntryKey(entry),
        JSON.stringify(readerOutboxRecord(entry)),
      )
    })
    window.localStorage.removeItem(READER_OUTBOX_KEY)
    return true
  } catch (error) {
    recordBestEffortFailure(error, {
      operationId: 'reader-outbox-legacy-migrate',
      reason: 'legacy reader outbox remains until every operation has an independent migrated receipt',
    })
    return false
  }
}

export function readReaderOutbox() {
  migrateLegacyReaderOutbox()
  let keys = []
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (key && key.startsWith(READER_OUTBOX_ENTRY_PREFIX)) keys.push(key)
    }
  } catch (error) {
    recordBestEffortFailure(error, {
      operationId: 'reader-outbox-read',
      reason: 'reader outbox is unavailable; current in-memory intent remains dirty',
    })
    return { valid: false, entries: [] }
  }
  const entries = []
  for (const key of keys) {
    let raw = ''
    try {
      raw = window.localStorage.getItem(key) || ''
      const record = JSON.parse(raw)
      if (!isValidReaderOutboxRecord(record)) {
        quarantineReaderOutbox('unknown-or-invalid-envelope', raw, key)
        continue
      }
      const { schemaVersion, ...entry } = record
      if (key !== readerOutboxEntryKey(entry)) {
        quarantineReaderOutbox('outbox-key-mismatch', raw, key)
        continue
      }
      entries.push(entry)
    } catch (error) {
      quarantineReaderOutbox('malformed-json', raw, key)
      recordBestEffortFailure(new Error('Reader outbox entry JSON could not be parsed'), {
        operationId: 'reader-outbox-parse',
        reason: 'malformed reader outbox entry is quarantined without being replayed',
      })
    }
  }
  return { valid: true, entries }
}

export function writeReaderOutboxEntry(entry) {
  if (!isValidReaderOutboxEntry(entry)) return false
  try {
    window.localStorage.setItem(
      readerOutboxEntryKey(entry),
      JSON.stringify(readerOutboxRecord(entry)),
    )
    return true
  } catch (error) {
    recordBestEffortFailure(error, {
      operationId: 'reader-outbox-write',
      reason: 'reader outbox write failed; save state remains dirty for explicit retry',
    })
    return false
  }
}

export function removeReaderOutboxEntry(entry) {
  try {
    window.localStorage.removeItem(readerOutboxEntryKey(entry))
    return true
  } catch (error) {
    recordBestEffortFailure(error, {
      operationId: 'reader-outbox-remove',
      reason: 'successful reader replay could not remove its outbox receipt',
    })
    return false
  }
}

function readerOutboxMarks(marks) {
  return (Array.isArray(marks) ? marks : []).map((mark) => ({
    globalIndex: Number(mark.globalIndex),
    word: String(mark.word || ''),
    start: Number.isFinite(Number(mark.start)) ? Number(mark.start) : null,
    sourceType: String(mark.sourceType || 'manual-mark'),
  }))
}

function readerOutboxActivity(payload) {
  return {
    event: String(payload.event || 'progress'),
    sessionId: String(payload.sessionId || ''),
    sessionStartedAt: String(payload.sessionStartedAt || ''),
    positionSeconds: Number.isFinite(Number(payload.positionSeconds)) ? Number(payload.positionSeconds) : 0,
    durationSeconds: Number.isFinite(Number(payload.durationSeconds)) ? Number(payload.durationSeconds) : 0,
    intervals: Array.isArray(payload.intervals)
      ? payload.intervals
        .filter((interval) => Array.isArray(interval) && interval.length === 2)
        .map((interval) => [Number(interval[0]), Number(interval[1])])
        .filter((interval) => interval.every((value) => Number.isFinite(value)))
      : [],
    coverageRatio: Number.isFinite(Number(payload.coverageRatio)) ? Number(payload.coverageRatio) : 0,
    markCount: Number.isInteger(Number(payload.markCount)) ? Math.max(0, Number(payload.markCount)) : 0,
  }
}

export function createReaderOutboxEntry(kind, payload, operationId, expectedRevision) {
  const jobId = String(payload && payload.jobId || '').trim()
  if (!jobId || !isSafeReaderOutboxText(operationId) || !Number.isInteger(expectedRevision) || expectedRevision < 0) return null
  const entry = {
    jobId,
    kind,
    operationId,
    expectedRevision,
    intent: kind === 'marks'
      ? { marks: readerOutboxMarks(payload.marks) }
      : readerOutboxActivity(payload),
  }
  return isValidReaderOutboxEntry(entry) ? entry : null
}
