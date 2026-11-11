import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

Error.stackTraceLimit = 0
globalThis.window = {}
const root = new URL('../src/composables/', import.meta.url)
const source = async (name) => readFile(new URL(name, root), 'utf8')
const load = async (text) => import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`)
const normalization = await source('session-annotation-import-normalization.js')
const merge = (await source('session-annotation-bundle-merge.js')).replace(/import\s+\{[\s\S]*?\}\s+from\s+'[^']+';/g, '')
const api = await load(normalization.replace(/\bexport\s+/g, '') + '\n' + merge)
globalThis.__ownershipMerge = api.buildManualLightweightImportedBundle
const io = await load((await source('session-annotation-lightweight-io.js'))
  .replace(/import\s+\{[\s\S]*?\}\s+from\s+'[^']+';/g, '')
  .replace('export function createSessionAnnotationLightweightIoRuntime', 'export function createSessionAnnotationLightweightIoRuntime')
  .replace('function requireLightweightIoFunction', 'const createObjectUrlDownloader = () => ({dispose(){}}); const buildManualLightweightImportedBundle = globalThis.__ownershipMerge; function requireLightweightIoFunction'))
const marks = new Map([[2, {globalIndex: 2, word: 'stable', sourceType: 'manual-mark', custom: 'preserve'}]])
let targets = [{id:'manual-mark-s-2-2',markedText:'stable',sentenceText:'It is really stable.',sentenceId:'s',occurrenceKey:'manual-mark::s::g:2-2',occurrenceGlobalStart:2,occurrenceGlobalEnd:2}]
let saved = null, writes = 0
const deps = {
  normalizeAnnotationTextValue: v => String(v || '').trim(),
  normalizeAnnotationSentenceValue: v => String(v || '').trim().toLowerCase(),
  getAnnotationTargetSentenceText: t => t.sentenceText,
  buildSyntheticAnnotationTargetFromEncodedId: (id, item) => ({id,markedText:item.markedText,sentenceText:item.sentence,occurrenceGlobalStart:1,occurrenceGlobalEnd:1}),
  buildAnnotationTargetCollection: () => ({context:{totalBlocks:1},targets}),
}
const scope = {audioKey:'isolated-ownership',documentId:'doc'}
const storage = {
  loadBundle: async () => ({generated:{items:[]},status:{blocks:{}}}),
  saveBundle: async (_scope, generated, status) => { writes++; saved={generated,status};return saved },
}
const runtime = io.createSessionAnnotationLightweightIoRuntime({
  ...deps, state:{markedMap:marks}, getAnnotationGenerationScope:()=>scope,
  getAnnotationGenerationStorage:()=>storage,
  refreshGeneratedAnnotationIndexForCurrentDocument:async()=>{},
  syncAnnotationGenerationEntryStatus:async o=>assert.notEqual(o.source,'edit'),
  rebuildMarksFromAnnotationItems:async()=>{throw Error('AI import must never rebuild user marks')},
})
const file = (items) => ({text:async()=>JSON.stringify({items})})
const valid = {targetId:'manual-mark-s-2-2',markedText:'stable',sourceSentence:'It is really stable.',boundary:'really stable',meaning:'很稳定',memoryHint:'提示'}
const before = [...marks].map(([k,v])=>[k,{...v}])
for (const options of [{}, {replaceExisting:false}, {replaceExisting:true}]) {
  await runtime.importManualLightweightAnnotations(file([valid]),options)
  assert.deepEqual([...marks],before)
}
assert.equal(saved.generated.items[0].occurrenceGlobalStart,2)
// Unknown/stale ranges may never create targets or resurrect an unmarked word.
const unknown = {targetId:'manual-mark-s-1-1',markedText:'really',sourceSentence:'It is really stable.',meaning:'确实'}
await assert.rejects(()=>runtime.importManualLightweightAnnotations(file([unknown])),/target|标注/)
await assert.rejects(()=>runtime.importManualLightweightAnnotations(file([{...valid,markedText:'Source'}])),/target|标注/)
await assert.rejects(()=>runtime.importManualLightweightAnnotations(file([{...valid,sourceSentence:'A different article.'}])),/target|标注/)
assert.deepEqual([...marks],before)
// Old cached coordinates cannot replace the current target's real position.
storage.loadBundle = async () => ({generated:{items:[{...valid,occurrenceGlobalStart:0,occurrenceGlobalEnd:0,occurrenceKey:'stale'}]},status:{blocks:{}}})
await runtime.importManualLightweightAnnotations(file([valid]))
assert.equal(saved.generated.items[0].occurrenceGlobalStart,2)
assert.equal(saved.generated.items[0].occurrenceKey,'manual-mark::s::g:2-2')
targets=[];marks.clear()
const previousWrites=writes
await assert.rejects(()=>runtime.importManualLightweightAnnotations(file([valid])),/target|标注/)
assert.equal(marks.size,0)
assert.equal(writes,previousWrites)
console.log('annotation marks ownership check passed')
