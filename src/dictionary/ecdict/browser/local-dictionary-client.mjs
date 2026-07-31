const MATCH_TYPES = new Set(['exact', 'normalized', 'lemma', 'none']);
const NULLABLE_STRING_FIELDS = [
  'phonetic',
  'definition',
  'translation',
  'pos',
  'exchange',
];
const NULLABLE_NUMBER_FIELDS = ['collins', 'bncRank', 'frequencyRank'];

export class LocalDictionaryClientError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'LocalDictionaryClientError';
    this.code = code;
  }
}

function isNullableString(value) {
  return value === null || typeof value === 'string';
}

function isNullableNumber(value) {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isDictionaryEntry(value) {
  return !!value
    && typeof value === 'object'
    && typeof value.word === 'string'
    && value.word.length > 0
    && NULLABLE_STRING_FIELDS.every((field) => isNullableString(value[field]))
    && NULLABLE_NUMBER_FIELDS.every((field) => isNullableNumber(value[field]))
    && typeof value.oxford === 'boolean'
    && Array.isArray(value.tags)
    && value.tags.every((tag) => typeof tag === 'string');
}

function isLemmaCandidate(value) {
  return !!value
    && typeof value === 'object'
    && (value.lemma === undefined || typeof value.lemma === 'string')
    && isDictionaryEntry(value.entry);
}

function isLookupResult(value) {
  return !!value
    && typeof value === 'object'
    && typeof value.available === 'boolean'
    && typeof value.query === 'string'
    && typeof value.normalizedQuery === 'string'
    && (value.errorCode === null || typeof value.errorCode === 'string')
    && MATCH_TYPES.has(value.matchedBy)
    && (value.directMatch === null || isDictionaryEntry(value.directMatch))
    && Array.isArray(value.normalizedCandidates)
    && value.normalizedCandidates.every(isDictionaryEntry)
    && Array.isArray(value.lemmaCandidates)
    && value.lemmaCandidates.every(isLemmaCandidate);
}

export function createLocalDictionaryClient({
  fetchImpl = globalThis.fetch,
  endpoint = '/api/dev/dictionary/ecdict',
  timeoutMs = 1500,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new LocalDictionaryClientError('ECDICT_CLIENT_UNAVAILABLE', 'Fetch is unavailable.');
  }

  return {
    async lookup(value) {
      const query = String(value ?? '');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
      try {
        const separator = endpoint.includes('?') ? '&' : '?';
        const response = await fetchImpl(
          `${endpoint}${separator}q=${encodeURIComponent(query).replace(/'/g, '%27')}`,
          { method: 'GET', headers: { accept: 'application/json' }, signal: controller.signal },
        );
        if (!response?.ok) {
          throw new LocalDictionaryClientError(
            'ECDICT_HTTP_ERROR',
            `ECDICT endpoint returned HTTP ${response?.status ?? 0}.`,
          );
        }
        const result = await response.json();
        if (!isLookupResult(result)) {
          throw new LocalDictionaryClientError(
            'ECDICT_INVALID_RESPONSE',
            'ECDICT endpoint returned an invalid lookup DTO.',
          );
        }
        return result;
      } catch (error) {
        if (error instanceof LocalDictionaryClientError) throw error;
        if (controller.signal.aborted) {
          throw new LocalDictionaryClientError(
            'ECDICT_REQUEST_TIMEOUT',
            'ECDICT request timed out.',
            { cause: error },
          );
        }
        throw new LocalDictionaryClientError(
          'ECDICT_REQUEST_FAILED',
          'ECDICT request failed.',
          { cause: error },
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
