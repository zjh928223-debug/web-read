import { execFile } from 'node:child_process'
import {
  REPOSITORY_ROOT,
  WINDOWS_OWNER_DOMAINS,
  artifactSetChecksum,
  assert,
  checksumFor,
  loadOwnerArtifacts,
  sha256Text,
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
assert(baseline.runtimeVerification?.mode === 'execute-pass-commands', 'baseline runtime verification mode is not executable')
assert(baseline.runtimeVerification?.runner === 'scripts/windows-local-owner-baseline-check.mjs', 'baseline runtime verification runner changed')
assert(environment.optimizationIsolation.realProfilePayloadRead === false, 'baseline cannot read a real profile payload')
assert(environment.optimizationIsolation.realProfilePayloadWrite === false, 'baseline cannot write a real profile payload')

const journeyIds = baseline.journeys.map((journey) => journey.id)
assert(JSON.stringify([...journeyIds].sort()) === JSON.stringify([...requiredJourneys].sort()), 'baseline journey set is incomplete or has extras')
const domainJourneyIds = new Set(['reader-session', 'vocabulary-srs', 'passage-preview', 'annotation', 'marks-activity', 'workflow'])
let passCount = 0
let blockedCount = 0
let notRunCount = 0
const runtimeEvidence = []
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
      const result = await executeFocusedEvidence(evidence.command)
      assert(
        result.exitCode === 0,
        `${journey.id}/${evidence.checkId} command failed with exit ${String(result.exitCode)}: ${result.output.slice(-2000)}`,
      )
      runtimeEvidence.push({
        journeyId: journey.id,
        checkId: evidence.checkId,
        exitCode: result.exitCode,
        outputChecksum: sha256Text(result.output),
      })
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
console.log(`runtime evidence verified: ${JSON.stringify({ count: runtimeEvidence.length, outputSetChecksum: checksumFor(runtimeEvidence) })}`)
console.log(`baseline artifact set checksum: ${artifactSetChecksum(artifacts)}`)

async function executeFocusedEvidence(command) {
  const [scriptPath] = parseNodeScriptCommand(command)
  return new Promise((resolve) => {
    execFile(process.execPath, [scriptPath], {
      cwd: REPOSITORY_ROOT,
      shell: false,
      windowsHide: true,
      timeout: 60000,
      maxBuffer: 128 * 1024,
    }, (error, stdout = '', stderr = '') => {
      const exitCode = error === null
        ? 0
        : typeof error.code === 'number' ? error.code : null
      resolve({
        exitCode,
        output: `${String(stdout)}\n${String(stderr)}`,
      })
    })
  })
}

function parseNodeScriptCommand(command) {
  const parts = String(command).trim().split(/\s+/u)
  assert(parts[0] === 'node' && parts.length === 2, `unsupported baseline command (only node scripts are executable): ${command}`)
  assert(/^scripts[\\/][^\\/]+\.(?:cjs|mjs|js)$/u.test(parts[1]), `baseline command must target a scripts file: ${command}`)
  return [parts[1].replaceAll('\\', '/')]
}
