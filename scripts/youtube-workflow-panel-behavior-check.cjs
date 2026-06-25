const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const APP_URL = process.env.READ_WEB_URL || 'http://127.0.0.1:5173/';
const VIEWPORT = { width: 1280, height: 720 };

const jobs = new Map();
let jobCounter = 0;
const recentJob = {
  jobId: 'recent-ready',
  title: 'Recent Ready Material',
  url: 'https://www.youtube.com/watch?v=recent123',
  readStatus: 'in-progress',
  lastActivityAt: new Date('2026-06-23T10:20:00Z').toISOString(),
  overallCoverageRatio: 0.42,
  lastPositionSeconds: 120,
  durationSeconds: 300,
  markCount: 2
};

function json(body) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body)
  };
}

async function mockWorkflowService(page) {
  await page.route('http://127.0.0.1:8765/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/health') return route.fulfill(json({ ok: true }));
    if (url.pathname === '/api/reader/recent') return route.fulfill(json([recentJob]));
    if (url.pathname === '/api/reader/activity') return route.fulfill(json(recentJob));
    if (url.pathname === '/api/jobs' && request.method() === 'POST') {
      const payload = JSON.parse(request.postData() || '{}');
      const jobId = `job-${++jobCounter}`;
      const job = {
        jobId,
        status: 'downloading',
        stage: 'downloading',
        request: { url: payload.url || '' },
        title: payload.url || jobId,
        logSummary: ['任务已入队。', '开始下载 YouTube 音频。'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      jobs.set(jobId, job);
      return route.fulfill(json(job));
    }

    const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (jobMatch) {
      const jobId = decodeURIComponent(jobMatch[1]);
      return route.fulfill(json(jobs.get(jobId) || { jobId, status: 'queued', request: { url: '' } }));
    }

    return route.fulfill(json({ ok: true }));
  });
}

async function dragLocator(page, locator, targetX, targetY) {
  const box = await locator.boundingBox();
  assert.ok(box, 'drag target should have a rendered box');
  let preferredX = box.x + box.width / 2;
  if (box.x < 0) preferredX = box.x + box.width - 12;
  if (box.x + box.width > VIEWPORT.width) preferredX = box.x + 12;
  const startX = Math.max(4, Math.min(VIEWPORT.width - 4, preferredX));
  const startY = Math.max(4, Math.min(VIEWPORT.height - 4, box.y + box.height / 2));
  if (process.env.DEBUG_WORKFLOW_BEHAVIOR) {
    const target = await locator.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        position: style.position,
        left: style.left,
        top: style.top,
        width: style.width,
        height: style.height,
        transform: style.transform,
        edge: element.dataset.edge
      };
    });
    const hit = await page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return element ? { tag: element.tagName, className: String(element.className || ''), text: element.textContent } : null;
    }, { x: startX, y: startY });
    console.log('drag hit', { startX, startY, box, target, inner: await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })), hit });
  }
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 10 });
  await page.mouse.up();
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: VIEWPORT });

  try {
    await page.addInitScript(() => {
      localStorage.removeItem('youtubeWorkflowCapsulePosition');
      localStorage.removeItem('youtubeWorkflow.model');
      localStorage.removeItem('youtubeWorkflow.baseUrl');
    });
    await mockWorkflowService(page);

    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.youtube-reader-controls .small-btn');

    const openButton = page.locator('.youtube-reader-controls .small-btn').first();
    const panel = page.locator('.youtube-workflow-panel');
    await openButton.click();
    await panel.waitFor({ state: 'visible' });
    await page.waitForSelector('.youtube-workflow-recent');
    assert.match(
      await page.locator('.youtube-workflow-recent').innerText(),
      /Recent Ready Material/,
      'recent ready tasks should render in the panel'
    );

    const centered = await panel.boundingBox();
    assert.ok(Math.abs(centered.x - 300) <= 8, `panel should open centered, got x=${centered.x}`);

    await page.mouse.move(centered.x + 120, centered.y + 24);
    await page.mouse.down();
    await page.mouse.move(520, 190, { steps: 8 });
    await page.mouse.up();
    const dragged = await panel.boundingBox();
    assert.ok(dragged.x > centered.x + 80, `panel should be draggable, got x=${dragged.x}`);

    await page.locator('.youtube-window-actions button').nth(1).click();
    await panel.waitFor({ state: 'hidden' });
    await openButton.click();
    await panel.waitFor({ state: 'visible' });
    const reopened = await panel.boundingBox();
    assert.ok(Math.abs(reopened.x - 300) <= 8, `closed panel should reopen centered, got x=${reopened.x}`);

    const floatToggle = page.getByRole('checkbox', { name: '显示任务浮标' });
    await floatToggle.check();
    let capsule = page.locator('.youtube-material-float');
    await capsule.waitFor({ state: 'visible' });
    assert.match(await capsule.innerText(), /暂无任务/, 'checked empty queue should show an empty-state floating indicator immediately');
    await page.locator('.youtube-window-actions button').first().click();
    await panel.waitFor({ state: 'hidden' });
    capsule = page.locator('.youtube-material-float');
    await capsule.waitFor({ state: 'visible' });
    assert.match(await capsule.innerText(), /暂无任务/, 'checked empty queue should show an empty-state floating indicator after shrinking');

    await capsule.click();
    await panel.waitFor({ state: 'visible' });
    await page.locator('.youtube-window-actions button').nth(1).click();
    await panel.waitFor({ state: 'hidden' });
    capsule = page.locator('.youtube-material-float');
    await capsule.waitFor({ state: 'visible' });
    assert.match(await capsule.innerText(), /暂无任务/, 'checked empty queue should show an empty-state floating indicator after closing');

    await capsule.click();
    await panel.waitFor({ state: 'visible' });
    await floatToggle.uncheck();
    await page.locator('.youtube-window-actions button').nth(1).click();
    await panel.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.youtube-material-float').count(), 0, 'unchecked empty queue should not show floating indicator');

    const offscreenPage = await browser.newPage({ viewport: { width: 640, height: 360 } });
    await mockWorkflowService(offscreenPage);
    await offscreenPage.addInitScript(() => {
      localStorage.setItem('youtubeWorkflowCapsulePosition', JSON.stringify({ x: 5000, y: 5000 }));
    });
    await offscreenPage.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await offscreenPage.waitForSelector('.youtube-reader-controls .small-btn');
    await offscreenPage.locator('.youtube-reader-controls .small-btn').first().click();
    const offscreenPanel = offscreenPage.locator('.youtube-workflow-panel');
    await offscreenPanel.waitFor({ state: 'visible' });
    await offscreenPage.getByRole('checkbox', { name: '显示任务浮标' }).check();
    await offscreenPage.locator('.youtube-window-actions button').first().click();
    await offscreenPanel.waitFor({ state: 'hidden' });
    const clampedCapsule = offscreenPage.locator('.youtube-material-float');
    await clampedCapsule.waitFor({ state: 'visible' });
    const clampedBox = await clampedCapsule.boundingBox();
    assert.ok(clampedBox.x >= 0 && clampedBox.x <= 640 - 42, `offscreen saved capsule x should clamp into viewport, got ${clampedBox.x}`);
    assert.ok(clampedBox.y >= 0 && clampedBox.y <= 360 - 42, `offscreen saved capsule y should clamp into viewport, got ${clampedBox.y}`);
    await offscreenPage.close();

    await openButton.click();
    await panel.waitFor({ state: 'visible' });
    await page.locator('.youtube-workflow-form input[type="url"]').fill('https://www.youtube.com/watch?v=test123');
    await page.locator('.youtube-workflow-form input[type="url"]').press('Enter');
    await page.locator('.youtube-workflow-form input[type="password"]').fill('fake-key-for-ui-test');
    await page.locator('.youtube-workflow-form button[type="submit"]').click();
    await page.waitForSelector('.youtube-workflow-job');
    await page.waitForSelector('.youtube-workflow-job[data-active="true"] .youtube-job-log');
    assert.ok(
      await page.locator('.youtube-workflow-job[data-active="true"] .youtube-job-log li').count() >= 1,
      'active workflow job should show recent running logs'
    );

    await page.locator('.youtube-window-actions button').nth(1).click();
    await panel.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.youtube-material-float').count(), 0, 'unchecked close should not show floating indicator');

    await openButton.click();
    await panel.waitFor({ state: 'visible' });
    await floatToggle.check();
    await page.mouse.click(12, 12);
    await panel.waitFor({ state: 'hidden' });
    capsule = page.locator('.youtube-material-float');
    await capsule.waitFor({ state: 'visible' });

    await capsule.click();
    await panel.waitFor({ state: 'visible' });
    await floatToggle.uncheck();
    await page.locator('.youtube-window-actions button').first().click();
    await panel.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.youtube-material-float').count(), 0, 'unchecked shrink should not show floating indicator');

    await openButton.click();
    await panel.waitFor({ state: 'visible' });
    await floatToggle.check();
    await page.locator('.youtube-window-actions button').first().click();
    await panel.waitFor({ state: 'hidden' });
    capsule = page.locator('.youtube-material-float');
    await capsule.waitFor({ state: 'visible' });

    await dragLocator(page, capsule, 6, 320);
    await page.mouse.move(480, 80);
    await page.waitForFunction(() => {
      const element = document.querySelector('.youtube-material-float');
      return element?.dataset.edge === 'left' && !element.classList.contains('is-dragging');
    });
    let hiddenBox = await capsule.boundingBox();
    const leftVisibleRight = hiddenBox.x + hiddenBox.width;
    const leftState = await capsule.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        className: String(element.className || ''),
        style: element.getAttribute('style'),
        edge: element.dataset.edge,
        matchesHidden: element.matches('.youtube-material-float[data-edge="left"]:not(:hover):not(.is-dragging)'),
        matchesHover: element.matches(':hover'),
        matchedRules: Array.from(document.styleSheets).flatMap((sheet) => {
          try {
            return Array.from(sheet.cssRules || [])
              .filter((rule) => rule.selectorText && rule.style && rule.style.transform)
              .filter((rule) => {
                try {
                  return rule.selectorText.split(',').some((selector) => element.matches(selector.trim()));
                } catch (_err) {
                  return false;
                }
              })
              .map((rule) => ({ selector: rule.selectorText, transform: rule.style.transform }));
          } catch (_err) {
            return [];
          }
        }),
        transform: style.transform,
        position: style.position,
        left: style.left,
        top: style.top
      };
    });
    assert.ok(
      leftVisibleRight <= 60,
      `left-snapped capsule should be half hidden, right=${leftVisibleRight}, state=${JSON.stringify(leftState)}`
    );

    await dragLocator(page, capsule, VIEWPORT.width - 6, 320);
    await page.mouse.move(480, 80);
    await page.waitForTimeout(120);
    const rightEdge = await capsule.getAttribute('data-edge');
    hiddenBox = await capsule.boundingBox();
    assert.equal(
      rightEdge,
      'right',
      `capsule should mark right-edge snap state, got edge=${rightEdge}, x=${hiddenBox.x}, width=${hiddenBox.width}`
    );
    assert.ok(hiddenBox.x >= VIEWPORT.width - 60, `right-snapped capsule should be half hidden, left=${hiddenBox.x}`);

    const beforeScroll = await capsule.boundingBox();
    await page.evaluate(() => {
      document.scrollingElement.scrollTop = 400;
      for (const selector of ['#main-app-area', '.container', '#transcript-container']) {
        const element = document.querySelector(selector);
        if (element) element.scrollTop = 400;
      }
    });
    await page.waitForTimeout(80);
    const afterScroll = await capsule.boundingBox();
    assert.ok(
      Math.abs(beforeScroll.y - afterScroll.y) <= 1,
      `fixed capsule should keep viewport y after scroll, before=${beforeScroll.y}, after=${afterScroll.y}`
    );

    console.log('youtube workflow panel behavior check passed');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
