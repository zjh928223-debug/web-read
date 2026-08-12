const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const APP_URL = process.env.READ_WEB_URL || 'http://127.0.0.1:5173/';
const VIEWPORT = { width: 1280, height: 720 };

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: VIEWPORT });
  try {
    await page.route('**/mock-video.mp4', (route) => route.fulfill({
      status: 200,
      headers: {
        'content-type': 'video/mp4',
        'accept-ranges': 'bytes',
      },
      body: Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50])
    }));
    await page.addInitScript(() => {
      localStorage.removeItem('youtubeWorkflow.videoPreferred');
      localStorage.removeItem('youtubeWorkflow.videoPriority');
      localStorage.removeItem('youtubeWorkflowVideoWindow');
    });
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__mediaSource);
    await page.evaluate(() => {
      window.__mediaSource.loadJobMedia({
        jobId: 'video-behavior',
        title: 'Local Video Behavior',
        hasVideo: true,
        videoUrl: '/mock-video.mp4',
        videoSource: 'test'
      });
      window.__mediaSource.setVideoPreferred(true);
    });

    await page.waitForFunction(() => {
      const element = document.querySelector('.youtube-video-player');
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden';
    });
    const player = page.locator('.youtube-video-player');
    const box = await player.boundingBox();
    assert.ok(box, 'video player should render with a box');
    assert.ok(Math.abs((box.x + box.width) - (VIEWPORT.width - 24)) <= 16, `video player should default to top right, got right=${box.x + box.width}`);
    assert.ok(box.width >= 340 && box.width <= 380, `video player should default around 360px wide, got width=${box.width}`);
    const readerControlsBox = await page.locator('.transcript-header').boundingBox();
    assert.ok(readerControlsBox, 'reader controls should render for overlap regression coverage');
    assert.ok(
      box.x + box.width <= readerControlsBox.x
        || readerControlsBox.x + readerControlsBox.width <= box.x
        || box.y + box.height <= readerControlsBox.y
        || readerControlsBox.y + readerControlsBox.height <= box.y,
      `video player should not cover reader controls, player=${JSON.stringify(box)}, controls=${JSON.stringify(readerControlsBox)}`
    );

    const video = page.locator('.youtube-video-player video');
    assert.equal(await video.getAttribute('preload'), 'metadata');
    assert.equal(await video.evaluate((element) => element.controls), false, 'native controls should stay hidden during normal reading/playback');

    const titlebarBox = await page.locator('.youtube-video-titlebar').boundingBox();
    assert.ok(titlebarBox, 'video titlebar should render');
    assert.ok(titlebarBox.height <= 32, `video titlebar should be visually slim, got height=${titlebarBox.height}`);

    const handleBox = await page.locator('.youtube-video-resize-handle').boundingBox();
    const videoBox = await video.boundingBox();
    assert.ok(handleBox && videoBox, 'video resize handle should render over the video');
    assert.ok(handleBox.width <= 18 && handleBox.height <= 18, `resize handle should stay compact, got ${handleBox.width}x${handleBox.height}`);
    assert.ok(handleBox.x >= videoBox.x + videoBox.width - 28, `resize handle should sit at the video right edge, got x=${handleBox.x}`);
    assert.ok(handleBox.y >= videoBox.y + videoBox.height - 28, `resize handle should sit at the video bottom edge, got y=${handleBox.y}`);

    const dragStart = { x: videoBox.x + videoBox.width / 2, y: videoBox.y + videoBox.height / 2 };
    await page.mouse.move(dragStart.x, dragStart.y);
    await page.mouse.down();
    await page.mouse.move(dragStart.x - 72, dragStart.y + 44, { steps: 6 });
    await page.mouse.up();
    const movedBox = await player.boundingBox();
    assert.ok(movedBox.x <= box.x - 55, `dragging from video body should move the window horizontally, before=${box.x}, after=${movedBox.x}`);
    assert.ok(movedBox.y >= box.y + 30, `dragging from video body should move the window vertically, before=${box.y}, after=${movedBox.y}`);
    assert.equal(await video.evaluate((element) => element.controls), true, 'native controls should appear only after direct video pointer interaction');
    await page.waitForFunction(() => {
      const videoElement = document.querySelector('.youtube-video-player video');
      return !!videoElement && videoElement.controls === false;
    });

    const minimizeButton = page.locator('.youtube-video-actions button').first();
    assert.equal(await page.locator('.youtube-video-actions button').count(), 2, 'video titlebar should expose minimize and close actions');
    await minimizeButton.click();
    const minimized = await player.boundingBox();
    assert.ok(minimized.height <= 54, `minimized video should keep only the title bar visible, got height=${minimized.height}`);

    await page.locator('.youtube-video-actions button').nth(1).click();
    await page.waitForFunction(() => !document.querySelector('.youtube-video-player'));
    const state = await page.evaluate(() => window.__mediaSource.getState());
    assert.equal(state.videoPreferred, false);
    assert.equal(state.activeKind, 'audio');
    assert.equal(await page.locator('#audio-player.video-media-active').count(), 0, 'closing video should restore audio styling');

    console.log('video player behavior check passed');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
