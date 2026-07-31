import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import edgeTtsPackage from 'node-edge-tts'

export const ARIA_EDGE_VOICE = 'en-US-AriaNeural'
const AUDIO_ID_PATTERN = /^[a-f0-9]{64}$/
const DEFAULT_CACHE_DIR = join(tmpdir(), 'read-web-aria-edge-tts-v1')
const { EdgeTTS } = edgeTtsPackage

export function createAriaEdgeTtsVitePlugin(options = {}) {
  const service = options.service || createAriaEdgeTtsService(options)
  const configure = (server) => {
    server.middlewares.use((request, response, next) => {
      void handleAriaEdgeTtsRequest(request, response, next, service)
    })
  }
  return {
    name: 'read-web-aria-edge-tts',
    configureServer: configure,
    configurePreviewServer: configure,
  }
}

export function createAriaEdgeTtsService(options = {}) {
  const cacheDir = options.cacheDir || DEFAULT_CACHE_DIR
  const voice = ARIA_EDGE_VOICE
  const pending = new Map()
  const synthesizeToFile = options.synthesizeToFile || (async (text, audioPath) => {
    const tts = new EdgeTTS({
      voice,
      lang: 'en-US',
      outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
      saveSubtitles: false,
      timeout: 15000,
    })
    await tts.ttsPromise(text, audioPath)
  })

  async function synthesize(value) {
    const text = normalizeTtsText(value)
    const audioId = createAudioId(text, voice)
    const audioPath = join(cacheDir, `${audioId}.mp3`)
    if (await isUsableAudioFile(audioPath)) return createResult(audioId, voice)
    if (pending.has(audioId)) return pending.get(audioId)

    const request = (async () => {
      await mkdir(cacheDir, { recursive: true })
      const temporaryPath = join(cacheDir, `${audioId}.${randomUUID()}.tmp`)
      try {
        await synthesizeToFile(text, temporaryPath)
        if (!await isUsableAudioFile(temporaryPath)) {
          throw new Error('Aria TTS returned an empty audio file')
        }
        await rename(temporaryPath, audioPath)
        return createResult(audioId, voice)
      } finally {
        await rm(temporaryPath, { force: true }).catch(() => {})
      }
    })()
    pending.set(audioId, request)
    try {
      return await request
    } finally {
      pending.delete(audioId)
    }
  }

  async function readAudio(audioId) {
    if (!AUDIO_ID_PATTERN.test(String(audioId || ''))) return null
    const audioPath = join(cacheDir, `${audioId}.mp3`)
    if (!await isUsableAudioFile(audioPath)) return null
    return readFile(audioPath)
  }

  return { synthesize, readAudio, voice }
}

export async function handleAriaEdgeTtsRequest(request, response, next, service) {
  const requestUrl = new URL(request.url || '/', 'http://127.0.0.1')
  if (request.method === 'POST' && requestUrl.pathname === '/api/tts/edge') {
    try {
      const payload = JSON.parse(await readRequestBody(request))
      const result = await service.synthesize(payload?.text)
      sendJson(response, 200, result)
    } catch (error) {
      const status = error?.code === 'INVALID_TTS_TEXT' ? 400 : 503
      sendJson(response, status, {
        error: status === 400 ? error.message : 'Aria TTS synthesis failed',
        voice: ARIA_EDGE_VOICE,
      })
    }
    return
  }

  const audioMatch = request.method === 'GET'
    ? requestUrl.pathname.match(/^\/api\/tts\/edge\/audio\/([a-f0-9]{64})\.mp3$/)
    : null
  if (audioMatch) {
    const audio = await service.readAudio(audioMatch[1])
    if (!audio) {
      response.statusCode = 404
      response.end()
      return
    }
    response.statusCode = 200
    response.setHeader('content-type', 'audio/mpeg')
    response.setHeader('content-length', String(audio.length))
    response.setHeader('cache-control', 'private, max-age=31536000, immutable')
    response.end(audio)
    return
  }

  next()
}

function normalizeTtsText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text || text.length > 240) {
    const error = new Error('TTS text must contain between 1 and 240 characters')
    error.code = 'INVALID_TTS_TEXT'
    throw error
  }
  return text
}

function createAudioId(text, voice) {
  return createHash('sha256').update(`${voice}\u0000${text}`).digest('hex')
}

function createResult(audioId, voice) {
  return {
    audioUrl: `/api/tts/edge/audio/${audioId}.mp3`,
    voice,
  }
}

async function isUsableAudioFile(filePath) {
  try {
    return (await stat(filePath)).size > 0
  } catch (_error) {
    return false
  }
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > 16 * 1024) {
        reject(new Error('Request body too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function sendJson(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload))
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('content-length', String(body.length))
  response.end(body)
}
