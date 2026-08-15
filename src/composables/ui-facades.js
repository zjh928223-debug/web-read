const pendingNotifications = [];
const MAX_PENDING_NOTIFICATIONS = 20;

function getPiniaUiStore() {
  const stores = window.__piniaStores;
  return stores && stores.ui ? stores.ui : null;
}

export function showToast(message, type, timeoutMs) {
  const uiStore = getPiniaUiStore();
  if (uiStore && typeof uiStore.showToast === 'function') {
    return uiStore.showToast(message, type, timeoutMs);
  }
  enqueueNotification('showToast', [message, type, timeoutMs]);
}

export function showError(code, detail) {
  const uiStore = getPiniaUiStore();
  if (uiStore && typeof uiStore.showError === 'function') {
    return uiStore.showError(code, detail);
  }
  enqueueNotification('showError', [code, detail]);
}

function enqueueNotification(method, args) {
  if (pendingNotifications.length >= MAX_PENDING_NOTIFICATIONS) pendingNotifications.shift();
  pendingNotifications.push({ method, args });
}

export function flushPendingUiNotifications() {
  const uiStore = getPiniaUiStore();
  if (!uiStore) return 0;
  const queued = pendingNotifications.splice(0);
  for (const notification of queued) {
    const handler = uiStore[notification.method];
    if (typeof handler === 'function') handler.apply(uiStore, notification.args);
  }
  return queued.length;
}

window.showToast = showToast;
window.showError = showError;
