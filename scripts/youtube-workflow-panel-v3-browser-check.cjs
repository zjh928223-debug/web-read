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
  const queue = [
    {
      jobId: 'active-one', status: 'translating', stage: 'translating', title: 'Active material',
      updatedAt: '2026-08-18T08:00:00.000Z', request: { url: 'https://youtu.be/Active12345' },
    },
    {
      jobId: 'failed-old', status: 'failed', stage: 'translating', title: 'Failed material',
      updatedAt: '2026-08-17T08:00:00.000Z', request: { url: 'https://youtu.be/Failed12345' },
      error: { category: 'gemini', message: 'AI response was invalid' },
    },
    {
      jobId: 'failed-new', status: 'failed', stage: 'translating', title: 'Failed material',
      updatedAt: '2026-08-18T07:00:00.000Z', request: { url: 'https://youtube.com/watch?v=Failed12345' },
      error: { category: 'gemini', message: 'AI response was invalid again' },
    },
  ]
  const library = Array.from({ length: 20 }, (_, index) => ({
    jobId: `library-${index}`,
    title: `Library material ${index + 1}`,
    url: `https://youtube.com/watch?v=Library${String(index).padStart(4, '0')}`,
    lastActivityAt: new Date(Date.UTC(2026, 7, 18, 10, 0, 0) - index * 3600000).toISOString(),
  }))
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'OPTIONS') return route.fulfill(json({ ok: true }))
    if (url.pathname === '/api/health') return route.fulfill(json({ ok: true }))
    if (url.pathname === '/api/jobs/snapshot') return route.fulfill(json({ revision, jobs: queue }))
    if (url.pathname === '/api/reader/recent') return route.fulfill(json(library))
    if (url.pathname === '/api/config') return route.fulfill(json({ model: 'gemini-test' }))
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
    await mockService(page)
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
    const capsuleBeforeHover = await openButton.evaluate((button) => {
      const style = getComputedStyle(button)
      return { borderRadius: style.borderRadius, backgroundImage: style.backgroundImage, color: style.color, fontWeight: style.fontWeight }
    })
    assert.equal(capsuleBeforeHover.borderRadius, '12px')
    assert.match(capsuleBeforeHover.backgroundImage, /linear-gradient/)
    assert.equal(capsuleBeforeHover.fontWeight, '500')
    assert.notEqual(capsuleBeforeHover.color, 'rgb(37, 99, 235)')
    await openButton.hover()
    const capsuleOnHover = await openButton.evaluate((button) => {
      const style = getComputedStyle(button)
      return { borderRadius: style.borderRadius, transform: style.transform }
    })
    assert.equal(capsuleOnHover.borderRadius, '12px')
    assert.equal(capsuleOnHover.transform, 'none', 'quiet capsules should not lift or enlarge on hover')

    const activeNavigation = page.locator('.youtube-workflow-nav button[data-active="true"]')
    const activeNavigationStyle = await activeNavigation.evaluate((button) => {
      const style = getComputedStyle(button)
      return { color: style.color, fontWeight: style.fontWeight, backgroundImage: style.backgroundImage }
    })
    assert.equal(activeNavigationStyle.fontWeight, '500')
    assert.match(activeNavigationStyle.backgroundImage, /linear-gradient/)

    const filterStyle = await page.locator('.youtube-filter-tabs button[data-active="true"]').evaluate((button) => {
      const style = getComputedStyle(button)
      return { fontWeight: style.fontWeight, backgroundImage: style.backgroundImage }
    })
    assert.equal(filterStyle.fontWeight, '500')
    assert.match(filterStyle.backgroundImage, /linear-gradient/)

    const iconStyle = await firstLibraryRow.getByRole('button', { name: '更多操作' }).evaluate((button) => {
      const style = getComputedStyle(button)
      return { borderRadius: style.borderRadius, fontWeight: style.fontWeight }
    })
    assert.equal(iconStyle.borderRadius, '999px')
    assert.equal(iconStyle.fontWeight, '500')

    await firstLibraryRow.getByRole('button', { name: '更多操作' }).click()
    assert.match(await firstLibraryRow.innerText(), /YouTube · Library0000/)
    await firstLibraryRow.getByRole('button', { name: '查看处理详情' }).click()
    const qualityDialog = page.getByRole('dialog', { name: '质量报告' })
    await qualityDialog.waitFor({ state: 'visible' })
    const qualityLayer = await page.locator('.youtube-quality-backdrop').evaluate((backdrop) => Number(getComputedStyle(backdrop).zIndex))
    const materialLayer = await page.locator('.youtube-workflow-backdrop').evaluate((backdrop) => Number(getComputedStyle(backdrop).zIndex))
    assert.ok(qualityLayer > materialLayer, `quality layer ${qualityLayer} should be above material layer ${materialLayer}`)
    const qualityBox = await qualityDialog.boundingBox()
    const topElementIsDialog = await page.evaluate(({ x, y }) => {
      const top = document.elementFromPoint(x, y)
      return Boolean(top && top.closest('[aria-labelledby="youtube-quality-dialog-title"]'))
    }, { x: qualityBox.x + qualityBox.width / 2, y: qualityBox.y + qualityBox.height / 2 })
    assert.equal(topElementIsDialog, true, 'quality dialog should receive pointer events above the material panel')
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
    await page.locator('.youtube-workflow-queue-job[data-status="failed"] .danger').click()
    await page.waitForSelector('.youtube-workflow-queue-job[data-status="failed"]', { state: 'hidden' })
    assert.equal(await page.locator('.youtube-workflow-queue-job[data-status="failed"]').count(), 0)

    await page.getByRole('button', { name: /添加素材/ }).click()
    const addText = await page.locator('.youtube-workflow-content').innerText()
    assert.match(addText, /视频链接/)
    assert.doesNotMatch(addText, /导入旧素材目录|视频优先|系统凭据/)
    await page.locator('textarea[name="youtube-material-link"]').fill('https://www.youtube.com/watch?v=vJl7LfO1r7Y&t=6s')
    await page.locator('textarea[name="youtube-material-link"]').press('Tab')
    await page.waitForSelector('.youtube-link-card')
    await page.locator('.youtube-add-material-form button[type="submit"]').click()
    await page.waitForSelector('.youtube-workflow-queue-job')
    assert.equal(await page.locator('[data-workflow-mutation-notice]').count(), 0, 'deleting failures must advance the local revision before creating again')
    assert.match(await page.locator('.youtube-workflow-queue').innerText(), /Created after delete/)

    await page.locator('.youtube-workflow-nav button[data-view="settings"]').click()
    const compactSettingsText = await page.locator('.youtube-workflow-content').innerText()
    assert.match(compactSettingsText, /Gemini API Key/)
    assert.doesNotMatch(compactSettingsText, /管理素材处理使用的 Gemini API Key/)
    assert.doesNotMatch(compactSettingsText, /^模型$/m)
    const advancedToggle = page.getByRole('button', { name: /高级设置/ })
    assert.equal((await advancedToggle.innerText()).trim(), '高级设置')
    const advancedToggleBox = await advancedToggle.boundingBox()
    assert.ok(advancedToggleBox.width >= 156 && advancedToggleBox.height >= 42)
    await advancedToggle.click()
    assert.match(await page.locator('.youtube-advanced-settings').innerText(), /^模型$/m)

    await page.setViewportSize({ width: 640, height: 760 })
    const mobileBox = await panel.boundingBox()
    assert.equal(Math.round(mobileBox.width), 640)
    assert.equal(await page.locator('.youtube-workflow-nav button').count(), 3)

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
      const closeStyle = await noticeClose.evaluate((button) => {
        const style = getComputedStyle(button)
        return {
          backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          boxShadow: style.boxShadow,
        }
      })
      assert.equal(cssAlpha(closeStyle.backgroundColor), 0, `${theme} notice close should be transparent by default`)
      await noticeClose.focus()
      const focusStyle = await noticeClose.evaluate((button) => getComputedStyle(button).boxShadow)
      assert.match(focusStyle, /0px 0px 0px 3px/, `${theme} notice close should retain a visible focus ring`)
      await noticeClose.hover()
      const hoverStyle = await noticeClose.evaluate((button) => getComputedStyle(button).backgroundImage)
      assert.match(hoverStyle, /linear-gradient/, `${theme} notice close should retain its hover treatment`)
    }
    await page.evaluate(() => document.documentElement.removeAttribute('data-theme'))
    await page.locator('.youtube-material-entry').click()
    await panel.waitFor({ state: 'visible' })
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
