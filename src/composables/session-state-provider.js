let sessionState = null;

export function configureSessionStateProvider(state) {
  sessionState = state || null;
}

export function getSessionState() {
  if (!sessionState) {
    throw new Error('Session state provider has not been configured');
  }
  return sessionState;
}

window.__sessionStateProvider = {
  configure: configureSessionStateProvider,
  getState: getSessionState
};
