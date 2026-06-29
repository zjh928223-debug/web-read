import { collectReaderDomRefs } from './reader-dom-refs.js';
import { initReaderBootstrapRuntime } from './reader-bootstrap-runtime.js';
import { createReaderFocusRestorer } from './reader-runtime-helpers.js';

export function initReaderRuntimeContext(deps = {}) {
  var getWindow = typeof deps.getWindow === 'function' ? deps.getWindow : function () { return globalThis; };
  var getDocument = typeof deps.getDocument === 'function' ? deps.getDocument : function () {
    return getWindow().document;
  };

  var bootstrapRuntime = initReaderBootstrapRuntime({
    getWindow: getWindow
  });
  var domRefs = collectReaderDomRefs(getDocument());

  var restoreReaderFocus = createReaderFocusRestorer({
    getDocument: getDocument,
    getFocusTarget: function () { return domRefs.mainAppArea; }
  });

  return {
    bootstrapRuntime: bootstrapRuntime,
    domRefs: domRefs,
    restoreReaderFocus: restoreReaderFocus
  };
}
