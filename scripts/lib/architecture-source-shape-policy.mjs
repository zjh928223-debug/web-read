export const CANONICAL_ARCHITECTURE_SOURCE_SHAPE_COUNT = 78

export const TEMPORARY_ARCHITECTURE_SOURCE_SHAPE_EXCLUSIONS = new Map([
  ['scripts/runtime-state-source-check.cjs', {
    task: '10.5',
    expectedFailure: 'should not read window.__state',
  }],
  ['scripts/video-player-module-check.cjs', {
    task: '10.5',
    expectedFailure: 'workflow loader should register video availability at load time',
  }],
])

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
  'scripts/production-host-lifecycle-check.mjs',
  'scripts/runtime-config-integration-check.mjs',
  'scripts/srs-review-check.cjs',
  'scripts/srs-review-ui-v2-check.cjs',
  'scripts/verify-vocabulary-personalization-content.mjs',
  'scripts/verify-vocabulary-personalization-shadow.mjs',
  'scripts/vocabulary-context-evidence-check.cjs',
  'scripts/vocabulary-preview-service-check.cjs',
  'scripts/youtube-workflow-loader-check.cjs',
  'scripts/youtube-workflow-panel-check.cjs',
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
