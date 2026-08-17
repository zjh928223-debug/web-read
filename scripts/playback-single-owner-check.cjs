const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const repoRoot = path.resolve(__dirname, '..')
const sourcePath = path.join(repoRoot, 'src', 'composables', 'playback-module.js')
const source = fs.readFileSync(sourcePath, 'utf8').replace(
  "import { requirePiniaRuntimeStores } from '../pinia-stores/runtime-registry.js';",
  'function requirePiniaRuntimeStores() { return globalThis.__playbackTestStores }'
)

const writes = { currentWordIndex: 0, highlightMode: 0, activeChunkIdx: 0, activeWordIdx: 0, activeSegIdx: 0 }
const transcriptStore = countedStore(['currentWordIndex', 'highlightMode', 'activeWordIdx', 'activeSegIdx'], writes)
const chunkStore = countedStore(['activeChunkIdx'], writes)
const wordElement = element('chunk-word-0')
const chunkElement = element('chunk-0')
const chunkRoot = { querySelector: () => wordElement }
const state = {
  words: [{ word: 'one', start: 0, end: 1, segIndex: 0 }],
  chunkItems: [{ start: 0, end: 1 }],
  wordStarts: [0],
  segments: [{ start: 0, end: 1 }],
  isChunkMode: true,
  highlightMode: 1,
  currentWordIndex: -1,
  lastActiveSegIndex: -1,
  lastActiveChunkIndex: -1,
  activeWordHighlightEl: null,
  activeSentenceEl: null,
  activeChunkEl: null,
}
Object.defineProperty(state, 'currentWordIndex', {
  get() { return transcriptStore.currentWordIndex },
  set(value) { transcriptStore.currentWordIndex = value },
})
Object.defineProperty(state, 'highlightMode', {
  get() { return transcriptStore.highlightMode },
  set(value) { transcriptStore.highlightMode = value },
})
Object.defineProperty(state, 'lastActiveChunkIndex', {
  get() { return chunkStore.activeChunkIdx },
  set(value) { chunkStore.activeChunkIdx = value },
})
transcriptStore.highlightMode = 1
resetWrites()

const sandbox = {
  window: {},
  __playbackTestStores: { transcript: transcriptStore, chunk: chunkStore },
  document: {
    getElementById(id) {
      if (id === 'chunk-vue-container') return chunkRoot
      if (id === 'chunk-0') return chunkElement
      return null
    },
  },
  console,
  Number,
  Object,
  Array,
  Math,
  Date,
}
vm.runInNewContext(source, sandbox, { filename: sourcePath })
sandbox.window.__playbackModule.init({
  state,
  audioPlayer: { currentTime: 0, paused: true, play() {}, pause() {} },
  getCurrentSegmentIndexHelper: () => 0,
  getSegmentCheckpointsHelper: () => [0],
  bsFindActiveHelper: () => 0,
  findChunkIndexByTime: () => 0,
  swapActiveClass: (next) => next,
  followPlaybackTarget() {},
  getAnnotationBubble: () => null,
  jumpPrevSentence() {},
  jumpNextSentence() {},
})

sandbox.window.mainUpdateHighlight(0, 0.1)

assert.equal(transcriptStore.currentWordIndex, 0)
assert.equal(transcriptStore.activeWordIdx, 0)
assert.equal(transcriptStore.activeSegIdx, -1)
assert.equal(chunkStore.activeChunkIdx, 0)
assert.equal(writes.currentWordIndex, 1, 'current word must be written once through the transcript state adapter')
assert.equal(writes.highlightMode, 0, 'playback updates must not rewrite the unchanged highlight mode')
assert.equal(writes.activeChunkIdx, 1, 'active chunk must be written once through the chunk state adapter')
assert.equal(writes.activeWordIdx, 1, 'active word projection must be published once by the playback controller')
assert.equal(writes.activeSegIdx, 1, 'active segment projection must be published once by the playback controller')

console.log('playback single-owner boundary check passed')

function countedStore(fields, counters) {
  const values = Object.fromEntries(fields.map((field) => [field, field === 'highlightMode' ? 2 : -1]))
  const store = {}
  for (const field of fields) {
    Object.defineProperty(store, field, {
      get() { return values[field] },
      set(value) { counters[field] += 1; values[field] = value },
      enumerable: true,
    })
  }
  return store
}

function element(id) {
  return { id, classList: { add() {}, remove() {} } }
}

function resetWrites() {
  for (const key of Object.keys(writes)) writes[key] = 0
}
