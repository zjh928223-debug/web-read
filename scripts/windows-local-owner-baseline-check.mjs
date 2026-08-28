import {
  WINDOWS_OWNER_DOMAINS,
  artifactSetChecksum,
  assert,
  loadOwnerArtifacts,
} from './lib/windows-local-owner-artifacts.mjs'

const artifacts = await loadOwnerArtifacts()
const baseline = artifacts['baseline-journeys.json']
const environment = artifacts['environment-baseline.json']
const requiredJourneys = [
  'cold-start', 'reader-session', 'vocabulary-srs', 'passage-preview', 'annotation',
  'marks-activity', 'workflow', 'a-b-a', 'host-restart', 'large-media-range',
]

assert(baseline.environmentRef === 'environment-baseline.json', 'baseline must reference environment artifact')
assert(baseline.executionPolicy.frontend === '127.0.0.1:5184', 'baseline frontend port is not isolated')
assert(baseline.executionPolicy.backend === '127.0.0.1:8776', 'baseline backend port is not isolated')
assert(baseline.executionPolicy.dataRoot === 'E:\\ReadWebData\\SubtitleWorkflow-Optimization', 'baseline data root is not isolated')
assert(environment.optimizationIsolation.realProfilePayloadRead === false, 'baseline cannot read a real profile payload')
assert(environment.optimizationIsolation.realProfilePayloadWrite === false, 'baseline cannot write a real profile payload')

const journeyIds = baseline.journeys.map((journey) => journey.id)
assert(JSON.stringify([...journeyIds].sort()) === JSON.stringify([...requiredJourneys].sort()), 'baseline journey set is incomplete or has extras')
const domainJourneyIds = new Set(['reader-session', 'vocabulary-srs', 'passage-preview', 'annotation', 'marks-activity', 'workflow'])
let passCount = 0
let blockedCount = 0
let notRunCount = 0
for (const journey of baseline.journeys) {
  assert(journey.apiFirstStatus === 'blocked', `${journey.id} must remain blocked until owner API implementation`)
  assert(typeof journey.blocker === 'string' && journey.blocker.length > 0, `${journey.id} lacks an explicit blocker`)
  assert(typeof journey.rollbackTarget === 'string' && journey.rollbackTarget.length > 0, `${journey.id} lacks rollback target`)
  if (domainJourneyIds.has(journey.id)) assert(journey.legacyEvidence.length > 0, `${journey.id} lacks current compatibility evidence`)
  blockedCount += 1
  for (const evidence of journey.legacyEvidence) {
    assert(['pass', 'not-run'].includes(evidence.status), `${journey.id}/${evidence.checkId} has invalid evidence status`)
    assert(typeof evidence.command === 'string' && evidence.command.length > 0, `${journey.id}/${evidence.checkId} lacks command`)
    if (evidence.status === 'pass') {
      assert(evidence.exitCode === 0, `${journey.id}/${evidence.checkId} pass must have exitCode 0`)
      passCount += 1
    } else {
      assert(evidence.exitCode === null, `${journey.id}/${evidence.checkId} not-run must have null exitCode`)
      notRunCount += 1
    }
  }
}

assert(baseline.overall.apiFirstOwnerReady === false, 'baseline cannot claim owner readiness')
assert(baseline.overall.legacyEvidenceOnly === true, 'baseline must be marked legacy-evidence-only')
assert(baseline.overall.liveServiceStarted === false, 'baseline artifact unexpectedly claims a live service')
assert(baseline.overall.cutoverExecuted === false, 'baseline artifact claims a cutover')
assert(baseline.overall.domainWritersMigrated === false, 'baseline artifact claims writer migration')
assert(WINDOWS_OWNER_DOMAINS.length === 6, 'baseline domain set must remain six')

console.log(`windows local owner baseline passed (${passCount} focused evidence passes, ${blockedCount} API-first blockers, ${notRunCount} intentionally not-run live checks)`)
console.log(`baseline artifact set checksum: ${artifactSetChecksum(artifacts)}`)
