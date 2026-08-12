const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const repoRoot = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'media-source-module.js'), 'utf8')

function createMedia(overrides = {}) {
  return {
    src: 'blob:reader-audio',
    currentSrc: 'blob:reader-audio',
    paused: true,
    currentTime: 0,
    playbackRate: 1,
    volume: 1,
    muted: false,
    classList: { toggle() {} },
    dataset: {},
    addEventListener() {},
    pause() { this.paused = true },
    play() { this.paused = false; return Promise.resolve() },
    ...overrides
  }
}

function loadMediaSource(audio) {
  const toasts = []
  const windowObject = {
    innerWidth: 1280,
    innerHeight: 720,
    localStorage: { getItem() { return null }, setItem() {} },
    showToast(message, type) { toasts.push({ message, type }) }
  }
  const documentObject = {
    readyState: 'complete',
    getElementById(id) { return id === 'audio-player' ? audio : null },
    addEventListener() {}
  }
  const context = vm.createContext({ window: windowObject, document: documentObject, Promise, Set, Number, Object })
  vm.runInContext(source, context, { filename: 'media-source-module.js' })
  return { mediaSource: windowObject.__mediaSource, toasts }
}

async function main() {
  const plain = (value) => JSON.parse(JSON.stringify(value))
  {
    const audio = createMedia()
    const { mediaSource, toasts } = loadMediaSource(audio)
    const result = await mediaSource.createActiveMediaProxy(audio).play()
    assert.deepEqual(plain(result), { status: 'playing', recovery: null })
    assert.deepEqual(toasts, [])
  }

  {
    const blocked = Object.assign(new Error('autoplay denied'), { name: 'NotAllowedError' })
    const audio = createMedia({ play() { return Promise.reject(blocked) } })
    const { mediaSource, toasts } = loadMediaSource(audio)
    const result = await mediaSource.createActiveMediaProxy(audio).play()
    assert.deepEqual(plain(result), { status: 'blocked', recovery: 'click-to-retry' })
    assert.equal(toasts.length, 1)
    assert.equal(toasts[0].type, 'warning')
    assert.match(toasts[0].message, /点击.*重试/)
  }

  {
    const audio = createMedia({ src: '', currentSrc: '', play() { throw new Error('must not call play without a source') } })
    const { mediaSource, toasts } = loadMediaSource(audio)
    const result = await mediaSource.createActiveMediaProxy(audio).play()
    assert.deepEqual(plain(result), { status: 'no-source', recovery: 'load-media' })
    assert.equal(toasts.length, 1)
    assert.equal(toasts[0].type, 'warning')
    assert.match(toasts[0].message, /加载.*素材/)
  }

  {
    const audio = createMedia({ play() { return Promise.reject(new Error('decoder failed at C:\\secret\\clip.mp3')) } })
    const { mediaSource, toasts } = loadMediaSource(audio)
    const result = await mediaSource.createActiveMediaProxy(audio).play()
    assert.deepEqual(plain(result), { status: 'error', recovery: 'reload-media' })
    assert.equal(toasts.length, 1)
    assert.equal(toasts[0].type, 'error')
    assert.match(toasts[0].message, /重新加载.*重试/)
    assert.doesNotMatch(toasts[0].message, /secret|clip\.mp3/)
  }

  console.log('media playback result check passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
