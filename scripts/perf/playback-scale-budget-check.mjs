import assert from 'node:assert/strict'
import { evaluatePlaybackScaleArtifact } from './playback-scale-budget.mjs'

const operationNames = ['word', 'chunk', 'seek', 'mark', 'mode']
const config = {
  schema: 'read-web.playback-scale-budgets',
  version: 1,
  fixture: {
    schema: 'read-web.playback-scale-fixture',
    version: 1,
    wordCounts: [1000, 10000],
    interactionsPerOperation: 100,
    offline: true,
  },
  budgets: {
    importMaxMs: { 1000: 1000, 10000: 5000 },
    interactionP95Ms: Object.fromEntries(operationNames.map((name) => [name, 100])),
    longTaskMaxMs: 250,
    listenerActiveMax: { 1000: 3000, 10000: 30000 },
    listenerGrowthMax: 0,
  },
}

function result(wordCount) {
  return {
    wordCount,
    segmentCount: wordCount / 10,
    chunkCount: wordCount / 10,
    importDurationMs: wordCount === 1000 ? 200 : 1000,
    samples: Object.fromEntries(operationNames.map((name) => [name, Array.from({ length: 100 }, () => 10)])),
    longTasks: [{ phase: 'import', durationMs: 75 }],
    listeners: {
      afterImport: wordCount * 2,
      afterOperations: wordCount * 2,
      peak: wordCount * 2 + wordCount / 5,
    },
    correctness: {
      wordCount,
      chunkCount: wordCount / 10,
      wordUpdates: 100,
      chunkUpdates: 100,
      seeks: 100,
      markedWords: 100,
      modeSwitches: 100,
      finalMode: 'transcript',
      activeWordCount: 1,
      activeChunkCount: 0,
    },
  }
}

const passing = {
  schema: 'read-web.playback-scale-results',
  schemaVersion: 1,
  fixture: config.fixture,
  errors: [],
  results: [result(1000), result(10000)],
}
assert.deepEqual(evaluatePlaybackScaleArtifact(config, passing).failures, [])

const missing10k = structuredClone(passing)
missing10k.results.pop()
assert.match(evaluatePlaybackScaleArtifact(config, missing10k).failures.join('\n'), /10000/)

const shortRun = structuredClone(passing)
shortRun.results[1].samples.seek.pop()
assert.match(evaluatePlaybackScaleArtifact(config, shortRun).failures.join('\n'), /seek.*100 samples/)

const listenerLeak = structuredClone(passing)
listenerLeak.results[0].listeners.afterOperations += 1
assert.match(evaluatePlaybackScaleArtifact(config, listenerLeak).failures.join('\n'), /listener growth/)

const incorrectMarkResult = structuredClone(passing)
incorrectMarkResult.results[0].correctness.markedWords = 99
assert.match(evaluatePlaybackScaleArtifact(config, incorrectMarkResult).failures.join('\n'), /markedWords/)

const duplicateActiveNode = structuredClone(passing)
duplicateActiveNode.results[1].correctness.activeWordCount = 2
assert.match(evaluatePlaybackScaleArtifact(config, duplicateActiveNode).failures.join('\n'), /activeWordCount/)

console.log('playback scale budget contract check passed')
