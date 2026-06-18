import { collectReaderDomRefs } from './reader-dom-refs.js';
import { initReaderBootstrapRuntime } from './reader-bootstrap-runtime.js';
import {
  createReaderFocusRestorer,
  createCurrentNoteToggler,
  createChunkNoteTransferDialogAccess
} from './reader-runtime-helpers.js';

export function initReaderRuntimeContext(deps = {}) {
  var getWindow = typeof deps.getWindow === 'function' ? deps.getWindow : function () { return globalThis; };
  var getDocument = typeof deps.getDocument === 'function' ? deps.getDocument : function () {
    return getWindow().document;
  };

  var bootstrapRuntime = initReaderBootstrapRuntime({
    getWindow: getWindow
  });
  var domRefs = collectReaderDomRefs(getDocument());
  var chunkNoteTransferApi = null;

  var restoreReaderFocus = createReaderFocusRestorer({
    getDocument: getDocument,
    getFocusTarget: function () { return domRefs.mainAppArea; }
  });
  var toggleCurrentNote = createCurrentNoteToggler({
    chunkState: bootstrapRuntime.chunkState,
    transcriptState: bootstrapRuntime.transcriptState,
    playbackState: bootstrapRuntime.playbackState,
    getDocument: getDocument
  });
  var chunkNoteTransferDialogAccess = createChunkNoteTransferDialogAccess({
    getTransferApi: function () { return chunkNoteTransferApi; }
  });

  return {
    bootstrapRuntime: bootstrapRuntime,
    domRefs: domRefs,
    restoreReaderFocus: restoreReaderFocus,
    toggleCurrentNote: toggleCurrentNote,
    closeChunkNoteExportDialog: chunkNoteTransferDialogAccess.closeChunkNoteExportDialog,
    getChunkNoteExportDialogEl: chunkNoteTransferDialogAccess.getChunkNoteExportDialogEl,
    setChunkNoteTransferApi: function (api) {
      chunkNoteTransferApi = api;
    },
    getChunkNoteTransferApi: function () {
      return chunkNoteTransferApi;
    }
  };
}
