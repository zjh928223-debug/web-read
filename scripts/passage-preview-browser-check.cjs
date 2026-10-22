const assert = require('node:assert/strict')
const path = require('node:path')
const { chromium } = require('playwright')

const projectRoot = path.resolve(__dirname, '..')
const fixturePath = path.join(__dirname, 'fixtures', 'passage-preview-result.fixture.json')
const targetUrl = process.env.READ_WEB_URL || 'http://127.0.0.1:4197/'

async function run() {
  const browser = await chromium.launch({ headless: true })
  if (process.env.PASSAGE_PREVIEW_BROWSER_CHECK_ONLY === 'queue-notice') {
    try {
      await verifyCompletedQueueNotice(browser, targetUrl)
      console.log('passage preview reachable queue-notice browser check passed')
    } finally {
      await browser.close()
    }
    return
  }
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
            attributionText: 'Powered by Wordnik',
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
    await verifyStartupAcquisitionRecovery(page)
    await verifyLearningSettingsDialog(page)
    await verifyPendingLearningSettings(browser, targetUrl)
    const before = await readVocabularyState(page)

    await page.locator('.passage-preview-file-input').setInputFiles(fixturePath)
    await page.locator('.passage-preview-page').waitFor()
    await assertInitialCardIsHidden(page, '预习 1 / 6')
    await page.waitForFunction(() => window.__passagePreviewSpoken?.[0] === 'enhance')
    const shortWordLayout = await page.evaluate(() => {
      const heading = document.querySelector('.passage-preview-word-line h2')
      const panel = document.querySelector('.passage-preview-word-panel')
      const previousText = heading.textContent
      const previousClass = heading.className
      const words = ['academics', 'temperatures']
      const layouts = Object.fromEntries(words.map((word) => {
        heading.textContent = word
        heading.className = 'is-long'
        const style = getComputedStyle(heading)
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')
        context.font = [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily].join(' ')
        const letterSpacing = Number.parseFloat(style.letterSpacing) || 0
        const textWidth = context.measureText(word).width + Math.max(0, word.length - 1) * letterSpacing
        const headingRect = heading.getBoundingClientRect()
        const panelRect = panel.getBoundingClientRect()
        return [word, {
          fits: textWidth <= heading.clientWidth + 1,
          withinPanel: headingRect.right <= panelRect.right + 1,
          fontSize: Number.parseFloat(style.fontSize),
          textWidth,
          availableWidth: heading.clientWidth,
        }]
      }))
      heading.textContent = previousText
      heading.className = previousClass
      return layouts
    })
    assert.equal(shortWordLayout.academics.fits, true, 'short but wide words must not be clipped in the left panel')
    assert.equal(shortWordLayout.academics.withinPanel, true, 'word heading must remain inside the left panel')
    assert.equal(shortWordLayout.temperatures.fits, true, 'long words must not be clipped in the left panel')
    assert.equal(shortWordLayout.temperatures.withinPanel, true, 'long word heading must remain inside the left panel')

    await page.getByRole('button', { name: '打开首次接触快捷键设置' }).click()
    await page.getByRole('dialog', { name: '快捷键设置' }).waitFor()
    const translationModeSwitch = page.getByRole('switch', { name: '中文展示方式：按住展示' })
    await translationModeSwitch.waitFor()
    assert.equal(await translationModeSwitch.getAttribute('aria-checked'), 'false')
    assert.equal(await page.evaluate(() => localStorage.getItem('vocabulary.passage-preview.translation-display-mode.v2')), null)
    for (const [label, key] of [
      ['看看这个词怎么用', 'f'],
      ['单词发音', 'q'],
      ['句子发音', 'w'],
      ['句子中文展示 / 隐藏', 'e'],
      ['上一个', 'a'],
      ['下一词', 'd'],
    ]) {
      const shortcutButton = label === '句子中文展示 / 隐藏'
        ? page.getByRole('button', { name: '修改句子中文快捷键' })
        : page.getByRole('button', { name: `修改${label}快捷键` })
      await shortcutButton.click()
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
        owner: trigger?.dataset.uiOwner || '',
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
    assert.equal(shortcutHeaderStyle.owner, 'learning')
    assert.equal(shortcutHeaderStyle.opacity, 1)
    assert.equal(shortcutHeaderStyle.fontSize, 14)
    assert.equal(shortcutHeaderStyle.borderWidth, 0)
    assert.equal(shortcutHeaderStyle.backgroundColor, 'rgba(0, 0, 0, 0)')
    assert.ok(['inline-flex', 'flex'].includes(shortcutHeaderStyle.display))
    assert.equal(shortcutHeaderStyle.alignItems, 'center')
    assert.equal(shortcutHeaderStyle.justifyContent, 'center')
    assert.ok(shortcutHeaderStyle.lineHeight >= 20)
    assert.equal(shortcutHeaderStyle.verticallyCentered, true)
    await page.evaluate(() => {
      const audio = document.querySelector('#audio-player')
      window.__passagePreviewOuterMediaCalls = 0
      Object.defineProperty(audio, 'paused', { configurable: true, get: () => true })
      audio.play = () => {
        window.__passagePreviewOuterMediaCalls += 1
        return Promise.resolve()
      }
      audio.pause = () => {
        window.__passagePreviewOuterMediaCalls += 1
      }
    })
    await page.keyboard.press('Space')
    assert.equal(
      await page.evaluate(() => window.__passagePreviewOuterMediaCalls),
      0,
      'preview space must not control the reader media underneath',
    )
    await page.keyboard.press('d')
    await page.getByText('预习 1 / 6', { exact: true }).waitFor()

    await page.evaluate(() => { window.__passagePreviewSpoken.length = 0 })
    await page.keyboard.press('q')
    await page.waitForFunction(() => window.__passagePreviewSpoken?.includes('enhance'))

    await page.keyboard.press('f')
    await page.locator('.passage-preview-real-sentence').waitFor()
    await page.getByText('主要义建议', { exact: true }).waitFor()
    assert.equal(await page.getByText('中文释义准备中…', { exact: true }).count(), 0)
    assert.equal(await page.getByText('正在从本地例句仓库和可追溯语料中筛选短句…', { exact: true }).count(), 0)
    assert.equal(await page.getByText('先看一眼词形；点击后只学习一个主要义和一条短句。', { exact: true }).count(), 0)
    assert.equal(await page.getByText(/学习者可以通过这个简单例子理解/).count(), 0)
    assert.equal(await page.locator('.passage-preview-translation-toggle').count(), 0)
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
    await page.keyboard.down('e')
    await page.locator('.passage-preview-sentence-translation').waitFor()
    await page.keyboard.up('e')
    assert.equal(await page.locator('.passage-preview-sentence-translation').count(), 0)
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
    assert.equal(await page.evaluate(() => localStorage.getItem('vocabulary.passage-preview.translation-display-mode.v2')), 'persistent')
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
    await page.locator('.passage-preview-page').waitFor()
    assert.ok(wordnikRequests >= 1, 'batch preparation should use Wordnik for missing real sentences')
    assert.ok(merriamWebsterRequests >= 1, 'batch preparation should warm configured dictionary sources')
    assert.ok(translationBatchSizes.length >= 1, 'batch preparation should warm sentence translations')
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
        const wordnikBranding = page.locator('.passage-preview-required-branding img[alt="Wordnik"]')
        await wordnikBranding.waitFor()
        assert.equal(await page.getByText('Powered by Wordnik', { exact: true }).count(), 1)
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
    await page.getByRole('button', { name: '今日复习', exact: true }).click()
    await page.locator('.srs-review-page:not(.passage-preview-page)').waitFor()
    await verifyCompletedQueueNotice(browser, targetUrl)

    assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`)
    console.log('First-contact vocabulary preview browser verification passed.')
  } finally {
    await context.close()
    await browser.close()
  }
}

async function verifyStartupAcquisitionRecovery(page) {
  const recoveryItem = makePreviewFixtureItem({
    id: 'ielts-reading:browser-recovery:replayed',
    lemma: 'recovery',
    meaning: '恢复',
  })
  await seedPassagePreviewBrowserState(page, {
    data: [recoveryItem],
    progress: {
      status: 'in_progress',
      currentIndex: 0,
      revealed: { [recoveryItem.id]: true },
      contextExpanded: {},
      startedAt: '2026-09-05T00:00:00.000Z',
      completedAt: null,
    },
    pendingCount: 40,
  })

  await page.reload({ waitUntil: 'networkidle' })
  await waitForAcquisitionUnitCount(page, recoveryItem.id, 41)
  assert.equal(
    await page.locator('.passage-preview-page').count(),
    0,
    'startup acquisition replay must not open the preview surface',
  )

  await page.reload({ waitUntil: 'networkidle' })
  await waitForAcquisitionUnitCount(page, recoveryItem.id, 41)
  assert.equal(
    (await readAcquisitionLearningUnitIds(page)).length,
    41,
    'a second refresh must not duplicate the replayed acquisition unit',
  )
}

async function verifyCompletedQueueNotice(browser, url) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/api/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '{}',
  }))
  await page.addInitScript(() => {
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
        setTimeout(() => utterance.onend?.(), 0)
      },
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: PreviewUtterance })
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synthesis })
  })
  try {
    await page.goto(url, { waitUntil: 'networkidle' })
    const completedItem = makePreviewFixtureItem({
      id: 'browser-completed-preview',
      lemma: 'completed',
      meaning: '完成',
    })
    await seedPassagePreviewBrowserState(page, {
      data: [completedItem],
      progress: {
        status: 'completed',
        currentIndex: 0,
        revealed: {},
        contextExpanded: {},
        startedAt: '2026-09-05T00:00:00.000Z',
        completedAt: '2026-09-05T00:05:00.000Z',
      },
      pendingCount: 40,
    })
    await page.reload({ waitUntil: 'networkidle' })
    await page.locator('#theme-toggle').click()
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark')
    await page.waitForTimeout(600)
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.getByRole('button', { name: '待预习' }).click()
    await page.locator('.passage-preview-page').waitFor()
    assert.equal(
      await page.locator('.passage-preview-queue-notice').count(),
      0,
      'the completed preview must not mount a covered duplicate of its visible queue warning',
    )
    const visibleQueueMessage = page.locator('.passage-preview-complete p').filter({
      hasText: '等待池现有 40 个词',
    })
    await visibleQueueMessage.waitFor({ state: 'visible' })
    const visibleQueueMessageText = await visibleQueueMessage.innerText()
    assert.match(visibleQueueMessageText, /降到 40 个以下前暂不开新一组/)
    assert.match(visibleQueueMessageText, /今天只需完成“今日复习”里的安排/)
    const visibleQueueMessageStack = await visibleQueueMessage.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      const page = element.closest('.passage-preview-page')
        const liveRegion = element.closest('[aria-live]')
      const messageStyle = getComputedStyle(element)
      const pageStyle = getComputedStyle(page)
      return {
        text: element.innerText,
        readerTheme: document.documentElement.getAttribute('data-theme'),
        learningPageTheme: page?.dataset.uiTheme || '',
        announcementMode: liveRegion?.getAttribute('aria-live') || '',
        foreground: messageStyle.color,
        pageBackground: pageStyle.backgroundColor,
        fontSize: messageStyle.fontSize,
        fontWeight: messageStyle.fontWeight,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        inViewport: rect.bottom > 0 && rect.top < window.innerHeight,
        hitTestClass: hit?.className?.toString?.() || hit?.tagName?.toLowerCase() || null,
        hitTestWithinNotice: Boolean(hit && element.contains(hit)),
      }
    })
    assert.equal(visibleQueueMessageStack.inViewport, true)
    assert.equal(visibleQueueMessageStack.hitTestWithinNotice, true)
    assert.equal(visibleQueueMessageStack.readerTheme, 'dark')
    assert.equal(visibleQueueMessageStack.learningPageTheme, 'light')
    assert.equal(visibleQueueMessageStack.announcementMode, 'polite')
    await page.screenshot({
      path: path.join(projectRoot, 'output', 'playwright', 'reader-review-queue-notice-reachable-mobile.png'),
    })
    console.log(`UI-015 reachable completed state shows its queue warning with no covered duplicate; visible stack=${JSON.stringify(visibleQueueMessageStack)}`)
    await page.locator('.passage-preview-complete .passage-preview-secondary').click()
    await page.locator('.passage-preview-page').waitFor({ state: 'detached' })
    assert.equal(
      await page.locator('.passage-preview-queue-notice').count(),
      0,
      'closing the completed preview must remove its global queue notice',
    )
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
      'closing the completed preview must restore the reader viewport width',
    )
    await page.getByRole('button', { name: '待预习' }).click()
    await page.locator('.passage-preview-page').waitFor()
    assert.equal(
      await page.getByRole('button', { name: '去今日复习', exact: true }).count(),
      1,
      'the completed preview must offer a direct route to today review',
    )
    await page.getByRole('button', { name: '去今日复习', exact: true }).click()
    await page.locator('.passage-preview-page').waitFor({ state: 'detached' })
    await page.locator('main.srs-review-page:not(.passage-preview-page)').waitFor()
    assert.equal(await page.locator('.passage-preview-queue-notice').count(), 0)
  } finally {
    await context.close()
  }
}

function makePreviewFixtureItem({ id, lemma, meaning }) {
  return {
    schemaVersion: 'vocabulary-preview.first-contact.v1',
    id,
    lemma,
    word: lemma,
    form: lemma,
    forms: [lemma],
    pos: 'noun',
    phonetic: '',
    source: 'browser-fixture',
    batchTitle: '浏览器恢复验证',
    primaryMeaningZh: meaning,
    primarySenseStatus: 'suggested',
    targetSenseKey: `preview:${lemma}:${meaning}`,
    realSentence: null,
    previewContext: {
      sentence: `${lemma[0].toUpperCase()}${lemma.slice(1)} takes time.`,
      source_kind: 'user_local_exam_material',
      source_id: 'browser-fixture',
      source_title: '浏览器恢复验证',
      source_locator: {
        locator_version: 'source-locator.v1',
        local_locator: `browser-fixture:${lemma}`,
      },
      license_kind: 'user_owned',
      ownership: 'private',
      quality_status: 'validated',
    },
  }
}

async function seedPassagePreviewBrowserState(page, { data, progress, pendingCount = 40 } = {}) {
  await page.evaluate(async ({ data: previewItems, progress: previewProgress, pendingCount: count }) => {
    const durableKey = 'vocabulary.passage-preview.durable-state.v1'
    const acquisitionRowId = 'vocabulary.acquisition.store.v1'
    const pendingPairs = Object.fromEntries(Array.from({ length: Math.max(0, Number(count) || 0) }, (_, index) => {
      const learningUnitId = `browser-pending-learning-unit-${index}`
      const meaning = `待复习释义 ${index}`
      const targetSense = {
        gloss: meaning,
        normalized_gloss: meaning,
        part_of_speech: 'noun',
        definition: null,
        language: 'en',
      }
      return [learningUnitId, {
        learning_unit: {
          schema_version: 'learning-unit.v1',
          learning_unit_id: learningUnitId,
          word_id: `browser-pending-word-${index}`,
          normalized_form: `pending-${index}`,
          language: 'en',
          target_sense_id: `browser-pending-sense-${index}`,
          target_sense_key: `en\u001fnoun\u001f${meaning}`,
          target_sense: targetSense,
          created_at: '2026-08-01T00:00:00.000Z',
          updated_at: '2026-08-01T00:00:00.000Z',
          archived_at: null,
          revision: 1,
          extensions: {
            source: 'ielts-preview',
            preview_item_id: `browser-pending:${index}`,
          },
        },
        acquisition_state: {
          schema_version: 'acquisition-state.v1',
          learning_unit_id: learningUnitId,
          status: 'introduced',
          context_evidence_ids: [],
          validated_anchor_id: null,
          last_acquisition_attempt_id: null,
          introduction_episode_id: `browser-pending-episode-${index}`,
          introduced_at: '2026-08-01T00:00:00.000Z',
          last_exposure_at: null,
          ready_for_check_at: null,
          graduated_at: null,
          skipped_at: null,
          revision: 1,
          extensions: {},
        },
      }]
    }))
    localStorage.setItem(durableKey, JSON.stringify({
      schemaVersion: 'passage-preview.durable-state.v1',
      revision: 0,
      batchId: 'batch:browser-fixture',
      data: Array.isArray(previewItems) ? previewItems : [],
      progress: previewProgress,
      allocations: null,
      continuation: null,
      archive: [],
      learningHistory: null,
      learningSettings: null,
    }))
    localStorage.removeItem('vocabulary.passage-preview.data.v2')
    localStorage.removeItem('vocabulary.passage-preview.progress.v2')
    localStorage.removeItem('vocabulary.passage-preview.acquisition.v1')

    await new Promise((resolve, reject) => {
      let request
      try {
        request = indexedDB.open('SeekPlayerDB', 1)
      } catch (error) {
        reject(error)
        return
      }
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('files')) {
          request.result.createObjectStore('files', { keyPath: 'id' })
        }
      }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const database = request.result
        let transaction
        try {
          transaction = database.transaction('files', 'readwrite')
        } catch (error) {
          database.close()
          reject(error)
          return
        }
        transaction.oncomplete = () => {
          database.close()
          resolve()
        }
        transaction.onerror = () => {
          database.close()
          reject(transaction.error)
        }
        transaction.onabort = () => {
          database.close()
          reject(transaction.error || new Error('fixture acquisition transaction aborted'))
        }
        transaction.objectStore('files').put({
          id: acquisitionRowId,
          content: {
            schema_version: 'acquisition-store.v1',
            by_learning_unit_id: pendingPairs,
            acquisition_attempts_by_id: {},
          },
          revision: 0,
          timestamp: new Date().toISOString(),
        })
      }
    })
  }, { data, progress, pendingCount })
}

async function waitForAcquisitionUnitCount(page, expectedLearningUnitId, expectedCount) {
  await page.waitForFunction(async ({ expectedLearningUnitId: id, expectedCount: count }) => {
    try {
      return await new Promise((resolve) => {
        const request = indexedDB.open('SeekPlayerDB', 1)
        request.onerror = () => resolve(false)
        request.onsuccess = () => {
          const database = request.result
          if (!database.objectStoreNames.contains('files')) {
            database.close()
            resolve(false)
            return
          }
          const rowRequest = database.transaction('files', 'readonly')
            .objectStore('files')
            .get('vocabulary.acquisition.store.v1')
          rowRequest.onerror = () => {
            database.close()
            resolve(false)
          }
          rowRequest.onsuccess = () => {
            const pairs = Object.values(rowRequest.result?.content?.by_learning_unit_id || {})
            const ids = pairs.map((pair) => pair?.learning_unit?.learning_unit_id).filter(Boolean)
            database.close()
            resolve(ids.length === count && pairs.some((pair) => (
              pair?.learning_unit?.extensions?.preview_item_id === id
            )))
          }
        }
      })
    } catch {
      return false
    }
  }, { expectedLearningUnitId, expectedCount }, { timeout: 15_000 })
}

async function readAcquisitionLearningUnitIds(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('SeekPlayerDB', 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      if (!database.objectStoreNames.contains('files')) {
        database.close()
        resolve([])
        return
      }
      const rowRequest = database.transaction('files', 'readonly')
        .objectStore('files')
        .get('vocabulary.acquisition.store.v1')
      rowRequest.onerror = () => {
        database.close()
        reject(rowRequest.error)
      }
      rowRequest.onsuccess = () => {
        const ids = Object.keys(rowRequest.result?.content?.by_learning_unit_id || {})
        database.close()
        resolve(ids)
      }
    }
  }))
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

async function verifyLearningSettingsDialog(page) {
  const trigger = page.getByRole('button', { name: '预习设置', exact: true })
  const dialog = page.getByRole('dialog', { name: '预习设置', exact: true })
  const input = dialog.getByRole('spinbutton', { name: '每组预习数量' })
  const open = async () => {
    await trigger.click()
    await dialog.waitFor()
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '关闭预习设置')
    await input.waitFor({ state: 'visible' })
    await page.waitForFunction(() => !document.querySelector('.passage-preview-learning-settings-dialog input').disabled)
  }
  const restored = async () => {
    await dialog.waitFor({ state: 'hidden' })
    assert.ok(await trigger.evaluate((node) => node === document.activeElement), 'settings close must restore the opener')
  }
  await open()
  await page.keyboard.press('Shift+Tab')
  assert.ok(await dialog.getByRole('button', { name: '保存设置' }).evaluate((node) => node === document.activeElement))
  await page.keyboard.press('Tab')
  assert.ok(await dialog.getByRole('button', { name: '关闭预习设置' }).evaluate((node) => node === document.activeElement))
  for (const key of [...Array(9).fill('Tab'), ...Array(9).fill('Shift+Tab')]) {
    await page.keyboard.press(key)
    assert.ok(await dialog.evaluate((node) => node.contains(document.activeElement)), `${key} leaked outside settings`)
  }
  for (const value of ['0', '201', '1.5']) {
    await input.fill(value)
    await dialog.getByRole('button', { name: '保存设置' }).click()
    assert.match(await dialog.locator('[role="status"]').innerText(), /1–200 之间的整数/)
    assert.ok(await dialog.isVisible())
  }
  await input.fill('37')
  await dialog.getByRole('button', { name: '保存设置' }).click()
  await restored()
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('vocabulary.passage-preview.durable-state.v1') || '{}').learningSettings?.batchSize)
  assert.equal(await saved(), 37)
  for (const path of ['cancel', 'close', 'backdrop', 'escape']) {
    await open()
    assert.equal(await input.inputValue(), '37')
    await input.fill('38')
    if (path === 'cancel') await dialog.getByRole('button', { name: '取消' }).click()
    if (path === 'close') await dialog.getByRole('button', { name: '关闭预习设置' }).click()
    if (path === 'backdrop') await page.locator('.passage-preview-shortcut-backdrop').click({ position: { x: 2, y: 2 } })
    if (path === 'escape') await page.keyboard.press('Escape')
    await restored()
    assert.equal(await saved(), 37, `${path} must not save the draft`)
  }
}

async function verifyPendingLearningSettings(browser, url) {
  const context = await browser.newContext({ serviceWorkers: 'block' })
  let records = {}, revision = 0, releaseSave, saveStarted = false, bottomEscapes = 0
  let observeSaveRequest, saveRequestTimeout
  const saveRequestObserved = new Promise((resolve) => { observeSaveRequest = resolve })
  const holdSave = new Promise((resolve) => { releaseSave = resolve })
  try {
    await context.route('**/*', async (route) => {
      const request = route.request(), target = new URL(request.url())
      const json = (body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
      if (target.pathname === '/api/app/health') return json({
        profileId: 'settings-browser-fixture', instanceId: 'settings-fixture-instance',
        liveness: { ready: true }, contractValid: true, profileEvidenceReady: true,
        ownerRegistry: { valid: true }, domains: [{ domain: 'passage-preview', authority: 'authoritative', queryCapability: 'read-only', commandCapability: 'writable' }],
      })
      if (target.pathname === '/api/app/owner') {
        const body = request.postDataJSON(), command = body.kind === 'command'
          && body.domain === 'passage-preview' && body.operation === 'legacy-import'
        if (command) {
          saveStarted = true
          observeSaveRequest()
          await holdSave
          records = { ...records, ...body.payload.records }
          revision += 1
        }
        const fingerprint = `sha256:${'a'.repeat(64)}`
        return json({
          contractVersion: body.contractVersion, requestId: body.requestId, correlationId: body.correlationId,
          domain: body.domain, operation: body.operation, outcome: command ? 'committed' : 'read',
          commitStatus: command ? 'committed' : 'not-applicable', revision, error: null,
          payload: { records }, receipt: command ? {
            receiptId: `settings-fixture-${revision}`, contractVersion: body.contractVersion,
            profileId: body.payload.profileId, instanceId: body.payload.instanceId,
            requestId: body.requestId, correlationId: body.correlationId, domain: body.domain, operation: body.operation,
            idempotencyKey: body.idempotencyKey, expectedRevision: body.expectedRevision,
            requestFingerprint: fingerprint, commitStatus: 'committed', revision, effectFingerprint: fingerprint,
            recordChecksums: [fingerprint], evidenceChecksum: fingerprint, evidenceSource: 'settings-browser-fixture',
            createdAt: '2026-10-03T00:00:00.000Z', committedAt: '2026-10-03T00:00:00.000Z', queryOperation: 'receipt-query',
          } : null,
        })
      }
      if (target.pathname.startsWith('/api/')) return json(target.pathname.includes('snapshot') ? { jobs: [], revision: 0 } : target.pathname.includes('recent') ? [] : { status: 'idle', ok: true })
      if (target.origin === new URL(url).origin) return route.continue()
      return route.abort()
    })
    const page = await context.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '预习设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '预习设置', exact: true })
    const input = dialog.getByRole('spinbutton', { name: '每组预习数量' })
    await page.waitForFunction(() => !document.querySelector('.passage-preview-learning-settings-dialog input')?.disabled)
    await input.fill('41')
    await page.evaluate(() => {
      window.__settingsBottomEscapes = 0
      document.addEventListener('keydown', (event) => { if (event.key === 'Escape') window.__settingsBottomEscapes += 1 })
    })
    await dialog.getByRole('button', { name: '保存设置' }).click()
    await Promise.race([
      saveRequestObserved,
      new Promise((_, reject) => {
        saveRequestTimeout = setTimeout(() => reject(new Error('Timed out waiting for the passage-preview legacy-import save request')), 10_000)
      }),
    ])
    clearTimeout(saveRequestTimeout)
    await page.waitForFunction(() => document.querySelector('.passage-preview-learning-settings-dialog')?.getAttribute('aria-busy') === 'true')
    assert.ok(saveStarted, 'the real owner save command must be pending')
    assert.ok(await input.isDisabled())
    assert.ok(await dialog.getByRole('button', { name: '取消' }).isDisabled())
    await page.keyboard.press('Escape')
    await dialog.getByRole('button', { name: '关闭预习设置' }).click()
    await page.locator('.passage-preview-shortcut-backdrop').click({ position: { x: 2, y: 2 } })
    for (const key of ['Tab', 'Shift+Tab']) {
      await page.keyboard.press(key)
      assert.ok(await dialog.evaluate((node) => node.contains(document.activeElement)))
    }
    assert.ok(await dialog.isVisible())
    bottomEscapes = await page.evaluate(() => window.__settingsBottomEscapes)
    assert.equal(bottomEscapes, 0, 'saving-time Escape must not reach the reader')
    releaseSave()
    await dialog.waitFor({ state: 'hidden' })
    assert.ok(await page.getByRole('button', { name: '预习设置', exact: true }).evaluate((node) => node === document.activeElement))
    await page.getByRole('button', { name: '预习设置', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('.passage-preview-learning-settings-dialog input')?.disabled)
    assert.equal(await input.inputValue(), '41')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
  } finally {
    clearTimeout(saveRequestTimeout)
    releaseSave()
    await context.close()
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
