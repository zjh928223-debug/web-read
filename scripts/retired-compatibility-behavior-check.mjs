import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/composables/session-facades.js', import.meta.url), 'utf8')
const executable = source
  .replace('export function configureSessionFacades', 'function configureSessionFacades')
  .replace(/^export function /gm, 'function ')
  .replace(/^export const /gm, 'const ')
  .replace(/^export default .*$/gm, '')
  .concat('\nexport { configureSessionFacades, clearGeneratedAnnotationIndex, clearPersistedChunkSession, getAnnotationGenerationScope, getAnnotationGenerationScopeKey, getAnnotationGeneratedIndexScopeKey, scheduleGeneratedAnnotationIndexRefresh, syncAnnotationGenerationEntryStatus };')

const module = await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}#${Date.now()}`)
const calls = []
const windowObject = { localStorage: { getItem() { return null } } }
module.configureSessionFacades({
  windowObject,
  getRuntimeState: () => ({ annotationGeneratedIndexScopeKey: 'scope-key' }),
  clearGeneratedAnnotationIndex: () => calls.push('clear-generated'),
  clearPersistedChunkSession: () => { calls.push('clear-session'); return Promise.resolve('cleared') },
  getAnnotationGenerationScope: () => ({ audioKey: 'audio', documentId: 'document' }),
  scheduleGeneratedAnnotationIndexRefresh: () => { calls.push('schedule-refresh'); return Promise.resolve('scheduled') },
  syncAnnotationGenerationEntryStatus: () => calls.push('sync-status'),
})

windowObject.clearGeneratedAnnotationIndex()
assert.equal(await windowObject.clearPersistedChunkSession(), 'cleared')
assert.deepEqual(windowObject.getAnnotationGenerationScope(), { audioKey: 'audio', documentId: 'document' })
assert.equal(module.getAnnotationGenerationScopeKey(), 'audio::document')
assert.equal(module.getAnnotationGeneratedIndexScopeKey(), 'scope-key')
assert.equal(await windowObject.scheduleGeneratedAnnotationIndexRefresh(), 'scheduled')
windowObject.syncAnnotationGenerationEntryStatus()
assert.deepEqual(calls, ['clear-generated', 'clear-session', 'schedule-refresh', 'sync-status'])

for (const retiredName of [
  'loadChunkNotesForCurrentAudio',
  'loadSentenceNotesForCurrentAudio',
  'switchSentenceNotesDoc',
  'setChunkNoteVisible',
  'chunkNotesApi',
  'sentenceNotesApi',
]) {
  assert.equal(Object.prototype.hasOwnProperty.call(windowObject, retiredName), false, `${retiredName} must not be reintroduced`)
}
console.log('retired compatibility behavior check passed')
