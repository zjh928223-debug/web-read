import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const source = await fs.readFile(new URL('../src/services/runtime/dialog-controller.js', import.meta.url), 'utf8')
const { createDialogController, createPendingActionGuard } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

const documentObject = createDocument()
const outside = element('outside')
const first = element('first')
const last = element('last')
const root = element('dialog', [first, last])
const status = element('status')
documentObject.activeElement = outside
let closeRequests = 0
let pending = false
const controller = createDialogController({ documentObject })

controller.open(root, {
  initialFocus: first,
  statusElement: status,
  isPending: () => pending,
  onRequestClose: () => { closeRequests += 1 },
})
await Promise.resolve()
assert.equal(root.attributes.get('role'), 'dialog')
assert.equal(root.attributes.get('aria-modal'), 'true')
assert.equal(status.attributes.get('role'), 'status')
assert.equal(status.attributes.get('aria-live'), 'polite')
assert.equal(documentObject.activeElement, first)

documentObject.dispatch(keyEvent('Tab', { shiftKey: true }))
assert.equal(documentObject.activeElement, last, 'Shift+Tab from first must wrap to last')
documentObject.dispatch(keyEvent('Tab'))
assert.equal(documentObject.activeElement, first, 'Tab from last must wrap to first')

pending = true
controller.setBusy(true)
documentObject.dispatch(keyEvent('Escape'))
assert.equal(closeRequests, 0, 'pending dialog must ignore Escape')
assert.equal(root.attributes.get('aria-busy'), 'true')

pending = false
controller.setBusy(false)
documentObject.dispatch(keyEvent('Escape'))
assert.equal(closeRequests, 1)
controller.close()
await Promise.resolve()
assert.equal(documentObject.activeElement, outside, 'close must restore prior focus')

const childFirst = element('child-first')
const childRoot = element('child-dialog', [childFirst])
let parentCloseRequests = 0
let childCloseRequests = 0
controller.open(root, { initialFocus: first, onRequestClose: () => { parentCloseRequests += 1 } })
await Promise.resolve()
const childController = createDialogController({ documentObject })
childController.open(childRoot, { initialFocus: childFirst, onRequestClose: () => { childCloseRequests += 1 } })
await Promise.resolve()
documentObject.dispatch(keyEvent('Escape'))
assert.equal(childCloseRequests, 1, 'Escape must be owned by the topmost nested dialog')
assert.equal(parentCloseRequests, 0, 'parent dialog must not also handle nested Escape')
childController.close()
await Promise.resolve()
assert.equal(documentObject.activeElement, first, 'closing nested dialog must restore focus inside its parent')
controller.close()
await Promise.resolve()
assert.equal(documentObject.activeElement, outside)

controller.open(root, { initialFocus: first, onRequestClose: () => {} })
await Promise.resolve()
controller.dispose()
await Promise.resolve()
assert.equal(documentObject.listenerCount(), 0, 'dispose must remove keyboard ownership')
assert.equal(documentObject.activeElement, outside, 'dispose must restore focus')

const pendingChanges = []
let resolveAction
let actionCalls = 0
const actionGuard = createPendingActionGuard({ onChange: (value) => pendingChanges.push(value) })
const firstRun = actionGuard.run(() => {
  actionCalls += 1
  return new Promise((resolve) => { resolveAction = resolve })
})
assert.deepEqual(await actionGuard.run(() => { actionCalls += 1 }), { status: 'ignored' })
assert.equal(actionCalls, 1, 'rapid duplicate actions must execute once')
resolveAction('done')
assert.deepEqual(await firstRun, { status: 'completed', value: 'done' })
assert.deepEqual(pendingChanges, [true, false])
actionGuard.dispose()
assert.deepEqual(await actionGuard.run(() => { actionCalls += 1 }), { status: 'ignored' })

console.log('dialog controller check passed')

function element(name, focusables = []) {
  return {
    name,
    disabled: false,
    attributes: new Map(),
    setAttribute(key, value) { this.attributes.set(key, String(value)) },
    removeAttribute(key) { this.attributes.delete(key) },
    contains(target) { return target === this || focusables.includes(target) },
    querySelectorAll() { return focusables },
    focus() { documentObject.activeElement = this },
  }
}

function keyEvent(key, options = {}) {
  return {
    key,
    shiftKey: !!options.shiftKey,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true },
    stopPropagation() {},
  }
}

function createDocument() {
  const listeners = new Set()
  return {
    activeElement: null,
    addEventListener(type, listener) { if (type === 'keydown') listeners.add(listener) },
    removeEventListener(type, listener) { if (type === 'keydown') listeners.delete(listener) },
    dispatch(event) { for (const listener of [...listeners]) listener(event) },
    listenerCount() { return listeners.size },
  }
}
