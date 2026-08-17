let runtimeStores = null

export function configurePiniaRuntimeStores(stores) {
  runtimeStores = Object.freeze({ ...stores })
  return runtimeStores
}

export function getPiniaRuntimeStores() {
  return runtimeStores
}

export function requirePiniaRuntimeStores() {
  if (!runtimeStores) throw new Error('Pinia runtime stores are not configured')
  return runtimeStores
}
