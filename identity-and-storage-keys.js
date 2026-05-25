(function attachIdentityStorageKeys(global) {
  function buildAudioKey(meta) {
    const name = (meta && meta.name) ? meta.name : 'audio';
    const size = (meta && Number.isFinite(meta.size)) ? meta.size : 0;
    const modified = (meta && Number.isFinite(meta.lastModified)) ? meta.lastModified : 0;
    return `${name}__${size}__${modified}`;
  }

  function buildTranscriptKey(data, segmentsFallback) {
    const segs = Array.isArray(data) ? data : ((data && Array.isArray(data.segments)) ? data.segments : segmentsFallback);
    const safeSegments = Array.isArray(segs) ? segs : [];
    const flatWords = safeSegments.flatMap(seg => Array.isArray(seg && seg.words) ? seg.words : []);
    const firstWord = flatWords[0] || {};
    const lastWord = flatWords[flatWords.length - 1] || {};
    const firstSeg = safeSegments[0] || {};
    const lastSeg = safeSegments[safeSegments.length - 1] || {};
    const textSeed = [
      firstSeg.text || '',
      lastSeg.text || '',
      firstWord.word || '',
      lastWord.word || ''
    ].join('|');
    let hash = 0;
    for (let i = 0; i < textSeed.length; i++) {
      hash = ((hash << 5) - hash) + textSeed.charCodeAt(i);
      hash |= 0;
    }
    return [
      safeSegments.length,
      flatWords.length,
      Number(firstWord.start ?? firstSeg.start ?? 0).toFixed(3),
      Number(lastWord.end ?? lastSeg.end ?? 0).toFixed(3),
      Math.abs(hash)
    ].join('__');
  }

  function getChunkNotesStorageKey(currentAudioKey) {
    return `chunkNotes::${currentAudioKey || 'default-audio'}`;
  }

  function getChunkNoteDraftStorageKey(currentAudioKey) {
    return `chunkNoteDraft::${currentAudioKey || 'default-audio'}`;
  }

  function getSentenceNotesStorageKey() {
    return 'allSentenceNotesByDoc';
  }

  function getLegacySentenceNotesStorageKey(audioKey) {
    return `sentenceNotes::${audioKey || 'default-audio'}`;
  }

  function buildCurrentSentenceDocId(transcriptSource, currentAudioKey, segmentsFallback) {
    const audioScope = currentAudioKey || 'default-audio';
    const transcriptScope = buildTranscriptKey(transcriptSource, segmentsFallback);
    return `${audioScope}::${transcriptScope}`;
  }

  global.IdentityStorageKeys = {
    buildAudioKey,
    buildTranscriptKey,
    buildCurrentSentenceDocId,
    getChunkNotesStorageKey,
    getChunkNoteDraftStorageKey,
    getSentenceNotesStorageKey,
    getLegacySentenceNotesStorageKey
  };
})(window);
