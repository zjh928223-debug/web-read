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
assert.match(launcherSource, /\$learningUrl = 'http:\/\/127\.0\.0\.1:5173\/'/)
assert.doesNotMatch(launcherSource, /\?learning=preview/)
assert.match(launcherSource, /--strictPort/)
assert.match(launcherSource, /Test-ReadWebServer/)
assert.match(launcherSource, /start-latest-reader\.ps1/)
assert.match(launcherSource, /-ServiceOnly/)
assert.match(launcherSource, /ServiceHealthUrl/)
assert.match(launcherSource, /ECDICT_ENABLED/)
assert.match(launcherSource, /ECDICT_DATABASE_PATH/)
assert.match(launcherSource, /if \(-not \$NoOpen\)/)
assert.doesNotMatch(launcherSource, /MERRIAM_WEBSTER|WORDNIK_API_KEY|GEMINI_API_KEY/)

console.log('Learning page launcher checks passed.')
