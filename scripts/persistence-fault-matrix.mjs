import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = path.resolve(root, process.env.PERSISTENCE_FAULT_MATRIX_OUTPUT || 'output/verification/persistence-fault-matrix.json')
const requireComplete = process.argv.includes('--require-complete')
const conditions = ['multi-tab', 'quota', 'corrupt', 'unknown-version', 'page-close', 'recovery']

const domains = [
  domain('reader', process.execPath, ['scripts/reader-session-persistence-check.mjs'], {
    'multi-tab': 'stale expectedRevision cannot overwrite a newer committed session',
    quota: 'failed transaction preserves the previous committed session',
    corrupt: 'malformed/checksum-invalid rows return corrupt and are quarantined',
    'unknown-version': 'unknown session schema is rejected and quarantined without source rewrite',
    'page-close': 'real Chromium closes the writer after put success but before transaction completion and reloads only a whole old/new session',
    recovery: 'legacy/committed session reload returns an intact session',
  }, root, [
    command(process.execPath, ['scripts/reader-session-persistence-check.mjs']),
    command(process.execPath, ['scripts/reader-session-load-browser-journeys-check.mjs']),
  ]),
  domain('marks-activity', process.execPath, ['scripts/reader-marks-activity-conflict-check.mjs'], Object.fromEntries(conditions.map((condition) => [condition, {
    'multi-tab': 'two public browser pages retain independent operations and backend revision CAS keeps one same-job winner',
    quota: 'public marks/activity repositories preserve the last committed revision when durable replace fails',
    corrupt: 'public repositories quarantine the original corrupt value and recover only through an explicit backup path',
    'unknown-version': 'unknown repository and outbox schemas fail closed without rewriting or replaying the source',
    'page-close': 'authenticated keepalive writes retain a versioned per-operation outbox for reload; BFCache support is reported by the browser probe',
    recovery: 'restart replays durable operation receipts and per-operation browser outbox entries idempotently',
  }[condition]])), root, [
    command(process.execPath, ['scripts/reader-marks-activity-conflict-check.mjs']),
    command(process.execPath, ['scripts/youtube-workflow-panel-reader-recovery-browser-check.mjs']),
    command(pythonCommand(), ['-m', 'unittest', 'tests.test_reader_marks_activity_persistence'], path.join(root, 'tools', 'subtitle-workflow')),
  ]),
  domain('vocabulary', process.execPath, ['scripts/vocabulary-snapshot-repository-check.mjs'], Object.fromEntries(conditions.map((condition) => [condition, {
    'multi-tab': 'two real Chromium pages use revision CAS and retain one complete winner without mixed rows',
    quota: 'public repository and learning unit-of-work preserve the prior snapshot on QuotaExceededError',
    corrupt: 'checksum-invalid canonical rows retain a raw quarantine and recover from the last valid backup',
    'unknown-version': 'unknown snapshot and watermark schemas fail closed without source rewrite',
    'page-close': 'a real writer page closes before transaction completion and a fresh page observes only a complete old/new snapshot',
    recovery: 'recovery advances the monotonic revision watermark and remains conflict-safe for stale tabs',
  }[condition]])), root, [
    command(process.execPath, ['scripts/vocabulary-snapshot-repository-check.mjs']),
    command(process.execPath, ['scripts/vocabulary-persistence-faults-check.mjs']),
    command(process.execPath, ['scripts/vocabulary-learning-uow-faults-check.mjs']),
    command(process.execPath, ['scripts/vocabulary-repository-multi-page-browser-check.cjs']),
    command(process.execPath, ['scripts/vocabulary-revision-watermark-browser-check.cjs']),
  ]),
  domain('passage-preview', process.execPath, ['scripts/passage-preview-durable-state-check.mjs'], Object.fromEntries(conditions.map((condition) => [condition, {
    'multi-tab': 'expectedRevision rejects a stale writer',
    quota: 'failed synchronous write preserves the authoritative revision',
    corrupt: 'inspection distinguishes malformed JSON',
    'unknown-version': 'unknown durable schema is rejected with a typed code',
    'page-close': 'synchronous commit survives a fresh public load',
    recovery: 'corrupt state recovers only from explicit legacy state',
  }[condition]]))),
  domain('annotation', process.execPath, ['scripts/annotation-storage-envelope-check.mjs'], Object.fromEntries(conditions.map((condition) => [condition, {
    'multi-tab': 'expectedRevision rejects stale bundle save',
    quota: 'QuotaExceededError preserves previous authoritative envelope text',
    corrupt: 'malformed/checksum-invalid envelope returns typed corrupt',
    'unknown-version': 'unknown bundle schema returns a distinct typed code',
    'page-close': 'localStorage envelope survives immediate public reload',
    recovery: 'missing bundle loads legacy generated/status through loadBundle',
  }[condition]]))),
  domain('workflow', pythonCommand(), ['-m', 'unittest', 'tests.test_durable_json_repository'], Object.fromEntries(conditions.map((condition) => [condition, {
    'multi-tab': 'independent processes merge unrelated jobs and stale same-job mutations conflict',
    quota: 'ENOSPC, replace and fsync failures preserve the last authoritative workflow envelope',
    corrupt: 'corrupt primary state is quarantined with source evidence and recovers only from a valid backup',
    'unknown-version': 'unknown jobs/history schemas fail closed and cannot be overwritten',
    'page-close': 'real process termination and browser response loss leave a replayable complete operation receipt',
    recovery: 'service restart replays create, cancel and prioritize receipts without duplicate mutation',
  }[condition]])), path.join(root, 'tools', 'subtitle-workflow'), [
    command(pythonCommand(), ['-m', 'unittest', 'tests.test_durable_json_repository', 'tests.test_workflow_durable_faults'], path.join(root, 'tools', 'subtitle-workflow')),
    command(pythonCommand(), ['-m', 'unittest', 'tests.test_service_app.ServiceAppTests.test_cancel_and_prioritize_idempotency_receipts_replay_after_restart'], path.join(root, 'tools', 'subtitle-workflow')),
    command(process.execPath, ['scripts/youtube-workflow-operation-receipt-check.cjs']),
    command(process.execPath, ['scripts/youtube-workflow-durable-protocol-check.mjs']),
  ]),
]

const startedAt = new Date().toISOString()
for (const item of domains) item.execution = await run(item)
const cells = domains.flatMap((item) => conditions.map((condition) => ({
  domain: item.name,
  condition,
  status: item.execution.exitCode === 0 && item.coverage[condition] ? 'pass' : 'gap',
  evidence: item.execution.exitCode === 0 ? (item.coverage[condition] || 'no executable public-entry evidence mapped') : `evidence command failed with exit ${item.execution.exitCode}`,
  command: item.commands.map((entry) => [entry.executable, ...entry.args]),
})))
const gaps = cells.filter((cell) => cell.status !== 'pass')
const evidence = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  startedAt,
  complete: gaps.length === 0,
  conditions,
  domains: domains.map((item) => ({ name: item.name, execution: item.execution })),
  cells,
  summary: { passed: cells.length - gaps.length, gaps: gaps.length, total: cells.length },
}
await fs.mkdir(path.dirname(outputPath), { recursive: true })
await fs.writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
console.log(`persistence fault matrix: ${evidence.summary.passed}/${evidence.summary.total} pass, ${gaps.length} gaps`)
console.log(`evidence: ${outputPath}`)
for (const gap of gaps) console.log(`  GAP ${gap.domain}/${gap.condition}: ${gap.evidence}`)
if (domains.some((item) => item.execution.exitCode !== 0) || (requireComplete && gaps.length)) process.exitCode = 1

function command(executable, args, cwd = root) {
  return { executable, args, cwd }
}

function domain(name, executable, args, coverage, cwd = root, commands = null) {
  return { name, executable, args, coverage, cwd, commands: commands || [command(executable, args, cwd)] }
}

function pythonCommand() {
  return process.env.READ_WEB_PYTHON || process.env.PYTHON || 'python'
}

async function run(item) {
  const began = Date.now()
  const steps = []
  for (const entry of item.commands) {
    const result = await runCommand(entry)
    steps.push(result)
    if (result.exitCode !== 0) break
  }
  const failed = steps.find((step) => step.exitCode !== 0)
  return { exitCode: failed?.exitCode || 0, signal: failed?.signal || null, durationMs: Date.now() - began, steps }
}

function runCommand(entry) {
  const began = Date.now()
  return new Promise((resolve, reject) => {
    const child = spawn(entry.executable, entry.args, { cwd: entry.cwd, env: process.env, windowsHide: true, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({
      command: [entry.executable, ...entry.args],
      exitCode: code ?? 1,
      signal: signal || null,
      durationMs: Date.now() - began,
    }))
  })
}
