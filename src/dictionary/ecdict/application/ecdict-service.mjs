import { normalizeDictionaryQuery } from '../domain/normalization.mjs';
import { EcdictRepository } from '../infrastructure/ecdict-repository.mjs';
import { EcdictDatabaseError } from '../infrastructure/sqlite-connection.mjs';

function unavailableResult(query, normalizedQuery, errorCode) {
  return {
    available: false,
    errorCode,
    query,
    normalizedQuery,
    matchedBy: 'none',
    directMatch: null,
    normalizedCandidates: [],
    lemmaCandidates: [],
  };
}

export function createEcdictService({
  enabled = false,
  databasePath,
  repositoryFactory = (path) => new EcdictRepository(path),
} = {}) {
  let repository = null;

  return {
    async lookup(value) {
      const query = String(value ?? '');
      const normalizedQuery = normalizeDictionaryQuery(query);
      if (!enabled) {
        return unavailableResult(query, normalizedQuery, 'ECDICT_DISABLED');
      }

      try {
        repository ??= repositoryFactory(databasePath);
        const directMatch = query ? repository.findExact(query) : null;
        const normalizedCandidates = normalizedQuery
          ? repository.findNormalized(normalizedQuery)
          : [];
        const lemmaCandidates = query
          ? repository.findLemmaCandidates(query)
          : [];
        return {
          available: true,
          errorCode: null,
          query,
          normalizedQuery,
          matchedBy: directMatch
            ? 'exact'
            : normalizedCandidates.length
              ? 'normalized'
              : lemmaCandidates.length
                ? 'lemma'
                : 'none',
          directMatch,
          normalizedCandidates,
          lemmaCandidates,
        };
      } catch (error) {
        const errorCode = error instanceof EcdictDatabaseError
          ? error.code
          : 'ECDICT_QUERY_FAILED';
        return unavailableResult(query, normalizedQuery, errorCode);
      }
    },

    close() {
      repository?.close();
      repository = null;
    },
  };
}
