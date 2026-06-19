export function createReaderNotesSessionRuntimeDeps(deps) {
  var globalObject = deps.globalObject;
  var runtimeContext = deps.runtimeContext;
  var bootstrapRuntime = deps.bootstrapRuntime;
  var domRefs = runtimeContext.domRefs;

  return {
    notesModule: globalObject.__notesModule,
    chunkNoteLayout: globalObject.__chunkNoteLayout,
    transcriptState: bootstrapRuntime.transcriptState,
    chunkState: bootstrapRuntime.chunkState,
    clozeState: bootstrapRuntime.clozeState,
    loadFromDB: bootstrapRuntime.loadFromDB,
    saveToDB: bootstrapRuntime.saveToDB,
    audioIdentityApi: bootstrapRuntime.audioIdentityApi,
    isPlainObjectRecord: bootstrapRuntime.runtimeDeps.isPlainObjectRecord,
    mainAppArea: domRefs.mainAppArea,
    chunkNoteSvgLayer: domRefs.chunkNoteSvgLayer,
    chunkNoteLayer: domRefs.chunkNoteLayer,
    chunkNoteCtxMenu: domRefs.chunkNoteCtxMenu,
    notePreviewSidebar: domRefs.notePreviewSidebar,
    notePreviewEmpty: domRefs.notePreviewEmpty,
    notePreviewList: domRefs.notePreviewList,
    toggleNotePreviewBtn: domRefs.toggleNotePreviewBtn,
    notePreviewResizeHandle: domRefs.notePreviewResizeHandle,
    notePreviewResizeHandleY: domRefs.notePreviewResizeHandleY
  };
}
