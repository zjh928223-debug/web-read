import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

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

console.log('Learning page launcher checks passed.')
