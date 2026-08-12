import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const componentUrl = new URL('../src/components/TranscriptContainer.vue', import.meta.url)
const chunkComponentUrl = new URL('../src/components/ChunkModeView.vue', import.meta.url)
const playbackUrl = new URL('../src/composables/playback-module.js', import.meta.url)
const [componentSource, chunkComponentSource, playbackSource] = await Promise.all([
  fs.readFile(componentUrl, 'utf8'),
  fs.readFile(chunkComponentUrl, 'utf8'),
  fs.readFile(playbackUrl, 'utf8'),
])

function functionBody(source, name, nextName) {
  const start = source.indexOf(`function ${name}(`)
  const end = source.indexOf(`function ${nextName}(`, start + 1)
  assert.ok(start >= 0 && end > start, `unable to inspect ${name}() boundary`)
  return source.slice(start, end)
}

const wordClassesBody = functionBody(componentSource, 'wordClasses', 'lineClasses')

assert.match(
  playbackSource,
  /swapActiveClass\(span,\s*st\.activeWordHighlightEl,\s*'word-highlight'\)/,
  'playback must retain its existing O(1) old/new DOM class swap seam',
)
assert.match(
  playbackSource,
  /swapActiveClass\(chunkBlock,\s*st\.activeChunkEl,\s*'chunk-active'\)/,
  'chunk playback must retain its existing O(1) old/new DOM class swap seam',
)

const sampleWordCount = 12_000
const sampleTransitions = 180
const coupledWordClassEvaluations = sampleWordCount * sampleTransitions
const localizedDomClassMutationsUpperBound = sampleTransitions * 2

console.log(JSON.stringify({
  sampleWordCount,
  sampleTransitions,
  coupledWordClassEvaluations,
  localizedDomClassMutationsUpperBound,
  reductionFactor: coupledWordClassEvaluations / localizedDomClassMutationsUpperBound,
}))

assert.doesNotMatch(
  wordClassesBody,
  /\bts\.activeWordIdx\b/,
  'TranscriptContainer.wordClasses() must not subscribe every word vnode to the ephemeral active-word cursor; playback-module already updates only the old/new DOM nodes',
)
assert.match(componentSource, /activeWordElement\.classList\.remove\('word-highlight'\)/)
assert.match(componentSource, /nextElement\.classList\.add\('word-highlight'\)/)
assert.doesNotMatch(
  chunkComponentSource,
  /:class=["']chunkClasses\(/,
  'ChunkModeView must not bind every chunk vnode class to the ephemeral active-chunk cursor',
)
assert.match(chunkComponentSource, /activeChunkElement\.classList\.remove\('chunk-active'\)/)
assert.match(chunkComponentSource, /nextElement\.classList\.add\('chunk-active'\)/)

console.log('playback active-word/chunk performance check passed')
