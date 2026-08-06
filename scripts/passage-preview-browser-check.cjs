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
  let wordnikRequests = 0
  page.on('pageerror', (error) => errors.push(error.message))

  try {
    await page.route('**/api/vocabulary/local-sentences**', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          available: false,
          errorCode: 'LOCAL_SENTENCE_DATABASE_MISSING',
          items: [],
        }),
      })
    })
    await page.route('**/api/vocabulary/real-sentences**', async (route) => {
      const word = new URL(route.request().url()).searchParams.get('word')
      const meanings = {
        enhance: '提升', readily: '容易', thorough: '全面细致', subtle: '不易察觉', attribute: '归因', decoy: '诱饵',
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          schemaVersion: 'tatoeba-real-sentences.v1',
          items: word === 'decoy' ? [] : [{
            id: `fixture-${word}`,
            sentence: `Learners can ${word} this simple example.`,
            translationZh: `学习者可以通过这个简单例子理解“${meanings[word] || '释义'}”。`,
            owner: 'fixture-author',
            translationOwner: 'fixture-translator',
            license: 'CC BY 2.0 FR',
            url: `https://tatoeba.org/en/sentences/show/fixture-${word}`,
          }],
        }),
      })
    })
    await page.route('**/api/vocabulary/wordnik-examples**', async (route) => {
      wordnikRequests += 1
      const word = new URL(route.request().url()).searchParams.get('word')
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          schemaVersion: 'wordnik-real-sentences.v1',
          source: 'Wordnik',
          sourceUrl: `https://www.wordnik.com/words/${word}`,
          items: [{
            id: `wordnik-${word}`,
            sentence: `This ${word} seemed harmless.`,
            providerName: 'fixture-provider',
            wordUrl: `https://www.wordnik.com/words/${word}`,
          }],
        }),
      })
    })
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
    await assertInitialCardIsHidden(page, '预习 1 / 6')
    await page.waitForFunction(() => window.__passagePreviewSpoken?.[0] === 'enhance')

    await page.getByRole('button', { name: '看看这个词怎么用' }).click()
    await page.locator('.passage-preview-real-sentence').waitFor()
    await page.getByText('主要义建议', { exact: true }).waitFor()
    await page.getByText(/Tatoeba #fixture-enhance/).waitFor()
    assert.equal(await page.locator('.passage-preview-chunks.is-paragraph').count(), 0)
    assert.equal(await page.getByText('查看完整语境', { exact: true }).count(), 0)
    await page.setViewportSize({ width: 390, height: 844 })
    const mobileLayout = await page.evaluate(() => {
      const word = document.querySelector('.passage-preview-word-panel')?.getBoundingClientRect()
      const contextPanel = document.querySelector('.passage-preview-context')?.getBoundingClientRect()
      return {
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        stacked: Boolean(word && contextPanel && contextPanel.top >= word.top + word.height - 1),
      }
    })
    assert.deepEqual(mobileLayout, { noHorizontalOverflow: true, stacked: true })
    await page.setViewportSize({ width: 1280, height: 800 })

    await page.getByRole('button', { name: '下一词' }).click()
    await assertInitialCardIsHidden(page, '预习 2 / 6')
    await page.waitForFunction(() => window.__passagePreviewSpoken.includes('readily'))

    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('button', { name: '待预习' }).click()
    await assertInitialCardIsHidden(page, '预习 2 / 6')

    for (let index = 2; index <= 6; index += 1) {
      await page.getByRole('button', { name: '看看这个词怎么用' }).click()
      await page.locator('.passage-preview-real-sentence').waitFor()
      if (index === 6) {
        await page.getByText(/Wordnik #wordnik-decoy/).waitFor()
        await page.getByText(/Wordnik 暂不提供整句中文翻译/).waitFor()
        assert.equal(await page.locator('img[alt="Powered by Wordnik"][width="132"][height="18"]').count(), 1)
      }
      const actionName = index === 6 ? '完成首次接触' : '下一词'
      await page.getByRole('button', { name: actionName }).click()
    }
    await page.getByText('6词首次接触完成', { exact: true }).waitFor()

    const after = await readVocabularyState(page)
    assert.equal(after.reviewStateCount, before.reviewStateCount)
    assert.equal(after.dbVersion, before.dbVersion)
    assert.deepEqual(after.storeNames, before.storeNames)
    assert.equal(wordnikRequests, 1)
    const persistedWordnik = await page.evaluate(() => {
      const envelope = JSON.parse(localStorage.getItem('vocabulary.passage-preview.data.v2') || '{}')
      return envelope.items?.find((item) => item.word === 'decoy')?.realSentence || null
    })
    assert.equal(persistedWordnik, null)

    await page.locator('.passage-preview-complete').getByRole('button', { name: '返回阅读器' }).click()
    await page.getByRole('button', { name: '今日复习' }).click()
    await page.locator('.srs-review-page:not(.passage-preview-page)').waitFor()

    assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`)
    console.log('First-contact vocabulary preview browser verification passed.')
  } finally {
    await context.close()
    await browser.close()
  }
}

async function assertInitialCardIsHidden(page, progressText) {
  await page.getByText(progressText, { exact: true }).waitFor()
  assert.equal(await page.locator('.passage-preview-real-sentence').count(), 0)
  assert.equal(await page.locator('.passage-preview-meaning').count(), 0)
  assert.equal(await page.locator('.passage-preview-sentence-translation').count(), 0)
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
