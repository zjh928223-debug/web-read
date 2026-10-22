const assert = require('node:assert/strict')
const { chromium } = require('playwright')

const APP_URL = process.env.READ_WEB_URL || 'http://127.0.0.1:5173/'

function cssAlpha(color) {
  const slash = color.match(/\/\s*([0-9.]+)\s*\)?$/)
  if (slash) return Number(slash[1])
  const rgba = color.match(/rgba\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*([0-9.]+)\s*\)/i)
  if (rgba) return Number(rgba[1])
  return color === 'transparent' ? 0 : 1
}

async function assertMaterialSurfaceStyles(page, theme) {
  const styles = await page.evaluate(() => {
    const backdrop = document.querySelector('.youtube-workflow-backdrop')
    const panel = document.querySelector('.youtube-workflow-panel')
    if (!backdrop || !panel) return null
    const backdropStyle = getComputedStyle(backdrop)
    const panelStyle = getComputedStyle(panel)
    return {
      backdropColor: backdropStyle.backgroundColor,
      panelColor: panelStyle.backgroundColor,
    }
  })
  assert.ok(styles, `${theme} material center surface nodes should be present`)
  const backdropAlpha = cssAlpha(styles.backdropColor)
  const panelAlpha = cssAlpha(styles.panelColor)
  assert.ok(backdropAlpha >= 0.27 && backdropAlpha <= 0.29, `${theme} backdrop alpha should be about 0.28, got ${styles.backdropColor}`)
  assert.ok(panelAlpha >= 0.99, `${theme} panel should be opaque, got ${styles.panelColor}`)
}

function json(body) {
  return {
    status: 200,
    contentType: 'application/json',
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    },
    body: JSON.stringify(body),
  }
}

async function mockService(page) {
  let revision = 4
  let configReadMode = 'success'
  let configSaveMode = 'success'
  let configGetCount = 0
  const backendConfig = {
    model: 'gemini-test',
    baseUrl: '',
    proxyUrl: '',
    cookiesPath: '',
    outputDir: 'C:/workflow-output',
    ytDlpPath: 'yt-dlp.exe',
    whisperxPath: 'whisperx.exe',
  }
  const queue = [
    {
      jobId: 'active-one', status: 'translating', stage: 'translating', title: 'Active material',
      updatedAt: '2026-08-18T08:00:00.000Z', request: { url: 'https://youtu.be/Active12345', model: 'gemini-queue-a', geminiMode: 'mock' },
    },
    {
      jobId: 'failed-old', status: 'failed', stage: 'translating', title: 'Failed material',
      updatedAt: '2026-08-17T08:00:00.000Z', request: { url: 'https://youtu.be/Failed12345', model: 'gemini-failed-old', geminiMode: 'off' },
      error: { category: 'gemini', message: 'AI response was invalid' },
    },
    {
      jobId: 'failed-new', status: 'failed', stage: 'translating', title: 'Failed material',
      updatedAt: '2026-08-18T07:00:00.000Z', request: { url: 'https://youtube.com/watch?v=Failed12345', model: 'gemini-failed-new', geminiMode: 'real' },
      error: { category: 'gemini', message: 'AI response was invalid again' },
    },
  ]
  const library = Array.from({ length: 20 }, (_, index) => ({
    jobId: `library-${index}`,
    title: `Library material ${index + 1}`,
    url: `https://youtube.com/watch?v=Library${String(index).padStart(4, '0')}`,
    request: {
      url: `https://youtube.com/watch?v=Library${String(index).padStart(4, '0')}`,
      model: `gemini-history-${index}`,
      geminiMode: index % 2 === 0 ? 'real' : 'mock',
    },
    lastActivityAt: new Date(Date.UTC(2026, 7, 18, 10, 0, 0) - index * 3600000).toISOString(),
  }))
  const observed = {
    credentialPayloads: [],
    configPayloads: [],
    createPayloads: [],
    setConfigReadMode(mode) {
      configReadMode = mode
    },
    setConfigSaveMode(mode) {
      configSaveMode = mode
    },
    get configGetCount() {
      return configGetCount
    },
  }
  await page.route('**/oembed**', (route) => route.fulfill(json({})))
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'OPTIONS') return route.fulfill(json({ ok: true }))
    if (url.pathname === '/api/health') return route.fulfill(json({ ok: true }))
    if (url.pathname === '/api/jobs/snapshot') return route.fulfill(json({ revision, jobs: queue }))
    if (url.pathname === '/api/reader/recent') return route.fulfill(json(library))
    if (url.pathname === '/api/credentials/gemini' && request.method() === 'POST') {
      observed.credentialPayloads.push(request.postDataJSON())
      return route.fulfill(json({ stored: true, provider: 'test' }))
    }
    if (url.pathname === '/api/config' && request.method() === 'POST') {
      const payload = request.postDataJSON()
      observed.configPayloads.push(payload)
      if (configSaveMode === 'fail') {
        return route.fulfill({ ...json({ detail: 'controlled config save failure' }), status: 503 })
      }
      return route.fulfill(json({ ...backendConfig, ...payload }))
    }
    if (url.pathname === '/api/config') {
      configGetCount += 1
      if (configReadMode === 'fail') {
        return route.fulfill({ ...json({ detail: 'controlled config read failure' }), status: 503 })
      }
      return route.fulfill(json(backendConfig))
    }
    if (url.pathname === '/api/credentials/gemini/status') return route.fulfill(json({ stored: true, provider: 'test' }))
    const sessionMatch = url.pathname.match(/^\/api\/jobs\/(library-\d+)\/session$/)
    if (sessionMatch) {
      return route.fulfill(json({ jobId: sessionMatch[1], title: `Session ${sessionMatch[1]}`, files: { audio: 'audio' } }))
    }
    const fileMatch = url.pathname.match(/^\/api\/jobs\/(library-\d+)\/file\/(transcript|chunkData)$/)
    if (fileMatch) {
      const [, jobId, kind] = fileMatch
      if (jobId === 'library-0' && kind === 'transcript') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: 'not-json' })
      }
      const payload = kind === 'transcript'
        ? { segments: [{ start: 0, end: 1, words: [{ word: jobId, start: 0, end: 1 }] }] }
        : { s: [{ chunks: [{ a: 0, b: 1, en: jobId }] }] }
      return route.fulfill(json(payload))
    }
    const marksMatch = url.pathname.match(/^\/api\/jobs\/(library-\d+)\/reader-marks$/)
    if (marksMatch) return route.fulfill(json({ jobId: marksMatch[1], marks: [] }))
    const mediaMatch = url.pathname.match(/^\/api\/jobs\/(library-\d+)\/media\/audio$/)
    if (mediaMatch) {
      return route.fulfill({
        status: 206,
        contentType: 'audio/wav',
        headers: {
          'access-control-expose-headers': 'accept-ranges, content-range, etag',
          'accept-ranges': 'bytes',
          'content-range': 'bytes 0-0/16',
          etag: '"library-audio-etag"',
        },
        body: Buffer.from([0]),
      })
    }
    const deleteMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/)
    if (deleteMatch && request.method() === 'DELETE') {
      const expectedRevision = Number(request.headers()['x-expected-revision'])
      if (expectedRevision !== revision) {
        return route.fulfill({
          ...json({ detail: { code: 'WORKFLOW_STATE_CONFLICT', expectedRevision, currentRevision: revision } }),
          status: 409,
        })
      }
      const jobId = decodeURIComponent(deleteMatch[1])
      const index = queue.findIndex((job) => job.jobId === jobId)
      if (index >= 0) queue.splice(index, 1)
      revision += 1
      return route.fulfill(json({ deleted: true, jobId, revision }))
    }
    if (url.pathname === '/api/jobs' && request.method() === 'POST') {
      const expectedRevision = Number(request.headers()['x-expected-revision'])
      if (expectedRevision !== revision) {
        return route.fulfill({
          ...json({ detail: { code: 'WORKFLOW_STATE_CONFLICT', expectedRevision, currentRevision: revision } }),
          status: 409,
        })
      }
      const payload = request.postDataJSON()
      observed.createPayloads.push(payload)
      revision += 1
      const created = {
        jobId: 'created-after-delete', status: 'queued', stage: 'queued', title: 'Created after delete',
        updatedAt: '2026-08-18T09:00:00.000Z', request: { url: payload.url }, revision,
      }
      queue.push(created)
      return route.fulfill(json(created))
    }
    return route.fulfill(json({ ok: true, revision }))
  })
  return observed
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const consoleErrors = []
  const pageErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  try {
    const observed = await mockService(page)
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
    await page.locator('.youtube-material-entry').click()
    const panel = page.locator('.youtube-workflow-panel')
    await panel.waitFor({ state: 'visible' })
    await assertMaterialSurfaceStyles(page, 'light')
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await assertMaterialSurfaceStyles(page, 'dark')
    await page.evaluate(() => document.documentElement.removeAttribute('data-theme'))
    await page.waitForSelector('.youtube-workflow-library-job')
    assert.equal(await page.locator('.youtube-workflow-nav button').count(), 3)
    assert.equal(await page.locator('.youtube-workflow-library-job').count(), 20)
    assert.match(await page.locator('.youtube-workflow-content').innerText(), /素材库/)
    assert.doesNotMatch(await page.locator('.youtube-workflow-content').innerText(), /按最近使用时间排列/)
    assert.equal(await page.locator('[data-reader-save-state]').count(), 0)
    const firstLibraryRow = page.locator('.youtube-workflow-library-job').first()
    assert.doesNotMatch(await firstLibraryRow.innerText(), /YouTube|Library0000/, 'source identity should stay hidden in the collapsed row')

    const openButton = firstLibraryRow.getByRole('button', { name: '打开' })
    const openButtonStyle = await openButton.evaluate((button) => {
      const style = getComputedStyle(button)
      return {
        owner: button.dataset.uiOwner,
        variant: button.dataset.variant,
        size: button.dataset.size,
        borderRadius: style.borderRadius,
        backgroundImage: style.backgroundImage,
        color: style.color,
        fontWeight: style.fontWeight,
      }
    })
    assert.equal(openButtonStyle.owner, 'workflow')
    assert.equal(openButtonStyle.variant, 'outline')
    assert.equal(openButtonStyle.size, 'default')
    assert.equal(openButtonStyle.borderRadius, '6px')
    assert.equal(openButtonStyle.backgroundImage, 'none')
    assert.equal(openButtonStyle.fontWeight, '500')
    await openButton.hover()
    const openButtonHoverStyle = await openButton.evaluate((button) => {
      const style = getComputedStyle(button)
      return { borderRadius: style.borderRadius, backgroundImage: style.backgroundImage, transform: style.transform }
    })
    assert.equal(openButtonHoverStyle.borderRadius, '6px')
    assert.equal(openButtonHoverStyle.backgroundImage, 'none')
    assert.equal(openButtonHoverStyle.transform, 'none', 'migrated buttons should not inherit the legacy lift effect')

    const activeNavigation = page.locator('.youtube-workflow-nav button[data-active="true"]')
    const activeNavigationStyle = await activeNavigation.evaluate((button) => {
      const style = getComputedStyle(button)
      return { owner: button.dataset.uiOwner, variant: button.dataset.variant, size: button.dataset.size, color: style.color, fontWeight: style.fontWeight, backgroundImage: style.backgroundImage }
    })
    assert.equal(activeNavigationStyle.owner, 'workflow')
    assert.equal(activeNavigationStyle.variant, 'secondary')
    assert.equal(activeNavigationStyle.size, 'default')
    assert.equal(activeNavigationStyle.fontWeight, '500')
    assert.equal(activeNavigationStyle.backgroundImage, 'none')

    const filterStyle = await page.locator('.youtube-filter-tabs button[data-active="true"]').evaluate((button) => {
      const style = getComputedStyle(button)
      return { owner: button.dataset.uiOwner, variant: button.dataset.variant, size: button.dataset.size, fontWeight: style.fontWeight, backgroundImage: style.backgroundImage }
    })
    assert.equal(filterStyle.owner, 'workflow')
    assert.equal(filterStyle.variant, 'secondary')
    assert.equal(filterStyle.size, 'default')
    assert.equal(filterStyle.fontWeight, '500')
    assert.equal(filterStyle.backgroundImage, 'none')

    const iconStyle = await firstLibraryRow.getByRole('button', { name: '更多操作' }).evaluate((button) => {
      const style = getComputedStyle(button)
      return { owner: button.dataset.uiOwner, variant: button.dataset.variant, size: button.dataset.size, borderRadius: style.borderRadius, fontWeight: style.fontWeight }
    })
    assert.equal(iconStyle.owner, 'workflow')
    assert.equal(iconStyle.variant, 'ghost')
    assert.equal(iconStyle.size, 'icon')
    assert.equal(iconStyle.borderRadius, '6px')
    assert.equal(iconStyle.fontWeight, '500')

    await firstLibraryRow.getByRole('button', { name: '更多操作' }).click()
    assert.match(await firstLibraryRow.innerText(), /YouTube · Library0000/)
    assert.match(await firstLibraryRow.innerText(), /任务请求模型：gemini-history-0/)
    assert.match(await firstLibraryRow.innerText(), /请求模式：真实模式/)
    assert.match(await firstLibraryRow.innerText(), /实际执行\/路由模型：当前记录未提供/)
    await firstLibraryRow.getByRole('button', { name: '查看处理详情' }).click()
    const qualityDialog = page.getByRole('dialog', { name: '质量报告' })
    await qualityDialog.waitFor({ state: 'visible' })
    assert.match(await qualityDialog.innerText(), /任务请求模型：gemini-history-0/)
    assert.match(await qualityDialog.innerText(), /实际执行\/路由模型：当前记录未提供/)
    const qualityLayer = await page.locator('.youtube-quality-backdrop').evaluate((backdrop) => Number(getComputedStyle(backdrop).zIndex))
    const materialLayer = await page.locator('.youtube-workflow-backdrop').evaluate((backdrop) => Number(getComputedStyle(backdrop).zIndex))
    assert.ok(qualityLayer > materialLayer, `quality layer ${qualityLayer} should be above material layer ${materialLayer}`)
    const qualityBox = await qualityDialog.boundingBox()
    const topElementIsDialog = await page.evaluate(({ x, y }) => {
      const top = document.elementFromPoint(x, y)
      return Boolean(top && top.closest('[aria-labelledby="youtube-quality-dialog-title"]'))
    }, { x: qualityBox.x + qualityBox.width / 2, y: qualityBox.y + qualityBox.height / 2 })
    assert.equal(topElementIsDialog, true, 'quality dialog should receive pointer events above the material panel')
    const qualityInitialFocus = qualityDialog.locator('[data-quality-initial-focus]')
    assert.equal(await qualityInitialFocus.getAttribute('data-ui-owner'), 'workflow')
    assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-quality-initial-focus')), true, 'quality dialog should focus a real initial action button')
    await qualityDialog.getByRole('button', { name: '关闭', exact: true }).click()

    const box = await panel.boundingBox()
    assert.ok(box.width >= 720 && box.width <= 960, `panel width should be adaptive, got ${box.width}`)
    assert.ok(Math.abs(box.x + box.width - (1440 - 14)) < 3, `panel should align right, got ${box.x + box.width}`)
    await page.mouse.click(5, 5)
    assert.equal(await panel.isVisible(), true, 'outside click should not close the fixed panel')

    await page.locator('.youtube-workflow-nav button[data-view="queue"]').click()
    await page.waitForSelector('.youtube-workflow-queue-job')
    assert.doesNotMatch(await page.locator('.youtube-workflow-content').innerText(), /处理中任务静默运行/)
    assert.equal(await page.locator('.youtube-workflow-queue-job').count(), 2)
    assert.match(await page.locator('.youtube-workflow-queue').innerText(), /2 次尝试/)
    assert.match(await page.locator('.youtube-workflow-queue').innerText(), /3\/4 · AI 切分与翻译/)
    const attemptHistory = page.locator('.youtube-task-attempt-details')
    assert.equal(await attemptHistory.count(), 1, 'the repeated failure should expose one attempt-history disclosure')
    await attemptHistory.locator('summary').click()
    assert.equal(await attemptHistory.locator('p').count(), 1, 'opening the disclosure should show the previous attempt')
    assert.match(await attemptHistory.innerText(), /AI response was invalid/)
    console.log('youtube queue attempt history opened and prior attempt was visible')
    await attemptHistory.locator('summary').click()
    const failedDeleteButton = page.locator('.youtube-workflow-queue-job[data-status="failed"] button[data-ui-owner="workflow"][data-variant="destructive"]').first()
    await page.keyboard.press('Tab')
    await failedDeleteButton.focus()
    await page.waitForTimeout(200)
    const destructiveFocusStyle = await failedDeleteButton.evaluate((button) => {
      const style = getComputedStyle(button)
      return {
        focusVisible: button.matches(':focus-visible'),
        ringColor: style.getPropertyValue('--tw-ring-color'),
        boxShadow: style.boxShadow,
      }
    })
    assert.equal(destructiveFocusStyle.focusVisible, true, 'destructive action should use keyboard-visible focus')
    assert.match(destructiveFocusStyle.boxShadow, /0px 0px 0px 3px/, 'destructive action should retain the component focus ring')
    assert.match(destructiveFocusStyle.ringColor, /oklch\(0\.577 0\.245 27\.325\)|oklch\(57\.7% \.245 27\.325\)|207|cf3d4b/i, 'destructive action should retain its semantic focus color')
    await failedDeleteButton.click()
    await page.waitForSelector('.youtube-workflow-queue-job[data-status="failed"]', { state: 'hidden' })
    assert.equal(await page.locator('.youtube-workflow-queue-job[data-status="failed"]').count(), 0)

    await page.getByRole('button', { name: /添加素材/ }).click()
    const addText = await page.locator('.youtube-workflow-content').innerText()
    assert.match(addText, /视频链接/)
    assert.doesNotMatch(addText, /导入旧素材目录|视频优先|系统凭据/)
    const linkInput = page.locator('textarea[name="youtube-material-link"]')
    const linkField = await linkInput.evaluate((textarea) => {
      const style = getComputedStyle(textarea)
      return [textarea.dataset.uiOwner, textarea.dataset.slot, textarea.name, textarea.autocomplete, textarea.rows, style.minHeight, style.maxHeight, style.borderRadius, style.padding, style.resize, style.cursor, style.backgroundImage, style.backdropFilter]
    })
    assert.deepEqual(linkField, ['workflow', 'textarea', 'youtube-material-link', 'off', 2, '76px', '220px', '6px', '8px 12px', 'vertical', 'text', 'none', 'none'])

    await linkInput.fill('  https://www.youtube.com/watch?v=bLurTest123  ')
    assert.equal(await linkInput.inputValue(), '  https://www.youtube.com/watch?v=bLurTest123  ', 'editing DOM should preserve raw v-model.trim input until change')
    await linkInput.press('Tab')
    await page.waitForSelector('.youtube-link-card')
    assert.match(await page.locator('.youtube-link-card').first().innerText(), /bLurTest123/, 'blur should commit the trimmed link value')

    await linkInput.fill('  https://www.youtube.com/watch?v=pAsteTest12\nhttps://www.youtube.com/watch?v=pAsteTest13  ')
    await page.evaluate(() => {
      const textarea = document.querySelector('textarea[name="youtube-material-link"]')
      const event = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', {
        value: { getData: () => '  https://www.youtube.com/watch?v=pAsteTest12\nhttps://www.youtube.com/watch?v=pAsteTest13  ' },
      })
      textarea.dispatchEvent(event)
    })
    await page.waitForTimeout(30)
    assert.equal(await page.locator('.youtube-link-card').count(), 3, 'multi-line paste should commit one card per link without duplication')

    await linkInput.fill('https://www.youtube.com/watch?v=enterTest12')
    await linkInput.press('Enter')
    await page.waitForTimeout(30)
    assert.equal(await page.locator('.youtube-link-card').count(), 3, 'ordinary Enter should keep textarea editing behavior')
    await linkInput.fill('https://www.youtube.com/watch?v=cTrlEnter12')
    await linkInput.press('Control+Enter')
    await page.waitForTimeout(30)
    assert.equal(await page.locator('.youtube-link-card').count(), 4, 'Ctrl+Enter should commit one link card')

    await page.locator('.youtube-link-card').first().getByRole('button', { name: '移除第 1 条链接' }).click()
    await page.locator('.youtube-link-card').first().getByRole('button', { name: '移除第 1 条链接' }).click()
    await page.locator('.youtube-link-card').first().getByRole('button', { name: '移除第 1 条链接' }).click()
    assert.equal(await page.locator('.youtube-link-card').count(), 1)
    await page.locator('.youtube-add-material-form button[type="submit"]').click()
    await page.waitForSelector('.youtube-workflow-queue-job')
    assert.equal(observed.createPayloads.length, 1)
    assert.equal(observed.createPayloads[0].url, 'https://www.youtube.com/watch?v=cTrlEnter12')
    assert.equal(await page.locator('[data-workflow-mutation-notice]').count(), 0, 'deleting failures must advance the local revision before creating again')
    assert.match(await page.locator('.youtube-workflow-queue').innerText(), /Created after delete/)

    await page.locator('.youtube-workflow-nav button[data-view="settings"]').click()
    await page.waitForSelector('[data-workflow-config-status]')
    await page.waitForTimeout(30)
    const compactSettingsText = await page.locator('.youtube-workflow-content').innerText()
    assert.match(compactSettingsText, /Gemini API Key/)
    assert.doesNotMatch(compactSettingsText, /管理素材处理使用的 Gemini API Key/)
    assert.match(compactSettingsText, /素材处理模型/)
    for (const purposeText of ['素材转写', '素材切分', '素材翻译', '文章解释', '短义精简', '句子即时翻译']) {
      assert.match(compactSettingsText, new RegExp(purposeText), `${purposeText} should be visible without opening advanced settings`)
    }
    const modelInput = page.locator('input[name="youtube-workflow-settings-model"]')
    assert.equal(await modelInput.count(), 1, 'material model should have one effective input')
    assert.equal(await modelInput.inputValue(), 'gemini-test')
    assert.equal(await page.locator('.youtube-advanced-settings input[name="youtube-workflow-settings-model"]').count(), 0)
    const configStatus = page.locator('[data-workflow-config-status]')
    assert.equal(await configStatus.getAttribute('data-config-read-state'), 'loaded')
    const configSaveButton = page.locator('[data-workflow-config-save]')
    assert.equal(await configSaveButton.isDisabled(), false)
    await modelInput.focus()
    await modelInput.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement?.matches('[data-workflow-config-save]')), true, 'settings model should tab to its save action')
    await modelInput.fill('gemini-next')
    await modelInput.press('Tab')
    assert.match(await configStatus.innerText(), /尚未保存/)
    assert.equal(await observed.configPayloads.length, 0, 'editing and tabbing should not submit config')
    await configSaveButton.click()
    await page.waitForTimeout(30)
    assert.equal(observed.configPayloads.at(-1).model, 'gemini-next')
    assert.equal(Object.keys(observed.configPayloads.at(-1)).sort().join(','), ['baseUrl', 'cookiesPath', 'model', 'outputDir', 'proxyUrl', 'whisperxPath', 'ytDlpPath'].sort().join(','))
    assert.equal(await configStatus.getAttribute('data-config-save-state'), 'saved')
    assert.match(await configStatus.innerText(), /已确认保存/)
    const advancedToggle = page.getByRole('button', { name: /高级设置/ })
    assert.equal((await advancedToggle.innerText()).trim(), '高级设置')
    assert.equal(await advancedToggle.getAttribute('data-ui-owner'), 'workflow')
    assert.equal(await advancedToggle.getAttribute('data-variant'), 'outline')
    assert.equal(await advancedToggle.getAttribute('data-size'), 'default')
    const advancedToggleBox = await advancedToggle.boundingBox()
    assert.ok(advancedToggleBox.width > 0 && advancedToggleBox.height >= 36)
    await advancedToggle.click()
    assert.doesNotMatch(await page.locator('.youtube-advanced-settings').innerText(), /^模型$/m)

    const apiKeyInput = page.locator('input[name="youtube-gemini-api-key-settings"]')
    const apiKeyField = await apiKeyInput.evaluate((input) => {
      const style = getComputedStyle(input)
      return [input.dataset.uiOwner, input.dataset.slot, input.type, input.name, input.autocomplete, style.height, style.borderRadius, style.padding, style.cursor, style.backgroundImage]
    })
    assert.deepEqual(apiKeyField, ['workflow', 'input', 'password', 'youtube-gemini-api-key-settings', 'off', '36px', '6px', '4px 12px', 'text', 'none'])
    await page.evaluate(() => {
      const input = document.querySelector('input[name="youtube-gemini-api-key-settings"]')
      input.value = 'old'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      input.value = '正在输入'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await page.evaluate(() => document.querySelector('.youtube-advanced-toggle').click())
    await page.waitForTimeout(30)
    assert.equal(await apiKeyInput.inputValue(), '正在输入', 'composition text should survive a parent component update')
    await page.evaluate(() => {
      const input = document.querySelector('input[name="youtube-gemini-api-key-settings"]')
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    })
    await page.waitForTimeout(30)
    await page.getByRole('button', { name: /高级设置/ }).click()
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    const darkApiKeyBackground = await apiKeyInput.evaluate((input) => getComputedStyle(input).backgroundColor)
    assert.notEqual(darkApiKeyBackground, 'rgba(0, 0, 0, 0)', 'dark theme should retain the generated input surface token')
    await page.evaluate(() => document.documentElement.removeAttribute('data-theme'))
    await apiKeyInput.fill('  test-key  ')
    assert.equal(await apiKeyInput.inputValue(), '  test-key  ', 'API Key should preserve raw v-model whitespace')
    await page.getByRole('button', { name: '更新 API Key' }).click()
    await page.waitForTimeout(30)
    assert.deepEqual(observed.credentialPayloads, [{ apiKey: '  test-key  ' }])

    const advancedInputs = page.locator('.youtube-advanced-settings input[data-ui-owner="workflow"]')
    assert.equal(await advancedInputs.count(), 6)
    for (let index = 0; index < await advancedInputs.count(); index += 1) {
      assert.equal(await advancedInputs.nth(index).getAttribute('data-slot'), 'input')
      assert.equal(await advancedInputs.nth(index).getAttribute('autocomplete'), 'off')
    }
    const cookiesPath = page.locator('input[name="youtube-workflow-cookies-path"]')
    await cookiesPath.fill('  C:/学习 数据/cookies.txt  ')
    assert.equal(await cookiesPath.inputValue(), '  C:/学习 数据/cookies.txt  ', 'advanced fields should preserve raw editing value before change')
    await cookiesPath.press('Tab')
    assert.equal(await cookiesPath.inputValue(), 'C:/学习 数据/cookies.txt', 'advanced fields should trim on change')
    await configSaveButton.click()
    await page.waitForTimeout(30)
    assert.equal(observed.configPayloads.at(-1).cookiesPath, 'C:/学习 数据/cookies.txt')

    observed.setConfigSaveMode('fail')
    await modelInput.fill('gemini-save-failure')
    await modelInput.press('Tab')
    await configSaveButton.click()
    await page.waitForTimeout(30)
    assert.equal(await configStatus.getAttribute('data-config-save-state'), 'failed')
    assert.match(await configStatus.innerText(), /保存失败/)
    assert.doesNotMatch(await configStatus.innerText(), /已确认保存/)
    const failedPayloadCount = observed.configPayloads.length
    observed.setConfigSaveMode('success')
    await configSaveButton.click()
    await page.waitForTimeout(30)
    assert.equal(observed.configPayloads.length, failedPayloadCount + 1)
    assert.equal(await configStatus.getAttribute('data-config-save-state'), 'saved')

    const configPayloadCountBeforeReadFailure = observed.configPayloads.length
    observed.setConfigReadMode('fail')
    await page.locator('.youtube-workflow-nav button[data-view="library"]').click()
    await page.locator('.youtube-workflow-nav button[data-view="settings"]').click()
    await page.waitForTimeout(40)
    assert.equal(await configStatus.getAttribute('data-config-read-state'), 'failed')
    assert.equal(await configSaveButton.isDisabled(), true)
    assert.match(await configStatus.innerText(), /读取失败/)
    await page.evaluate(() => document.querySelector('[data-workflow-config-save]').click())
    await page.waitForTimeout(30)
    assert.equal(observed.configPayloads.length, configPayloadCountBeforeReadFailure, 'failed config reads must not submit unknown fields')
    observed.setConfigReadMode('success')
    await page.locator('.youtube-workflow-nav button[data-view="library"]').click()
    await page.locator('.youtube-workflow-nav button[data-view="settings"]').click()
    await page.waitForTimeout(40)
    assert.equal(await configStatus.getAttribute('data-config-read-state'), 'loaded')
    assert.equal(await configSaveButton.isDisabled(), false)

    for (const width of [760, 761, 640, 641]) {
      await page.setViewportSize({ width, height: 760 })
      const viewportFieldBox = await advancedInputs.first().boundingBox()
      const viewportPanelBox = await panel.boundingBox()
      assert.ok(viewportFieldBox && viewportFieldBox.width > 0, `${width}px advanced field should remain visible`)
      assert.ok(viewportFieldBox.x >= viewportPanelBox.x - 1, `${width}px field should stay inside the panel on the left`)
      assert.ok(viewportFieldBox.x + viewportFieldBox.width <= viewportPanelBox.x + viewportPanelBox.width + 1, `${width}px field should stay inside the panel on the right`)
    }

    await page.setViewportSize({ width: 640, height: 760 })
    const mobileBox = await panel.boundingBox()
    assert.equal(Math.round(mobileBox.width), 640)
    assert.equal(await page.locator('.youtube-workflow-nav button').count(), 3)

    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport)
      const layout = await page.evaluate(() => {
        const panelBox = document.querySelector('.youtube-workflow-panel')?.getBoundingClientRect()
        const modelBox = document.querySelector('.youtube-workflow-model-settings')?.getBoundingClientRect()
        const purposeBox = document.querySelector('.youtube-workflow-purpose-summary')?.getBoundingClientRect()
        return {
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
          panelBox: panelBox ? { left: panelBox.left, right: panelBox.right, width: panelBox.width } : null,
          modelBox: modelBox ? { left: modelBox.left, right: modelBox.right, width: modelBox.width } : null,
          purposeBox: purposeBox ? { left: purposeBox.left, right: purposeBox.right, width: purposeBox.width } : null,
        }
      })
      assert.ok(layout.documentWidth <= layout.viewportWidth + 1, `${viewport.width}x${viewport.height} should not overflow horizontally`)
      assert.ok(layout.panelBox && layout.modelBox && layout.purposeBox, `${viewport.width}x${viewport.height} settings surfaces should render`)
      assert.ok(layout.modelBox.left >= layout.panelBox.left - 1 && layout.modelBox.right <= layout.panelBox.right + 1, `${viewport.width} model card should stay inside panel`)
      assert.ok(layout.purposeBox.left >= layout.panelBox.left - 1 && layout.purposeBox.right <= layout.panelBox.right + 1, `${viewport.width} purpose card should stay inside panel`)
      if (process.env.N8_EVIDENCE_DIR) {
        const path = require('node:path')
        const fs = require('node:fs')
        fs.mkdirSync(process.env.N8_EVIDENCE_DIR, { recursive: true })
        await page.screenshot({ path: path.join(process.env.N8_EVIDENCE_DIR, `settings-${viewport.width}x${viewport.height}.png`), fullPage: false })
      }
    }

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.locator('.youtube-workflow-nav button[data-view="library"]').click()
    await page.locator('.youtube-workflow-library-job').first().getByRole('button', { name: '打开' }).click()
    const materialNotice = page.locator('.youtube-material-notice')
    await materialNotice.waitFor({ state: 'visible' })
    assert.match(await materialNotice.innerText(), /字幕不可用，请重新生成字幕/)
    const noticeClose = materialNotice.locator('.youtube-material-notice-close')
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') {
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
      } else {
        await page.evaluate(() => document.documentElement.removeAttribute('data-theme'))
      }
      await page.mouse.move(0, 0)
      await page.waitForTimeout(200)
      const closeStyle = await noticeClose.evaluate((button) => {
        const style = getComputedStyle(button)
        return {
          owner: button.dataset.uiOwner,
          variant: button.dataset.variant,
          size: button.dataset.size,
          backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          boxShadow: style.boxShadow,
        }
      })
      assert.equal(closeStyle.owner, 'workflow')
      assert.equal(closeStyle.variant, 'ghost')
      assert.equal(closeStyle.size, 'icon')
      assert.equal(cssAlpha(closeStyle.backgroundColor), 0, `${theme} notice close should be transparent by default`)
      const noticeAction = materialNotice.locator('button').first()
      await noticeAction.focus()
      await page.keyboard.press('Tab')
      await page.waitForTimeout(200)
      const focusStyle = await noticeClose.evaluate((button) => {
        const style = getComputedStyle(button)
        return { active: document.activeElement === button, focusVisible: button.matches(':focus-visible'), outline: style.outline, boxShadow: style.boxShadow }
      })
      assert.equal(focusStyle.active, true, `${theme} notice close should receive keyboard focus`)
      assert.equal(focusStyle.focusVisible, true, `${theme} notice close should use keyboard-visible focus`)
      assert.match(focusStyle.boxShadow, /0px 0px 0px 3px/, `${theme} notice close should retain the component focus ring`)
      await noticeClose.hover()
      const hoverStyle = await noticeClose.evaluate((button) => getComputedStyle(button).backgroundImage)
      assert.equal(hoverStyle, 'none', `${theme} notice close should use the shadcn hover treatment without a legacy gradient`)
    }
    await page.evaluate(() => document.documentElement.removeAttribute('data-theme'))
    await page.locator('.youtube-material-entry').click()
    await panel.waitFor({ state: 'visible' })
    const libraryNavigation = page.locator('.youtube-workflow-nav button[data-view="library"]')
    await libraryNavigation.click()
    await page.waitForTimeout(200)
    const mouseFocusStyle = await libraryNavigation.evaluate((button) => ({
      active: document.activeElement === button,
      focusVisible: button.matches(':focus-visible'),
      boxShadow: getComputedStyle(button).boxShadow,
    }))
    assert.equal(mouseFocusStyle.active, true, 'mouse click should focus the navigation button')
    assert.equal(mouseFocusStyle.focusVisible, false, 'mouse click should not trigger keyboard-visible focus')
    assert.ok(mouseFocusStyle.boxShadow === 'none' || /0px 0px 0px 0px/.test(mouseFocusStyle.boxShadow), 'mouse focus should not add a persistent component ring')
    await page.locator('.youtube-workflow-library-job').nth(1).getByRole('button', { name: '打开' }).click()
    await panel.waitFor({ state: 'hidden' })
    assert.equal(await materialNotice.isVisible(), false, 'a new open attempt must dismiss the previous material error immediately')
  } finally {
    await browser.close()
  }
  assert.deepEqual(consoleErrors, [], `browser console should stay healthy: ${consoleErrors.join(' | ')}`)
  assert.deepEqual(pageErrors, [], `browser page errors should stay healthy: ${pageErrors.join(' | ')}`)
  console.log('youtube workflow panel v3 browser check passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
