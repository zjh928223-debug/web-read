function normalizeQuery(value) {
  return String(value ?? '').trim();
}

function cacheKey(query) {
  return query.toLocaleLowerCase('en-US');
}

export function createSrsReviewDictionaryAssistance({
  client = null,
  onChange = () => {},
} = {}) {
  const cache = new Map();
  const pending = new Map();
  const state = {
    query: '',
    result: null,
    unavailable: false,
    errorCode: null,
    requestId: 0,
    revealed: false,
  };
  let alive = true;

  function getSnapshot() {
    const hasVisibleResult = state.revealed
      && state.result?.available === true
      && state.result.matchedBy !== 'none';
    return {
      ...state,
      visibleResult: hasVisibleResult ? state.result : null,
      unavailableVisible: state.revealed && state.unavailable,
    };
  }

  function emitChange() {
    if (alive) onChange(getSnapshot());
  }

  async function setCard(value) {
    const query = normalizeQuery(value);
    const requestId = state.requestId + 1;
    Object.assign(state, {
      query,
      result: null,
      unavailable: false,
      errorCode: null,
      requestId,
      revealed: false,
    });
    emitChange();
    if (!alive || !client || !query) return getSnapshot();

    const key = cacheKey(query);
    if (cache.has(key)) {
      if (alive && state.requestId === requestId) {
        state.result = cache.get(key);
        emitChange();
      }
      return getSnapshot();
    }

    let lookupPromise = pending.get(key);
    if (!lookupPromise) {
      lookupPromise = Promise.resolve()
        .then(() => client.lookup(query))
        .then(
          (lookupResult) => {
            pending.delete(key);
            if (lookupResult?.available === true) cache.set(key, lookupResult);
            return lookupResult;
          },
          (error) => {
            pending.delete(key);
            throw error;
          },
        );
      pending.set(key, lookupPromise);
    }

    try {
      const lookupResult = await lookupPromise;
      if (!alive || state.requestId !== requestId) return getSnapshot();
      if (lookupResult?.available === true) {
        state.result = lookupResult;
      } else {
        state.unavailable = true;
        state.errorCode = typeof lookupResult?.errorCode === 'string'
          ? lookupResult.errorCode
          : 'ECDICT_DATABASE_UNAVAILABLE';
      }
      emitChange();
    } catch (error) {
      if (!alive || state.requestId !== requestId) return getSnapshot();
      state.unavailable = true;
      state.errorCode = typeof error?.code === 'string'
        ? error.code
        : 'ECDICT_REQUEST_FAILED';
      emitChange();
    }
    return getSnapshot();
  }

  function setRevealed(value) {
    if (!alive) return getSnapshot();
    state.revealed = value === true;
    emitChange();
    return getSnapshot();
  }

  function dispose() {
    alive = false;
    state.requestId += 1;
  }

  emitChange();
  return {
    setCard,
    setRevealed,
    getSnapshot,
    dispose,
  };
}
