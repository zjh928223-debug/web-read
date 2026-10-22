const RECOMMENDED_ANNOTATION_MODEL = 'gemini-3.1-flash-lite';

const DEFAULT_GEMINI_MODEL = RECOMMENDED_ANNOTATION_MODEL;

function getResultItems(result) {
  return result && Array.isArray(result.items) ? result.items : [];
}

function getTemplateItems(template) {
  return template && Array.isArray(template.items) ? template.items : [];
}

function getTargetId(item) {
  return String(item && item.targetId || '').trim();
}

function hasBackfillContent(item) {
  return ['boundary', 'type', 'meaning', 'memoryHint'].some((key) => String(item && item[key] || '').trim());
}

function analyzeBackfillCoverage(template, result) {
  const templateItems = getTemplateItems(template);
  const resultItems = getResultItems(result);
  const resultByTargetId = new Map();
  resultItems.forEach((item) => {
    const targetId = getTargetId(item);
    if (targetId && hasBackfillContent(item)) resultByTargetId.set(targetId, item);
  });
  const missingItems = [];
  let coveredCount = 0;
  templateItems.forEach((item) => {
    const targetId = getTargetId(item);
    if (targetId && resultByTargetId.has(targetId)) coveredCount += 1;
    else missingItems.push(item);
  });
  return {
    totalCount: templateItems.length,
    resultCount: resultItems.length,
    coveredCount,
    missingCount: missingItems.length,
    missingItems,
    fullyCovered: templateItems.length > 0 && coveredCount === templateItems.length,
    partiallyCovered: coveredCount > 0 && missingItems.length > 0,
  };
}

function normalizeTemplateText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getTemplateSentences(template) {
  return Array.isArray(template && template.articleSentences)
    ? template.articleSentences.map((sentence) => normalizeTemplateText(sentence)).filter(Boolean)
    : [];
}

function findSentenceIndexForItem(sentences, item) {
  const sourceSentence = normalizeTemplateText(item && item.sourceSentence);
  if (!sourceSentence) return -1;
  return sentences.findIndex((sentence) => (
    sentence === sourceSentence
    || sentence.includes(sourceSentence)
    || sourceSentence.includes(sentence)
  ));
}

function truncateArticleTextByItems(template, requestItems) {
  const items = Array.isArray(requestItems) ? requestItems : [];
  const sentences = getTemplateSentences(template);
  if (!items.length) {
    return {
      articleText: normalizeTemplateText(template && template.articleText),
      articleSentences: sentences,
    };
  }

  let lastSentenceIndex = -1;
  items.forEach((item) => {
    const sentenceIndex = findSentenceIndexForItem(sentences, item);
    if (sentenceIndex > lastSentenceIndex) lastSentenceIndex = sentenceIndex;
  });
  if (lastSentenceIndex >= 0) {
    const scopedSentences = sentences.slice(0, lastSentenceIndex + 1);
    return {
      articleText: scopedSentences.join(' '),
      articleSentences: scopedSentences,
    };
  }

  const articleText = normalizeTemplateText(template && template.articleText);
  let lastEnd = 0;
  items.forEach((item) => {
    const sourceSentence = normalizeTemplateText(item && item.sourceSentence);
    if (!sourceSentence || !articleText) return;
    const index = articleText.indexOf(sourceSentence);
    if (index >= 0) lastEnd = Math.max(lastEnd, index + sourceSentence.length);
  });
  if (lastEnd > 0) {
    return {
      articleText: articleText.slice(0, lastEnd).trim(),
      articleSentences: sentences,
    };
  }
  return { articleText, articleSentences: sentences };
}

function buildRequestTemplate(template, requestItems) {
  const items = Array.isArray(requestItems) ? requestItems : [];
  const scopedArticle = truncateArticleTextByItems(template, items);
  return {
    ...template,
    articleText: scopedArticle.articleText,
    articleSentences: scopedArticle.articleSentences,
    items,
  };
}

function createIncrementalConfirmMessage(coverage) {
  return [
    `当前文章已有 ${coverage.coveredCount} 个标注解释。`,
    `检测到新增 ${coverage.missingCount} 个未解释标注。`,
    '确认调用 Gemini，只为新增标注生成解释吗？',
  ].join('\n');
}

export { RECOMMENDED_ANNOTATION_MODEL, DEFAULT_GEMINI_MODEL, getResultItems, getTemplateItems, analyzeBackfillCoverage, buildRequestTemplate, createIncrementalConfirmMessage };
