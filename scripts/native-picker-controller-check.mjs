import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = path.resolve(import.meta.dirname, '..')

function dataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`
}

const typedErrorSource = fs.readFileSync(path.join(repoRoot, 'src/services/runtime/typed-error.js'), 'utf8')
const typedErrorUrl = dataUrl(typedErrorSource)
const controllerSource = fs.readFileSync(path.join(repoRoot, 'src/services/workflow/native-picker-controller.js'), 'utf8')
  .replace("'../runtime/typed-error.js'", `'${typedErrorUrl}'`)
const { createNativePickerController } = await import(`${dataUrl(controllerSource)}#native-picker-controller`)

function deferredPicker() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function abortablePending(signal) {
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      reject(error)
    }, { once: true })
  })
}

{
  const states = []
  let focusCount = 0
  const trigger = { id: 'folder-trigger' }
  let focusedTarget = null
  let receivedSignal = null
  const controller = createNativePickerController({
    client: {
      pickImportFolder(_payload, options) {
        receivedSignal = options.signal
        return Promise.resolve({ selected: true, path: 'D:/study', status: 'selected' })
      },
      pickVideoFile() { throw new Error('unexpected video picker') },
    },
    onState: (state) => states.push(state.status),
    captureFocus: () => trigger,
    refocus: (target) => { focusCount += 1; focusedTarget = target },
  })
  const result = await controller.pick('folder', { initialDir: 'D:/' })
  assert.equal(result.path, 'D:/study')
  assert.ok(receivedSignal instanceof AbortSignal)
  assert.deepEqual(states, ['busy', 'selected'])
  assert.equal(focusCount, 1)
  assert.equal(focusedTarget, trigger)
}

{
  let attempts = 0
  const controller = createNativePickerController({
    client: {
      pickImportFolder() { throw new Error('unexpected folder picker') },
      pickVideoFile() {
        attempts += 1
        return Promise.resolve(attempts === 1
          ? { selected: false, path: '', status: 'canceled' }
          : { selected: true, path: 'D:/study/video.mp4', status: 'selected' })
      },
    },
  })
  const canceled = await controller.pick('video')
  assert.deepEqual(canceled, { selected: false, path: '', status: 'canceled' })
  assert.equal(controller.getState().status, 'canceled')
  assert.equal(controller.getState().retryable, true)
  const retried = await controller.retry()
  assert.equal(retried.path, 'D:/study/video.mp4')
}

{
  const pending = deferredPicker()
  const controller = createNativePickerController({
    client: {
      pickImportFolder() { return pending.promise },
      pickVideoFile() { return Promise.resolve({ selected: true, path: 'D:/other.mp4' }) },
    },
  })
  const first = controller.pick('folder')
  await assert.rejects(controller.pick('video'), (error) => {
    assert.equal(error.code, 'NATIVE_PICKER_BUSY')
    assert.equal(error.category, 'conflict')
    assert.equal(error.retryable, true)
    assert.equal(error.operationId, 'native-picker-video')
    return true
  })
  assert.equal(controller.getState().status, 'busy')
  pending.resolve({ selected: true, path: 'D:/study' })
  await first
}

{
  const controller = createNativePickerController({
    timeoutMs: 5,
    client: {
      pickImportFolder(_payload, options) { return abortablePending(options.signal) },
      pickVideoFile() { throw new Error('unexpected video picker') },
    },
  })
  await assert.rejects(controller.pick('folder'), (error) => {
    assert.equal(error.code, 'NATIVE_PICKER_TIMEOUT')
    assert.equal(error.category, 'timeout')
    assert.equal(error.retryable, true)
    return true
  })
  assert.equal(controller.getState().status, 'error')
}

{
  const controller = createNativePickerController({
    client: {
      pickImportFolder() { throw new Error('unexpected folder picker') },
      pickVideoFile(_payload, options) { return abortablePending(options.signal) },
    },
  })
  const pending = controller.pick('video')
  assert.equal(controller.cancel(), true)
  await assert.rejects(pending, (error) => {
    assert.equal(error.code, 'NATIVE_PICKER_CANCELED')
    assert.equal(error.category, 'canceled')
    assert.equal(error.retryable, false)
    return true
  })
  assert.equal(controller.getState().status, 'canceled')
  assert.equal(controller.cancel(), false)
}

{
  const controller = createNativePickerController({
    client: {
      pickImportFolder() {
        const error = new Error('native-picker-busy')
        error.code = 'native-picker-busy'
        throw error
      },
      pickVideoFile() { throw new Error('unexpected video picker') },
    },
  })
  await assert.rejects(controller.pick('folder'), (error) => {
    assert.equal(error.code, 'NATIVE_PICKER_BUSY')
    assert.equal(error.category, 'conflict')
    return true
  })
}

console.log('native picker controller check passed')
