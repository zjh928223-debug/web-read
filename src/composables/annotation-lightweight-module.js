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

  async function importManualLightweightAnnotations(file, options) {
    if (typeof runtimeHandlers.importManualLightweightAnnotations === 'function') {
      return runtimeHandlers.importManualLightweightAnnotations(file, options);
    }
    throw new Error('Annotation lightweight import module is not ready');
  }

  function initManualLightweightAnnotationControls(deps) {
    deps = deps || {};
    var exportButton = deps.exportButton || null;
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

  }

  window.__annotationLightweightModule = {
    configureManualLightweightAnnotationRuntime: configureManualLightweightAnnotationRuntime,
    buildManualLightweightAnnotationTemplate: buildManualLightweightAnnotationTemplate,
    exportManualLightweightAnnotations: exportManualLightweightAnnotations,
    importManualLightweightAnnotations: importManualLightweightAnnotations,
    initManualLightweightAnnotationControls: initManualLightweightAnnotationControls
  };
})();
