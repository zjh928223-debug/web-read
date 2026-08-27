import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { resolveViteConfigPath, verifyReleaseManifest } from './lib/release-manifest.mjs'

const execFileAsync = promisify(execFile)

async function pathExists(filename) {
  try {
    await stat(filename)
    return true
  } catch {
    return false
  }
}

const helperSource = await readFile(new URL('../src/features/passage-preview/passage-preview-learning-launch.js', import.meta.url), 'utf8')
const helperUrl = `data:text/javascript;base64,${Buffer.from(helperSource).toString('base64')}`
const { isPassagePreviewLearningLaunch } = await import(helperUrl)

assert.equal(isPassagePreviewLearningLaunch({ search: '?learning=preview' }), true)
assert.equal(isPassagePreviewLearningLaunch('http://127.0.0.1:5173/?learning=preview'), true)
assert.equal(isPassagePreviewLearningLaunch({ search: '?learning=review' }), false)
assert.equal(isPassagePreviewLearningLaunch({ search: '' }), false)

const appSource = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
assert.doesNotMatch(appSource, /isPassagePreviewLearningLaunch/)
assert.match(appSource, /@click="openPassagePreview"/)
assert.match(appSource, /async function openPassagePreview\(\)[\s\S]*?await openStoredPassagePreview\(\)/)
const onMountedBlock = appSource.match(/onMounted\(\(\) => \{[\s\S]*?\n\}\)/)?.[0] || ''
assert.doesNotMatch(onMountedBlock, /openStoredPassagePreview\(\)/)
assert.match(appSource, /function openStoredPassagePreview\(\)/)

const launcherSource = await readFile(new URL('./launch-learning-page.ps1', import.meta.url), 'utf8')
assert.match(launcherSource, /\[string\]\$RuntimeConfigPath = ''/)
assert.match(launcherSource, /runtime\.legacy\.json/)
assert.match(launcherSource, /\$learningUrl = "\$baseUrl\/"/)
assert.doesNotMatch(launcherSource, /\?learning=preview/)
assert.match(launcherSource, /runtime\.legacy\.json/)
assert.match(launcherSource, /Test-ReadWebServer/)
assert.match(launcherSource, /start-latest-reader\.ps1/)
assert.match(launcherSource, /Join-Path \$projectRoot 'tools\\subtitle-workflow'/)
assert.doesNotMatch(launcherSource, /read-web-worktrees/)
assert.doesNotMatch(launcherSource, /C:\\Users\\0/)
assert.match(launcherSource, /-ServiceOnly/)
assert.match(launcherSource, /ServiceHealthUrl/)
assert.match(launcherSource, /ECDICT_ENABLED/)
assert.match(launcherSource, /ECDICT_DATABASE_PATH/)
assert.match(launcherSource, /LOCAL_SENTENCE_DATABASE_PATH/)
assert.match(launcherSource, /SENTENCE_TRANSLATION_CACHE_PATH/)
assert.match(launcherSource, /VITE_LOCAL_SERVICE_BASE_URL/)
assert.match(launcherSource, /if \(-not \$NoOpen\)/)
assert.doesNotMatch(launcherSource, /MERRIAM_WEBSTER|WORDNIK_API_KEY|GEMINI_API_KEY/)

const startupSource = await readFile(new URL('./start-latest-reader.ps1', import.meta.url), 'utf8')
assert.match(startupSource, /\$defaultReaderRoot = Split-Path -Parent \$PSScriptRoot/)
assert.match(startupSource, /Join-Path \$ReaderRoot 'tools\\subtitle-workflow'/)
assert.match(startupSource, /VITE_LOCAL_SERVICE_BASE_URL/)
assert.doesNotMatch(startupSource, /read-web-worktrees/)
assert.match(startupSource, /runtime\.legacy\.json/)
assert.doesNotMatch(startupSource, /C:\\Users\\0/)

const optimizationSource = await readFile(new URL('./launch-optimization-preview.ps1', import.meta.url), 'utf8')
const optimizationReleaseSource = await readFile(new URL('./optimization-release.psm1', import.meta.url), 'utf8')
const optimizationRuntimeSource = await readFile(new URL('./optimization-launch-runtime.psm1', import.meta.url), 'utf8')
const releaseManifestSource = await readFile(new URL('./generate-release-manifest.mjs', import.meta.url), 'utf8')
const releaseManifestSchema = await readFile(new URL('../config/release-manifest.schema.json', import.meta.url), 'utf8')
const frontDoorSource = await readFile(new URL('../tools/optimization-stable-front-door.mjs', import.meta.url), 'utf8')
const packageSource = await readFile(new URL('../package.json', import.meta.url), 'utf8')
const verifyFullSource = await readFile(new URL('./verify-full.mjs', import.meta.url), 'utf8')
assert.match(optimizationSource, /runtime\.optimization\.json/)
assert.doesNotMatch(optimizationSource, /npmCommand\.Source run build/)
assert.match(optimizationSource, /tools\\local-capability-host\.mjs/)
assert.match(optimizationSource, /tools\\optimization-stable-front-door\.mjs/)
assert.match(optimizationSource, /Stop-OptimizationOwnedState/)
assert.match(optimizationSource, /VITE_LOCAL_SERVICE_BASE_URL/)
assert.match(optimizationSource, /E:\\ReadWebData\\SubtitleWorkflow-Optimization/)
assert.match(optimizationSource, /frontend\/backend ports 5184\/8776/)
assert.match(optimizationSource, /optimization-release\.psm1/)
assert.match(optimizationSource, /active-release\.json/)
assert.match(optimizationSource, /Write-OptimizationActiveRelease/)
assert.match(optimizationSource, /Write-OptimizationFrontDoorTarget/)
assert.match(optimizationSource, /Get-OptimizationFreePort/)
assert.match(optimizationReleaseSource, /'run', 'build'[\s\S]*--config[\s\S]*viteConfigPath[\s\S]*--outDir[\s\S]*--emptyOutDir/)
assert.doesNotMatch(optimizationReleaseSource, /Get-FileHash/)
assert.doesNotMatch(optimizationSource, /Get-FileHash/)
assert.match(optimizationReleaseSource, /keyPath = 'id'/)
assert.match(optimizationReleaseSource, /\$manifestRoot[\s\S]*\$descriptorRoot/)
assert.match(optimizationReleaseSource, /releaseFormatVersion = 2/)
assert.match(optimizationReleaseSource, /Get-OptimizationViteConfigPath/)
assert.match(releaseManifestSource, /indexedDb: \{ name: 'SeekPlayerDB', version: 1, objectStore: 'files', keyPath: 'id' \}/)
assert.match(releaseManifestSource, /resolveViteConfigPath/)
assert.match(releaseManifestSource, /const viteConfig = resolveViteConfigPath\(root\)/)
assert.match(releaseManifestSource, /\.\.\.required, \.\.\.\(viteConfig \? \[viteConfig\] : \[\]\)/)
assert.match(releaseManifestSchema, /"keyPath": \{ "const": "id" \}/)
assert.match(releaseManifestSchema, /"dependencyLocks"/)
assert.match(releaseManifestSchema, /"externalTools"/)
assert.match(releaseManifestSchema, /"compatibility"/)
assert.match(releaseManifestSchema, /"supportMatrix"/)
assert.match(optimizationReleaseSource, /Get-OptimizationExternalToolProbeResult/)
assert.match(releaseManifestSource, /classifyExternalToolProbe/)
assert.match(optimizationReleaseSource, /Move-Item -LiteralPath \$Candidate\.stagingRoot -Destination \$targetRoot/)
assert.match(optimizationRuntimeSource, /Start-OptimizationOwnedPair/)
assert.match(optimizationRuntimeSource, /Start-ManagedRuntimeInstance/)
assert.match(optimizationRuntimeSource, /youtube_workflow\.production_host_prototype/)
assert.match(packageSource, /verify:optimization-launcher/)
assert.match(packageSource, /verify:optimization-launcher:pwsh/)
assert.match(verifyFullSource, /verify:optimization-launcher/)
assert.match(verifyFullSource, /verify:optimization-launcher:pwsh/)
assert.match(optimizationSource, /activation-journal\.json/)
assert.match(optimizationSource, /front-door-committed-target\.json/)
assert.match(optimizationSource, /READ_WEB_OPTIMIZATION_TEST_KILL_PHASE/)
assert.match(optimizationSource, /Invoke-OptimizationHostDrain/)
assert.match(frontDoorSource, /front-door-process-health/)
assert.match(frontDoorSource, /RESERVED_TARGET_PORTS/)
assert.match(frontDoorSource, /committedTargetFile/)
assert.match(frontDoorSource, /readVisibleTarget\(\)/)
assert.match(optimizationSource, /--committed-target-file/)
assert.match(optimizationSource, /if \(\$DevFallback\)[\s\S]*?launch-next-preview\.ps1/)
assert.doesNotMatch(optimizationSource, /\$launcher\s*=\s*Join-Path \$PSScriptRoot 'launch-next-preview\.ps1'/)
assert.doesNotMatch(optimizationSource, /scripts[\\/]perf[\\/]browser-journeys\.mjs/)

const configFixture = await mkdtemp(path.join(os.tmpdir(), 'read-web-vite-config-combination-'))
try {
  await writeFile(path.join(configFixture, 'vite.config.js'), 'export default { branch: "legacy" }\n')
  assert.equal(resolveViteConfigPath(configFixture), 'vite.config.js')
  await writeFile(path.join(configFixture, 'vite.config.mjs'), 'export default { branch: "esm" }\n')
  assert.equal(resolveViteConfigPath(configFixture), 'vite.config.mjs')
  await rm(path.join(configFixture, 'vite.config.mjs'))
  assert.equal(resolveViteConfigPath(configFixture), 'vite.config.js')
} finally {
  await rm(configFixture, { recursive: true, force: true })
}

const manifestFixture = await mkdtemp(path.join(os.tmpdir(), 'read-web-release-manifest-combination-'))
const manifestOutput = await mkdtemp(path.join(os.tmpdir(), 'read-web-release-manifest-output-'))
const generatorPath = fileURLToPath(new URL('./generate-release-manifest.mjs', import.meta.url))
try {
  await mkdir(path.join(manifestFixture, 'dist'), { recursive: true })
  await writeFile(path.join(manifestFixture, 'index.html'), '<!doctype html>\n')
  await writeFile(path.join(manifestFixture, 'dist', 'index.html'), '<!doctype html>\n')
  await writeFile(path.join(manifestFixture, 'package.json'), '{"name":"manifest-fixture","version":"1.0.0","packageManager":"npm@11.8.0","engines":{"node":"24.13.1","npm":"11.8.0"}}\n')
  await writeFile(path.join(manifestFixture, 'package-lock.json'), '{"name":"manifest-fixture","version":"1.0.0","lockfileVersion":3,"packages":{"":{"name":"manifest-fixture","version":"1.0.0"}}}\n')
  await mkdir(path.join(manifestFixture, 'tools', 'subtitle-workflow'), { recursive: true })
  await writeFile(path.join(manifestFixture, 'tools', 'subtitle-workflow', 'requirements-service.lock'), '# CPython 3.10 / Windows x86-64\nfixture==1.0.0 --hash=sha256:' + 'a'.repeat(64) + '\n')
  await writeFile(path.join(manifestFixture, 'vite.config.js'), 'export default { branch: "legacy" }\n')
  await writeFile(path.join(manifestFixture, 'vite.config.mjs'), 'export default { branch: "esm" }\n')
  await execFileAsync('git', ['init', '-q'], { cwd: manifestFixture, windowsHide: true })
  await execFileAsync('git', ['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=Fixture', 'add', '.'], { cwd: manifestFixture, windowsHide: true })
  await execFileAsync('git', ['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=Fixture', 'commit', '-qm', 'fixture'], { cwd: manifestFixture, windowsHide: true })
  await execFileAsync(process.execPath, [generatorPath, '--root', manifestFixture, '--previous-root', manifestFixture, '--output', manifestOutput], { cwd: manifestFixture, windowsHide: true })
  const esmManifest = JSON.parse(await readFile(path.join(manifestOutput, 'release-manifest.json'), 'utf8'))
  const esmVerification = await verifyReleaseManifest(path.join(manifestOutput, 'release-manifest.json'), manifestFixture)
  assert.equal(esmVerification.passed, true, `generated ESM release manifest failed schema/checksum verification: ${esmVerification.failures.join('; ')}`)
  const esmArtifacts = esmManifest.artifacts.map(({ path: artifactPath }) => artifactPath)
  assert.ok(esmArtifacts.includes('vite.config.mjs'))
  assert.ok(!esmArtifacts.includes('vite.config.js'))

  const packagePath = path.join(manifestFixture, 'package.json')
  const packageWithManager = await readFile(packagePath, 'utf8')
  const packageWithoutManager = '{"name":"manifest-fixture","version":"1.0.0","engines":{"node":"24.13.1","npm":"11.8.0"}}\n'
  await writeFile(packagePath, packageWithoutManager)
  const normalizedOutput = await mkdtemp(path.join(os.tmpdir(), 'read-web-release-manifest-normalized-'))
  try {
    await execFileAsync(process.execPath, [generatorPath, '--root', manifestFixture, '--previous-root', manifestFixture, '--output', normalizedOutput], { cwd: manifestFixture, windowsHide: true })
    const normalizedManifest = JSON.parse(await readFile(path.join(normalizedOutput, 'release-manifest.json'), 'utf8'))
    assert.equal(typeof normalizedManifest.runtime.npm, 'string')
    assert.ok(normalizedManifest.runtime.npm.length > 0, 'missing packageManager must be normalized from npm --version')
  } finally {
    await rm(normalizedOutput, { recursive: true, force: true })
  }

  await writeFile(packagePath, packageWithManager)
  const missingNpmOutput = await mkdtemp(path.join(os.tmpdir(), 'read-web-release-manifest-missing-npm-'))
  try {
    await assert.rejects(
      execFileAsync(process.execPath, [generatorPath, '--root', manifestFixture, '--previous-root', manifestFixture, '--output', missingNpmOutput], {
        cwd: manifestFixture,
        windowsHide: true,
        env: { ...process.env, READ_WEB_RELEASE_NPM: 'read-web-command-that-does-not-exist' },
      }),
      /runtime npm version is unavailable/
    )
    assert.equal(await pathExists(path.join(missingNpmOutput, 'release-manifest.json')), false, 'invalid npm runtime must not be written')
  } finally {
    await rm(missingNpmOutput, { recursive: true, force: true })
  }

  const missingNodeOutput = await mkdtemp(path.join(os.tmpdir(), 'read-web-release-manifest-missing-node-'))
  try {
    await assert.rejects(
      execFileAsync(process.execPath, [generatorPath, '--root', manifestFixture, '--previous-root', manifestFixture, '--output', missingNodeOutput], {
        cwd: manifestFixture,
        windowsHide: true,
        env: { ...process.env, READ_WEB_RELEASE_NODE: 'read-web-command-that-does-not-exist' },
      }),
      /runtime node version is unavailable/
    )
    assert.equal(await pathExists(path.join(missingNodeOutput, 'release-manifest.json')), false, 'invalid Node runtime must not be written')
  } finally {
    await rm(missingNodeOutput, { recursive: true, force: true })
  }

  const unsupportedNodeOutput = await mkdtemp(path.join(os.tmpdir(), 'read-web-release-manifest-unsupported-node-'))
  try {
    await writeFile(packagePath, packageWithManager.replace('"node":"24.13.1"', '"node":"0.0.0"'))
    await assert.rejects(
      execFileAsync(process.execPath, [generatorPath, '--root', manifestFixture, '--previous-root', manifestFixture, '--output', unsupportedNodeOutput], { cwd: manifestFixture, windowsHide: true }),
      /Node version is unsupported/
    )
    assert.equal(await pathExists(path.join(unsupportedNodeOutput, 'release-manifest.json')), false, 'unsupported Node runtime must not be written')
  } finally {
    await writeFile(packagePath, packageWithManager)
    await rm(unsupportedNodeOutput, { recursive: true, force: true })
  }

  const missingPythonOutput = await mkdtemp(path.join(os.tmpdir(), 'read-web-release-manifest-missing-python-'))
  try {
    await assert.rejects(
      execFileAsync(process.execPath, [generatorPath, '--root', manifestFixture, '--previous-root', manifestFixture, '--output', missingPythonOutput], {
        cwd: manifestFixture,
        windowsHide: true,
        env: { ...process.env, READ_WEB_RELEASE_PYTHON: 'read-web-command-that-does-not-exist' },
      }),
      /runtime python version is unavailable/
    )
    assert.equal(await pathExists(path.join(missingPythonOutput, 'release-manifest.json')), false, 'invalid Python runtime must not be written')
  } finally {
    await rm(missingPythonOutput, { recursive: true, force: true })
  }

  const unsupportedPythonOutput = await mkdtemp(path.join(os.tmpdir(), 'read-web-release-manifest-unsupported-python-'))
  const lockPath = path.join(manifestFixture, 'tools', 'subtitle-workflow', 'requirements-service.lock')
  const lockText = await readFile(lockPath, 'utf8')
  try {
    await writeFile(lockPath, lockText.replace('CPython 3.10', 'CPython 99.99'))
    await assert.rejects(
      execFileAsync(process.execPath, [generatorPath, '--root', manifestFixture, '--previous-root', manifestFixture, '--output', unsupportedPythonOutput], { cwd: manifestFixture, windowsHide: true }),
      /Python version is unsupported/
    )
    assert.equal(await pathExists(path.join(unsupportedPythonOutput, 'release-manifest.json')), false, 'unsupported Python runtime must not be written')
  } finally {
    await writeFile(lockPath, lockText)
    await rm(unsupportedPythonOutput, { recursive: true, force: true })
  }

  const invalidSchemaOutput = await mkdtemp(path.join(os.tmpdir(), 'read-web-release-manifest-invalid-schema-'))
  try {
    await writeFile(packagePath, '{"name":"manifest-fixture","version":"","packageManager":"npm@11.8.0","engines":{"node":"24.13.1","npm":"11.8.0"}}\n')
    await assert.rejects(
      execFileAsync(process.execPath, [generatorPath, '--root', manifestFixture, '--previous-root', manifestFixture, '--output', invalidSchemaOutput], { cwd: manifestFixture, windowsHide: true }),
      /schema validation failed before write/
    )
    assert.equal(await pathExists(path.join(invalidSchemaOutput, 'release-manifest.json')), false, 'schema-invalid manifest must not be written')
  } finally {
    await writeFile(packagePath, packageWithManager)
    await rm(invalidSchemaOutput, { recursive: true, force: true })
  }

  await rm(path.join(manifestFixture, 'vite.config.mjs'))
  const fallbackOutput = await mkdtemp(path.join(os.tmpdir(), 'read-web-release-manifest-fallback-'))
  try {
    await execFileAsync(process.execPath, [generatorPath, '--root', manifestFixture, '--previous-root', manifestFixture, '--output', fallbackOutput], { cwd: manifestFixture, windowsHide: true })
    const fallbackManifest = JSON.parse(await readFile(path.join(fallbackOutput, 'release-manifest.json'), 'utf8'))
    const fallbackVerification = await verifyReleaseManifest(path.join(fallbackOutput, 'release-manifest.json'), manifestFixture)
    assert.equal(fallbackVerification.passed, true, `generated fallback release manifest failed schema/checksum verification: ${fallbackVerification.failures.join('; ')}`)
    const fallbackArtifacts = fallbackManifest.artifacts.map(({ path: artifactPath }) => artifactPath)
    assert.ok(fallbackArtifacts.includes('vite.config.js'))
    assert.ok(!fallbackArtifacts.includes('vite.config.mjs'))
  } finally {
    await rm(fallbackOutput, { recursive: true, force: true })
  }
} finally {
  await rm(manifestFixture, { recursive: true, force: true })
  await rm(manifestOutput, { recursive: true, force: true })
}

console.log('Learning page launcher checks passed.')
