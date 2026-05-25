(function () {
  'use strict';

  var toastTimer = null;

  function showToast(message, type, timeoutMs) {
    if (type === undefined) type = 'info';
    if (timeoutMs === undefined) timeoutMs = 2600;
    var toast = document.getElementById('app-toast');
    if (!toast) return;
    toast.textContent = message || '';
    toast.className = '';
    toast.classList.add(type);
    toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    if (timeoutMs > 0) {
      toastTimer = setTimeout(function () {
        toast.classList.remove('show');
      }, timeoutMs);
    }
  }

  function showError(code, detail) {
    var suffix = detail ? '\n' + detail : '';
    showToast('Error [' + code + ']' + suffix, 'error', 3800);
  }

  window.__uiStore = {
    showToast: showToast,
    showError: showError
  };
})();
