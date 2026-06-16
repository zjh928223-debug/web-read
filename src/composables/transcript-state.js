(function () {
  var arrayFields = new Set(['segments', 'words', 'wordStarts']);
  var numberFields = new Set(['currentWordIndex', 'highlightMode', 'activeWordIdx', 'activeSegIdx']);
  var booleanFields = new Set(['useVueRendering']);
  var fallback = {
    segments: [],
    words: [],
    wordStarts: [],
    currentWordIndex: -1,
    highlightMode: 2,
    activeWordIdx: -1,
    activeSegIdx: -1,
    useVueRendering: false
  };
  var boundStore = null;

  function normalizeField(key, value) {
    if (arrayFields.has(key)) return Array.isArray(value) ? value : [];
    if (numberFields.has(key)) {
      var n = Number(value);
      if (!Number.isFinite(n)) return key === 'highlightMode' ? 2 : -1;
      return n;
    }
    if (booleanFields.has(key)) return !!value;
    return value;
  }

  function getStore() {
    if (boundStore) return boundStore;
    if (typeof window !== 'undefined' && window.__piniaStores && window.__piniaStores.transcript) {
      return window.__piniaStores.transcript;
    }
    return null;
  }

  function getField(key) {
    var store = getStore();
    if (store && Object.prototype.hasOwnProperty.call(store, key)) {
      return store[key];
    }
    return fallback[key];
  }

  function setField(key, value) {
    var next = normalizeField(key, value);
    fallback[key] = next;
    var store = getStore();
    if (store && Object.prototype.hasOwnProperty.call(store, key)) {
      store[key] = next;
    }
    return next;
  }

  function copyStoreToFallback(store) {
    Object.keys(fallback).forEach(function (key) {
      fallback[key] = normalizeField(key, store[key]);
    });
  }

  function copyFallbackToStore(store) {
    Object.keys(fallback).forEach(function (key) {
      store[key] = normalizeField(key, fallback[key]);
    });
  }

  var api = {
    bindPiniaStore: function (store, options) {
      if (!store) return api;
      var preferStore = !!(options && options.preferStore);
      if (preferStore) copyStoreToFallback(store);
      else copyFallbackToStore(store);
      boundStore = store;
      return api;
    },
    getSnapshot: function () {
      return {
        segments: getField('segments'),
        words: getField('words'),
        wordStarts: getField('wordStarts'),
        currentWordIndex: getField('currentWordIndex'),
        highlightMode: getField('highlightMode'),
        activeWordIdx: getField('activeWordIdx'),
        activeSegIdx: getField('activeSegIdx'),
        useVueRendering: getField('useVueRendering')
      };
    },
    resetFallback: function () {
      fallback = {
        segments: [],
        words: [],
        wordStarts: [],
        currentWordIndex: -1,
        highlightMode: 2,
        activeWordIdx: -1,
        activeSegIdx: -1,
        useVueRendering: false
      };
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

  window.__transcriptState = api;
})();
