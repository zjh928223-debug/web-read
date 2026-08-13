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
  domain('marks-activity', process.execPath, ['scripts/latest-wins-ledger-check.mjs'], {
    recovery: 'failed latest intent remains dirty and succeeds through the public retry entry',
  }),
  domain('vocabulary', process.execPath, ['scripts/vocabulary-snapshot-repository-check.mjs'], {
    'multi-tab': 'two public repository instances serialize concurrent snapshot updates',
    'unknown-version': 'unknown schema is rejected without rewriting the source row',
    recovery: 'known legacy schema migrates with a pre-migration source backup',
  }),
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
  domain('workflow', pythonCommand(), ['-m', 'unittest', 'tests.test_durable_json_repository'], {
    corrupt: 'public WorkflowStore load quarantines corrupt primary state',
    recovery: 'public WorkflowStore load recovers a valid backup before accepting writes',
  }, path.join(root, 'tools', 'subtitle-workflow')),
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
