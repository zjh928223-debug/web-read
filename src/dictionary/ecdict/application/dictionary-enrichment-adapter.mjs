function getCandidateQuery(candidate) {
  return String(
    candidate?.markedText
    || candidate?.marked_text
    || candidate?.word
    || candidate?.lemma
    || '',
  ).trim();
}

function unavailableSuggestion(query, errorCode = 'ECDICT_REQUEST_FAILED') {
  return {
    available: false,
    errorCode,
    query,
    normalizedQuery: '',
    matchedBy: 'none',
    directMatch: null,
    normalizedCandidates: [],
    lemmaCandidates: [],
  };
}

export function createDictionaryEnrichmentAdapter({ client, concurrency = 4 } = {}) {
  if (!client || typeof client.lookup !== 'function') {
    throw new TypeError('DictionaryEnrichmentAdapter requires a dictionary client.');
  }
  const workerCount = Math.max(1, Math.floor(Number(concurrency) || 1));

  return {
    async enrichCandidates(candidates = []) {
      const source = Array.isArray(candidates) ? candidates : [];
      const queries = new Map();
      source.forEach((candidate) => {
        const query = getCandidateQuery(candidate);
        const key = query.toLocaleLowerCase('en-US');
        if (query && !queries.has(key)) queries.set(key, query);
      });

      const pending = Array.from(queries.entries());
      const suggestions = new Map();
      let nextIndex = 0;
      async function worker() {
        while (nextIndex < pending.length) {
          const [key, query] = pending[nextIndex];
          nextIndex += 1;
          try {
            suggestions.set(key, await client.lookup(query));
          } catch (error) {
            suggestions.set(key, unavailableSuggestion(query, error?.code || 'ECDICT_REQUEST_FAILED'));
          }
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(workerCount, pending.length) }, () => worker()),
      );

      return source.map((candidate) => {
        const query = getCandidateQuery(candidate);
        const key = query.toLocaleLowerCase('en-US');
        return {
          ...candidate,
          dictionarySuggestion: suggestions.get(key) || unavailableSuggestion(query),
        };
      });
    },
  };
}
