import {
  REQUIRED_READER_SESSION_CONSUMERS,
  assert,
  missingConsumerEvidenceTokens,
  missingMatrixConsumerRefs,
  missingRequiredConsumerIds,
} from './lib/windows-local-owner-artifacts.mjs'

function assertReaderSessionFixture(consumerRecords, matrixRefs) {
  const consumerIds = consumerRecords.map((consumer) => consumer.id)
  const missing = missingRequiredConsumerIds(consumerIds)
  assert(missing.length === 0, `fixture is missing Reader Session callers: ${missing.join(', ')}`)
  const missingMatrixRefs = missingMatrixConsumerRefs(consumerRecords, matrixRefs)
  assert(missingMatrixRefs.length === 0, `fixture is missing matrix references: ${missingMatrixRefs.join(', ')}`)
}

const completeFixture = REQUIRED_READER_SESSION_CONSUMERS.map((id) => ({ id }))
const completeMatrixRefs = completeFixture.map((item) => item.id)
assertReaderSessionFixture(completeFixture, completeMatrixRefs)
for (const omittedId of REQUIRED_READER_SESSION_CONSUMERS) {
  let rejected = false
  try {
    assertReaderSessionFixture(
      completeFixture.filter((item) => item.id !== omittedId),
      completeMatrixRefs,
    )
  } catch {
    rejected = true
  }
  assert(rejected, `consumer gate did not reject fixture without mapped consumer ${omittedId}`)
  rejected = false
  try {
    assertReaderSessionFixture(
      completeFixture,
      completeMatrixRefs.filter((id) => id !== omittedId),
    )
  } catch {
    rejected = true
  }
  assert(rejected, `consumer gate did not reject fixture without matrix reference ${omittedId}`)
}

const sourceFixture = "async function toggle(saveToDB, marks) { await saveToDB('marks', marks) }"
const consumerFixture = { symbols: ['toggle', 'saveToDB'], evidenceTokens: ['marks'] }
assert(missingConsumerEvidenceTokens(consumerFixture, sourceFixture).length === 0, 'source token fixture should pass')
assert(
  missingConsumerEvidenceTokens(consumerFixture, sourceFixture.replaceAll('saveToDB', 'persistMarks')).includes('saveToDB'),
  'consumer gate did not reject an omitted source token',
)

console.log('windows local owner consumer self-test passed (each required caller omission is rejected)')
