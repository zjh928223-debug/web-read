import browserPortPolicy from './browser-port-policy.cjs'

export const isBrowserSafePort = browserPortPolicy.isBrowserSafePort
export const listenOnBrowserSafePort = browserPortPolicy.listenOnBrowserSafePort
export const RESERVED_DAILY_PORTS = browserPortPolicy.RESERVED_DAILY_PORTS
