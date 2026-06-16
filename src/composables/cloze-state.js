(function () {
  var arrayFields = new Set(['clozeItems', 'clozeAnswerState']);
  var storeFieldMap = {
    clozeItems: 'items',
    hasClozeData: 'hasData',
    clozeAnswerState: 'answerState'
  };
  var fallback = createDefaults();
  var boundStore = null;

  function createDefaults() {
    return {
      clozeItems: [],
      hasClozeData: false,
      clozeAnswerState: []
    };
  }

  function normalizeField(key, value) {
    if (arrayFields.has(key)) return Array.isArray(value) ? value : [];
    if (key === 'hasClozeData') return !!value;
    return value;
  }

  function getStore() {
    if (boundStore) return boundStore;
    if (typeof window !== 'undefined' && window.__piniaStores && window.__piniaStores.cloze) {
      return window.__piniaStores.cloze;
    }
    return null;
  }

  function hasStoreField(store, key) {
    if (!store) return false;
    var storeKey = storeFieldMap[key] || key;
    return Object.prototype.hasOwnProperty.call(store, storeKey);
  }

  function getStoreField(store, key) {
    var storeKey = storeFieldMap[key] || key;
    return store[storeKey];
  }

  function setStoreField(store, key, value) {
    var storeKey = storeFieldMap[key] || key;
    store[storeKey] = value;
  }

  function getField(key) {
    var store = getStore();
    if (hasStoreField(store, key)) return normalizeField(key, getStoreField(store, key));
    return fallback[key];
  }

  function setField(key, value) {
    var next = normalizeField(key, value);
    fallback[key] = next;
    var store = getStore();
    if (hasStoreField(store, key)) setStoreField(store, key, next);
    return next;
  }

  function copyStoreToFallback(store) {
    Object.keys(fallback).forEach(function (key) {
      if (hasStoreField(store, key)) fallback[key] = normalizeField(key, getStoreField(store, key));
    });
  }

  function copyFallbackToStore(store) {
    Object.keys(fallback).forEach(function (key) {
      if (hasStoreField(store, key)) setStoreField(store, key, normalizeField(key, fallback[key]));
    });
  }

  function buildSnapshot() {
    return {
      clozeItems: getField('clozeItems'),
      hasClozeData: getField('hasClozeData'),
      clozeAnswerState: getField('clozeAnswerState')
    };
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

  window.__clozeState = api;
})();
