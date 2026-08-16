import { mkdir, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { rehearseRealProfileCopy } from './lib/read-web-real-profile-rehearsal.mjs'

const options = parseArguments(process.argv.slice(2))
await mkdir(options.isolatedRoot, { recursive: true })
options.isolatedRoot = await realpath(options.isolatedRoot)
const result = await rehearseRealProfileCopy(options)
const report = {
  schemaVersion: 'read-web.real-profile-rehearsal.v1',
  status: result.status,
  sourceUnchanged: result.sourceUnchanged,
  artifactChecksum: result.artifactChecksum,
  recordCounts: result.recordCounts,
  domainChecksums: result.domainChecksums,
  restoredRecordCounts: result.restoredRecordCounts,
  restoredDomainChecksums: result.restoredDomainChecksums,
  journeys: result.journeys,
  browserEvidence: result.browserEvidence,
  isolatedArtifacts: {
    runRoot: path.relative(options.isolatedRoot, result.runRoot),
    artifact: path.relative(options.isolatedRoot, result.artifactPath),
    browserProfile: path.relative(options.isolatedRoot, result.restoredProfileDir),
    workflowData: path.relative(options.isolatedRoot, result.restoredWorkflowDataRoot),
  },
}
const reportPath = path.join(options.isolatedRoot, 'real-profile-rehearsal-report.json')
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ ...report, reportPath }, null, 2))

function parseArguments(args) {
  const values = {}
  const additionalOutputRoots = []
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]
    const value = args[index + 1]
    if (!name?.startsWith('--') || value === undefined) {
      throw configurationError('Arguments must use explicit --name value pairs')
    }
    const key = name.slice(2)
    if (key === 'additional-output-root') additionalOutputRoots.push(value)
    else values[key] = value
  }
  const required = ['browser-profile-dir', 'browser-origin', 'workflow-data-root', 'isolated-root']
  for (const name of required) {
    if (!values[name]) throw configurationError(`Missing required --${name}`)
  }
  return {
    browserProfileDir: values['browser-profile-dir'],
    browserOrigin: values['browser-origin'],
    workflowDataRoot: values['workflow-data-root'],
    isolatedRoot: path.resolve(values['isolated-root']),
    additionalOutputRoots,
    pythonCommand: values['python-command'] || 'python',
  }
}

function configurationError(message) {
  const error = new Error(message)
  error.code = 'REAL_PROFILE_REHEARSAL_CONFIGURATION'
  return error
}
