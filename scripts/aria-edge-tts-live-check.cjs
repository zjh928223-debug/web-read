const assert = require('node:assert/strict')

const targetUrl = new URL(process.env.READ_WEB_URL || 'http://127.0.0.1:4197/')
const serviceToken = String(process.env.READ_WEB_SERVICE_TOKEN || '').trim()

function headers(extra = {}) {
  return serviceToken ? { ...extra, 'x-read-web-token': serviceToken } : extra
}

async function run() {
  const response = await fetch(new URL('/api/tts/edge', targetUrl), {
    method: 'POST',
    headers: headers({ 'content-type': 'application/json' }),
    body: JSON.stringify({ text: 'pronunciation verification' }),
  })
  if (response.status !== 200) {
    assert.fail(`Aria endpoint returned ${response.status}: ${await response.text()}`)
  }
  const payload = await response.json()
  assert.equal(payload.voice, 'en-US-AriaNeural')
  assert.match(payload.audioUrl, /^\/api\/tts\/edge\/audio\/[a-f0-9]{64}\.mp3$/)

  const audioResponse = await fetch(new URL(payload.audioUrl, targetUrl), { headers: headers() })
  assert.equal(audioResponse.status, 200)
  assert.match(audioResponse.headers.get('content-type') || '', /^audio\/mpeg/)
  const audio = Buffer.from(await audioResponse.arrayBuffer())
  assert.ok(audio.length > 1000, `expected synthesized MP3, received ${audio.length} bytes`)
  const hasId3Header = audio.subarray(0, 3).toString('ascii') === 'ID3'
  const hasMpegFrame = audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0
  assert.ok(hasId3Header || hasMpegFrame, 'response is not recognizable MP3 data')

  const batchResponse = await fetch(new URL('/api/tts/edge/batch', targetUrl), {
    method: 'POST',
    headers: headers({ 'content-type': 'application/json' }),
    body: JSON.stringify({ texts: ['batch pronunciation one', 'batch pronunciation two', 'batch pronunciation one'] }),
  })
  if (batchResponse.status !== 200) {
    assert.fail(`Aria batch endpoint returned ${batchResponse.status}: ${await batchResponse.text()}`)
  }
  const batchPayload = await batchResponse.json()
  assert.equal(Array.isArray(batchPayload.items), true)
  assert.deepEqual(batchPayload.items.map((item) => item.text), [
    'batch pronunciation one',
    'batch pronunciation two',
  ])
  for (const item of batchPayload.items) {
    assert.equal(item.voice, 'en-US-AriaNeural')
    assert.match(item.audioUrl, /^\/api\/tts\/edge\/audio\/[a-f0-9]{64}\.mp3$/)
    const itemAudioResponse = await fetch(new URL(item.audioUrl, targetUrl), { headers: headers() })
    assert.equal(itemAudioResponse.status, 200)
    assert.match(itemAudioResponse.headers.get('content-type') || '', /^audio\/mpeg/)
    assert.ok((await itemAudioResponse.arrayBuffer()).byteLength > 1000)
  }

  console.log(`Live Aria single and batch fallback passed (${payload.voice}, ${audio.length} bytes, ${batchPayload.items.length} items).`)
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
