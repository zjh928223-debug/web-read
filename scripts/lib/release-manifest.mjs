import { createHash } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function sha256File(filename) {
  return createHash('sha256').update(await readFile(filename)).digest('hex')
}

export async function readReleaseManifest(manifestPath) {
  const bytes = await readFile(manifestPath)
  const manifest = JSON.parse(bytes.toString('utf8'))
  if (manifest.schemaVersion !== 1 || !manifest.release?.gitSha || !Array.isArray(manifest.artifacts)) {
    throw new Error(`unsupported release manifest: ${manifestPath}`)
  }
  return { manifest, sha256: createHash('sha256').update(bytes).digest('hex') }
}

export async function verifyReleaseManifest(manifestPath, rootOverride = '') {
  const { manifest, sha256 } = await readReleaseManifest(manifestPath)
  const root = path.resolve(rootOverride || manifest.release.root || path.dirname(manifestPath))
  const failures = []
  for (const artifact of manifest.artifacts) {
    const filename = path.resolve(root, artifact.path)
    if (filename !== root && !filename.startsWith(`${root}${path.sep}`)) {
      failures.push(`${artifact.path}: outside release root`)
      continue
    }
    try {
      const actual = await sha256File(filename)
      if (actual !== artifact.sha256) failures.push(`${artifact.path}: checksum mismatch`)
    } catch (error) {
      failures.push(`${artifact.path}: ${error.code || 'read failed'}`)
    }
  }
  return { manifest, manifestSha256: sha256, root, failures, passed: failures.length === 0 }
}

export async function writeJsonAtomic(filename, value) {
  const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, filename)
}
