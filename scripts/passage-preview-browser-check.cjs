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
  let merriamWebsterRequests = 0
  const translationBatchSizes = []
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
    await page.route('**/api/vocabulary/merriam-webster-examples**', async (route) => {
      merriamWebsterRequests += 1
      const requestUrl = new URL(route.request().url())
      const word = requestUrl.searchParams.get('word')
      const reference = requestUrl.searchParams.get('reference')
      const items = word === 'attribute' && reference === 'learners' ? [{
        id: 'learners:attribute:1:1',
        sentence: 'They attribute the change to careful planning.',
        definition: 'to explain something as caused by someone or something',
        partOfSpeech: 'verb',
        entryOrder: 1,
        senseOrder: 1,
        matchedTerm: 'attribute',
        reference: 'learners',
        dictionaryTitle: "Merriam-Webster's Advanced Learner's English Dictionary",
        sourceUrl: 'https://dictionaryapi.com/products/api-learners-dictionary',
        attribution: null,
      }] : []
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          schemaVersion: 'merriam-webster-sense-examples.v1',
          reference,
          items,
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
    await page.route('**/api/vocabulary/sentence-translations', async (route) => {
      const body = route.request().postDataJSON()
      translationBatchSizes.push(body.items.length)
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          schemaVersion: 'sentence-translations.v1',
          available: true,
          items: body.items.map((item) => ({
            ...item,
            translationZh: `这是“${item.id}”对应的整句中文翻译。`,
          })),
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

    await page.getByRole('button', { name: '打开首次接触快捷键设置' }).click()
    await page.getByRole('dialog', { name: '快捷键设置' }).waitFor()
    const translationModeSwitch = page.getByRole('switch', { name: '中文展示方式：持续展示' })
    await translationModeSwitch.waitFor()
    assert.equal(await translationModeSwitch.getAttribute('aria-checked'), 'true')
    await translationModeSwitch.click()
    const holdModeSwitch = page.getByRole('switch', { name: '中文展示方式：按住展示' })
    assert.equal(await holdModeSwitch.getAttribute('aria-checked'), 'false')
    assert.equal(await page.evaluate(() => localStorage.getItem('vocabulary.passage-preview.translation-display-mode.v1')), 'hold')
    for (const [label, key] of [
      ['看看这个词怎么用', 'f'],
      ['单词发音', 'q'],
      ['句子发音', 'w'],
      ['句子中文展示 / 隐藏', 'e'],
      ['上一个', 'a'],
      ['下一词', 'd'],
    ]) {
      await page.getByRole('button', { name: `修改${label}快捷键` }).click()
      await page.keyboard.press(key)
      await page.getByText('已保存，立即生效。', { exact: true }).waitFor()
    }
    const storedShortcuts = await page.evaluate(() => JSON.parse(
      localStorage.getItem('vocabulary.passage-preview.shortcuts.v2') || 'null',
    ))
    assert.deepEqual(storedShortcuts.shortcuts, {
      revealContent: 'f', wordAudio: 'q', sentenceAudio: 'w', translation: 'e', previousItem: 'a', nextItem: 'd',
    })
    await page.getByRole('button', { name: '完成', exact: true }).click()
    assert.equal(await page.locator('.passage-preview-page kbd').count(), 0, 'study surface must not show shortcut labels')
    const shortcutHeaderStyle = await page.evaluate(() => {
      const title = document.querySelector('.passage-preview-source')
      const meta = document.querySelector('.passage-preview-header-meta')
      const progress = meta?.querySelector('.srs-review-progress')
      const trigger = meta?.querySelector('.passage-preview-shortcut-open')
      const triggerStyle = trigger ? getComputedStyle(trigger) : null
      return {
        exists: Boolean(meta && progress && trigger),
        followsProgress: Boolean(progress && trigger && progress.nextElementSibling === trigger),
        outsideCenteredTitle: Boolean(title && !title.querySelector('.passage-preview-shortcut-open')),
        isRightOfProgress: Boolean(progress && trigger && trigger.getBoundingClientRect().left >= progress.getBoundingClientRect().right),
        opacity: triggerStyle ? Number.parseFloat(triggerStyle.opacity) : 1,
        fontSize: triggerStyle ? Number.parseFloat(triggerStyle.fontSize) : 99,
        borderWidth: triggerStyle ? Number.parseFloat(triggerStyle.borderTopWidth) : 99,
        backgroundColor: triggerStyle?.backgroundColor || '',
        display: triggerStyle?.display || '',
        alignItems: triggerStyle?.alignItems || '',
        justifyContent: triggerStyle?.justifyContent || '',
        lineHeight: triggerStyle ? Number.parseFloat(triggerStyle.lineHeight) : 99,
        verticallyCentered: Boolean(trigger && Math.abs(
          trigger.getBoundingClientRect().top + trigger.getBoundingClientRect().height / 2
            - (progress.getBoundingClientRect().top + progress.getBoundingClientRect().height / 2),
        ) <= 1),
      }
    })
    assert.equal(shortcutHeaderStyle.exists, true)
    assert.equal(shortcutHeaderStyle.followsProgress, true)
    assert.equal(shortcutHeaderStyle.outsideCenteredTitle, true)
    assert.equal(shortcutHeaderStyle.isRightOfProgress, true)
    assert.ok(shortcutHeaderStyle.opacity <= 0.5)
    assert.ok(shortcutHeaderStyle.fontSize <= 10)
    assert.equal(shortcutHeaderStyle.borderWidth, 0)
    assert.equal(shortcutHeaderStyle.backgroundColor, 'rgba(0, 0, 0, 0)')
    assert.ok(['inline-flex', 'flex'].includes(shortcutHeaderStyle.display))
    assert.equal(shortcutHeaderStyle.alignItems, 'center')
    assert.equal(shortcutHeaderStyle.justifyContent, 'center')
    assert.ok(shortcutHeaderStyle.lineHeight <= 10)
    assert.equal(shortcutHeaderStyle.verticallyCentered, true)
    await page.keyboard.press('d')
    await page.getByText('预习 1 / 6', { exact: true }).waitFor()

    await page.evaluate(() => { window.__passagePreviewSpoken.length = 0 })
    await page.keyboard.press('q')
    await page.waitForFunction(() => window.__passagePreviewSpoken?.includes('enhance'))

    await page.keyboard.press('f')
    await page.locator('.passage-preview-real-sentence').waitFor()
    await page.getByText('主要义建议', { exact: true }).waitFor()
    assert.equal(await page.getByText(/学习者可以通过这个简单例子理解/).count(), 0)
    assert.equal(await page.locator('.passage-preview-attribution').count(), 0)
    assert.equal(await page.locator('.passage-preview-wordnik-badge').count(), 0)
    const desktopSentenceStyle = await page.evaluate(() => {
      const line = document.querySelector('.passage-preview-sentence-line > p')
      const mark = document.querySelector('.passage-preview-sentence-line mark')
      const lineStyle = getComputedStyle(line)
      const markStyle = getComputedStyle(mark)
      return {
        lineCount: Math.round(line.getBoundingClientRect().height / parseFloat(lineStyle.lineHeight)),
        fontSize: parseFloat(lineStyle.fontSize),
        markBackground: markStyle.backgroundColor,
        markDecoration: markStyle.textDecorationLine,
      }
    })
    assert.ok(desktopSentenceStyle.lineCount <= 2)
    assert.ok(desktopSentenceStyle.fontSize <= 28)
    assert.equal(desktopSentenceStyle.markBackground, 'rgba(0, 0, 0, 0)')
    assert.equal(desktopSentenceStyle.markDecoration, 'underline')
    const unclippedLeftColumn = await page.evaluate(() => {
      const panel = document.querySelector('.passage-preview-word-panel')
      const word = document.querySelector('.passage-preview-word-line h2')
      const meaning = document.querySelector('.passage-preview-meaning')
      word.textContent = 'approximate'
      word.classList.add('is-long')
      meaning.textContent = '近似的，接近但不完全正确的'
      const panelRect = panel.getBoundingClientRect()
      const wordRect = word.getBoundingClientRect()
      const meaningRect = meaning.getBoundingClientRect()
      return {
        wordFits: word.scrollWidth <= word.clientWidth + 1 && wordRect.right <= panelRect.right + 1,
        meaningFits: meaning.scrollWidth <= meaning.clientWidth + 1 && meaningRect.right <= panelRect.right + 1,
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      }
    })
    assert.deepEqual(unclippedLeftColumn, { wordFits: true, meaningFits: true, noHorizontalOverflow: true })
    const sentenceText = await page.locator('.passage-preview-sentence-line > p').innerText()
    await page.keyboard.press('w')
    await page.waitForFunction((text) => window.__passagePreviewSpoken?.includes(text), sentenceText)
    await page.keyboard.down('e')
    await page.locator('.passage-preview-sentence-translation').waitFor()
    await page.keyboard.up('e')
    assert.equal(await page.locator('.passage-preview-sentence-translation').count(), 0)
    await page.keyboard.down('e')
    await page.locator('.passage-preview-sentence-translation').waitFor()
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    assert.equal(await page.locator('.passage-preview-sentence-translation').count(), 0)
    await page.keyboard.up('e')
    await page.getByRole('button', { name: '打开首次接触快捷键设置' }).click()
    await page.getByRole('switch', { name: '中文展示方式：按住展示' }).click()
    assert.equal(await page.evaluate(() => localStorage.getItem('vocabulary.passage-preview.translation-display-mode.v1')), 'persistent')
    await page.getByRole('button', { name: '完成', exact: true }).click()
    await page.locator('.passage-preview-sentence-translation').waitFor()
    await page.keyboard.press('e')
    assert.equal(await page.locator('.passage-preview-sentence-translation').count(), 0)
    await page.keyboard.press('e')
    await page.locator('.passage-preview-sentence-translation').waitFor()
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

    await page.keyboard.press('d')
    await assertInitialCardIsHidden(page, '预习 2 / 6')
    await page.waitForFunction(() => window.__passagePreviewSpoken.includes('readily'))
    await page.keyboard.press('a')
    await page.getByText('预习 1 / 6', { exact: true }).waitFor()
    await page.keyboard.press('d')
    await page.getByText('预习 2 / 6', { exact: true }).waitFor()

    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('button', { name: '待预习' }).click()
    await assertInitialCardIsHidden(page, '预习 2 / 6')
    await page.evaluate(() => { window.__passagePreviewSpoken.length = 0 })
    await page.keyboard.press('q')
    await page.waitForFunction(() => window.__passagePreviewSpoken?.includes('readily'))

    for (let index = 2; index <= 6; index += 1) {
      await page.getByRole('button', { name: '看看这个词怎么用' }).click()
      await page.locator('.passage-preview-real-sentence').waitFor()
      if (index === 5) {
        const branding = page.locator('.passage-preview-required-branding img')
        await branding.waitFor()
        assert.deepEqual(await branding.evaluate((image) => ({
          width: image.getBoundingClientRect().width,
          height: image.getBoundingClientRect().height,
          alt: image.alt,
        })), { width: 50, height: 50, alt: 'Merriam-Webster' })
      }
      if (index === 6) {
        await page.getByText(/这是“.*”对应的整句中文翻译/).waitFor()
        assert.equal(await page.getByText(/Wordnik|暂无整句中文翻译|真实出版摘句来源/).count(), 0)
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
    assert.ok(merriamWebsterRequests >= 1)
    assert.ok(translationBatchSizes.every((size) => size <= 25))
    const persistedWordnik = await page.evaluate(() => {
      const envelope = JSON.parse(localStorage.getItem('vocabulary.passage-preview.data.v2') || '{}')
      return envelope.items?.find((item) => item.word === 'decoy')?.realSentence || null
    })
    assert.equal(persistedWordnik, null)
    const persistedMerriamWebster = await page.evaluate(() => {
      const envelope = JSON.parse(localStorage.getItem('vocabulary.passage-preview.data.v2') || '{}')
      return envelope.items?.find((item) => item.word === 'attribute')?.realSentence || null
    })
    assert.equal(persistedMerriamWebster, null)

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
