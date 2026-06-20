function requireExportPayloadFunction(deps, name) {
  if (deps && typeof deps[name] === 'function') return deps[name];
  throw new Error(`Missing annotation export payload dependency: ${name}`);
}

function getOccurrenceIndex(target, deps) {
  if (deps && typeof deps.getOccurrenceIndex === 'function') {
    const injectedIndex = deps.getOccurrenceIndex(target);
    return Number.isInteger(injectedIndex) ? injectedIndex : 0;
  }
  const targetIndex = Number(target && target.occurrenceIndex);
  return Number.isInteger(targetIndex) ? targetIndex : 0;
}

export function buildAnnotationContextPayloadFromArticle(articleText, targets, articleId = '', deps = {}) {
  const normalizeAnnotationTextValue = requireExportPayloadFunction(deps, 'normalizeAnnotationTextValue');
  const splitAnnotationContextSentenceSpans = requireExportPayloadFunction(deps, 'splitAnnotationContextSentenceSpans');
  const getAnnotationTargetSentenceText = requireExportPayloadFunction(deps, 'getAnnotationTargetSentenceText');
  const resolveAnnotationContextSentence = requireExportPayloadFunction(deps, 'resolveAnnotationContextSentence');
  const cleanMarkedTextForAnnotationContext = requireExportPayloadFunction(deps, 'cleanMarkedTextForAnnotationContext');

  const normalizedArticleText = normalizeAnnotationTextValue(articleText);
  const normalizedTargets = Array.isArray(targets) ? targets : [];
  const sentenceSpans = splitAnnotationContextSentenceSpans(
    normalizedArticleText,
    normalizedTargets.map((target) => getAnnotationTargetSentenceText(target))
  );
  return {
    schemaVersion: 2,
    articleId: normalizeAnnotationTextValue(articleId),
    articleText: normalizedArticleText,
    articleSentences: sentenceSpans.map((span) => normalizeAnnotationTextValue(span && span.text)).filter(Boolean),
    items: normalizedTargets.map((target) => ({
      ...resolveAnnotationContextSentence(getAnnotationTargetSentenceText(target), sentenceSpans, target && target.markedText),
      targetId: normalizeAnnotationTextValue(target && (target.targetId || target.id)),
      markedText: normalizeAnnotationTextValue(target && target.markedText),
      cleanMarkedText: cleanMarkedTextForAnnotationContext(target && target.markedText),
      sourceSentence: getAnnotationTargetSentenceText(target),
      occurrenceIndex: getOccurrenceIndex(target, deps)
    })).filter((item) => item.targetId && item.markedText && item.sourceSentence)
  };
}

export function buildManualLightweightAnnotationExportPayload(deps = {}) {
  const buildAnnotationTargetCollection = requireExportPayloadFunction(deps, 'buildAnnotationTargetCollection');
  const buildManualLightweightTargetLookup = requireExportPayloadFunction(deps, 'buildManualLightweightTargetLookup');
  const buildAnnotationContextArticleText = requireExportPayloadFunction(deps, 'buildAnnotationContextArticleText');
  const normalizeAnnotationTextValue = requireExportPayloadFunction(deps, 'normalizeAnnotationTextValue');

  const { context, targets } = buildAnnotationTargetCollection();
  if (!context.totalBlocks) {
    throw new Error('请先导入字幕或切分数据。');
  }
  if (!targets.length) {
    throw new Error('当前文档没有可导出的标注目标。');
  }
  const lookup = buildManualLightweightTargetLookup(targets);
  const articleText = buildAnnotationContextArticleText(context);
  return buildAnnotationContextPayloadFromArticle(articleText, targets, normalizeAnnotationTextValue(context.documentId), {
    ...deps,
    getOccurrenceIndex(target) {
      const targetId = normalizeAnnotationTextValue(target && target.id);
      return Number.isInteger(lookup.occurrenceByTargetId.get(targetId))
        ? lookup.occurrenceByTargetId.get(targetId)
        : 0;
    }
  });
}
