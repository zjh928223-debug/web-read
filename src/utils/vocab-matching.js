export function normalizeVocabMatchText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
}

export function buildVocabMatchMap(words, globalVocab) {
  const vocabMatchMap = new Map();
  if (!Array.isArray(words) || !Array.isArray(globalVocab) || !words.length || !globalVocab.length) {
    return vocabMatchMap;
  }

  globalVocab.forEach((vData) => {
    if (!vData) return;
    const anchorText = vData.match_context ? vData.match_context : vData.word;
    const targetWord = vData.word;

    const anchorTokens = String(anchorText || '').trim().split(/\s+/).map(normalizeVocabMatchText).filter(Boolean);
    const targetTokens = String(targetWord || '').trim().split(/\s+/).map(normalizeVocabMatchText).filter(Boolean);

    if (anchorTokens.length === 0 || targetTokens.length === 0) return;

    for (let i = 0; i <= words.length - anchorTokens.length; i += 1) {
      let isAnchorMatch = true;
      for (let k = 0; k < anchorTokens.length; k += 1) {
        const docWord = words[i + k].word || words[i + k].text || '';
        if (normalizeVocabMatchText(docWord) !== anchorTokens[k]) {
          isAnchorMatch = false;
          break;
        }
      }

      if (!isAnchorMatch) continue;

      let offsetInAnchor = -1;
      for (let m = 0; m <= anchorTokens.length - targetTokens.length; m += 1) {
        let subMatch = true;
        for (let n = 0; n < targetTokens.length; n += 1) {
          if (anchorTokens[m + n] !== targetTokens[n]) {
            subMatch = false;
            break;
          }
        }
        if (subMatch) {
          offsetInAnchor = m;
          break;
        }
      }

      if (offsetInAnchor === -1) continue;

      const realStartIndex = i + offsetInAnchor;
      const groupIndices = [];
      for (let len = 0; len < targetTokens.length; len += 1) {
        const exactIndex = realStartIndex + len;
        groupIndices.push(exactIndex);
        vocabMatchMap.set(exactIndex, {
          data: vData,
          group: groupIndices
        });
      }
    }
  });

  return vocabMatchMap;
}

window.VocabMatchingHelpers = {
  normalizeVocabMatchText,
  buildVocabMatchMap
};
