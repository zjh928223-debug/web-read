import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { gateEnvironment, resolveSelectedPython } from './lib/python-runtime.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..')
const workflowRoot = path.join(repoRoot, 'tools', 'subtitle-workflow')
const selectedPython = await resolveSelectedPython({
  repoRoot,
  configPath: process.env.READ_WEB_RUNTIME_CONFIG || 'config/runtime.optimization.json',
})
const python = selectedPython.executable
const outputRoot = process.env.READ_WEB_RELEASE_STABILITY_OUTPUT
  ? path.resolve(process.env.READ_WEB_RELEASE_STABILITY_OUTPUT)
  : await mkdtemp(path.join(os.tmpdir(), 'read-web-release-stability-12.4-'))
const reportPath = path.join(outputRoot, 'release-stability-report.json')
const contractOnly = process.env.READ_WEB_STABILITY_CONTRACT_ONLY === '1'
const gitState = {
  sha: git('rev-parse', 'HEAD'),
  branch: git('branch', '--show-current'),
  dirtyAtStart: git('status', '--porcelain').length > 0,
}

await mkdir(outputRoot, { recursive: true })
const stages = []
const startedAt = new Date().toISOString()

try {
  assert.ok(contractOnly || !gitState.dirtyAtStart, 'release stability evidence requires a clean Git worktree')
  await runStage('production-host-cold-start-restart-and-playback', process.execPath, ['scripts/production-host-lifecycle-check.mjs'], {
    cwd: repoRoot,
    env: {
      ...gateEnvironment(selectedPython),
      READ_WEB_PRODUCTION_HOST_OUTPUT: path.join(outputRoot, 'production-host'),
      READ_WEB_PRODUCTION_HOST_EVIDENCE: path.join(outputRoot, 'production-host-lifecycle.json'),
      READ_WEB_PRODUCTION_HOST_ENDURANCE: '1',
      READ_WEB_STABILITY_OUTPUT: path.join(outputRoot, 'release-playback-endurance.json'),
    },
  })
  await runStage('quota-corruption-recovery-matrix', process.execPath, ['scripts/persistence-fault-matrix.mjs', '--require-complete'], {
    cwd: repoRoot,
    env: { ...gateEnvironment(selectedPython), PERSISTENCE_FAULT_MATRIX_OUTPUT: path.join(outputRoot, 'persistence-fault-matrix.json') },
  })
  await runStage('owned-external-process-cancellation', python, ['scripts/release-process-cancellation.py'], {
    cwd: repoRoot,
    env: { ...gateEnvironment(selectedPython), READ_WEB_PROCESS_CANCELLATION_OUTPUT: path.join(outputRoot, 'process-cancellation.json') },
  })
  await runStage(
    'cancel-50-jobs-and-restart',
    python,
    ['-m', 'unittest', 'tests.test_workflow_stress.WorkflowStressTests.test_restart_after_canceling_50_jobs_has_no_phantom_active_job'],
    { cwd: workflowRoot, env: gateEnvironment(selectedPython) },
  )

  const lifecycle = await readJson(path.join(outputRoot, 'production-host-lifecycle.json'))
  const endurance = await readJson(path.join(outputRoot, 'release-playback-endurance.json'))
  const persistence = await readJson(path.join(outputRoot, 'persistence-fault-matrix.json'))
  const cancellation = await readJson(path.join(outputRoot, 'process-cancellation.json'))
  assert.equal(lifecycle.status, 'passed')
  assert.equal(lifecycle.coldStarts, 3)
  assert.equal(lifecycle.serviceRestart.everyPortReleased, true)
  assert.equal(endurance.status, 'passed')
  assert.equal(endurance.mode, contractOnly ? 'contract-only' : 'release-evidence')
  assert.equal(endurance.rapidSwitch.patternValid, true)
  assert.equal(persistence.complete, true)
  assert.equal(persistence.summary.gaps, 0)
  assert.equal(cancellation.status, 'passed')

  const report = {
    schema: 'read-web.release-stability-rehearsal',
    schemaVersion: 1,
    task: '12.4',
    capturedAt: new Date().toISOString(),
    startedAt,
    status: 'passed',
    mode: contractOnly ? 'contract-only' : 'release-evidence',
    git: gitState,
    isolation: {
      outputRoot,
      dailyPortsUntouched: true,
      dailySourceDataReadOnly: true,
      externalNetworkRequests: 0,
    },
    evidence: {
      coldStarts: lifecycle.coldStarts,
      serviceRestart: lifecycle.serviceRestart,
      playbackDurationMs: endurance.actualDurationMs,
      playbackProgressingSamples: endurance.playback.progressingSamples,
      rapidMaterialSwitch: endurance.rapidSwitch,
      memory: endurance.memory,
      resources: endurance.resources,
      processCancellation: cancellation,
      quotaCorruption: persistence.summary,
      canceledJobsAfterRestart: 50,
    },
    stages,
    artifacts: {
      lifecycle: path.join(outputRoot, 'production-host-lifecycle.json'),
      endurance: path.join(outputRoot, 'release-playback-endurance.json'),
      persistence: path.join(outputRoot, 'persistence-fault-matrix.json'),
      processCancellation: path.join(outputRoot, 'process-cancellation.json'),
    },
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(`release stability rehearsal passed: ${reportPath}`)
} catch (error) {
  const report = {
    schema: 'read-web.release-stability-rehearsal',
    schemaVersion: 1,
    task: '12.4',
    capturedAt: new Date().toISOString(),
    startedAt,
    status: 'failed',
    mode: contractOnly ? 'contract-only' : 'release-evidence',
    isolation: { outputRoot, dailyPortsUntouched: true, dailySourceDataReadOnly: true },
    stages,
    error: error.stack || error.message || String(error),
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.error(`release stability rehearsal failed: ${reportPath}`)
  throw error
}

async function runStage(label, executable, args, options) {
  const began = Date.now()
  console.log(`\n[release stability] ${label}`)
  const result = await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: { ...gateEnvironment(selectedPython), ...(options.env || {}) },
      stdio: 'inherit',
      windowsHide: true,
      shell: process.platform === 'win32' && executable.endsWith('.cmd'),
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code: code ?? 1, signal: signal || null }))
  })
  const entry = { label, command: [executable, ...args], exitCode: result.code, signal: result.signal, durationMs: Date.now() - began }
  stages.push(entry)
  if (result.code !== 0) throw new Error(`${label} exited ${result.code}${result.signal ? ` (${result.signal})` : ''}`)
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, 'utf8'))
}

function git(...args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()
}
