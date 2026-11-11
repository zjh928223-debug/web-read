import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { synthesizeArticleSpeech, speechFailureMessage } from '../src/services/pronunciation/article-tts-cli.mjs'

const root = await mkdtemp(join(tmpdir(), 'read-web-article-tts-retry-'))
try {
  for (const transient of ['Unexpected server response: 429', 'WebSocket closed before turn.end (code 1006)']) {
    let attempts = 0
    const delays = []
    const audio = join(root, 'audio.mp3')
    const timing = join(root, 'timing.json')
    await synthesizeArticleSpeech({ text: 'Hello.', proxy: '' }, audio, timing, {
      wait: async ms => delays.push(ms),
      createTts: () => ({ async *streamAudio() {
        attempts++
        if (attempts === 1) {
          yield Buffer.from('discard-partial')
          yield { part: 'discard', start: 0, end: 10 }
          throw new Error(transient)
        }
        yield Buffer.from('complete-audio')
        yield { part: 'Hello', start: 10, end: 500 }
      } }),
    })
    assert.equal(attempts, 2)
    assert.equal(delays.length, 1)
    assert.ok(delays[0] >= 2000)
    assert.equal(await readFile(audio, 'utf8'), 'complete-audio', 'a failed attempt must never be appended')
    assert.deepEqual(JSON.parse(await readFile(timing)), [{ text: 'Hello', start: 0.01, end: 0.5 }])
  }
  let attempts = 0
  await assert.rejects(synthesizeArticleSpeech({ text: 'Hello.' }, join(root, 'failed.mp3'), join(root, 'failed.json'), {
    wait: async () => {},
    createTts: () => ({ async *streamAudio() { attempts++; throw new Error('Unexpected server response: 429') } }),
  }), /429/)
  assert.equal(attempts, 4, 'persistent rate limits must stop after bounded retries')
  attempts = 0
  await assert.rejects(synthesizeArticleSpeech({ text: 'Hello.' }, join(root, 'rejected.mp3'), join(root, 'rejected.json'), {
    wait: async () => assert.fail('permanent errors must not wait'),
    createTts: () => ({ async *streamAudio() { attempts++; throw new Error('Unexpected server response: 400') } }),
  }), /400/)
  assert.equal(attempts, 1)
  assert.match(speechFailureMessage(new Error('Unexpected server response: 429')), /429/)
  assert.equal(speechFailureMessage(new Error('connect failed wss://private.invalid/?token=sensitive')).includes('sensitive'), false)
  console.log('article TTS retries, bounded failure, and partial audio isolation passed')
} finally {
  await rm(root, { recursive: true, force: true })
}
