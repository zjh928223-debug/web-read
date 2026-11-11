import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const source = (await fs.readFile(new URL('../src/pinia-stores/ui.js', import.meta.url), 'utf8'))
  .replace("import { defineStore } from 'pinia'", 'const defineStore = (_name, setup) => setup')
  .replace("import { ref } from 'vue'", 'const ref = value => ({ value })')
// Control time without changing process-wide timers or the store's public API.
const clock = `
let now = 0, sequence = 0;
const pending = new Map();
const setTimeout = (run, delay) => { const id = ++sequence; pending.set(id, { at: now + delay, run }); return id; };
const clearTimeout = id => pending.delete(id);
export function advance(delay) {
  const end = now + delay;
  for (;;) {
    const next = [...pending].sort((a,b) => a[1].at - b[1].at)[0];
    if (!next || next[1].at > end) break;
    now = next[1].at; pending.delete(next[0]); next[1].run();
  }
  now = end;
}
`
const api = await import(`data:text/javascript;base64,${Buffer.from(clock + source).toString('base64')}`)
const ui = api.useUiStore()

ui.showToast('Read this message')
api.advance(5999)
assert.equal(ui.toastVisible.value, true)
assert.equal(ui.toastFading.value, false)
api.advance(301)
assert.equal(ui.toastFading.value, true)
ui.holdToast('hover')
assert.equal(ui.toastFading.value, false, 'entering during fade must restore the message')
api.advance(20000)
assert.equal(ui.toastVisible.value, true, 'hover must hold the message')
ui.holdToast('selection')
ui.releaseToast('hover')
api.advance(20000)
assert.equal(ui.toastVisible.value, true, 'a text selection must survive pointer exit')
ui.releaseToast('selection')
api.advance(6700)
assert.equal(ui.toastVisible.value, false)

let actionRuns = 0
ui.showToast('Open failed', 'error', undefined, {
  source: 'material-load', action: { label: 'View details', run: () => actionRuns++ },
})
api.advance(7999)
assert.equal(ui.toastFading.value, false, 'errors should remain readable for eight seconds')
api.advance(301)
assert.equal(ui.toastFading.value, true)
ui.toastAction.value.run()
assert.equal(actionRuns, 1)
ui.showToast('Replacement')
assert.equal(ui.toastMessage.value, 'Replacement')
assert.equal(ui.toastFading.value, false, 'a new message must replace a fading one immediately')
assert.equal(ui.toastAction.value, null, 'an old failure action must not leak to a new message')
ui.holdToast('focus')
ui.holdToast('hover')
ui.releaseToast('hover')
api.advance(20000)
assert.equal(ui.toastVisible.value, true, 'keyboard focus must hold the message independently')
ui.dismissToast()
assert.equal(ui.toastVisible.value, false)
assert.equal(ui.toastPaused.value, false)
console.log('Reader notice timing checks passed (duration, interruptible fade, hover, selection, focus, replacement, action).')
