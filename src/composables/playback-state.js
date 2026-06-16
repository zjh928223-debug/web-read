(function () {
  var booleanFields = new Set(['autoFollow', 'userScrollSuppress']);
  var numberDefaults = {
    lastActiveSegIndex: -1,
    lastSentencePrevTapSegIndex: -1,
    lastSentencePrevTapAt: 0
  };
  var rawNullableFields = new Set([
    'suppressTimer',
    'activeWordHighlightEl',
    'activeSentenceEl',
    'activeChunkEl'
  ]);
  var fallback = createDefaults();

  function createDefaults() {
    return {
      autoFollow: true,
      userScrollSuppress: false,
      suppressTimer: null,
      lastActiveSegIndex: -1,
      activeWordHighlightEl: null,
      activeSentenceEl: null,
      activeChunkEl: null,
      playbackUiSignature: '',
      lastSentencePrevTapSegIndex: -1,
      lastSentencePrevTapAt: 0
    };
  }

  function normalizeField(key, value) {
    if (booleanFields.has(key)) return !!value;
    if (rawNullableFields.has(key)) return value == null ? null : value;
    if (key === 'playbackUiSignature') return value == null ? '' : String(value);
    if (Object.prototype.hasOwnProperty.call(numberDefaults, key)) {
      var n = Number(value);
      return Number.isFinite(n) ? n : numberDefaults[key];
    }
    return value;
  }

  function getField(key) {
    return fallback[key];
  }

  function setField(key, value) {
    var next = normalizeField(key, value);
    fallback[key] = next;
    return next;
  }

  function buildSnapshot() {
    return {
      autoFollow: getField('autoFollow'),
      userScrollSuppress: getField('userScrollSuppress'),
      suppressTimer: getField('suppressTimer'),
      lastActiveSegIndex: getField('lastActiveSegIndex'),
      activeWordHighlightEl: getField('activeWordHighlightEl'),
      activeSentenceEl: getField('activeSentenceEl'),
      activeChunkEl: getField('activeChunkEl'),
      playbackUiSignature: getField('playbackUiSignature'),
      lastSentencePrevTapSegIndex: getField('lastSentencePrevTapSegIndex'),
      lastSentencePrevTapAt: getField('lastSentencePrevTapAt')
    };
  }

  var api = {
    getSnapshot: buildSnapshot,
    resetFallback: function () {
      fallback = createDefaults();
      return api;
    }
  };

  Object.keys(fallback).forEach(function (key) {
    Object.defineProperty(api, key, {
      get: function () { return getField(key); },
      set: function (value) { setField(key, value); },
      enumerable: true,
      configurable: true
    });
  });

  window.__playbackState = api;
})();
