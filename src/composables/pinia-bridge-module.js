import { requirePiniaRuntimeStores } from '../pinia-stores/runtime-registry.js';

let activeSources = null;

export function bridgeToPinia() {
  if (!activeSources) return;
  var ps = requirePiniaRuntimeStores();
  var transcriptState = activeSources.transcriptState;
  var chunkState = activeSources.chunkState;
  var chunkSnapshot = chunkState.getSnapshot();
  ps.transcript.segments = transcriptState.segments;
  ps.transcript.words = transcriptState.words;
  ps.transcript.wordStarts = transcriptState.wordStarts;
  ps.transcript.highlightMode = transcriptState.highlightMode;
  ps.chunk.chunkItems = chunkSnapshot.chunkItems;
  ps.chunk.isChunkMode = chunkSnapshot.isChunkMode;
  ps.chunk.hasAiChunkData = chunkSnapshot.hasAiChunkData;
  ps.chunk.chunkCNVisible = chunkSnapshot.chunkCnVisible;
  ps.chunk.chunkCNHoldMode = chunkSnapshot.chunkCnHoldMode;
  ps.chunk.chunkFocusMode = chunkSnapshot.chunkCnMode === 'focus';
  ps.chunk.chunkShadowVisible = chunkSnapshot.isChunkShadowOn;
}

export function initPiniaBridge(deps = {}) {
  activeSources = Object.freeze({
    transcriptState: deps.transcriptState,
    chunkState: deps.chunkState
  });
  return bridgeToPinia;
}
