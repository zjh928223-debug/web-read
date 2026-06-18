export const runtimeState = {};

export function getRuntimeState() {
  return runtimeState;
}

window.__state = runtimeState;
