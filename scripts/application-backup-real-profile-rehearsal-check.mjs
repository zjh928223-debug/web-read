import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'

import {
  collectReadOnlyWorkflowDomains,
  exportChromiumOriginSnapshot,
  fingerprintChromiumOriginSource,
  fingerprintWorkflowSource,
  rehearseRealProfileCopy,
  validateRealProfileRehearsalLayout,
} from './lib/read-web-real-profile-rehearsal.mjs'

const root = await mkdtemp(path.join(os.tmpdir(), 'read-web-real-profile-contract-'))

try {
  const browserProfileDir = path.join(root, 'daily-browser-profile')
  const workflowDataRoot = path.join(root, 'daily-workflow-data')
  const isolatedRoot = path.join(root, 'isolated-rehearsal')
  await Promise.all([
    mkdir(browserProfileDir, { recursive: true }),
    mkdir(workflowDataRoot, { recursive: true }),
    mkdir(isolatedRoot, { recursive: true }),
  ])

  const layout = await validateRealProfileRehearsalLayout({
    browserProfileDir,
    workflowDataRoot,
    isolatedRoot,
    forbiddenWriteRoots: [browserProfileDir, workflowDataRoot],
  })
  assert.equal(layout.browserProfileDir, path.resolve(browserProfileDir))
  assert.equal(layout.workflowDataRoot, path.resolve(workflowDataRoot))
  assert.equal(layout.isolatedRoot, path.resolve(isolatedRoot))

  const unsafeOutput = path.join(workflowDataRoot, 'unsafe-output')
  await mkdir(unsafeOutput, { recursive: true })
  await assert.rejects(
    validateRealProfileRehearsalLayout({
      browserProfileDir,
      workflowDataRoot,
      isolatedRoot: unsafeOutput,
      forbiddenWriteRoots: [browserProfileDir, workflowDataRoot],
    }),
    (error) => error?.code === 'REAL_PROFILE_REHEARSAL_UNSAFE_PATH',
  )

  const browserUserDataDir = path.join(root, 'browser-user-data')
  const origin = 'http://127.0.0.1:49151'
  await createBrowserFixture({ browserUserDataDir, origin })
  const sourceFingerprint = await fingerprintChromiumOriginSource({
    browserProfileDir: path.join(browserUserDataDir, 'Default'),
    browserOrigin: origin,
  })
  const exported = await exportChromiumOriginSnapshot({
    browserProfileDir: path.join(browserUserDataDir, 'Default'),
    browserOrigin: origin,
    isolatedRoot,
  })
  assert.equal(exported.networkRequests, 0)
  assert.deepEqual(exported.indexedDbRows, [
    { id: 'allSentenceNotesByDoc' },
    { id: 'audio' },
    { id: 'audioMeta', schemaVersion: 1, revision: 7, payload: { contentId: 'real-profile-fixture' } },
    { id: 'vocabulary-article-srs-settlement-progress:fixture', schemaVersion: 1, revision: 9, payload: { settled: true } },
    { id: 'vocabulary.acquisition.store.v1', schemaVersion: 1, revision: 8, payload: { words: [] } },
    { id: 'vocabulary.srs.store.v1', schemaVersion: 1, revision: 8, payload: { words: [] } },
  ])
  assert.equal(exported.localStorage['vocabulary.passage-preview.shortcut.context.v1'], 'context')
  assert.equal(
    exported.localStorage['vocabulary.passage-preview.reacquisition-progress.v1'],
    '{"status":"active","currentIndex":0}',
  )
  assert.equal(
    exported.localStorage['vocabulary.passage-preview.delayed-check.v1'],
    '{"schemaVersion":"passage-preview.delayed-check.v1","items":[]}',
  )
  assert.equal(exported.localStorage['AnnotationGenerationStorage::fixture'], '{"schemaVersion":1}')
  assert.equal(exported.localStorage['unrelated.secret'], undefined)
  assert.equal(
    await fingerprintChromiumOriginSource({
      browserProfileDir: path.join(browserUserDataDir, 'Default'),
      browserOrigin: origin,
    }),
    sourceFingerprint,
    'read-only export must not mutate the source browser profile',
  )
  const workflowStateDir = path.join(workflowDataRoot, '.workflow_state')
  const workflowOutputDir = path.join(workflowDataRoot, 'output')
  const legacyOutputRoot = path.join(root, 'authorized-legacy-output')
  await Promise.all([
    mkdir(workflowStateDir, { recursive: true }),
    mkdir(workflowOutputDir, { recursive: true }),
    mkdir(legacyOutputRoot, { recursive: true }),
  ])
  await writeFile(path.join(workflowStateDir, 'jobs.json'), '{"jobs":[]}\n', 'utf8')
  await writeFile(path.join(workflowStateDir, 'history.json'), `${JSON.stringify({
    items: [{ jobId: 'legacy-job', outputDir: legacyOutputRoot, title: 'legacy 🔴' }],
  })}\n`, 'utf8')
  await writeFile(path.join(legacyOutputRoot, 'manifest.json'), '{"schemaVersion":1,"revision":1}\n', 'utf8')
  const workflowFingerprint = await fingerprintWorkflowSource({
    workflowStateDir,
    workflowOutputDir,
    additionalOutputRoots: [legacyOutputRoot],
  })
  const workflowDomains = await collectReadOnlyWorkflowDomains({
    workflowStateDir,
    workflowOutputDir,
    additionalOutputRoots: [legacyOutputRoot],
  })
  assert.deepEqual(Object.keys(workflowDomains).sort(), ['marks-activity', 'workflow'])
  assert.equal(workflowDomains.workflow.records.length, 2)
  assert.equal(workflowDomains.workflow.records.some((record) => record.id === 'output:legacy/external-1/manifest.json'), true)
  assert.equal(workflowDomains['marks-activity'].records.length, 0)
  assert.equal(
    await fingerprintWorkflowSource({
      workflowStateDir,
      workflowOutputDir,
      additionalOutputRoots: [legacyOutputRoot],
    }),
    workflowFingerprint,
    'workflow collection must not mutate the source data root',
  )

  const rehearsal = await rehearseRealProfileCopy({
    browserProfileDir: path.join(browserUserDataDir, 'Default'),
    browserOrigin: origin,
    workflowDataRoot,
    isolatedRoot,
    additionalOutputRoots: [legacyOutputRoot],
  })
  assert.equal(rehearsal.status, 'passed')
  assert.equal(rehearsal.sourceUnchanged, true)
  assert.deepEqual(rehearsal.browserEvidence.excludedRows, {
    media: ['audio'],
    retired: ['allSentenceNotesByDoc'],
  })
  assert.deepEqual(rehearsal.recordCounts, {
    'reader-session': 1,
    'marks-activity': 0,
    'vocabulary-srs': 3,
    'passage-preview': 3,
    annotation: 1,
    workflow: 2,
  })
  assert.deepEqual(rehearsal.recordCounts, rehearsal.restoredRecordCounts)
  assert.deepEqual(rehearsal.domainChecksums, rehearsal.restoredDomainChecksums)
  assert.deepEqual(rehearsal.journeys, {
    Reader: { status: 'passed' },
    Vocabulary: { status: 'passed' },
    SRS: { status: 'passed' },
    Preview: { status: 'passed' },
    Annotation: { status: 'passed' },
    workflow: { status: 'passed' },
  })
  assert.equal(rehearsal.browserEvidence.logicalSourceStable, true)
  assert.equal(rehearsal.browserEvidence.maxBackupBytes, 128 * 1024 * 1024)

  console.log('real profile rehearsal safety contract passed')
} finally {
  await rm(root, { recursive: true, force: true })
}

async function createBrowserFixture({ browserUserDataDir, origin }) {
  const context = await chromium.launchPersistentContext(browserUserDataDir, {
    channel: 'chrome',
    headless: true,
    args: ['--profile-directory=Default'],
  })
  try {
    await context.route('**/*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>fixture</title>' })
    })
    const page = await context.newPage()
    await page.goto(`${origin}/__fixture__`)
    await page.evaluate(async () => {
      localStorage.setItem('vocabulary.passage-preview.shortcut.context.v1', 'context')
      localStorage.setItem(
        'vocabulary.passage-preview.reacquisition-progress.v1',
        JSON.stringify({ status: 'active', currentIndex: 0 }),
      )
      localStorage.setItem(
        'vocabulary.passage-preview.delayed-check.v1',
        JSON.stringify({ schemaVersion: 'passage-preview.delayed-check.v1', items: [] }),
      )
      localStorage.setItem('AnnotationGenerationStorage::fixture', '{"schemaVersion":1}')
      localStorage.setItem('unrelated.secret', 'must-not-export')
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('SeekPlayerDB', 1)
        request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'id' })
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('files', 'readwrite')
        transaction.objectStore('files').put({
          id: 'audio', blob: new Blob(['x'.repeat(2 * 1024 * 1024)], { type: 'audio/mpeg' }),
        })
        transaction.objectStore('files').put({
          id: 'allSentenceNotesByDoc', content: { retired: true },
        })
        transaction.objectStore('files').put({
          id: 'audioMeta', schemaVersion: 1, revision: 7, payload: { contentId: 'real-profile-fixture' },
        })
        transaction.objectStore('files').put({
          id: 'vocabulary.srs.store.v1', schemaVersion: 1, revision: 8, payload: { words: [] },
        })
        transaction.objectStore('files').put({
          id: 'vocabulary.acquisition.store.v1', schemaVersion: 1, revision: 8, payload: { words: [] },
        })
        transaction.objectStore('files').put({
          id: 'vocabulary-article-srs-settlement-progress:fixture',
          schemaVersion: 1,
          revision: 9,
          payload: { settled: true },
        })
        transaction.oncomplete = resolve
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
      database.close()
    })
  } finally {
    await context.close()
  }
}

async function deleteBrowserRow({ browserUserDataDir, origin, rowId }) {
  const context = await chromium.launchPersistentContext(browserUserDataDir, {
    channel: 'chrome',
    headless: true,
    args: ['--profile-directory=Default'],
  })
  try {
    await context.route('**/*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>fixture cleanup</title>' })
    })
    const page = await context.newPage()
    await page.goto(`${origin}/__fixture_cleanup__`)
    await page.evaluate(async (id) => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('SeekPlayerDB')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('files', 'readwrite')
        transaction.objectStore('files').delete(id)
        transaction.oncomplete = resolve
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
      database.close()
    }, rowId)
  } finally {
    await context.close()
  }
}
