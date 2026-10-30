import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-word-navigation-'))
try {
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}')
  for (const name of ['reader-word-navigation.js', 'reader-shortcut-scope.js', 'annotation-bubble-resolver.js']) {
    fs.copyFileSync(path.join(repo, 'src/composables', name), path.join(root, name))
  }
  fs.writeFileSync(path.join(root, 'annotation-bubble.js'), 'export const getAnnotationBubbleApi = () => globalThis.fixture.bubble')
  fs.writeFileSync(path.join(root, 'session-facades.js'), `
    export const emitAnnotationDebug = () => {};
    export const emitAnnotationDiagnostics = () => {};
    export const getAnnotationClickResolver = () => ({resolveClick: ({wordIndex}) => globalThis.fixture.hits.get(wordIndex)});
    export const getAnnotationGeneratedIndexScopeKey = () => globalThis.fixture.indexScope;
    export const getAnnotationGeneratedResultStore = () => ({getItems: () => globalThis.fixture.items});
    export const getAnnotationGenerationScope = () => ({});
    export const getAnnotationGenerationScopeKey = () => globalThis.fixture.scope;
    export const waitForGeneratedAnnotationIndex = () => globalThis.fixture.wait;
  `)
  const { createReaderWordNavigation } = await import(pathToFileURL(path.join(root, 'reader-word-navigation.js')))
  const { isReaderShortcutEventAllowed: allowed } = await import(pathToFileURL(path.join(root, 'reader-shortcut-scope.js')))
  const { initAnnotationBubbleResolver } = await import(pathToFileURL(path.join(root, 'annotation-bubble-resolver.js')))
  globalThis.window = globalThis
  let visible = false, content = '', closes = 0
  const hideListeners = new Set()
  const bubble = {
    init() {}, show() { visible = true }, isVisible() { return visible },
    hide() { const wasVisible = visible; visible = false; if (wasVisible) for (const cb of hideListeners) cb() },
    setAnnotation(annotation) { content = annotation.meaning },
    clearAnnotation() { content = '' }, setStatus(message) { content = message },
    onHide(callback) { hideListeners.add(callback); return () => hideListeners.delete(callback) },
  }
  const fixture = globalThis.fixture = { bubble, scope: 'doc-a', indexScope: 'doc-a', items: [], hits: new Map(), wait: Promise.resolve() }
  const marks = new Map([[1, {}], [4, {}]])
  const vocab = new Map([[3, { meaning: 'three' }], [5, { word: 'empty' }]])
  let words = Array.from({ length: 7 }, (_, i) => ({ word: `word${i}` }))
  const resolver = initAnnotationBubbleResolver({ getWords: () => words, markedMap: marks, vocabMatchMap: vocab, onClose: () => closes++ })
  fixture.items = [{ meaning: 'phrase', occurrenceGlobalStart: 2, occurrenceGlobalEnd: 3 }]
  assert.deepEqual(resolver.getNavigableWordIndices().sort(), [1, 2, 3, 4], 'union includes explained occurrences and manual marks, excludes unexplained matches')
  fixture.indexScope = 'old-doc'
  assert.deepEqual(resolver.getNavigableWordIndices().sort(), [1, 3, 4], 'old document generated items cannot enter navigation')
  fixture.indexScope = fixture.scope

  function target() {
    const listeners = new Map()
    return {
      addEventListener(type, cb) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(cb) },
      removeEventListener(type, cb) { listeners.get(type)?.delete(cb) },
      dispatch(type, event = {}) { for (const cb of listeners.get(type) || []) cb(event) },
      count() { return [...listeners.values()].reduce((n, list) => n + list.size, 0) },
    }
  }
  const elements = new Map([['annotation-navigation-status', { textContent: '' }]])
  for (const id of ['btn-prev-annotation-word', 'btn-next-annotation-word']) elements.set(id, target())
  const span = index => ({ dataset: { wordIndex: String(index) }, textContent: words[index].word, isConnected: true, scrollIntoView() {} })
  for (let i = 0; i < words.length; i++) for (const prefix of ['word-', 'chunk-word-']) elements.set(prefix + i, span(i))
  const doc = { ...target(), getElementById: id => elements.get(id), querySelectorAll: () => [] }
  const selectionStore = { selectedAnnotationWordIndex: -1, currentWordIndex: -1 }
  let chunk = false
  const nav = createReaderWordNavigation({ documentObject: doc, selectionStore, getWords: () => words,
    getPlaybackWordIndex: () => selectionStore.currentWordIndex, isChunkMode: () => chunk,
    getNavigableWordIndices: resolver.getNavigableWordIndices, notifyAnnotationBubbleWordClick: resolver.notifyAnnotationBubbleWordClick, closeBubble: bubble.hide,
  })
  assert.equal(nav.navigate(1), true); assert.equal(selectionStore.selectedAnnotationWordIndex, 1)
  assert.match(content, /word1：暂无释义/)
  nav.navigate(1); assert.equal(selectionStore.selectedAnnotationWordIndex, 2)
  nav.navigate(1); assert.equal(selectionStore.selectedAnnotationWordIndex, 3); assert.equal(content, 'three')
  doc.dispatch('pointerdown', { target: { closest: () => null } })
  assert.equal(visible, true, 'clicking blank space keeps the bubble open')
  assert.equal(content, 'three', 'clicking blank space retains the explanation')
  assert.equal(selectionStore.selectedAnnotationWordIndex, 3, 'clicking blank space retains the selected word')
  chunk = true; nav.navigate(1); assert.equal(selectionStore.selectedAnnotationWordIndex, 4)
  assert.equal(nav.navigate(1), false); assert.match(elements.get('annotation-navigation-status').textContent, /最后/)
  assert.equal(selectionStore.currentWordIndex, -1, 'annotation browsing never changes mark/playback input')
  nav.navigate(-1); nav.navigate(-1); nav.navigate(-1)
  assert.equal(nav.navigate(-1), false); assert.equal(selectionStore.selectedAnnotationWordIndex, 1)
  assert.match(elements.get('annotation-navigation-status').textContent, /第一个/)

  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(allowed({ target: { tagName } }, doc), false)
  assert.equal(allowed({ isComposing: true }, doc), false)
  assert.equal(allowed({ defaultPrevented: true }, doc), false)
  assert.equal(allowed({ target: { isContentEditable: true } }, doc), false)
  assert.equal(allowed({ key: ' ', target: { closest: () => ({}) } }, doc), false)
  assert.equal(allowed({ target: { tagName: 'BODY' } }, doc), true)
  const overlay = { getClientRects: () => [{}] }
  doc.querySelectorAll = () => [overlay]
  assert.equal(allowed({ target: { tagName: 'BODY' } }, doc), false)
  overlay.hidden = true
  assert.equal(allowed({ target: { tagName: 'BODY' } }, doc), true)

  const pending = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
  const drain = async promise => { await promise.catch(() => {}); await Promise.resolve(); await Promise.resolve() }
  marks.set(2, {}); marks.set(6, {})
  fixture.hits.set(1, { meaning: 'hover one' })
  fixture.hits.set(2, { meaning: 'hover phrase', boundary: 'word2 word3' })
  fixture.hits.set(6, { meaning: '   ', memoryHint: 'hint without meaning' })
  assert.equal(resolver.hasExplainedMarkedAnnotation(elements.get('word-1')), true, 'word audio can resolve explained marks while the bubble is closed')
  assert.equal(resolver.hasExplainedMarkedAnnotation(elements.get('word-6')), false, 'a hint alone cannot enable word audio')
  bubble.show()
  assert.equal(resolver.notifyAnnotationBubbleWordHover(elements.get('word-1')), true)
  assert.equal(content, 'hover one', 'visible bubble switches synchronously on an explained marked word')
  assert.equal(resolver.notifyAnnotationBubbleWordHover(elements.get('chunk-word-2')), true)
  assert.equal(content, 'hover phrase', 'AI chunks use the same phrase resolver')
  for (const index of [0, 3, 4, 5, 6]) {
    assert.equal(resolver.notifyAnnotationBubbleWordHover(elements.get('word-' + index)), false)
    assert.equal(content, 'hover phrase', 'unmarked or unexplained targets preserve the last explanation')
  }
  fixture.indexScope = 'old-document'
  assert.equal(resolver.notifyAnnotationBubbleWordHover(elements.get('word-1')), false)
  assert.equal(content, 'hover phrase', 'old document indices cannot replace current content')
  fixture.indexScope = fixture.scope
  fixture.hits.delete(1); fixture.indexScope = ''
  const hoverWait = pending(); fixture.wait = hoverWait.promise
  resolver.notifyAnnotationBubbleWordClick(elements.get('word-1'), { forceShow: true })
  fixture.indexScope = fixture.scope
  assert.equal(resolver.notifyAnnotationBubbleWordHover(elements.get('word-2')), true)
  fixture.hits.set(1, { meaning: 'late clicked explanation' })
  hoverWait.resolve(); await drain(hoverWait.promise)
  assert.equal(content, 'hover phrase', 'an old asynchronous click cannot overwrite a later hover')
  bubble.hide()
  const closesAfterHover = closes
  assert.equal(resolver.notifyAnnotationBubbleWordHover(elements.get('word-1')), false)
  assert.equal(visible, false, 'hover never opens a closed bubble')
  marks.delete(2); marks.delete(6); fixture.hits.clear()
  fixture.indexScope = ''
  let wait = pending(); fixture.wait = wait.promise
  resolver.notifyAnnotationBubbleWordClick(elements.get('word-1'), { forceShow: true })
  assert.match(content, /word1：正在读取/)
  resolver.notifyAnnotationBubbleWordClick(elements.get('word-3'), { forceShow: true, allowUnmarked: true })
  fixture.hits.set(1, { meaning: 'late A' }); fixture.indexScope = fixture.scope
  wait.resolve(); await drain(wait.promise)
  assert.equal(content, 'three', 'late A must not replace the current B')
  fixture.hits.clear(); fixture.indexScope = ''; wait = pending(); fixture.wait = wait.promise
  resolver.notifyAnnotationBubbleWordClick(elements.get('word-1'), { forceShow: true })
  nav.close(); assert.equal(selectionStore.selectedAnnotationWordIndex, -1)
  fixture.hits.set(1, { meaning: 'after close' }); fixture.indexScope = fixture.scope
  wait.resolve(); await drain(wait.promise)
  assert.equal(visible, false, 'closing invalidates pending requests instead of reopening the bubble')
  assert.equal(closes, closesAfterHover + 1)
  fixture.hits.clear(); fixture.indexScope = ''; wait = pending(); fixture.wait = wait.promise
  resolver.notifyAnnotationBubbleWordClick(elements.get('word-1'), { forceShow: true })
  fixture.scope = 'doc-b'; wait.resolve(); await drain(wait.promise)
  assert.notEqual(content, 'after close', 'scope changes reject old completion')
  resolver.clear(); fixture.indexScope = ''; wait = pending(); fixture.wait = wait.promise
  resolver.notifyAnnotationBubbleWordClick(elements.get('word-4'), { forceShow: true })
  wait.reject(new Error('fixture read error')); await drain(wait.promise)
  assert.match(content, /读取失败/)
  resolver.dispose(); resolver.dispose()
  assert.equal(hideListeners.size, 0)
  const before = content
  resolver.notifyAnnotationBubbleWordClick(elements.get('word-3'))
  assert.equal(content, before, 'disposed resolver cannot mutate UI')
  assert.equal(resolver.notifyAnnotationBubbleWordHover(elements.get('word-1')), false)
  marks.clear(); vocab.clear(); fixture.items = []; fixture.indexScope = fixture.scope
  assert.equal(nav.navigate(1), false); assert.match(elements.get('annotation-navigation-status').textContent, /暂无/)
  nav.dispose(); nav.dispose()
  assert.equal(doc.count(), 0); assert.equal(elements.get('btn-next-annotation-word').count(), 0)
  console.log('reader annotation navigation, scope, union and late-response contracts passed (isolated interfaces; historical audio mismatch NOT_VERIFIED)')
} finally {
  if (path.dirname(root) !== path.resolve(os.tmpdir())) throw new Error('unsafe temporary root')
  fs.rmSync(root, { recursive: true, force: true })
  delete globalThis.fixture
}
