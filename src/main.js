import { createApp, watch } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

// === Phase 10: Import all utility + annotation ES modules (replaces IIFE <script> tags) ===
// Side-effect imports — they also set window globals for app.js compatibility
import './utils/data-utils.js'
import './utils/identity-storage-keys.js'
import './utils/import-export-helpers.js'
import './utils/sentence-notes-persistence.js'
import './utils/cloze-utils.js'
import './utils/cloze-view-model.js'
import './utils/playback-index.js'
import './utils/chunk-matching.js'
import './utils/vocab-matching.js'
import './composables/transcript-state.js'
import './composables/chunk-state.js'
import './composables/cloze-state.js'
import './services/annotation/target-source.js'
import './services/annotation/diagnostics.js'
import './services/annotation/diagnostics-records.js'
import './services/annotation/run-diagnostics.js'
import './services/annotation/diff.js'
import './services/annotation/progress-store.js'
import './services/annotation/result-store.js'
import './services/annotation/click-resolver.js'
import './services/annotation/api-config.js'
import './services/annotation/storage.js'
import './services/annotation/prompt-builder.js'
import './services/annotation/block-planner.js'
import './services/annotation/api-client.js'
import './services/annotation/controller.js'

// === Import all Pinia stores ===
import { useThemeStore } from './pinia-stores/theme.js'
import { useUiStore } from './pinia-stores/ui.js'
import { useAudioStore } from './pinia-stores/audio.js'
import { useMarksStore } from './pinia-stores/marks.js'
import { useClozeStore } from './pinia-stores/cloze.js'
import { useTranscriptStore } from './pinia-stores/transcript.js'
import { useChunkStore } from './pinia-stores/chunk.js'
import { useNotesStore } from './pinia-stores/notes.js'
import { useAnnotationStore } from './pinia-stores/annotation.js'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.mount('#vue-root')

// === Bridge: Pinia stores → window.__xxxStore (for app.js compatibility) ===
// After Pinia stores are created, they become the source of truth.
// The IIFE stores (loaded before app.js) now delegate to Pinia.

const themeStore = useThemeStore()
const uiStore = useUiStore()
const audioStore = useAudioStore()
const marksStore = useMarksStore()
const clozeStore = useClozeStore()
const transcriptStore = useTranscriptStore()
const chunkStore = useChunkStore()
const notesStore = useNotesStore()
const annotationStore = useAnnotationStore()

// Bridge theme — replace IIFE store methods with Pinia delegation
if (window.__themeStore) {
  var origTheme = window.__themeStore
  origTheme.applyMode = function (theme, persist) { return themeStore.applyMode(theme, persist) }
  origTheme.applyCustom = function (colors, persist) { return themeStore.applyCustom(colors, persist) }
  origTheme.init = function () { return themeStore.init() }
  origTheme.getStoredCustomThemeColors = function () { return themeStore.getStoredCustomThemeColors() }
  origTheme.openCustomThemePanel = function () { return themeStore.openCustomPanel() }
  origTheme.closeCustomThemePanel = function () { return themeStore.closeCustomPanel() }
  // Keep CUSTOM_THEME_DEFAULTS accessible
  origTheme.CUSTOM_THEME_DEFAULTS = themeStore.CUSTOM_THEME_DEFAULTS
}

// Bridge UI — replace showToast/showError AND window.showToast for Vue component
if (window.__uiStore) {
  var origUi = window.__uiStore
  origUi.showToast = function (msg, type, timeoutMs) { return uiStore.showToast(msg, type, timeoutMs) }
  origUi.showError = function (code, detail) { return uiStore.showError(code, detail) }
  // Also bridge window.showToast so Vue ToastMessage component receives calls
  window.showToast = function (msg, type, timeoutMs) { return uiStore.showToast(msg, type, timeoutMs) }
  window.showError = function (code, detail) { return uiStore.showError(code, detail) }
}

// Bridge Audio — replace DB ops
if (window.__audioStore) {
  var origAudio = window.__audioStore
  origAudio.initDB = function () { return audioStore.initDB() }
  origAudio.saveToDB = function (id, data) { return audioStore.saveToDB(id, data) }
  origAudio.loadFromDB = function (id) { return audioStore.loadFromDB(id) }
  origAudio.deleteFromDB = function (id) { return audioStore.deleteFromDB(id) }
  origAudio.clearDBStore = function () { return audioStore.clearDBStore() }
  origAudio.getDb = function () { return audioStore.getDb() }
}

// Bridge Marks
if (window.__marksStore) {
  var origMarks = window.__marksStore
  origMarks.toggleMark = function (mm, cwi, w, sdb, saf) { return marksStore.toggle(mm, cwi, w, sdb, saf) }
  origMarks.syncMarkedWordVisual = function (gi, im) { return marksStore.syncVisual(gi, im) }
  origMarks.exportMarksToArray = function (mm) { return marksStore.exportToArray(mm) }
}

// Expose Pinia stores for Vue component access
window.__piniaStores = {
  theme: themeStore, ui: uiStore, audio: audioStore, marks: marksStore,
  cloze: clozeStore, transcript: transcriptStore, chunk: chunkStore,
  notes: notesStore, annotation: annotationStore
}

// Phase 8: Read from __bridge (app.js writes data here before main.js runs)
// This syncs the initial data loaded during startup restore
if (window.__bridge && window.__bridge.transcript) {
  var t = window.__bridge.transcript
  transcriptStore.segments = t.segments || []
  transcriptStore.words = t.words || []
  transcriptStore.wordStarts = t.wordStarts || []
  transcriptStore.highlightMode = t.highlightMode == null ? 2 : t.highlightMode
}
if (window.__transcriptState && typeof window.__transcriptState.bindPiniaStore === 'function') {
  window.__transcriptState.bindPiniaStore(transcriptStore, { preferStore: true })
}
if (window.__bridge && window.__bridge.chunkItems) {
  chunkStore.chunkItems = window.__bridge.chunkItems || []
  chunkStore.isChunkMode = window.__bridge.isChunkMode || false
  chunkStore.hasAiChunkData = window.__bridge.hasAiChunkData || false
  chunkStore.chunkCNVisible = window.__bridge.chunkCNVisible === true
  chunkStore.chunkCNHoldMode = window.__bridge.chunkCNHoldMode !== false
  chunkStore.chunkFocusMode = window.__bridge.chunkFocusMode !== false
  chunkStore.chunkShadowVisible = window.__bridge.chunkShadowVisible !== false
}
if (window.__chunkState && typeof window.__chunkState.bindPiniaStore === 'function') {
  window.__chunkState.bindPiniaStore(chunkStore, { preferStore: true })
}
if (window.__bridge && window.__bridge.clozeItems) {
  clozeStore.items = window.__bridge.clozeItems || []
  clozeStore.hasData = window.__bridge.hasClozeData || false
  clozeStore.answerState = window.__bridge.clozeAnswerState || []
}
if (window.__clozeState && typeof window.__clozeState.bindPiniaStore === 'function') {
  window.__clozeState.bindPiniaStore(clozeStore, { preferStore: true })
}

console.log('[vue] Phase 8 — bridge data synced to Pinia')

// Sync reactive rendering flag — Pinia ref drives window.__USE_VUE_RENDERING
// Also show/hide old vs Vue containers
transcriptStore.useVueRendering = window.__USE_VUE_RENDERING || false
function applyRenderMode(val) {
  window.__USE_VUE_RENDERING = val
  var oldContainer = document.getElementById('transcript-container')
  if (oldContainer) {
    oldContainer.style.display = val ? 'none' : ''
  }
}
applyRenderMode(transcriptStore.useVueRendering)
watch(function () { return transcriptStore.useVueRendering }, function (val) {
  applyRenderMode(val)
})

// Sync Pinia store state from IIFE store (app.js has already called init())
// Read current theme from localStorage to sync Pinia state
themeStore.init()
