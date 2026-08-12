import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const moduleSource = readFileSync(
  new URL('../src/services/runtime/lifecycle-scope.js', import.meta.url),
  'utf8',
)
const { createLifecycleScope } = await import(
  `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`
)

const events = []
const scope = createLifecycleScope()
scope.add(() => events.push('first'))
scope.add(() => events.push('second'))
scope.dispose()
assert.deepEqual(events, ['second', 'first'])
scope.dispose()
assert.deepEqual(events, ['second', 'first'])
assert.throws(() => scope.add(() => {}), { code: 'LIFECYCLE_SCOPE_DISPOSED' })

const resources = []
const scheduler = createScheduler(resources)
const resourceScope = createLifecycleScope({
  clearInterval: scheduler.clearInterval,
  clearTimeout: scheduler.clearTimeout,
  cancelAnimationFrame: scheduler.cancelAnimationFrame,
  revokeObjectURL(url) { resources.push(`revoke:${url}`) },
})
const target = createEventTarget(resources)
const listener = () => {}
const controller = resourceScope.listen(target, 'change', listener, { capture: true })
assert.equal(controller.signal.aborted, false)
resourceScope.timeout(scheduler.setTimeout(() => {}, 10))
resourceScope.interval(scheduler.setInterval(() => {}, 10))
resourceScope.animationFrame(scheduler.requestAnimationFrame(() => {}))
resourceScope.observe({ disconnect() { resources.push('disconnect') } })
resourceScope.objectURL('blob:fixture')
resourceScope.add(() => {
  resources.push('failing-disposer')
  throw new Error('cleanup failure')
})
resourceScope.add(() => resources.push('last'))

assert.doesNotThrow(() => resourceScope.dispose())
assert.deepEqual(resources, [
  'listen:change:true',
  'last',
  'failing-disposer',
  'revoke:blob:fixture',
  'disconnect',
  'cancelAnimationFrame:3',
  'clearInterval:2',
  'clearTimeout:1',
  'abort:change',
])
assert.equal(controller.signal.aborted, true)
resourceScope.dispose()
assert.equal(resources.length, 9)

const fallbackEvents = []
const fallbackScope = createLifecycleScope()
fallbackScope.listen(createLegacyEventTarget(fallbackEvents), 'click', listener, { capture: true })
fallbackScope.dispose()
assert.deepEqual(fallbackEvents, ['add:click:true', 'remove:click:true'])

for (const register of [
  () => resourceScope.listen(target, 'change', listener),
  () => resourceScope.timeout(4),
  () => resourceScope.interval(5),
  () => resourceScope.animationFrame(6),
  () => resourceScope.observe({ disconnect() {} }),
  () => resourceScope.objectURL('blob:late'),
]) {
  assert.throws(register, { code: 'LIFECYCLE_SCOPE_DISPOSED' })
}

console.log('LifecycleScope checks passed.')

function createScheduler(events) {
  let sequence = 0
  return {
    setTimeout() { return ++sequence },
    setInterval() { return ++sequence },
    requestAnimationFrame() { return ++sequence },
    clearTimeout(id) { events.push(`clearTimeout:${id}`) },
    clearInterval(id) { events.push(`clearInterval:${id}`) },
    cancelAnimationFrame(id) { events.push(`cancelAnimationFrame:${id}`) },
  }
}

function createEventTarget(events) {
  return {
    addEventListener(type, _listener, options) {
      events.push(`listen:${type}:${options.capture}`)
      options.signal.addEventListener('abort', () => events.push(`abort:${type}`), { once: true })
    },
  }
}

function createLegacyEventTarget(events) {
  return {
    addEventListener(type, _listener, options) { events.push(`add:${type}:${options.capture}`) },
    removeEventListener(type, _listener, options) {
      const capture = typeof options === 'boolean' ? options : options.capture
      events.push(`remove:${type}:${capture}`)
    },
  }
}
