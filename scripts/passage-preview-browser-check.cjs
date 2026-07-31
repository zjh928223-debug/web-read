const assert = require('node:assert/strict')
const path = require('node:path')
const { chromium } = require('playwright')

const projectRoot = path.resolve(__dirname, '..')
const fixturePath = path.join(__dirname, 'fixtures', 'passage-preview-result.fixture.json')
const targetUrl = process.env.READ_WEB_URL || 'http://127.0.0.1:4197/'

async function run() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))

  try {
    await page.addInitScript(() => {
      const spoken = []
      class PreviewUtterance {
        constructor(text) {
          this.text = text
        }
      }
      const synthesis = {
        getVoices: () => [{
          name: 'Microsoft Aria Online (Natural) - English (United States)',
          lang: 'en-US',
        }],
        cancel() {},
        speak(utterance) {
          spoken.push(utterance.text)
          setTimeout(() => utterance.onend?.(), 35)
        },
      }
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: PreviewUtterance })
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synthesis })
      window.__passagePreviewSpoken = spoken
    })
    await page.goto(targetUrl, { waitUntil: 'networkidle' })
    const before = await readVocabularyState(page)

    await page.locator('.passage-preview-file-input').setInputFiles(fixturePath)
    await page.locator('.passage-preview-page').waitFor()
    await assertInitialCardIsHidden(page, '预习 1 / 5')
    await page.waitForFunction(() => window.__passagePreviewSpoken?.[0] === 'thorough')

    await page.getByRole('button', { name: '显示学习内容' }).click()
    await page.locator('.passage-preview-phrase').waitFor()
    assert.equal(await page.locator('.passage-preview-translation').count(), 0)
    assert.equal(await page.locator('.passage-preview-chunks.is-paragraph').count(), 0)

    await page.keyboard.down('c')
    await page.locator('.passage-preview-translation').first().waitFor()
    await page.keyboard.up('c')
    await page.waitForFunction(() => document.querySelectorAll('.passage-preview-translation').length === 0)

    await page.keyboard.press('v')
    await page.locator('.passage-preview-chunks.is-paragraph').waitFor()
    await page.keyboard.press('v')
    assert.equal(await page.locator('.passage-preview-chunks.is-paragraph').count(), 0)

    await page.locator('.passage-preview-shortcut-settings button').first().click()
    await page.keyboard.press('z')
    await page.keyboard.down('z')
    await page.locator('.passage-preview-translation').first().waitFor()
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.waitForFunction(() => document.querySelectorAll('.passage-preview-translation').length === 0)
    await page.keyboard.up('z')

    const spokenBeforeContext = await page.evaluate(() => window.__passagePreviewSpoken.length)
    await page.getByRole('button', { name: '朗读语境' }).click()
    await page.locator('.passage-preview-chunks li.is-reading').waitFor()
    await page.waitForFunction(
      (count) => window.__passagePreviewSpoken.length >= count + 2,
      spokenBeforeContext,
    )

    await page.getByRole('button', { name: '下一词' }).click()
    await assertInitialCardIsHidden(page, '预习 2 / 5')
    await page.waitForFunction(() => window.__passagePreviewSpoken.includes('readily'))

    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('button', { name: '待预习' }).click()
    await assertInitialCardIsHidden(page, '预习 2 / 5')

    for (let index = 2; index <= 5; index += 1) {
      await page.getByRole('button', { name: '显示学习内容' }).click()
      await page.locator('.passage-preview-phrase').waitFor()
      const actionName = index === 5 ? '完成预习' : '下一词'
      await page.getByRole('button', { name: actionName }).click()
    }
    await page.getByText('5词预习完成', { exact: true }).waitFor()

    const after = await readVocabularyState(page)
    assert.equal(after.reviewStateCount, before.reviewStateCount)
    assert.equal(after.dbVersion, before.dbVersion)
    assert.deepEqual(after.storeNames, before.storeNames)

    await page.locator('.passage-preview-complete').getByRole('button', { name: '返回阅读器' }).click()
    await page.getByRole('button', { name: '今日复习' }).click()
    await page.locator('.srs-review-page:not(.passage-preview-page)').waitFor()

    assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`)
    console.log('Passage 1 preview browser verification passed.')
  } finally {
    await context.close()
    await browser.close()
  }
}

async function assertInitialCardIsHidden(page, progressText) {
  await page.getByText(progressText, { exact: true }).waitFor()
  assert.equal(await page.locator('.passage-preview-phrase').count(), 0)
  assert.equal(await page.locator('.passage-preview-meaning').count(), 0)
  assert.equal(await page.locator('.passage-preview-chunks').count(), 0)
  assert.equal(await page.locator('.passage-preview-translation').count(), 0)
}

async function readVocabularyState(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('SeekPlayerDB', 1)
    request.onerror = () => reject(request.error)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains('files')) {
        database.createObjectStore('files', { keyPath: 'id' })
      }
    }
    request.onsuccess = () => {
      const database = request.result
      const storeNames = Array.from(database.objectStoreNames)
      const dbVersion = database.version
      if (!storeNames.includes('files')) {
        database.close()
        resolve({ reviewStateCount: 0, dbVersion, storeNames })
        return
      }
      const transaction = database.transaction('files', 'readonly')
      const rowRequest = transaction.objectStore('files').get('vocabulary.srs.store.v1')
      rowRequest.onerror = () => reject(rowRequest.error)
      rowRequest.onsuccess = () => {
        const reviewStates = rowRequest.result?.content?.reviewStates
        database.close()
        resolve({
          reviewStateCount: Array.isArray(reviewStates) ? reviewStates.length : 0,
          dbVersion,
          storeNames,
        })
      }
    }
  }))
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
