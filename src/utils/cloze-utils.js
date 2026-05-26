export function validateClozeData(data) {
  if (!Array.isArray(data)) {
    throw new Error('Cloze JSON must be an array');
  }
  return data.map((item, idx) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Question ${idx + 1} is invalid`);
    }
    const clozeSentence = String(item.cloze_sentence || '').trim();
    const targetWord = String(item.target_word || '').trim();
    if (!clozeSentence || !targetWord) {
      throw new Error(`Question ${idx + 1} is missing cloze_sentence or target_word`);
    }
    return {
      sourceSentence: String(item.source_sentence || '').trim(),
      chineseTranslation: String(item.chinese_translation || '').trim(),
      clozeSentence,
      targetWord,
      wordType: String(item.word_type || '').trim(),
      reasoning: String(item.reasoning || '').trim()
    };
  });
}

export function normalizeClozeAnswer(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:'"“”‘’()[\]{}]/g, '');
}

export function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

window.ClozeUtils = { validateClozeData, normalizeClozeAnswer };
