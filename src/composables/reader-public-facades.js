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

export function buildCurrentSentenceDocId() {
  return callPublicApi('buildCurrentSentenceDocId', arguments);
}

export function applyCurrentAudioMeta() {
  return callPublicApi('applyCurrentAudioMeta', arguments);
}

function installReaderPublicFacades() {
  window.buildCurrentSentenceDocId = buildCurrentSentenceDocId;
  window.applyCurrentAudioMeta = applyCurrentAudioMeta;
}

installReaderPublicFacades();
