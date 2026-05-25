(function attachChunkNoteLayoutCore(global) {
  function normalizeChunkNoteLayoutResult(baseResult, extras) {
    return {
      ...baseResult,
      valid: !!baseResult.fits,
      padX: extras.padX,
      padY: extras.padY,
      maxTextW: extras.maxTextW,
      maxTextH: extras.maxTextH
    };
  }

  function buildEmptyChunkNoteLayoutResult(preferredFs, extras) {
    return normalizeChunkNoteLayoutResult({
      fontSize: preferredFs,
      lineHeight: Math.max(12, Math.round(preferredFs * 1.24)),
      lines: [''],
      fits: true
    }, extras);
  }

  function buildChunkNoteLayoutResult(best, extras) {
    return normalizeChunkNoteLayoutResult(best, extras);
  }

  global.ChunkNoteLayoutCore = {
    normalizeChunkNoteLayoutResult,
    buildEmptyChunkNoteLayoutResult,
    buildChunkNoteLayoutResult
  };
})(window);
