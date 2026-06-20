import {
  buildManualLightweightTargetLookup,
  normalizeManualLightweightImportedItem,
  resolveManualLightweightImportTarget
} from './session-annotation-import-normalization.js';

function requireBundleMergeFunction(deps, name) {
  if (deps && typeof deps[name] === 'function') return deps[name];
  throw new Error(`Missing annotation bundle merge dependency: ${name}`);
}

export function buildImportedAnnotationStatusBlocks(items, existingBlocks) {
  if (existingBlocks && typeof existingBlocks === 'object' && Object.keys(existingBlocks).length) return existingBlocks;
  const blocks = {};
  const importedAt = new Date().toISOString();
  items.forEach((item) => {
    const blockId = String(item && item.blockId || 'manual-import');
    if (!blocks[blockId]) {
      blocks[blockId] = {
        state: 'imported',
        insertedCount: 0,
        importedAt
      };
    }
    blocks[blockId].insertedCount += 1;
  });
  return blocks;
}

export function buildManualLightweightImportedBundle(parsed, scope, storage, deps = {}) {
  const buildAnnotationTargetCollection = requireBundleMergeFunction(deps, 'buildAnnotationTargetCollection');
  const normalizeAnnotationTextValue = requireBundleMergeFunction(deps, 'normalizeAnnotationTextValue');

  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error('JSON 必须是包含 items 数组的对象。');
  }

  const { context, targets } = buildAnnotationTargetCollection();
  if (!context.totalBlocks) {
    throw new Error('请先导入字幕或切分数据。');
  }
  const targetLookup = buildManualLightweightTargetLookup(targets, deps);

  const normalizedItems = parsed.items
    .map((item, index) => normalizeManualLightweightImportedItem(item, index, deps))
    .filter(Boolean);
  if (!normalizedItems.length) {
    throw new Error('导入文件里没有可用的 items。');
  }

  const generatedBase = storage && typeof storage.createGeneratedJson === 'function'
    ? storage.createGeneratedJson(scope, [])
    : { schemaVersion: 1, audioKey: scope.audioKey, documentId: scope.documentId, items: [] };
  const statusBase = storage && typeof storage.createStatusJson === 'function'
    ? storage.createStatusJson(scope, {})
    : { schemaVersion: 1, audioKey: scope.audioKey, documentId: scope.documentId, blocks: {} };

  return storage.loadBundle(scope).then((existingBundle) => {
    const existingGenerated = existingBundle && existingBundle.generated && typeof existingBundle.generated === 'object'
      ? existingBundle.generated
      : generatedBase;
    const existingStatus = existingBundle && existingBundle.status && typeof existingBundle.status === 'object'
      ? existingBundle.status
      : statusBase;
    const existingItems = Array.isArray(existingGenerated.items) ? existingGenerated.items : [];
    const existingByTargetId = new Map();
    existingItems.forEach((item) => {
      const targetId = normalizeAnnotationTextValue(item && item.targetId);
      if (targetId) existingByTargetId.set(targetId, item);
    });

    const nextByTargetId = new Map(existingByTargetId);
    const missingTargetIds = [];
    const skippedItems = [];
    const markedTextMismatchTargetIds = [];
    const ambiguousItems = [];
    let importedCount = 0;

    normalizedItems.forEach((item) => {
      if (!item.ok) {
        skippedItems.push(item.reason || 'invalid-item');
        return;
      }
      const resolved = resolveManualLightweightImportTarget(item, targetLookup, deps);
      const target = resolved.target;
      if (!target) {
        if (resolved.reason === 'ambiguous-without-occurrenceIndex') {
          ambiguousItems.push(item.targetId || item.markedText || `item-${item.index}`);
        } else {
          missingTargetIds.push(item.targetId);
        }
        return;
      }
      if (!item.hasAnyBackfillField) {
        skippedItems.push(item.targetId);
        return;
      }

      const targetMarkedText = normalizeAnnotationTextValue(target.markedText);
      if (item.markedText && targetMarkedText && item.markedText !== targetMarkedText) {
        markedTextMismatchTargetIds.push(item.targetId);
      }

      const resolvedTargetId = normalizeAnnotationTextValue(target.id || item.targetId);
      const existing = nextByTargetId.get(resolvedTargetId) || nextByTargetId.get(item.targetId) || {};
      const blockId = normalizeAnnotationTextValue(existing.blockId || target.sentenceId || 'manual-import');
      const boundary = item.boundary
        || normalizeAnnotationTextValue(existing.boundary)
        || normalizeAnnotationTextValue(target.sentenceText || target.sentencePlainText || target.boundary || target.markedText);

      nextByTargetId.set(resolvedTargetId, {
        ...existing,
        id: normalizeAnnotationTextValue(existing.id || `manual-${resolvedTargetId}`),
        targetId: resolvedTargetId,
        blockId,
        markedText: targetMarkedText || item.markedText,
        boundary,
        type: item.type || normalizeAnnotationTextValue(existing.type),
        meaning: item.meaning || normalizeAnnotationTextValue(existing.meaning),
        memoryHint: item.memoryHint || normalizeAnnotationTextValue(existing.memoryHint),
        occurrenceKey: normalizeAnnotationTextValue(existing.occurrenceKey || target.occurrenceKey),
        occurrenceGlobalStart: Number.isInteger(Number(existing.occurrenceGlobalStart))
          ? Number(existing.occurrenceGlobalStart)
          : (Number.isInteger(Number(target.occurrenceGlobalStart)) ? Number(target.occurrenceGlobalStart) : null),
        occurrenceGlobalEnd: Number.isInteger(Number(existing.occurrenceGlobalEnd))
          ? Number(existing.occurrenceGlobalEnd)
          : (Number.isInteger(Number(target.occurrenceGlobalEnd)) ? Number(target.occurrenceGlobalEnd) : null),
        source: 'manual-lightweight-import'
      });
      importedCount += 1;
    });

    if (!importedCount) {
      throw new Error('没有成功匹配并回填任何 target。');
    }

    const mergedItems = Array.from(nextByTargetId.values());
    const importedAt = new Date().toISOString();
    return {
      generated: {
        ...generatedBase,
        ...existingGenerated,
        schemaVersion: 1,
        audioKey: scope.audioKey,
        documentId: scope.documentId,
        importedAt,
        source: 'manual-lightweight-import',
        items: mergedItems
      },
      status: {
        ...statusBase,
        ...existingStatus,
        schemaVersion: 1,
        audioKey: scope.audioKey,
        documentId: scope.documentId,
        importedAt,
        source: 'manual-lightweight-import',
        blocks: buildImportedAnnotationStatusBlocks(mergedItems, existingStatus && existingStatus.blocks)
      },
      importedCount,
      skippedCount: skippedItems.length + missingTargetIds.length + ambiguousItems.length,
      missingTargetIds,
      markedTextMismatchTargetIds,
      ambiguousItems
    };
  });
}
