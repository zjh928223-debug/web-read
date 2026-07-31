function compact(value, maxLength = 120) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function safeHead(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function formatDictionarySuggestion(suggestion, { includeSource = true } = {}) {
  if (!suggestion?.available || suggestion.matchedBy === 'none') return '';
  const direct = suggestion.directMatch;
  const directWord = safeHead(direct?.word);
  const directKey = directWord.toLocaleLowerCase('en-US');
  const uniqueHeads = (values) => values.map(safeHead).filter(Boolean).filter((word, index, all) => {
    const key = word.toLocaleLowerCase('en-US');
    return key !== directKey
      && all.findIndex((item) => item.toLocaleLowerCase('en-US') === key) === index;
  });
  const normalizedHeads = uniqueHeads(
    (Array.isArray(suggestion.normalizedCandidates)
      ? suggestion.normalizedCandidates
      : []).map((entry) => entry?.word),
  );
  const lemmaHeads = uniqueHeads(
    (Array.isArray(suggestion.lemmaCandidates)
      ? suggestion.lemmaCandidates
      : []).map(
      (candidate) => candidate?.lemma || candidate?.entry?.word,
    ),
  );
  const candidateParts = [];
  if (normalizedHeads.length) {
    candidateParts.push(
      `normalized 候选（${normalizedHeads.length}）：${normalizedHeads.join('、')}`,
    );
  }
  if (lemmaHeads.length) {
    candidateParts.push(`lemma 候选（${lemmaHeads.length}）：${lemmaHeads.join('、')}`);
  }

  if (direct && directWord) {
    const meaning = compact(direct.translation || direct.definition);
    const prefix = includeSource ? 'ECDICT · ' : '';
    const base = `${prefix}${directWord}${meaning ? `：${meaning}` : ''}`;
    return candidateParts.length ? `${base} · ${candidateParts.join(' · ')}` : base;
  }
  if (!candidateParts.length) return '';
  return includeSource ? `ECDICT ${candidateParts.join(' · ')}` : candidateParts.join(' · ');
}
