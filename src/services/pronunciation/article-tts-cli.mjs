import { readFile, open, writeFile } from 'node:fs/promises'
import edgeTtsPackage from 'node-edge-tts'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

// Run under the workflow process supervisor, so cancel also stops the socket.
// Input is a private file rather than command-line text or credentials.
export async function synthesizeArticleSpeech({ text, proxy }, audioPath, timingPath, options = {}) {
  const createTts = options.createTts || (config => new edgeTtsPackage.EdgeTTS(config))
  const wait = options.wait || (ms => new Promise(resolve => setTimeout(resolve, ms)))
  for (let attempt = 0; ; attempt++) {
    try {
      return await synthesizeOnce()
    } catch (error) {
      if (attempt >= 3 || !isTransientSpeechError(error)) throw error
      await wait(2000 * 2 ** attempt)
    }
  }

  async function synthesizeOnce() {
    const tts = createTts({
      voice: 'en-US-AriaNeural', lang: 'en-US', rate: '-5%',
      outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
      saveSubtitles: true, timeout: 45000, proxy: proxy || undefined,
    })
    // Each attempt replaces both the audio and in-memory word boundaries.
    const audio = await open(audioPath, 'w')
    const boundaries = []
    let bytes = 0
    try {
      for await (const chunk of tts.streamAudio(text)) {
        if (Buffer.isBuffer(chunk)) {
          await audio.writeFile(chunk)
          bytes += chunk.length
        } else {
          boundaries.push({ text: chunk.part, start: chunk.start / 1000, end: chunk.end / 1000 })
        }
      }
    } finally {
      await audio.close()
    }
    if (!bytes || !boundaries.length) throw new Error('empty speech or word boundaries')
    await writeFile(timingPath, JSON.stringify(boundaries))
  }
}

function isTransientSpeechError(error) {
  return /\b(?:429|500|502|503|504)\b|timed?\s*out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|WebSocket closed|empty speech/i
    .test(`${error?.code || ''} ${error?.message || ''}`)
}

export function speechFailureMessage(error) {
  const message = `${error?.code || ''} ${error?.message || ''}`
  if (/\b429\b/.test(message)) return 'Aria 请求过于频繁（429），自动重试后仍未成功，请稍后重试。'
  if (/timed?\s*out|ETIMEDOUT/i.test(message)) return 'Aria 语音连接超时，自动重试后仍未成功，请稍后重试。'
  if (isTransientSpeechError(error)) return 'Aria 语音连接中断，自动重试后仍未成功，请稍后重试。'
  return 'Aria 语音生成失败，请稍后重试。'
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [inputPath, audioPath, timingPath] = process.argv.slice(2)
  try {
    await synthesizeArticleSpeech(JSON.parse(await readFile(inputPath, 'utf8')), audioPath, timingPath)
  } catch (error) {
    // Upstream socket exceptions can contain access-bearing endpoint parameters.
    console.error(speechFailureMessage(error))
    process.exitCode = 1
  }
}
