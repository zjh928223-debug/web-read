function getPiniaUiStore() {
  const stores = window.__piniaStores;
  return stores && stores.ui ? stores.ui : null;
}

export function showToast(message, type, timeoutMs) {
  const uiStore = getPiniaUiStore();
  if (uiStore && typeof uiStore.showToast === 'function') {
    return uiStore.showToast(message, type, timeoutMs);
  }
}

export function showError(code, detail) {
  const uiStore = getPiniaUiStore();
  if (uiStore && typeof uiStore.showError === 'function') {
    return uiStore.showError(code, detail);
  }
  const suffix = detail ? '\n' + detail : '';
  return showToast('Error [' + code + ']' + suffix, 'error', 3800);
}

window.showToast = showToast;
window.showError = showError;
