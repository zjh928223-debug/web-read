export function createReaderNotesSessionRuntimeDeps(deps) {
  var globalObject = deps.globalObject;
  var runtimeContext = deps.runtimeContext;
  var bootstrapRuntime = deps.bootstrapRuntime;
  var domRefs = runtimeContext.domRefs;

  return {
    transcriptState: bootstrapRuntime.transcriptState,
    chunkState: bootstrapRuntime.chunkState,
    clozeState: bootstrapRuntime.clozeState,
    loadFromDB: bootstrapRuntime.loadFromDB,
    saveToDB: bootstrapRuntime.saveToDB,
    audioIdentityApi: bootstrapRuntime.audioIdentityApi,
    isPlainObjectRecord: bootstrapRuntime.runtimeDeps.isPlainObjectRecord,
    mainAppArea: domRefs.mainAppArea
  };
}
