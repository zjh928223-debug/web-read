import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const source = await fs.readFile(
  new URL('../src/components/YouTubeWorkflowPanel.vue', import.meta.url),
  'utf8',
)

assert.match(source, /import \{ createLatestWinsLedger \}/)
assert.match(source, /const readerMarksLedgers = new Map\(\)/)
assert.match(source, /const readerActivityLedgers = new Map\(\)/)
assert.match(source, /getReaderMarksLedger\(jobId\)\.submit\(/)
assert.match(source, /getReaderActivityLedger\(payload\.jobId\)/)
assert.match(source, /activityOperationId: context\.operationId/)
assert.match(source, /readerUnloadFlushed/)
assert.match(source, /handleBeforeUnload\(\)/)
assert.match(source, /window\.addEventListener\('reader-marks-changed', handleReaderMarksChanged\)/)
assert.doesNotMatch(source, /MutationObserver/)
assert.doesNotMatch(source, /markCountObserver/)
assert.doesNotMatch(source, /bindMarkCountTracking/)
assert.equal(
  (source.match(/saveReaderMarks\(/g) || []).length,
  1,
  'reader marks should have one ordinary write owner; unload beacon remains a separate last-chance transport',
)

console.log('workflow reader marks ledger contract passed')
