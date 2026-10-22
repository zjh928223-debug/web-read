const pendingPassagePreviewContacts = new Map()

export function rememberPendingPassagePreviewContact(contact) {
  const key = getPendingPassagePreviewContactKey(contact?.item || contact)
  if (!key || !contact?.seenAt) return false
  pendingPassagePreviewContacts.set(key, clone(contact))
  return true
}

export function getPendingPassagePreviewContact(item) {
  const key = getPendingPassagePreviewContactKey(item)
  if (!key) return null
  const contact = pendingPassagePreviewContacts.get(key)
  return contact ? clone(contact) : null
}

export function clearPendingPassagePreviewContact(item) {
  const key = getPendingPassagePreviewContactKey(item)
  if (!key) return false
  return pendingPassagePreviewContacts.delete(key)
}

export function getPassagePreviewTargetSenseKey(item = {}) {
  const explicit = normalizeText(item.targetSenseKey || item.target_sense_key)
  if (explicit) return explicit
  const lemma = normalizeWord(item.lemma || item.word)
  const meaning = normalizeText(item.primaryMeaningZh || item.meaning || item.gloss)
  return lemma && meaning ? `preview:${lemma}:${meaning}` : ''
}

export function samePassagePreviewTarget(left, right) {
  const leftLemma = normalizeWord(left?.lemma || left?.word)
  const rightLemma = normalizeWord(right?.lemma || right?.word)
  if (!leftLemma || leftLemma !== rightLemma) return false
  const leftSense = getPassagePreviewTargetSenseKey(left)
  const rightSense = getPassagePreviewTargetSenseKey(right)
  if (!leftSense || !rightSense) return false
  if (leftSense === rightSense) return true
  const leftId = normalizeText(left?.id || left?.previewItemId)
  const rightId = normalizeText(right?.id || right?.previewItemId)
  if (!leftId || leftId !== rightId) return false
  const leftMeaning = normalizeText(left?.primaryMeaningZh || left?.meaning || left?.gloss)
  const rightMeaning = normalizeText(right?.primaryMeaningZh || right?.meaning || right?.gloss)
  const leftPos = normalizeText(left?.pos || left?.partOfSpeech).toLowerCase()
  const rightPos = normalizeText(right?.pos || right?.partOfSpeech).toLowerCase()
  return Boolean(
    leftMeaning
      && rightMeaning
      && leftMeaning === rightMeaning
      && (!leftPos || !rightPos || leftPos === rightPos),
  )
}

export function mergePassagePreviewContactStatuses({
  firstContacts = {},
  previousStatuses = {},
  introducedRecords = [],
  introducedRecordsLoaded = false,
} = {}) {
  const records = Array.isArray(introducedRecords) ? introducedRecords : []
  const contacts = firstContacts && typeof firstContacts === 'object' && !Array.isArray(firstContacts)
    ? firstContacts
    : {}
  const previous = previousStatuses && typeof previousStatuses === 'object'
    ? previousStatuses
    : {}
  return Object.fromEntries(Object.entries(contacts).map(([id, contact]) => {
    const matched = records.some((record) => samePassagePreviewTarget(contact?.item, record))
    const status = matched
      ? 'committed'
      : previous[id] === 'failed'
        ? 'failed'
        : !introducedRecordsLoaded && previous[id] === 'committed'
          ? 'committed'
          : 'pending'
    return [id, status]
  }))
}

export function createPassagePreviewContact({ item, seenAt, sentence } = {}) {
  const targetSenseKey = getPassagePreviewTargetSenseKey(item)
  const id = normalizeText(item?.id)
  const lemma = normalizeWord(item?.lemma || item?.word)
  const word = normalizeText(item?.word || item?.lemma)
  const primaryMeaningZh = normalizeText(item?.primaryMeaningZh)
  const normalizedSeenAt = normalizeIso(seenAt)
  if (!id || !lemma || !word || !primaryMeaningZh || !targetSenseKey || !normalizedSeenAt) return null
  const snapshot = clone(item)
  snapshot.id = id
  snapshot.lemma = lemma
  snapshot.word = word
  snapshot.primaryMeaningZh = primaryMeaningZh
  snapshot.targetSenseKey = targetSenseKey
  if (sentence && typeof sentence === 'object') snapshot.realSentence = clone(sentence)
  return {
    seenAt: normalizedSeenAt,
    targetSenseKey,
    item: snapshot,
  }
}

export function buildPassagePreviewContactSummary({ items = [], firstContacts = {}, statuses = {} } = {}) {
  const sourceItems = Array.isArray(items) ? items : []
  const contacts = firstContacts && typeof firstContacts === 'object' && !Array.isArray(firstContacts)
    ? firstContacts
    : {}
  const currentIds = new Set(sourceItems.map((item) => normalizeText(item?.id)).filter(Boolean))
  const currentContactIds = sourceItems
    .map((item) => normalizeText(item?.id))
    .filter((id) => id && contacts[id])
  const pendingRecovery = Object.keys(contacts)
    .filter((id) => !currentIds.has(id))
    .filter((id) => statuses[id] !== 'committed')
    .length
  const committed = currentContactIds.filter((id) => statuses[id] === 'committed').length
  const failed = currentContactIds.filter((id) => statuses[id] === 'failed').length
  return {
    currentTotal: sourceItems.length,
    currentPersisted: currentContactIds.length,
    currentCommitted: committed,
    currentPending: Math.max(0, currentContactIds.length - committed),
    currentFailed: failed,
    pendingRecovery,
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function getPendingPassagePreviewContactKey(item = {}) {
  const id = normalizeText(item?.id || item?.previewItemId)
  const sense = getPassagePreviewTargetSenseKey(item)
  return id && sense ? `${id}\u001f${sense}` : ''
}

function normalizeIso(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function normalizeWord(value) {
  const word = normalizeText(value).toLowerCase()
  return /^[a-z]+(?:[-'][a-z]+)*$/u.test(word) ? word : ''
}

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
}
