// Dictionary results stay transient; only AI phonetics use saved refinement rows.
export function normalizeSettlementPhonetic(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  const body = raw.replace(/^[/\[]|[/\]]$/g, '').trim().replace(/'/g, 'ˈ').replace(/:/g, 'ː').replace(/ә/g, 'ə');
  if (!body || body.length > 96 || !/\p{L}/u.test(body)
    || !/^[\p{Script=Latin}\p{M}ˈˌːˑ. \-()]+$/u.test(body)) return '';
  return `/${body}/`;
}

export function createLocalPoolPhoneticLookup({ fetchImpl = globalThis.fetch, token = import.meta.env?.VITE_READ_WEB_SERVICE_TOKEN || '' } = {}) {
  return async (words) => {
    if (typeof fetchImpl !== 'function' || !words.length) return [];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    try {
      const headers = { accept: 'application/json', ...(token ? { 'X-Read-Web-Token': token } : {}) };
      const response = await fetchImpl(`/api/vocabulary/ielts-learning-pool?phonetics=${encodeURIComponent(words.join(','))}`, { headers, signal: controller.signal });
      if (!response.ok) return [];
      const data = await response.json();
      return data?.available && data.schemaVersion === 'settlement-phonetics.v1' && Array.isArray(data.items) ? data.items : [];
    } catch { return []; }
    finally { clearTimeout(timeout); }
  };
}

export function createSettlementPhoneticResolver(client, { lookupMany } = {}) {
  const cache = new Map();
  const poolCache = new Map();
  async function lookup(text) {
    if (!client) return '';
    const key = text.toLowerCase();
    if (!cache.has(key)) {
      cache.set(key, Promise.resolve().then(() => client.lookup(text)).then((result) => {
        if (!result?.available) return '';
        // A lemma's pronunciation must not be substituted for an inflected word.
        const matches = [result.directMatch, ...(result.normalizedCandidates || [])]
          .filter((entry) => entry?.word?.toLowerCase() === key);
        return matches.length === 1 ? normalizeSettlementPhonetic(matches[0].phonetic)
          : normalizeSettlementPhonetic(result.directMatch?.phonetic);
      }).catch(() => ''));
      if (cache.size > 512) cache.delete(cache.keys().next().value);
    }
    return cache.get(key);
  }
  return async (candidates = []) => {
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, async () => {
      while (cursor < candidates.length) {
        const candidate = candidates[cursor++];
        if (candidate.entry_type === 'phrase' || normalizeSettlementPhonetic(candidate.phonetic)) continue;
        const phonetic = await lookup(String(candidate.markedText || candidate.lemma || '').trim());
        if (phonetic) { candidate.phonetic = phonetic; candidate.phonetic_source = 'local-dictionary'; }
      }
    }));
    if (typeof lookupMany !== 'function') return;
    const missing = candidates.filter((candidate) => candidate.entry_type !== 'phrase' && !normalizeSettlementPhonetic(candidate.phonetic));
    const words = [...new Set(missing.map((candidate) => String(candidate.markedText || candidate.lemma || '').trim().toLowerCase()))];
    const uncached = words.filter((word) => !poolCache.has(word));
    for (let offset = 0; offset < uncached.length; offset += 100) {
      const batch = uncached.slice(offset, offset + 100);
      const request = Promise.resolve().then(() => lookupMany(batch)).catch(() => []);
      batch.forEach((word) => poolCache.set(word, request.then((items) => {
        const entry = items.find((item) => item.word?.toLowerCase() === word);
        return normalizeSettlementPhonetic(entry?.phonetic);
      })));
    }
    await Promise.all(missing.map(async (candidate) => {
      const word = String(candidate.markedText || candidate.lemma || '').trim().toLowerCase();
      const phonetic = await poolCache.get(word);
      if (phonetic) { candidate.phonetic = phonetic; candidate.phonetic_source = 'local-dictionary'; }
    }));
    while (poolCache.size > 512) poolCache.delete(poolCache.keys().next().value);
  };
}
