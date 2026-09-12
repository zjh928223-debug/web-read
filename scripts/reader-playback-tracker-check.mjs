import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const moduleText = await fs.readFile(
  new URL('../src/services/workflow/reader-playback-tracker.js', import.meta.url),
  'utf8',
)
const { createReaderPlaybackTracker } = await import(
  `data:text/javascript;base64,${Buffer.from(moduleText).toString('base64')}#${Date.now()}`,
)

function createMedia(duration = 100, playbackRate = 1) {
  const listeners = new Map()
  return {
    currentTime: 0,
    duration,
    playbackRate,
    paused: true,
    ended: false,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(listener)
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener)
    },
    dispatch(type) {
      for (const listener of [...(listeners.get(type) || [])]) listener()
    },
    listenerCount(type) {
      return listeners.get(type)?.size || 0
    },
  }
}

function createHarness({ jobId = 'job-a', duration = 100, playbackRate = 1, markCount = 0 } = {}) {
  let currentJobId = jobId
  const media = createMedia(duration, playbackRate)
  const activities = []
  const tracker = createReaderPlaybackTracker({
    getCurrentJobId: () => currentJobId,
    getReaderMedia: () => media,
    getMediaSource: () => null,
    ensureCurrentJobFromAudioMeta: () => {},
    onActivity: (event) => activities.push(event),
    getCurrentMarkCount: () => markCount,
  })
  return {
    tracker,
    media,
    activities,
    setJobId(value) { currentJobId = value },
  }
}

function bindEventTracking(harness) {
  harness.tracker.bindPlaybackTracking()
  return harness
}

function playRange(harness, start, end) {
  const { media } = harness
  media.paused = false
  media.ended = false
  media.currentTime = start
  media.dispatch('play')
  for (let current = start + 2; current < end; current += 2) {
    media.currentTime = current
    media.dispatch('timeupdate')
  }
  media.currentTime = end
  media.dispatch('timeupdate')
}

const originalDateNow = Date.now
let now = 1000
Date.now = () => now

try {
  let dependencyCalls = 0
  createReaderPlaybackTracker({
    getCurrentJobId: () => { dependencyCalls += 1; return 'unused' },
    getReaderMedia: () => { dependencyCalls += 1; return null },
    getMediaSource: () => { dependencyCalls += 1; return null },
  })
  assert.equal(dependencyCalls, 0, 'constructing the tracker must not call its dependencies')

  const first = createHarness({ jobId: 'a' })
  const second = createHarness({ jobId: 'a' })
  assert.equal(first.tracker.getPlaybackState('missing'), undefined, 'missing playback queries must not create state')
  first.tracker.startReaderSession({ jobId: 'a' })
  bindEventTracking(first)
  playRange(first, 0, 2)
  const firstSession = first.tracker.getReaderSessionId()
  first.tracker.startReaderSession({ jobId: 'b' })
  assert.deepEqual(first.tracker.getPlaybackState('b').intervals, [], 'switching to a new job must start with empty intervals')
  first.tracker.startReaderSession({ jobId: 'a' })
  assert.deepEqual(first.tracker.getPlaybackState('a').intervals, [[0, 2]], 'A to B to A must retain A intervals')
  assert.notEqual(first.tracker.getReaderSessionId(), firstSession, 'each reader session start must receive a new session id')
  second.tracker.startReaderSession({ jobId: 'a' })
  assert.notEqual(second.tracker.getPlaybackState('a'), first.tracker.getPlaybackState('a'), 'tracker instances must own independent state')
  assert.deepEqual(second.tracker.getPlaybackState('a').intervals, [], 'one tracker must not inherit another tracker intervals')

  const ranges = bindEventTracking(createHarness({ jobId: 'ranges', duration: 100 }))
  ranges.tracker.startReaderSession({ jobId: 'ranges' })
  playRange(ranges, 0, 4)
  ranges.media.dispatch('seeking')
  ranges.media.currentTime = 2
  ranges.media.dispatch('timeupdate')
  ranges.media.currentTime = 5
  ranges.media.dispatch('timeupdate')
  assert.deepEqual(ranges.tracker.getPlaybackState('ranges').intervals, [[0, 5]], 'overlapping listening intervals must merge')
  ranges.media.dispatch('seeking')
  ranges.media.currentTime = 50
  ranges.media.dispatch('timeupdate')
  ranges.media.currentTime = 57
  ranges.media.dispatch('timeupdate')
  assert.deepEqual(ranges.tracker.getPlaybackState('ranges').intervals, [[0, 5]], 'a large jump after seeking must not be counted')

  const normalRate = bindEventTracking(createHarness({ jobId: 'normal-rate', playbackRate: 1 }))
  normalRate.tracker.startReaderSession({ jobId: 'normal-rate' })
  playRange(normalRate, 0, 3)
  normalRate.media.currentTime = 6.1
  normalRate.media.dispatch('timeupdate')
  normalRate.media.currentTime = 7
  normalRate.media.dispatch('timeupdate')
  assert.deepEqual(normalRate.tracker.getPlaybackState('normal-rate').intervals, [[0, 3], [6.1, 7]], 'normal playback must reject deltas above the natural threshold')

  const fastRate = bindEventTracking(createHarness({ jobId: 'fast-rate', playbackRate: 2 }))
  fastRate.tracker.startReaderSession({ jobId: 'fast-rate' })
  playRange(fastRate, 0, 5)
  fastRate.media.currentTime = 10.1
  fastRate.media.dispatch('timeupdate')
  fastRate.media.currentTime = 12
  fastRate.media.dispatch('timeupdate')
  assert.deepEqual(fastRate.tracker.getPlaybackState('fast-rate').intervals, [[0, 5], [10.1, 12]], 'faster playback must use its rate-adjusted threshold')

  const invalidDuration = bindEventTracking(createHarness({ jobId: 'invalid-duration', duration: Number.NaN }))
  invalidDuration.tracker.startReaderSession({ jobId: 'invalid-duration' })
  playRange(invalidDuration, 0, 2)
  assert.equal(invalidDuration.tracker.getPlaybackState('invalid-duration').coverageRatio, 0, 'invalid duration must leave coverage unchanged')

  const belowCompletion = bindEventTracking(createHarness({ jobId: 'below', duration: 10 }))
  belowCompletion.tracker.startReaderSession({ jobId: 'below' })
  playRange(belowCompletion, 0, 6)
  belowCompletion.media.ended = true
  belowCompletion.media.dispatch('ended')
  assert.equal(belowCompletion.tracker.getPlaybackState('below').completed, false, 'ended below 70 percent must stay incomplete')

  const atCompletion = bindEventTracking(createHarness({ jobId: 'at', duration: 10 }))
  atCompletion.tracker.startReaderSession({ jobId: 'at' })
  playRange(atCompletion, 0, 7)
  atCompletion.media.ended = true
  atCompletion.media.dispatch('ended')
  assert.equal(atCompletion.tracker.getPlaybackState('at').completed, true, 'ended at 70 percent must mark the session complete')

  const events = bindEventTracking(createHarness({ jobId: 'events' }))
  events.tracker.startReaderSession({ jobId: 'events' })
  events.media.paused = false
  events.media.currentTime = 0
  events.media.dispatch('play')
  events.media.dispatch('play')
  assert.deepEqual(events.activities, ['open'], 'only the first play should emit open')
  now = 15999
  events.media.currentTime = 1
  events.media.dispatch('timeupdate')
  assert.deepEqual(events.activities, ['open'], 'progress must remain throttled before 15 seconds')
  now = 16000
  events.media.currentTime = 2
  events.media.dispatch('timeupdate')
  assert.deepEqual(events.activities, ['open', 'progress'], 'progress must fire at the 15-second boundary')
  events.media.ended = false
  events.media.dispatch('pause')
  events.media.ended = true
  events.media.dispatch('pause')
  assert.deepEqual(events.activities, ['open', 'progress', 'pause'], 'ended pause must not emit an extra pause save')
  events.media.dispatch('ended')
  assert.equal(events.activities.at(-1), 'ended', 'ended must emit one activity notification')

  const audio = createMedia()
  const video = createMedia()
  let activeMedia = audio
  const subscriptions = new Set()
  let unsubscribeCount = 0
  const sourceAdapter = {
    subscribe(listener) {
      subscriptions.add(listener)
      return () => {
        unsubscribeCount += 1
        subscriptions.delete(listener)
      }
    },
    switchTo(media) {
      activeMedia = media
      for (const listener of [...subscriptions]) listener()
    },
  }
  const bindingActivities = []
  const bindingTracker = createReaderPlaybackTracker({
    getCurrentJobId: () => 'binding',
    getReaderMedia: () => activeMedia,
    getMediaSource: () => sourceAdapter,
    onActivity: (event) => bindingActivities.push(event),
  })
  bindingTracker.startReaderSession({ jobId: 'binding' })
  bindingTracker.bindPlaybackTracking()
  bindingTracker.bindPlaybackTracking()
  for (const type of ['timeupdate', 'play', 'pause', 'seeking', 'ended']) assert.equal(audio.listenerCount(type), 1, `${type} should bind once to audio`)
  sourceAdapter.switchTo(video)
  for (const type of ['timeupdate', 'play', 'pause', 'seeking', 'ended']) {
    assert.equal(audio.listenerCount(type), 0, `${type} should be removed from the old audio element`)
    assert.equal(video.listenerCount(type), 1, `${type} should bind once to video`)
  }
  audio.dispatch('play')
  video.paused = false
  video.dispatch('play')
  assert.deepEqual(bindingActivities, ['open'], 'only the active media element should notify the tracker')
  bindingTracker.unbindPlaybackTracking()
  assert.equal(unsubscribeCount, 1, 'unbind must remove the media subscription')
  for (const type of ['timeupdate', 'play', 'pause', 'seeking', 'ended']) assert.equal(video.listenerCount(type), 0, `${type} should be removed on unbind`)
  sourceAdapter.switchTo(audio)
  assert.equal(audio.listenerCount('play'), 0, 'unbound trackers must not rebind after a later media notification')

  const payloadHarness = createHarness({ jobId: 'payload', duration: 100, markCount: 7 })
  payloadHarness.tracker.startReaderSession({ jobId: 'payload' })
  bindEventTracking(payloadHarness)
  playRange(payloadHarness, 0, 2)
  payloadHarness.media.currentTime = 12
  const closePayload = payloadHarness.tracker.buildReaderActivityPayload('close')
  assert.equal(closePayload.jobId, 'payload')
  assert.equal(closePayload.event, 'close')
  assert.match(closePayload.sessionId, /^payload-/)
  assert.equal(closePayload.positionSeconds, 12)
  assert.equal(closePayload.durationSeconds, 100)
  assert.equal(closePayload.markCount, 7)
  assert.deepEqual(closePayload.intervals, [[0, 2]])
  assert.equal(closePayload.coverageRatio, 0.02)
  const mutablePayload = payloadHarness.tracker.buildReaderActivityPayload('progress')
  mutablePayload.intervals[0][0] = 99
  assert.deepEqual(payloadHarness.tracker.buildReaderActivityPayload('progress').intervals, [[0, 2]], 'payload intervals must be copied from internal state')
  payloadHarness.tracker.unbindPlaybackTracking()
  assert.deepEqual(closePayload.intervals, [[0, 2]], 'close payload should remain complete after unbind')

  const fallback = createHarness({ jobId: 'fallback', duration: Number.NaN })
  fallback.media.currentTime = Number.NaN
  const fallbackPayload = fallback.tracker.buildReaderActivityPayload('close')
  assert.deepEqual(
    {
      jobId: fallbackPayload.jobId,
      sessionId: fallbackPayload.sessionId,
      positionSeconds: fallbackPayload.positionSeconds,
      durationSeconds: fallbackPayload.durationSeconds,
      intervals: fallbackPayload.intervals,
      coverageRatio: fallbackPayload.coverageRatio,
      markCount: fallbackPayload.markCount,
    },
    {
      jobId: 'fallback',
      sessionId: 'fallback-session',
      positionSeconds: 0,
      durationSeconds: 0,
      intervals: [],
      coverageRatio: 0,
      markCount: 0,
    },
    'payload should preserve the existing fallback values when no usable media is available',
  )
} finally {
  Date.now = originalDateNow
}

console.log('reader playback tracker check passed')
