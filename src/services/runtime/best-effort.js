import { createErrorPresenter } from './error-presenter.js'

const presenter = createErrorPresenter()

export function recordBestEffortFailure(error, context = {}) {
  const operationId = String(context.operationId || '').trim()
  if (!operationId) throw new TypeError('best-effort operationId is required')
  const reason = String(context.reason || '').trim()
  if (!reason) throw new TypeError('best-effort reason is required')
  const presentation = presenter.present(error, {
    operationId,
    details: {
      ...(context.details || {}),
      bestEffort: true,
      reason,
    },
  })
  const logger = context.logger || console
  if (logger && typeof logger.warn === 'function') {
    logger.warn('[read-web best-effort failure]', presentation.diagnostic)
  }
  return presentation
}

export function observeBestEffort(promise, context = {}) {
  return Promise.resolve(promise).catch((error) => {
    recordBestEffortFailure(error, context)
    return context.fallback
  })
}
