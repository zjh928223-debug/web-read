import { executeWindowsOwnerProductionEntry, parseWindowsOwnerProductionEntryArguments } from './lib/windows-owner-production-entry.mjs'

function safeError(error) {
  return {
    ok: false,
    error: {
      code: error?.code || 'OWNER_PRODUCTION_ENTRY_FAILED',
      message: error?.message || 'Windows owner production entry failed',
    },
  }
}

try {
  const parsed = parseWindowsOwnerProductionEntryArguments(process.argv.slice(2))
  const result = await executeWindowsOwnerProductionEntry(parsed)
  process.stdout.write(`${JSON.stringify(result)}\n`)
  if (result?.result?.ok === false || result?.status === 'blocked') process.exitCode = 1
} catch (error) {
  process.stderr.write(`${JSON.stringify(safeError(error))}\n`)
  process.exitCode = 1
}
