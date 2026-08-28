import {
  REQUIRED_READER_SESSION_CONSUMERS,
  assert,
  missingConsumerEvidenceTokens,
  missingRequiredConsumerIds,
} from './lib/windows-local-owner-artifacts.mjs'

function assertReaderSessionFixture(consumerIds) {
  const missing = missingRequiredConsumerIds(consumerIds)
  assert(missing.length === 0, `fixture is missing Reader Session callers: ${missing.join(', ')}`)
}

const completeFixture = REQUIRED_READER_SESSION_CONSUMERS.map((id) => ({ id }))
assertReaderSessionFixture(completeFixture.map((item) => item.id))
for (const omittedId of REQUIRED_READER_SESSION_CONSUMERS) {
  let rejected = false
  try {
    assertReaderSessionFixture(completeFixture.filter((item) => item.id !== omittedId).map((item) => item.id))
  } catch {
    rejected = true
  }
  assert(rejected, `consumer gate did not reject fixture without ${omittedId}`)
}

const sourceFixture = "async function toggle(saveToDB, marks) { await saveToDB('marks', marks) }"
const consumerFixture = { symbols: ['toggle', 'saveToDB'], evidenceTokens: ['marks'] }
assert(missingConsumerEvidenceTokens(consumerFixture, sourceFixture).length === 0, 'source token fixture should pass')
assert(
  missingConsumerEvidenceTokens(consumerFixture, sourceFixture.replaceAll('saveToDB', 'persistMarks')).includes('saveToDB'),
  'consumer gate did not reject an omitted source token',
)

console.log('windows local owner consumer self-test passed (each required caller omission is rejected)')
