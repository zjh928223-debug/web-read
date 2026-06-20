export function createSessionAnnotationApiSettingsRuntime(deps = {}) {
  function initAnnotationApiSettingsUi() {
    if (!deps.buttonEl || deps.buttonEl.hidden) return;
    const configHelper = typeof deps.getAnnotationApiConfigHelper === 'function'
      ? deps.getAnnotationApiConfigHelper()
      : null;
    if (configHelper && typeof configHelper.restore === 'function') {
      configHelper.restore();
    }

    const settingsUi = typeof deps.getAnnotationApiSettingsUiApi === 'function'
      ? deps.getAnnotationApiSettingsUiApi()
      : null;
    if (!settingsUi || typeof settingsUi.init !== 'function') return;
    settingsUi.init({
      buttonEl: deps.buttonEl,
      panelEl: deps.panelEl,
      onChange: () => {
        deps.syncAnnotationGenerationEntryStatus();
      }
    });
  }

  return {
    initAnnotationApiSettingsUi
  };
}
