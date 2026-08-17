import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { flushPendingUiNotifications } from './composables/ui-facades.js'

// === Phase 10: Import all utility + annotation ES modules (replaces IIFE <script> tags) ===
// Side-effect imports — they also set window globals for app.js compatibility
import './utils/data-utils.js'
import './utils/identity-storage-keys.js'
import './utils/import-export-helpers.js'
import './utils/playback-index.js'
import './utils/chunk-matching.js'
import './utils/vocab-matching.js'
import './composables/transcript-state.js'
import './composables/chunk-state.js'
import './composables/cloze-state.js'
import './composables/playback-state.js'
import './composables/file-input-bindings.js'
import './composables/annotation-bubble.js'
import './services/annotation/target-source.js'
import './services/annotation/diagnostics.js'
import './services/annotation/result-store.js'
import './services/annotation/click-resolver.js'
import './services/annotation/storage.js'

// === Import all Pinia stores ===
import { useThemeStore } from './pinia-stores/theme.js'
import { useUiStore } from './pinia-stores/ui.js'
import { useAudioStore } from './pinia-stores/audio.js'
import { useMarksStore } from './pinia-stores/marks.js'
import { useClozeStore } from './pinia-stores/cloze.js'
import { useTranscriptStore } from './pinia-stores/transcript.js'
import { useChunkStore } from './pinia-stores/chunk.js'
import { useAnnotationStore } from './pinia-stores/annotation.js'
import { configurePiniaRuntimeStores } from './pinia-stores/runtime-registry.js'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)

const themeStore = useThemeStore(pinia)
const uiStore = useUiStore(pinia)
const audioStore = useAudioStore(pinia)
const marksStore = useMarksStore(pinia)
const clozeStore = useClozeStore(pinia)
const transcriptStore = useTranscriptStore(pinia)
const chunkStore = useChunkStore(pinia)
const annotationStore = useAnnotationStore(pinia)

configurePiniaRuntimeStores({
  theme: themeStore, ui: uiStore, audio: audioStore, marks: marksStore,
  cloze: clozeStore, transcript: transcriptStore, chunk: chunkStore,
  annotation: annotationStore
})

// Phase 8: adapters loaded before Pinia keep startup data until stores exist.
if (window.__transcriptState && typeof window.__transcriptState.bindPiniaStore === 'function') {
  window.__transcriptState.bindPiniaStore(transcriptStore)
}
if (window.__chunkState && typeof window.__chunkState.bindPiniaStore === 'function') {
  window.__chunkState.bindPiniaStore(chunkStore)
}
if (window.__clozeState && typeof window.__clozeState.bindPiniaStore === 'function') {
  window.__clozeState.bindPiniaStore(clozeStore)
}

console.log('[vue] runtime adapters bound to Pinia')

themeStore.init()

// Pinia is configured before the legacy reader/session assembly starts, so
// compatibility stores and global Pinia bridges are no longer required.
await import('./composables/reader-runtime.js')
await import('./composables/session-init.js')

app.mount('#vue-root')
flushPendingUiNotifications()

// Vue owns both reader views. Keep the legacy DOM shell only as a hidden
// compatibility anchor for runtime adapters that still need its element.
const oldContainer = document.getElementById('transcript-container')
if (oldContainer) {
  oldContainer.style.display = 'none'
}
