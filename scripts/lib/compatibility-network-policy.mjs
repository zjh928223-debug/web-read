export function shouldContinueStaticRequest(requestUrl, targetOrigin) {
  const request = new URL(requestUrl)
  const origin = new URL(targetOrigin).origin
  const isApiRequest = request.pathname === '/api' || request.pathname.startsWith('/api/')
  return request.origin === origin && !isApiRequest
}
