export function initPiniaBridge(deps = {}) {
  var transcriptState = deps.transcriptState;
  var chunkState = deps.chunkState;
  var clozeState = deps.clozeState;

  function bridgeToPinia() {
    var ps = window.__piniaStores;
    var chunkSnapshot = chunkState.getSnapshot();
    var clozeSnapshot = clozeState.getSnapshot();
    if (ps) {
      if (ps.transcript) {
        ps.transcript.segments = transcriptState.segments;
        ps.transcript.words = transcriptState.words;
        ps.transcript.wordStarts = transcriptState.wordStarts;
        ps.transcript.highlightMode = transcriptState.highlightMode;
      }
      if (ps.chunk) {
        ps.chunk.chunkItems = chunkSnapshot.chunkItems;
        ps.chunk.isChunkMode = chunkSnapshot.isChunkMode;
        ps.chunk.hasAiChunkData = chunkSnapshot.hasAiChunkData;
        ps.chunk.chunkCNVisible = chunkSnapshot.chunkCnVisible;
        ps.chunk.chunkCNHoldMode = chunkSnapshot.chunkCnHoldMode;
        ps.chunk.chunkFocusMode = chunkSnapshot.chunkCnMode === 'focus';
        ps.chunk.chunkShadowVisible = chunkSnapshot.isChunkShadowOn;
      }
      if (ps.cloze) {
        ps.cloze.items = clozeSnapshot.clozeItems;
        ps.cloze.hasData = clozeSnapshot.hasClozeData;
        ps.cloze.answerState = clozeSnapshot.clozeAnswerState;
      }
    }
  }

  window.bridgeToPinia = bridgeToPinia;
  return bridgeToPinia;
}
