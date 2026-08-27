export const CANONICAL_ARCHITECTURE_SOURCE_SHAPE_COUNT = 80

export const TEMPORARY_ARCHITECTURE_SOURCE_SHAPE_EXCLUSIONS = new Map()

export const ARCHITECTURE_EVIDENCE_OWNED_BY_OTHER_GATES = new Set([
  'scripts/exam-vocabulary-import-closure-check.cjs',
  'scripts/learning-page-launcher-check.mjs',
  'scripts/legacy-vocabulary-audit-check.cjs',
  'scripts/legacy-vocabulary-migration-check.mjs',
  'scripts/local-sentence-warehouse-check.mjs',
  'scripts/merriam-webster-sentence-check.mjs',
  'scripts/passage-preview-check.cjs',
  'scripts/personalization-shadow-activation-check.mjs',
  'scripts/personalization-shadow-diagnostics-check.mjs',
  'scripts/personalization-shadow-product-boundary-check.mjs',
  'scripts/production-host-lifecycle-check.mjs',
  'scripts/runtime-config-integration-check.mjs',
  'scripts/application-backup-target-integrity-matrix-check.mjs',
  'scripts/application-backup-capability-structure-check.cjs',
  'scripts/srs-review-check.cjs',
  'scripts/srs-review-ui-v2-check.cjs',
  'scripts/verify-vocabulary-personalization-content.mjs',
  'scripts/verify-vocabulary-personalization-shadow.mjs',
  'scripts/vocabulary-context-evidence-check.cjs',
  'scripts/vocabulary-preview-service-check.cjs',
  'scripts/youtube-workflow-loader-check.cjs',
  'scripts/youtube-workflow-panel-check.cjs',
  'scripts/youtube-workflow-panel-v3-check.cjs',
])

export const CANONICAL_ARCHITECTURE_SOURCE_SHAPE_EXCLUSIONS = new Set([
  'scripts/test-inventory.mjs',
  'scripts/verify-architecture.mjs',
  ...TEMPORARY_ARCHITECTURE_SOURCE_SHAPE_EXCLUSIONS.keys(),
])

export function isArchitectureGuard(relativePath) {
  const basename = relativePath.split('/').pop() || relativePath
  return /(?:-check\.|-gate\.|-guard\.|-drain\.|-boundary\.|-facades\.|-module\.|-state\.|-owner\.|-deps\.|-refs\.|-order\.|-runtime\.|-audit\.|-migration\.|-ledger\.|^verify-)/.test(basename)
}

export function isCanonicalArchitectureSourceShapeOwner({ relativePath, layers, evidence, invocation = 'direct' }) {
  return evidence?.sourceShape?.length > 0
    && layers?.includes('architecture')
    && isArchitectureGuard(relativePath)
    && !layers.some((layer) => ['browser', 'performance', 'release'].includes(layer))
    && !ARCHITECTURE_EVIDENCE_OWNED_BY_OTHER_GATES.has(relativePath)
    && !CANONICAL_ARCHITECTURE_SOURCE_SHAPE_EXCLUSIONS.has(relativePath)
    && invocation !== 'inventory-only'
}
