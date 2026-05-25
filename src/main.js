import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import '../styles.css'

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

console.log('[vue] Phase 7 — Pinia stores bridged to IIFE stores')

// Sync Pinia store state from IIFE store (app.js has already called init())
// Read current theme from localStorage to sync Pinia state
themeStore.init()

