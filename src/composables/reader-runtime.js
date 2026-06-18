// === ES Module imports: utility modules that set window globals ===
import '../utils/data-utils.js';
import '../utils/identity-storage-keys.js';
import '../utils/import-export-helpers.js';
import '../utils/sentence-notes-persistence.js';
import '../utils/cloze-utils.js';
import '../utils/cloze-view-model.js';
import '../utils/playback-index.js';
import '../utils/chunk-matching.js';
import '../utils/vocab-matching.js';
import '../utils/chunk-note-layout-helpers.js';
import '../utils/chunk-note-layout-core.js';
import './transcript-state.js';
import './chunk-state.js';
import './cloze-state.js';
import './playback-state.js';
import './render-mode.js';
import './annotation-lightweight-module.js';
import { initReaderRuntimeShell } from './reader-runtime-shell.js';

// === Read-order map ===
// 1) Data layer: validation, identity, storage keys, persistence helpers
// 2) UI layer: DOM bindings, runtime state, startup wiring
// 3) Feature layer: import handlers, matching, rendering, interactions
// 4) Input layer: keyboard/mouse/global listeners (kept behavior-intact)

initReaderRuntimeShell({
  getWindow: function () { return window; },
  getDocument: function () { return document; }
});
