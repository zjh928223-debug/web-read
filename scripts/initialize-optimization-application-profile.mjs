import process from 'node:process'

import { initializeIsolatedBrowserProfileIfMissing } from './lib/read-web-production-backup.mjs'

try {
  const options = parseArguments(process.argv.slice(2))
  const result = await initializeIsolatedBrowserProfileIfMissing(options)
  process.stdout.write(`${JSON.stringify(result)}\n`)
} catch (error) {
  const code = typeof error?.code === 'string' && error.code ? error.code : 'PROFILE_INITIALIZATION_FAILED'
  process.stderr.write(`${code}: ${error?.message || String(error)}\n`)
  process.exitCode = 1
}

function parseArguments(values) {
  const result = {}
  const optionNames = {
    '--isolation-root': 'isolationRoot',
    '--profile-dir': 'profileDir',
  }
  for (let index = 0; index < values.length; index += 1) {
    const name = values[index]
    if (!(name in optionNames)) {
      throw new Error(`unknown argument: ${name}`)
    }
    const value = values[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`${name} requires a value`)
    }
    result[optionNames[name]] = value
    index += 1
  }
  if (!result.isolationRoot || !result.profileDir) {
    throw new Error('--isolation-root and --profile-dir are required')
  }
  return result
}
