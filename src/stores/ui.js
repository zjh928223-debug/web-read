  function showToast(message, type, timeoutMs) {
    // Delegate to Vue ToastMessage component (set on window by component setup)
    if (typeof window.showToast === 'function') {
      return window.showToast(message, type, timeoutMs);
    }
  }

  function showError(code, detail) {
    if (typeof window.showError === 'function') {
      return window.showError(code, detail);
    }
  }

  window.__uiStore = {
    showToast: showToast,
    showError: showError
  };
