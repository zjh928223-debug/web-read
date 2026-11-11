import assert from 'node:assert/strict'
import fs from 'node:fs'

const loadSource = async (path, transform = source => source) => {
  const source = transform(fs.readFileSync(new URL(path, import.meta.url), 'utf8'))
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
}
const { getCurrentSegmentIndex } = await loadSource('../src/utils/playback-index.js', source => source.replace('window.PlaybackIndexHelpers =', 'globalThis.__playbackGapHelpers ='))
const { createReaderWordAudio } = await loadSource('../src/composables/reader-word-audio.js')

// The two reported sentence-final annotations stop in these alignment gaps.
const segments = [
  { start: 1.434, end: 3.356 },
  { start: 3.616, end: 9.081 },
  { start: 9.401, end: 15.766 },
]
const words = [
  { start: 1.434, end: 1.514, segIndex: 0 },
  { start: 2.095, end: 2.595, segIndex: 0 },
  { start: 2.755, end: 3.356, segIndex: 0 },
  { start: 3.616, end: 4.036, segIndex: 1 },
  { start: 8.1, end: 8.36, segIndex: 1 },
  { start: 8.4, end: 9.081, segIndex: 1 },
  { start: 9.401, end: 9.461, segIndex: 2 },
]
const starts = words.map(word => word.start)
const at = time => getCurrentSegmentIndex(segments, words, starts, time)

for (const [time, expected] of [
  [0, 0], [2.7, 0], [3.356, 0], [3.476, 0], [3.615999, 0],
  [3.616, 1], [8.5, 1], [9.081, 1], [9.201, 1], [9.400999, 1],
  [9.401, 2], [20, 2],
]) assert.equal(at(time), expected, `highlight at ${time}s must follow the sentence that has actually begun`)
assert.equal(getCurrentSegmentIndex([], [], [], 0), -1)
assert.equal(getCurrentSegmentIndex(segments, [], [], 3.476), 0, 'segment-only timing must hold through the same gap')
assert.equal(getCurrentSegmentIndex([{ start: 0, end: 2 }, { start: 8, end: 9 }], [], [], 7), 0, 'long pauses must not anticipate the next sentence')
assert.equal(getCurrentSegmentIndex([{ start: 0, end: 5 }, { start: 2, end: 3 }], [
  { start: 0, end: 5, segIndex: 0 }, { start: 2, end: 3, segIndex: 1 },
], [0, 2], 3.5), 0, 'active overlapping word priority must remain intact')

// Exercise the annotation clip owner and the same timeupdate-to-highlight seam.
class TestMedia extends EventTarget {
  src = 'current-material.mp4'; duration = 30; currentTime = 0; playbackRate = 1; paused = true
  play() { this.paused = false; return Promise.resolve() }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')) }
  advance(time) { this.currentTime = time; this.dispatchEvent(new Event('timeupdate')) }
}
const media = new TestMedia()
const clip = createReaderWordAudio({ getMedia: () => media })
let highlighted = -1
media.addEventListener('timeupdate', () => { highlighted = at(media.currentTime) })
for (const [range, stoppedAt, expected] of [
  [{ start: 2.095, end: 3.356, previousEnd: 1.955, nextStart: 3.616 }, 3.477, 0],
  [{ start: 8.1, end: 9.081, previousEnd: 7.94, nextStart: 9.401 }, 9.202, 1],
]) {
  assert.equal(await clip.play(range), true)
  media.advance(stoppedAt)
  assert.equal(media.paused, true, 'the original clip still pauses at its existing buffered end')
  assert.equal(highlighted, expected, 'paused annotation playback stays on its own sentence')
  assert.equal(media.currentTime, stoppedAt, 'the fix must not rewind or trim the original audio')
  media.advance(stoppedAt)
  assert.equal(highlighted, expected, 'late paused timeupdate events must not jump forward')
}
await media.play()
media.advance(9.401)
assert.equal(highlighted, 2, 'continuing playback advances when the next sentence actually begins')
clip.cancel()
delete globalThis.__playbackGapHelpers
console.log('playback sentence-gap and annotation-stop checks passed')
