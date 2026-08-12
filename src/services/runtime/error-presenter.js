import { normalizeError } from './typed-error.js'

const CATEGORY_TITLES = Object.freeze({
  validation: 'Check the input',
  configuration: 'Configuration needed',
  network: 'Network problem',
  timeout: 'Timed out',
  canceled: 'Canceled',
  conflict: 'Update conflict',
  storage: 'Storage problem',
  'external-tool': 'Tool failed',
  permission: 'Permission required',
  internal: 'Something went wrong',
})

function statusState(category) {
  if (category === 'canceled') return 'canceled'
  if (category === 'timeout') return 'timed-out'
  return 'failed'
}

export function createErrorPresenter(options = {}) {
  const titles = { ...CATEGORY_TITLES, ...(options.titles || {}) }
  const retryLabel = String(options.retryLabel || 'Retry')

  function present(error, context = {}) {
    const typedError = normalizeError(error, context)
    const canceled = typedError.category === 'canceled'
    return {
      error: typedError,
      notice: {
        visible: !canceled,
        tone: canceled ? 'neutral' : 'error',
        title: titles[typedError.category],
        message: typedError.message,
        operationId: typedError.operationId,
      },
      status: {
        state: statusState(typedError.category),
        category: typedError.category,
        code: typedError.code,
        operationId: typedError.operationId,
      },
      retry: {
        allowed: typedError.retryable,
        label: retryLabel,
        operationId: typedError.operationId,
      },
      diagnostic: {
        category: typedError.category,
        code: typedError.code,
        operationId: typedError.operationId,
        details: typedError.details,
      },
    }
  }

  return { present }
}
