export const SRS_REVIEW_SOURCE_SELECTOR_VERSION = 'srs-review-source-selector.v1'

export function resolveSrsReviewV2Enabled(value) {
  if (value == null || value === '') return true
  if (typeof value === 'boolean') return value
  return !['0', 'false', 'off', 'legacy'].includes(String(value).trim().toLowerCase())
}

export function createSrsReviewSourceSelector(options = {}) {
  const v2Service = options.v2Service
  const legacyService = options.legacyService
  if (!isReviewServiceV2(v2Service)) {
    throw new Error('SRS review source selector requires a V2 review service')
  }
  if (!isLegacyReviewService(legacyService)) {
    throw new Error('SRS review source selector requires a legacy review service')
  }
  const v2Enabled = resolveSrsReviewV2Enabled(options.v2Enabled)
  const probeRetryDelayMs = Math.max(0, Number(options.probeRetryDelayMs ?? 40) || 0)

  const selector = {
    reviewSourceSelectorVersion: SRS_REVIEW_SOURCE_SELECTOR_VERSION,
    async resolveReviewSource(context = {}) {
      if (!v2Enabled) {
        return { source: 'legacy', service: legacyService, reason: 'v2_feature_flag_off' }
      }
      try {
        if (await v2Service.hasReviewCards(context)) {
          return { source: 'v2', service: v2Service, reason: 'v2_cards_available' }
        }
      } catch (error) {
        try {
          if (probeRetryDelayMs) await delay(probeRetryDelayMs)
          if (await v2Service.hasReviewCards(context)) {
            return { source: 'v2', service: v2Service, reason: 'v2_cards_available_after_retry' }
          }
        } catch (retryError) {
          return {
            source: 'legacy',
            service: legacyService,
            reason: 'v2_probe_failed',
            probeError: retryError,
          }
        }
      }
      return { source: 'legacy', service: legacyService, reason: 'v2_cards_unavailable' }
    },
  }

  if (typeof legacyService.cacheGeneralMeanings === 'function') {
    selector.cacheGeneralMeanings = (...args) => legacyService.cacheGeneralMeanings(...args)
  }
  return selector
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function isReviewServiceV2(service) {
  return Boolean(
    service
    && typeof service.startReviewSession === 'function'
    && typeof service.resumeReviewSession === 'function'
    && typeof service.recordReviewAttempt === 'function'
    && typeof service.getReviewCards === 'function',
  )
}

export function isLegacyReviewService(service) {
  return Boolean(
    service
    && typeof service.getDueWords === 'function'
    && typeof service.reviewWord === 'function',
  )
}
