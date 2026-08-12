import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/services/runtime/download-object-url.js', import.meta.url), 'utf8')
const { createObjectUrlDownloader } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
)

const fixture = createFixture()
const downloader = createObjectUrlDownloader(fixture.dependencies)

const first = downloader.download(new Blob(['first']), 'first.json')
assert.equal(first.filename, 'first.json')
assert.equal(fixture.liveUrls.size, 1, 'URL must remain alive through the click task')
assert.deepEqual(fixture.events.slice(0, 4), [
  'create:blob:download-1',
  'append:first.json',
  'click:first.json',
  'remove:first.json',
])
fixture.flushScheduled()
assert.equal(fixture.liveUrls.size, 0, 'URL must be revoked on the next task')

for (let index = 0; index < 500; index += 1) {
  downloader.download(new Blob([String(index)]), `export-${index}.json`)
  fixture.flushScheduled()
  assert.equal(fixture.liveUrls.size, 0, `export ${index} must not retain a Blob URL`)
}
assert.equal(fixture.createdCount(), fixture.revokedCount())
assert.equal(fixture.peakLiveUrls(), 1, 'sequential downloads must keep live Blob URLs bounded')

const failedClick = createFixture({ clickFails: true })
const failedClickDownloader = createObjectUrlDownloader(failedClick.dependencies)
assert.throws(
  () => failedClickDownloader.download(new Blob(['failed']), 'failed.zip'),
  /click failed/,
)
assert.equal(failedClick.liveUrls.size, 0, 'click failure must revoke in finally')
assert.equal(failedClick.attachedCount(), 0, 'click failure must still remove the anchor')

const failedSchedule = createFixture({ scheduleFails: true })
const failedScheduleDownloader = createObjectUrlDownloader(failedSchedule.dependencies)
assert.throws(
  () => failedScheduleDownloader.download(new Blob(['failed']), 'failed.json'),
  /schedule failed/,
)
assert.equal(failedSchedule.liveUrls.size, 0, 'schedule failure must revoke in finally')
assert.equal(failedSchedule.attachedCount(), 0)

const failedRemove = createFixture({ removeFails: true })
const failedRemoveDownloader = createObjectUrlDownloader(failedRemove.dependencies)
assert.throws(
  () => failedRemoveDownloader.download(new Blob(['failed']), 'failed.txt'),
  /remove failed/,
)
assert.equal(failedRemove.liveUrls.size, 0, 'anchor removal failure must still revoke in finally')

const pending = createFixture()
const pendingDownloader = createObjectUrlDownloader(pending.dependencies)
pendingDownloader.download(new Blob(['one']), 'one.json')
pendingDownloader.download(new Blob(['two']), 'two.json')
assert.equal(pending.liveUrls.size, 2)
pendingDownloader.dispose()
pendingDownloader.dispose()
assert.equal(pending.liveUrls.size, 0, 'dispose must synchronously release pending URLs')
pending.flushScheduled()
assert.equal(pending.createdCount(), pending.revokedCount(), 'scheduled cleanup after dispose must be idempotent')

console.log('download Object URL lifecycle check passed')

function createFixture(options = {}) {
  const events = []
  const liveUrls = new Set()
  const scheduled = []
  const attached = new Set()
  let nextId = 0
  let peak = 0

  const body = {
    appendChild(anchor) {
      attached.add(anchor)
      events.push(`append:${anchor.download}`)
    },
    removeChild(anchor) {
      if (options.removeFails) throw new Error('remove failed')
      if (!attached.delete(anchor)) throw new Error('anchor was not attached')
      events.push(`remove:${anchor.download}`)
    },
  }
  const dependencies = {
    documentObject: {
      body,
      createElement(name) {
        assert.equal(name, 'a')
        return {
          href: '',
          download: '',
          click() {
            events.push(`click:${this.download}`)
            if (options.clickFails) throw new Error('click failed')
          },
        }
      },
    },
    urlApi: {
      createObjectURL() {
        const url = `blob:download-${++nextId}`
        liveUrls.add(url)
        peak = Math.max(peak, liveUrls.size)
        events.push(`create:${url}`)
        return url
      },
      revokeObjectURL(url) {
        if (liveUrls.delete(url)) events.push(`revoke:${url}`)
      },
    },
    schedule(callback) {
      if (options.scheduleFails) throw new Error('schedule failed')
      const task = { callback, canceled: false }
      scheduled.push(task)
      return () => { task.canceled = true }
    },
  }

  return {
    dependencies,
    events,
    liveUrls,
    flushScheduled() {
      for (const task of scheduled.splice(0)) {
        if (!task.canceled) task.callback()
      }
    },
    createdCount: () => events.filter((event) => event.startsWith('create:')).length,
    revokedCount: () => events.filter((event) => event.startsWith('revoke:')).length,
    attachedCount: () => attached.size,
    peakLiveUrls: () => peak,
  }
}
