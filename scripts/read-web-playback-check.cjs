const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const targetUrl = process.env.READ_WEB_URL || process.env.READ26_URL || 'http://127.0.0.1:4173/';
const artifactsDir = path.join(process.cwd(), '.playwright-artifacts');
const screenshotPath = path.join(artifactsDir, 'read-web-playback.png');
const chunkScreenshotPath = path.join(artifactsDir, 'read-web-chunk-playback.png');
const reportPath = path.join(artifactsDir, 'read-web-playback-report.json');

function makeSilentWavDataUrl(seconds = 3, sampleRate = 8000) {
  const numSamples = seconds * sampleRate;
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return `data:audio/wav;base64,${buffer.toString('base64')}`;
}

async function ensureArtifactsDir() {
  await fs.promises.mkdir(artifactsDir, { recursive: true });
}

async function main() {
  await ensureArtifactsDir();

  const consoleErrors = [];
  const pageErrors = [];
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  await page.goto(targetUrl, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(
    () => typeof window.processTranscript === 'function' && window.__piniaStores,
    null,
    { timeout: 10000 }
  );

  const defaultHighlightUi = await page.evaluate(() => ({
    stateHighlightMode: window.__state.highlightMode,
    piniaHighlightMode: window.__piniaStores.transcript.highlightMode,
    buttonText: document.getElementById('highlight-mode-btn')
      ? document.getElementById('highlight-mode-btn').textContent.trim()
      : '',
    bodySentenceClass: document.body.classList.contains('highlight-sentence-mode')
  }));

  await page.evaluate((audioSrc) => {
    window.processTranscript({
      segments: [
        {
          start: 0,
          end: 2,
          words: [
            { word: 'One', start: 0, end: 1 },
            { word: 'two', start: 1, end: 2 }
          ]
        },
        {
          start: 2,
          end: 4,
          words: [
            { word: 'Second', start: 2, end: 3 },
            { word: 'line', start: 3, end: 4 }
          ]
        },
        {
          start: 4,
          end: 6,
          words: [
            { word: 'Third', start: 4, end: 5 },
            { word: 'line', start: 5, end: 6 }
          ]
        }
      ]
    });
    const audio = document.getElementById('audio-player');
    audio.src = audioSrc;
    audio.muted = true;
  }, makeSilentWavDataUrl(6));

  await page.waitForSelector('#word-1', { timeout: 10000 });
  await page.click('#highlight-mode-btn');
  await page.click('#highlight-mode-btn');
  await page.waitForFunction(
    () => window.__state.highlightMode === 1 && window.__piniaStores.transcript.highlightMode === 1,
    null,
    { timeout: 5000 }
  );
  const wordHighlightUi = await page.evaluate(() => ({
    stateHighlightMode: window.__state.highlightMode,
    piniaHighlightMode: window.__piniaStores.transcript.highlightMode,
    buttonText: document.getElementById('highlight-mode-btn')
      ? document.getElementById('highlight-mode-btn').textContent.trim()
      : '',
    bodySentenceClass: document.body.classList.contains('highlight-sentence-mode')
  }));
  const navigationResult = await page.evaluate(() => {
    const audio = document.getElementById('audio-player');
    audio.currentTime = 0.2;
    window.forceUpdateUI(audio.currentTime);
    const before = {
      time: audio.currentTime,
      activeWordIdx: window.__piniaStores.transcript.activeWordIdx
    };
    window.handleForwardClick();
    const afterForward = {
      time: audio.currentTime,
      activeWordIdx: window.__piniaStores.transcript.activeWordIdx
    };
    window.handleBackwardClick();
    const afterBackward = {
      time: audio.currentTime,
      activeWordIdx: window.__piniaStores.transcript.activeWordIdx
    };
    return { before, afterForward, afterBackward };
  });

  await page.evaluate(async () => {
    await document.getElementById('audio-player').play();
  });
  await page.waitForFunction(
    () => window.__piniaStores.transcript.activeWordIdx >= 1,
    null,
    { timeout: 5000 }
  );
  await page.waitForSelector('#word-1.word-highlight', { timeout: 10000 });

  await page.screenshot({ path: screenshotPath, fullPage: false });
  const result = await page.evaluate(() => {
    const audio = document.getElementById('audio-player');
    return {
      currentTime: audio.currentTime,
      paused: audio.paused,
      activeWordIdx: window.__piniaStores.transcript.activeWordIdx,
      currentWordIndex: window.__piniaStores.transcript.currentWordIndex,
      highlighted: Array.from(document.querySelectorAll('.word-highlight')).map((el) => el.id),
      firstLineText: document.getElementById('segment-0') ? document.getElementById('segment-0').innerText : ''
    };
  });

  await page.evaluate(() => {
    const audio = document.getElementById('audio-player');
    audio.pause();
    audio.currentTime = 0;
    window.processChunkData({
      s: [
        { id: 0, chunks: [{ en: 'One two', zh: 'one two', a: 1, b: 2 }] },
        { id: 1, chunks: [{ en: 'Second line', zh: 'second line', a: 1, b: 2 }] },
        { id: 2, chunks: [{ en: 'Third line', zh: 'third line', a: 1, b: 2 }] }
      ]
    });
    if (!window.__state.isChunkMode) {
      window.toggleChunkMode(true);
    }
    audio.currentTime = 2.5;
    window.forceUpdateUI(2.5);
  });
  await page.waitForSelector('#chunk-1.chunk-active', { timeout: 10000 });
  await page.screenshot({ path: chunkScreenshotPath, fullPage: false });

  const chunkClickResult = await page.evaluate(() => {
    const audio = document.getElementById('audio-player');
    const beforeClick = {
      time: audio.currentTime,
      activeChunkIdx: window.__piniaStores.chunk.activeChunkIdx,
      activeChunks: Array.from(document.querySelectorAll('.chunk-active')).map((el) => el.id)
    };
    document.getElementById('chunk-0').click();
    const afterClick = {
      time: audio.currentTime,
      activeChunkIdx: window.__piniaStores.chunk.activeChunkIdx,
      isChunkMode: window.__state.isChunkMode,
      piniaIsChunkMode: window.__piniaStores.chunk.isChunkMode,
      chunkCount: document.querySelectorAll('.chunk-block').length
    };
    return { beforeClick, afterClick };
  });
  await page.waitForSelector('#chunk-0.chunk-active', { timeout: 10000 });
  chunkClickResult.afterClick.activeChunks = await page.evaluate(() => (
    Array.from(document.querySelectorAll('.chunk-active')).map((el) => el.id)
  ));

  const report = {
    targetUrl,
    ok: consoleErrors.length === 0
      && pageErrors.length === 0
      && defaultHighlightUi.stateHighlightMode === 2
      && defaultHighlightUi.piniaHighlightMode === 2
      && defaultHighlightUi.buttonText === '高亮:句'
      && defaultHighlightUi.bodySentenceClass === true
      && wordHighlightUi.stateHighlightMode === 1
      && wordHighlightUi.piniaHighlightMode === 1
      && wordHighlightUi.buttonText === '高亮:词'
      && wordHighlightUi.bodySentenceClass === false
      && result.activeWordIdx >= 1
      && result.highlighted.includes('word-1')
      && navigationResult.afterForward.time >= 1.9
      && navigationResult.afterBackward.time <= 0.1
      && chunkClickResult.beforeClick.activeChunkIdx === 1
      && chunkClickResult.beforeClick.activeChunks.includes('chunk-1')
      && chunkClickResult.afterClick.isChunkMode === true
      && chunkClickResult.afterClick.piniaIsChunkMode === true
      && chunkClickResult.afterClick.chunkCount === 3
      && chunkClickResult.afterClick.time <= 0.1
      && chunkClickResult.afterClick.activeChunkIdx === 0
      && chunkClickResult.afterClick.activeChunks.includes('chunk-0'),
    consoleErrors,
    pageErrors,
    defaultHighlightUi,
    wordHighlightUi,
    result,
    navigationResult,
    chunkClickResult,
    screenshotPath,
    chunkScreenshotPath
  };

  await fs.promises.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await browser.close();

  if (!report.ok) {
    console.error(`read-web playback check failed. Report: ${reportPath}`);
    process.exitCode = 1;
    return;
  }

  console.log(`read-web playback check passed. Report: ${reportPath}`);
}

main().catch(async (error) => {
  const fallback = {
    targetUrl,
    ok: false,
    fatalError: {
      name: error.name,
      message: error.message,
      stack: error.stack || ''
    }
  };
  await ensureArtifactsDir();
  await fs.promises.writeFile(reportPath, `${JSON.stringify(fallback, null, 2)}\n`, 'utf8');
  console.error(`read-web playback check crashed. Report: ${reportPath}`);
  process.exit(1);
});
