export function ensureVueRenderingDefault() {
  if (typeof window.__USE_VUE_RENDERING === 'undefined') {
    window.__USE_VUE_RENDERING = true;
  }
  return window.__USE_VUE_RENDERING;
}

ensureVueRenderingDefault();
