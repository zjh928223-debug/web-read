(function () {
  var arrayFields = new Set(['chunkItems']);
  var booleanFields = new Set([
    'isChunkMode',
    'hasAiChunkData',
    'chunkCnVisible',
    'chunkCnHoldMode',
    'isHoldingChunkCn',
    'isChunkShadowOn'
  ]);
  var nullableBooleanFields = new Set(['holdPrevChunkCnVisible']);
  var numberDefaults = {
    lastActiveChunkIndex: -1,
    lastAiPrevTapChunkIndex: -1,
    lastAiPrevTapAt: 0
  };
  var storeFieldMap = {
    chunkCnVisible: 'chunkCNVisible',
    chunkCnHoldMode: 'chunkCNHoldMode',
    isChunkShadowOn: 'chunkShadowVisible',
    lastActiveChunkIndex: 'activeChunkIdx'
  };
  var fallback = createDefaults();
  var boundStore = null;

  function createDefaults() {
    return {
      isChunkMode: false,
      chunkItems: [],
      hasAiChunkData: false,
      chunkCnVisible: false,
      chunkCnHoldMode: true,
      isHoldingChunkCn: false,
      holdPrevChunkCnVisible: null,
      isChunkShadowOn: true,
      chunkCnMode: 'focus',
      manualChunkStates: {},
      lastActiveChunkIndex: -1,
      lastAiPrevTapChunkIndex: -1,
      lastAiPrevTapAt: 0
    };
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function normalizeField(key, value) {
    if (arrayFields.has(key)) return Array.isArray(value) ? value : [];
    if (key === 'manualChunkStates') return isPlainObject(value) ? value : {};
    if (booleanFields.has(key)) return !!value;
    if (nullableBooleanFields.has(key)) return value == null ? null : !!value;
    if (key === 'chunkCnMode') return value === 'global' ? 'global' : 'focus';
    if (Object.prototype.hasOwnProperty.call(numberDefaults, key)) {
      var n = Number(value);
      return Number.isFinite(n) ? n : numberDefaults[key];
    }
    return value;
  }

  function getStore() {
    if (boundStore) return boundStore;
    if (typeof window !== 'undefined' && window.__piniaStores && window.__piniaStores.chunk) {
      return window.__piniaStores.chunk;
    }
    return null;
  }

  function hasStoreField(store, key) {
    if (!store) return false;
    if (key === 'chunkCnMode') return Object.prototype.hasOwnProperty.call(store, 'chunkFocusMode');
    var storeKey = storeFieldMap[key] || key;
    return Object.prototype.hasOwnProperty.call(store, storeKey);
  }

  function getStoreField(store, key) {
    if (key === 'chunkCnMode') return store.chunkFocusMode === false ? 'global' : 'focus';
    var storeKey = storeFieldMap[key] || key;
    return store[storeKey];
  }

  function setStoreField(store, key, value) {
    if (key === 'chunkCnMode') {
      store.chunkFocusMode = value === 'focus';
      return;
    }
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
      isChunkMode: getField('isChunkMode'),
      chunkItems: getField('chunkItems'),
      hasAiChunkData: getField('hasAiChunkData'),
      chunkCnVisible: getField('chunkCnVisible'),
      chunkCnHoldMode: getField('chunkCnHoldMode'),
      isHoldingChunkCn: getField('isHoldingChunkCn'),
      holdPrevChunkCnVisible: getField('holdPrevChunkCnVisible'),
      isChunkShadowOn: getField('isChunkShadowOn'),
      chunkCnMode: getField('chunkCnMode'),
      manualChunkStates: getField('manualChunkStates'),
      lastActiveChunkIndex: getField('lastActiveChunkIndex'),
      lastAiPrevTapChunkIndex: getField('lastAiPrevTapChunkIndex'),
      lastAiPrevTapAt: getField('lastAiPrevTapAt')
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

  window.__chunkState = api;
})();
