import { initSessionRuntimeAssembly } from './session-runtime-assembly.js';

initSessionRuntimeAssembly({
  getWindow: function () { return window; },
  getDocument: function () { return document; }
});
