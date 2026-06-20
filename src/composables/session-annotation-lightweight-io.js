import {
  buildAnnotationContextPayloadFromArticle,
  buildManualLightweightAnnotationExportPayload
} from './session-annotation-export-payload.js';
import {
  buildManualLightweightTargetLookup
} from './session-annotation-import-normalization.js';
import {
  buildManualLightweightImportedBundle
} from './session-annotation-bundle-merge.js';

function requireLightweightIoFunction(deps, name) {
  if (deps && typeof deps[name] === 'function') return deps[name];
  throw new Error(`Missing annotation lightweight IO dependency: ${name}`);
}

function sanitizeFilenamePart(value, fallback = 'article') {
  const normalized = String(value || '').trim().replace(/[\\/:*?"<>|]+/g, '_');
  return normalized || fallback;
}

export function createSessionAnnotationLightweightIoRuntime(deps = {}) {
  function getManualLightweightAnnotationImportNormalizationDeps() {
    return {
      normalizeAnnotationTextValue: requireLightweightIoFunction(deps, 'normalizeAnnotationTextValue'),
      normalizeAnnotationSentenceValue: requireLightweightIoFunction(deps, 'normalizeAnnotationSentenceValue'),
      getAnnotationTargetSentenceText: requireLightweightIoFunction(deps, 'getAnnotationTargetSentenceText'),
      buildSyntheticAnnotationTargetFromEncodedId: requireLightweightIoFunction(deps, 'buildSyntheticAnnotationTargetFromEncodedId')
    };
  }

  function getManualLightweightAnnotationBundleMergeDeps() {
    return {
      ...getManualLightweightAnnotationImportNormalizationDeps(),
      buildAnnotationTargetCollection: requireLightweightIoFunction(deps, 'buildAnnotationTargetCollection')
    };
  }

  function getManualLightweightAnnotationExportPayloadDeps() {
    const importNormalizationDeps = getManualLightweightAnnotationImportNormalizationDeps();
    return {
      buildAnnotationTargetCollection: requireLightweightIoFunction(deps, 'buildAnnotationTargetCollection'),
      buildManualLightweightTargetLookup(targets) {
        return buildManualLightweightTargetLookup(targets, importNormalizationDeps);
      },
      buildAnnotationContextArticleText: requireLightweightIoFunction(deps, 'buildAnnotationContextArticleText'),
      splitAnnotationContextSentenceSpans: requireLightweightIoFunction(deps, 'splitAnnotationContextSentenceSpans'),
      getAnnotationTargetSentenceText: requireLightweightIoFunction(deps, 'getAnnotationTargetSentenceText'),
      normalizeAnnotationTextValue: requireLightweightIoFunction(deps, 'normalizeAnnotationTextValue'),
      resolveAnnotationContextSentence: requireLightweightIoFunction(deps, 'resolveAnnotationContextSentence'),
      cleanMarkedTextForAnnotationContext: requireLightweightIoFunction(deps, 'cleanMarkedTextForAnnotationContext')
    };
  }

  function downloadJsonFile(payload, filename) {
    const documentObject = deps.documentObject;
    const urlApi = deps.urlApi;
    const BlobCtor = deps.BlobCtor;
    const blob = new BlobCtor([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = documentObject.createElement('a');
    a.href = urlApi.createObjectURL(blob);
    a.download = filename;
    documentObject.body.appendChild(a);
    a.click();
    documentObject.body.removeChild(a);
    setTimeout(() => urlApi.revokeObjectURL(a.href), 0);
  }

  function installAnnotationContextExport() {
    const windowObject = deps.windowObject;
    windowObject.AnnotationContextExport = {
      buildPayloadFromArticle(articleText, targets, articleId = '') {
        return buildAnnotationContextPayloadFromArticle(
          articleText,
          targets,
          articleId,
          getManualLightweightAnnotationExportPayloadDeps()
        );
      }
    };
  }

  function exportManualLightweightAnnotations() {
    const payload = buildManualLightweightAnnotationExportPayload(
      getManualLightweightAnnotationExportPayloadDeps()
    );
    const helper = deps.windowObject.ImportExportSharedHelpers || null;
    const audioBase = helper && typeof helper.getCurrentAudioFilenameBase === 'function'
      ? helper.getCurrentAudioFilenameBase(deps.state.currentAudioMeta, 'article')
      : 'article';
    const filenameBase = sanitizeFilenamePart(payload.articleId || audioBase, 'article');
    downloadJsonFile(payload, `${filenameBase}_annotation_light.json`);
    deps.showToast(`轻量标注导出完成，共 ${payload.items.length} 条`, 'success');
    return payload;
  }

  async function importManualLightweightAnnotations(file) {
    const storage = requireLightweightIoFunction(deps, 'getAnnotationGenerationStorage')();
    if (!storage || typeof storage.saveBundle !== 'function' || typeof storage.loadBundle !== 'function') {
      throw new Error('AnnotationGenerationStorage 不可用');
    }
    const rawText = await file.text();
    const parsed = JSON.parse(rawText);
    const scope = requireLightweightIoFunction(deps, 'getAnnotationGenerationScope')();
    const normalized = await buildManualLightweightImportedBundle(
      parsed,
      scope,
      storage,
      getManualLightweightAnnotationBundleMergeDeps()
    );
    await storage.saveBundle(scope, normalized.generated, normalized.status);
    await requireLightweightIoFunction(deps, 'refreshGeneratedAnnotationIndexForCurrentDocument')();
    requireLightweightIoFunction(deps, 'rebuildMarksFromAnnotationItems')(normalized.generated && normalized.generated.items, {
      sourceType: 'annotation-lightweight-import',
      replaceExisting: true
    });
    await requireLightweightIoFunction(deps, 'syncAnnotationGenerationEntryStatus')();
    return normalized;
  }

  return {
    exportManualLightweightAnnotations,
    importManualLightweightAnnotations,
    installAnnotationContextExport,
    getManualLightweightAnnotationImportNormalizationDeps,
    getManualLightweightAnnotationBundleMergeDeps,
    getManualLightweightAnnotationExportPayloadDeps
  };
}
