// Annotation lightweight import/export DOM glue.
(function () {
  var runtimeHandlers = {
    buildManualLightweightAnnotationTemplate: null,
    exportManualLightweightAnnotations: null,
    importManualLightweightAnnotations: null
  };

  function configureManualLightweightAnnotationRuntime(config) {
    config = config || {};
    runtimeHandlers.buildManualLightweightAnnotationTemplate = typeof config.buildManualLightweightAnnotationTemplate === 'function'
      ? config.buildManualLightweightAnnotationTemplate
      : null;
    runtimeHandlers.exportManualLightweightAnnotations = typeof config.exportManualLightweightAnnotations === 'function'
      ? config.exportManualLightweightAnnotations
      : null;
    runtimeHandlers.importManualLightweightAnnotations = typeof config.importManualLightweightAnnotations === 'function'
      ? config.importManualLightweightAnnotations
      : null;
  }

  function buildManualLightweightAnnotationTemplate() {
    if (typeof runtimeHandlers.buildManualLightweightAnnotationTemplate === 'function') {
      return runtimeHandlers.buildManualLightweightAnnotationTemplate();
    }
    throw new Error('Annotation lightweight template module is not ready');
  }

  function exportManualLightweightAnnotations() {
    if (typeof runtimeHandlers.exportManualLightweightAnnotations === 'function') {
      return runtimeHandlers.exportManualLightweightAnnotations();
    }
    throw new Error('Annotation lightweight export module is not ready');
  }

  async function importManualLightweightAnnotations(file) {
    if (typeof runtimeHandlers.importManualLightweightAnnotations === 'function') {
      return runtimeHandlers.importManualLightweightAnnotations(file);
    }
    throw new Error('Annotation lightweight import module is not ready');
  }

  function buildImportSuccessMessage(result) {
    var safeResult = result && typeof result === 'object' ? result : {};
    var mismatchCount = Array.isArray(safeResult.markedTextMismatchTargetIds)
      ? safeResult.markedTextMismatchTargetIds.length
      : 0;
    var ambiguousCount = Array.isArray(safeResult.ambiguousItems)
      ? safeResult.ambiguousItems.length
      : 0;
    var skippedCount = Number.isFinite(Number(safeResult.skippedCount)) ? Number(safeResult.skippedCount) : 0;
    var importedCount = Number.isFinite(Number(safeResult.importedCount)) ? Number(safeResult.importedCount) : 0;
    var mismatchSuffix = mismatchCount ? '，markedText 校验不一致 ' + mismatchCount + ' 条' : '';
    var ambiguousSuffix = ambiguousCount ? '，歧义未导入 ' + ambiguousCount + ' 条' : '';
    var skippedSuffix = skippedCount ? '，跳过 ' + skippedCount + ' 条' : '';
    return '轻量回填完成 ' + importedCount + ' 条' + skippedSuffix + ambiguousSuffix + mismatchSuffix;
  }

  function initManualLightweightAnnotationControls(deps) {
    deps = deps || {};
    var exportButton = deps.exportButton || null;
    var importButton = deps.importButton || null;
    var importInput = deps.importInput || null;
    var getFirstFileFromEvent = typeof deps.getFirstFileFromEvent === 'function'
      ? deps.getFirstFileFromEvent
      : function (event) {
        return event && event.target && event.target.files && event.target.files[0] ? event.target.files[0] : null;
      };
    var refreshAfterImport = typeof deps.refreshAfterImport === 'function' ? deps.refreshAfterImport : function () {};
    var showToast = typeof deps.showToast === 'function' ? deps.showToast : function () {};
    var showError = typeof deps.showError === 'function' ? deps.showError : function () {};

    if (exportButton) {
      exportButton.addEventListener('click', function () {
        try {
          exportManualLightweightAnnotations();
        } catch (error) {
          showError('ANNOTATION_LIGHT_EXPORT', error && error.message ? error.message : 'Export failed');
        }
      });
    }

    if (importButton && importInput) {
      importButton.addEventListener('click', function () {
        importInput.click();
      });
      importInput.addEventListener('change', async function (event) {
        var file = getFirstFileFromEvent(event);
        importInput.value = '';
        if (!file) return;
        try {
          var result = await importManualLightweightAnnotations(file);
          refreshAfterImport();
          showToast(buildImportSuccessMessage(result), 'success');
        } catch (error) {
          showError('ANNOTATION_LIGHT_IMPORT', error && error.message ? error.message : 'Import failed');
        }
      });
    }
  }

  window.__annotationLightweightModule = {
    configureManualLightweightAnnotationRuntime: configureManualLightweightAnnotationRuntime,
    buildManualLightweightAnnotationTemplate: buildManualLightweightAnnotationTemplate,
    exportManualLightweightAnnotations: exportManualLightweightAnnotations,
    importManualLightweightAnnotations: importManualLightweightAnnotations,
    buildImportSuccessMessage: buildImportSuccessMessage,
    initManualLightweightAnnotationControls: initManualLightweightAnnotationControls
  };
})();
