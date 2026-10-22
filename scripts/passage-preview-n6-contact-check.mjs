import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'passage-preview-n6-contact-'))

try {
  const storage = await loadStorageModule(tempDir)
  const contact = {
    seenAt: '2026-10-08T08:00:00.000Z',
    targetSenseKey: 'preview:bank:金融机构',
    item: {
      id: 'preview:bank:1',
      lemma: 'bank',
      word: 'bank',
      primaryMeaningZh: '金融机构',
      targetSenseKey: 'preview:bank:金融机构',
      previewContext: {
        sentence: 'The bank approved the loan.',
        source_kind: 'user_local_exam_material',
        source_id: 'book-1',
        source_locator: { locator_version: 'source-locator.v1', local_locator: 'book-1:p1:s1' },
      },
    },
  }
  const progress = storage.createInitialPassagePreviewProgress({ firstContacts: { [contact.item.id]: contact } })
  storage.savePassagePreviewProgress(progress)
  assert.deepEqual(storage.loadPassagePreviewProgress().firstContacts, { [contact.item.id]: contact })

  const durableKey = 'vocabulary.passage-preview.durable-state.v1'
  const rawBeforeCorruption = globalThis.localStorage.getItem(durableKey)
  const malformed = JSON.parse(rawBeforeCorruption)
  delete malformed.progress.firstContacts
  malformed.progress.firstContacts = []
  globalThis.localStorage.setItem(durableKey, JSON.stringify(malformed))
  const rawMalformed = globalThis.localStorage.getItem(durableKey)
  assert.throws(
    () => storage.loadPassagePreviewProgress(),
    (error) => error.code === 'PASSAGE_PREVIEW_FIRST_CONTACTS_INVALID',
  )
  assert.equal(globalThis.localStorage.getItem(durableKey), rawMalformed)
  assert.notEqual(rawMalformed, rawBeforeCorruption)

  malformed.progress = { status: 'in_progress', currentIndex: 0, revealed: {} }
  globalThis.localStorage.setItem(durableKey, JSON.stringify(malformed))
  assert.deepEqual(storage.loadPassagePreviewProgress().firstContacts, {})

  const contacts = await loadContactModule(tempDir)
  assert.equal(contacts.samePassagePreviewTarget(
    contact.item,
    { ...contact.item, id: 'preview:bank:2', primaryMeaningZh: '河岸', targetSenseKey: 'preview:bank:河岸' },
  ), false)
  assert.equal(contacts.samePassagePreviewTarget(
    contact.item,
    {
      ...contact.item,
      targetSenseKey: 'en\u001fnoun\u001f金融机构',
    },
  ), true)
  assert.equal(contacts.samePassagePreviewTarget(
    contact.item,
    {
      previewItemId: contact.item.id,
      lemma: contact.item.lemma,
      word: contact.item.word,
      primaryMeaningZh: contact.item.primaryMeaningZh,
      pos: 'noun',
      targetSenseKey: 'en\u001fnoun\u001f金融机构',
    },
  ), true)
  assert.equal(contacts.samePassagePreviewTarget(
    contact.item,
    {
      ...contact.item,
      primaryMeaningZh: '河岸',
      targetSenseKey: 'en\u001fnoun\u001f河岸',
    },
  ), false)
  assert.equal(contacts.samePassagePreviewTarget(contact.item, contact.item), true)
  assert.equal(contacts.rememberPendingPassagePreviewContact(contact), true)
  assert.deepEqual(contacts.getPendingPassagePreviewContact(contact.item), contact)
  assert.equal(contacts.clearPendingPassagePreviewContact(contact.item), true)
  assert.equal(contacts.getPendingPassagePreviewContact(contact.item), null)
  assert.deepEqual(
    contacts.mergePassagePreviewContactStatuses({
      firstContacts: {
        a: contact,
        b: { ...contact, item: { ...contact.item, id: 'preview:book:2' } },
      },
      previousStatuses: { a: 'committed', b: 'pending' },
      introducedRecords: [{ ...contact.item, previewItemId: 'preview:book:2' }],
      introducedRecordsLoaded: false,
    }),
    { a: 'committed', b: 'committed' },
  )
  console.log('N6 first-contact storage, corruption preservation, and sense identity checks passed.')
} finally {
  await fs.rm(tempDir, { recursive: true, force: true })
}

async function loadStorageModule(tempDir) {
  const durableSource = await fs.readFile(path.join(repoRoot, 'src/features/passage-preview/passage-preview-durable-state.js'), 'utf8')
  await fs.writeFile(
    path.join(tempDir, 'passage-preview-durable-state.mjs'),
    durableSource.replace(
      "import { assertWindowsOwnerBrowserWriterAllowed } from '../../services/windows-owner-domain-cutover.js'\n",
      'const assertWindowsOwnerBrowserWriterAllowed = () => {}\n',
    ),
  )
  const storageSource = await fs.readFile(path.join(repoRoot, 'src/features/passage-preview/passage-preview-storage.js'), 'utf8')
  const transformed = storageSource
    .replace(/import \{[\s\S]*?\} from '\.\.\/\.\.\/services\/windows-owner-domain-adapter\.js'\r?\n/u, [
      'const getAuthoritativeWindowsOwner = () => null',
      'const ownerRecordContent = (value) => value?.content ?? value',
      'const ownerResponseRecords = () => ({})',
      'const requireOwnerCommitted = (value) => value',
      'const requireOwnerRead = (value) => value',
      'const stableOwnerIdempotencyKey = () => `n6-test`',
      '',
    ].join('\n'))
    .replace("from './passage-preview-durable-state.js'", "from './passage-preview-durable-state.mjs'")
  const storagePath = path.join(tempDir, 'passage-preview-storage.mjs')
  await fs.writeFile(storagePath, transformed)
  const api = await import(`${pathToFileURL(storagePath).href}?n6=${Date.now()}`)
  globalThis.localStorage = memoryStorage()
  return api
}

async function loadContactModule(tempDir) {
  const source = await fs.readFile(path.join(repoRoot, 'src/features/passage-preview/passage-preview-contact.js'), 'utf8')
  const target = path.join(tempDir, 'passage-preview-contact.mjs')
  await fs.writeFile(target, source)
  return import(`${pathToFileURL(target).href}?n6-contact=${Date.now()}`)
}

function memoryStorage() {
  const values = new Map()
  return {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, String(value)) },
    removeItem(key) { values.delete(key) },
  }
}
