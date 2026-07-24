export function buildAudioKey(meta) {
  const source = String((meta && meta.source) || '').trim();
  const jobId = String((meta && meta.jobId) || '').trim();
  if (source === 'youtube-workflow' && jobId) return `youtube-workflow::${jobId}`;
  const name = (meta && meta.name) ? meta.name : 'audio';
  const size = (meta && Number.isFinite(meta.size)) ? meta.size : 0;
  const modified = (meta && Number.isFinite(meta.lastModified)) ? meta.lastModified : 0;
  return `${name}__${size}__${modified}`;
}

export function buildTranscriptKey(data, segmentsFallback) {
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

export function getChunkNotesStorageKey(currentAudioKey) {
  return `chunkNotes::${currentAudioKey || 'default-audio'}`;
}

export function getChunkNoteDraftStorageKey(currentAudioKey) {
  return `chunkNoteDraft::${currentAudioKey || 'default-audio'}`;
}

export function getSentenceNotesStorageKey() {
  return 'allSentenceNotesByDoc';
}

export function getLegacySentenceNotesStorageKey(audioKey) {
  return `sentenceNotes::${audioKey || 'default-audio'}`;
}

export function buildCurrentSentenceDocId(transcriptSource, currentAudioKey, segmentsFallback) {
  const audioScope = currentAudioKey || 'default-audio';
  const transcriptScope = buildTranscriptKey(transcriptSource, segmentsFallback);
  return `${audioScope}::${transcriptScope}`;
}

window.IdentityStorageKeys = { buildAudioKey, buildTranscriptKey, getChunkNotesStorageKey, getChunkNoteDraftStorageKey, getSentenceNotesStorageKey, getLegacySentenceNotesStorageKey, buildCurrentSentenceDocId };
