let publicApi = {};

function callPublicApi(name, args) {
  const fn = publicApi[name];
  if (typeof fn === 'function') {
    return fn.apply(null, args);
  }
}

export function configureReaderPublicFacades(api = {}) {
  publicApi = { ...publicApi, ...api };
  installReaderPublicFacades();
  return publicApi;
}

export function selectSentenceFromChunkTarget() {
  return callPublicApi('selectSentenceFromChunkTarget', arguments);
}

export function openChunkNoteContextFromEvent() {
  return callPublicApi('openChunkNoteContextFromEvent', arguments);
}

export function buildCurrentSentenceDocId() {
  return callPublicApi('buildCurrentSentenceDocId', arguments);
}

export function loadChunkNotesForCurrentAudio() {
  return callPublicApi('loadChunkNotesForCurrentAudio', arguments);
}

export function setChunkNoteVisible() {
  return callPublicApi('setChunkNoteVisible', arguments);
}

export function loadSentenceNotesForCurrentAudio() {
  return callPublicApi('loadSentenceNotesForCurrentAudio', arguments);
}

export function switchSentenceNotesDoc() {
  return callPublicApi('switchSentenceNotesDoc', arguments);
}

export function applyCurrentAudioMeta() {
  return callPublicApi('applyCurrentAudioMeta', arguments);
}

function installReaderPublicFacades() {
  window.selectSentenceFromChunkTarget = selectSentenceFromChunkTarget;
  window.openChunkNoteContextFromEvent = openChunkNoteContextFromEvent;
  window.buildCurrentSentenceDocId = buildCurrentSentenceDocId;
  window.loadChunkNotesForCurrentAudio = loadChunkNotesForCurrentAudio;
  window.setChunkNoteVisible = setChunkNoteVisible;
  window.loadSentenceNotesForCurrentAudio = loadSentenceNotesForCurrentAudio;
  window.switchSentenceNotesDoc = switchSentenceNotesDoc;
  window.applyCurrentAudioMeta = applyCurrentAudioMeta;
}

installReaderPublicFacades();
