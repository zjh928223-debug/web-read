const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const targetUrl = process.env.READ_WEB_URL || process.env.READ26_URL || 'http://127.0.0.1:4173/';
const artifactsDir = path.join(process.cwd(), '.playwright-artifacts');
const screenshotPath = path.join(artifactsDir, 'read-web-interactions.png');
const reportPath = path.join(artifactsDir, 'read-web-interactions-report.json');

function makeSilentWavDataUrl(seconds = 6, sampleRate = 8000) {
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });

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

  const annotationImportUi = await page.evaluate(() => ({
    hasLightweightButton: !!document.getElementById('btn-import-annotation-lightweight'),
    hasLightweightInput: !!document.getElementById('import-annotation-lightweight-file'),
    hasGeneratedButton: !!document.getElementById('btn-import-annotation-generated'),
    hasGeneratedInput: !!document.getElementById('import-annotation-generated-file'),
    hasPromptButton: !!document.getElementById('btn-annotation-generate'),
    hasPromptPanel: !!document.getElementById('annotation-prompt-panel'),
    hasPromptStatus: !!document.getElementById('annotation-generation-status'),
    hasPromptEntryUi: typeof window.AnnotationGenerationEntryUI !== 'undefined'
  }));

  const defaultHighlightUi = await page.evaluate(() => ({
    stateHighlightMode: window.__state.highlightMode,
    piniaHighlightMode: window.__piniaStores.transcript.highlightMode,
    buttonText: document.getElementById('highlight-mode-btn')
      ? document.getElementById('highlight-mode-btn').textContent.trim()
      : '',
    bodySentenceClass: document.body.classList.contains('highlight-sentence-mode')
  }));

  const removedFeatureUi = await page.evaluate(() => ({
    deprecatedOptions: !!document.querySelector('.deprecated-options'),
    loadChunkButton: !!document.getElementById('btn-load-chunk'),
    loadClozeButton: !!document.getElementById('btn-load-cloze'),
    hotkeyNotesInput: !!document.getElementById('hotkey-notes-input'),
    hotkeyChunkNoteInput: !!document.getElementById('hotkey-chunk-note-input'),
    importChunkNotesButton: !!document.getElementById('btn-import-chunk-notes'),
    exportChunkNotesButton: !!document.getElementById('btn-export-chunk-notes'),
    chunkNoteContextMenu: !!document.getElementById('chunk-note-ctx-menu'),
    clozeQuizSection: !!document.getElementById('cloze-quiz-section')
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
          translation: 'Second translation',
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

  await page.waitForSelector('#word-2', { timeout: 10000 });
  await page.click('#word-2');
  await page.waitForFunction(
    () => window.__piniaStores.transcript.currentWordIndex === 2,
    null,
    { timeout: 5000 }
  );

  await page.keyboard.press('m');
  await page.waitForSelector('#word-2.marked', { timeout: 5000 });

  const normalInteraction = await page.evaluate(() => {
    const audio = document.getElementById('audio-player');
    const word = document.getElementById('word-2');
    return {
      time: audio.currentTime,
      activeWordIdx: window.__piniaStores.transcript.activeWordIdx,
      activeSegIdx: window.__piniaStores.transcript.activeSegIdx,
      currentWordIndex: window.__piniaStores.transcript.currentWordIndex,
      marked: !!(word && word.classList.contains('marked')),
      wordStart: word ? word.dataset.wordStart : ''
    };
  });

  const exportDownload = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.click('#btn-export-annotation-lightweight')
  ]).then(async ([download]) => ({
    suggestedFilename: download.suggestedFilename()
  }));

  await page.click('#hotkey-backward-input');
  const hotkeyWaitingUi = await page.evaluate(() => {
    const input = document.getElementById('hotkey-backward-input');
    return {
      value: input.value,
      waiting: input.classList.contains('is-hotkey-waiting'),
      readOnly: input.readOnly,
      role: input.getAttribute('role'),
      ariaBusy: input.getAttribute('aria-busy')
    };
  });
  await page.keyboard.press('Shift+A');
  await page.waitForFunction(
    () => {
      const input = document.getElementById('hotkey-backward-input');
      return input && input.value === 'a' && !input.classList.contains('is-hotkey-waiting');
    },
    null,
    { timeout: 5000 }
  );
  const hotkeySingleKeyCapture = await page.evaluate(() => ({
    backwardInput: document.getElementById('hotkey-backward-input').value,
    storedBackwardKey: localStorage.getItem('st.backwardKey'),
    stateBackwardKey: window.__state.backwardKey
  }));
  await page.click('#hotkey-backward-input');
  await page.keyboard.press('z');
  await page.evaluate(() => {
    const audio = document.getElementById('audio-player');
    audio.currentTime = 2.2;
    window.forceUpdateUI(2.2);
    const focusTarget = document.getElementById('main-app-area') || document.body;
    if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus();
  });
  await page.keyboard.press('z');
  await page.waitForFunction(
    () => document.getElementById('audio-player').currentTime <= 2.05,
    null,
    { timeout: 5000 }
  );
  const hotkeyCustomization = await page.evaluate(() => ({
    backwardInput: document.getElementById('hotkey-backward-input').value,
    storedBackwardKey: localStorage.getItem('st.backwardKey'),
    legacyBackwardKey: localStorage.getItem('backwardKey'),
    audioTimeAfterCustomBackward: document.getElementById('audio-player').currentTime,
    activeElementId: document.activeElement ? document.activeElement.id : ''
  }));

  await page.click('#hotkey-chunk-cn-input');
  await page.keyboard.press('Shift+C');
  await page.click('#hotkey-chunk-cn-input');
  await page.keyboard.press('CapsLock');
  const hotkeyCapsIgnored = await page.evaluate(() => {
    const input = document.getElementById('hotkey-chunk-cn-input');
    return {
      value: input.value,
      waiting: input.classList.contains('is-hotkey-waiting'),
      storedChunkCnKey: localStorage.getItem('st.chunkCnKey'),
      stateChunkCnKey: window.__state.chunkCnKey
    };
  });
  await page.keyboard.press('Escape');
  const hotkeyImeNormalization = await page.evaluate(() => ({
    chunkCnInput: document.getElementById('hotkey-chunk-cn-input').value,
    storedChunkCnKey: localStorage.getItem('st.chunkCnKey'),
    stateChunkCnKey: window.__state.chunkCnKey,
    inputLang: document.getElementById('hotkey-chunk-cn-input').getAttribute('lang'),
    autocomplete: document.getElementById('hotkey-chunk-cn-input').getAttribute('autocomplete'),
    spellcheck: document.getElementById('hotkey-chunk-cn-input').getAttribute('spellcheck')
  }));

  await page.click('.speed-btn[data-speed="1.25"]');
  await page.click('#toggle-follow');
  await page.evaluate(() => {
    const audio = document.getElementById('audio-player');
    audio.currentTime = 2.2;
    window.forceUpdateUI(2.2);
  });
  await page.waitForSelector('#segment-1.sentence-active', { timeout: 5000 });
  const controlsInteraction = await page.evaluate(() => {
    const audio = document.getElementById('audio-player');
    return {
      playbackRate: audio.playbackRate,
      speed125Active: !!document.querySelector('.speed-btn[data-speed="1.25"].speed-button-active'),
      autoFollow: window.__state.autoFollow,
      followButtonOn: document.getElementById('toggle-follow').classList.contains('on'),
      highlightMode: window.__state.highlightMode,
      piniaHighlightMode: window.__piniaStores.transcript.highlightMode,
      activeSentence: document.querySelector('.sentence-active') ? document.querySelector('.sentence-active').id : ''
    };
  });
  await page.click('#highlight-mode-btn');
  await page.click('#highlight-mode-btn');
  await page.evaluate(() => window.forceUpdateUI(document.getElementById('audio-player').currentTime));
  await page.waitForFunction(
    () => window.__state.highlightMode === 1 && window.__piniaStores.transcript.highlightMode === 1,
    null,
    { timeout: 5000 }
  );

  await page.evaluate(() => {
    window.processChunkData({
      s: [
        { id: 0, chunks: [{ en: 'One two', zh: 'one two', a: 1, b: 2 }] },
        { id: 1, chunks: [
          { en: 'Second', zh: 'second', a: 1, b: 1 },
          { en: 'line', zh: 'line', a: 2, b: 2 }
        ] },
        { id: 2, chunks: [{ en: 'Third line', zh: 'third line', a: 1, b: 2 }] }
      ]
    });
    if (window.__state.highlightMode !== 2) {
      window.cycleHighlightMode();
    }
  });
  await page.waitForSelector('#chunk-1', { timeout: 10000 });
  const chunkAutoEntry = await page.evaluate(() => ({
    stateIsChunkMode: window.__state.isChunkMode,
    piniaIsChunkMode: window.__piniaStores.chunk.isChunkMode,
    buttonActive: document.getElementById('toggle-chunk-btn').classList.contains('active'),
    buttonText: document.getElementById('toggle-chunk-btn').textContent.trim()
  }));
  await page.click('#chunk-1');
  await page.waitForSelector('#chunk-1.chunk-active', { timeout: 10000 });

  const chunkDefaults = await page.evaluate(() => {
    const activeCn = document.querySelector('#chunk-1 .chunk-cn');
    const inactiveCn = document.querySelector('#chunk-0 .chunk-cn');
    const activeStyle = activeCn ? getComputedStyle(activeCn) : null;
    const inactiveStyle = inactiveCn ? getComputedStyle(inactiveCn) : null;
    return {
      stateMode: window.__state.chunkCnMode,
      stateHold: window.__state.chunkCnHoldMode,
      stateVisible: window.__state.chunkCnVisible,
      piniaFocus: window.__piniaStores.chunk.chunkFocusMode,
      piniaHold: window.__piniaStores.chunk.chunkCNHoldMode,
      piniaVisible: window.__piniaStores.chunk.chunkCNVisible,
      focusButtonText: document.getElementById('btn-chunk-focus').textContent.trim(),
      holdButtonText: document.getElementById('btn-chunk-cn-hold').textContent.trim(),
      rootFocusClass: document.getElementById('chunk-vue-container').classList.contains('cn-mode-focus'),
      activeCnHidden: activeCn ? activeCn.classList.contains('hidden-cn') : null,
      activeCnOpacity: activeStyle ? activeStyle.opacity : '',
      inactiveCnOpacity: inactiveStyle ? inactiveStyle.opacity : '',
      wordHighlights: Array.from(document.querySelectorAll('.word-highlight')).map((el) => el.id),
      highlightMode: window.__state.highlightMode,
      piniaActiveWordIdx: window.__piniaStores.transcript.activeWordIdx
    };
  });
  await page.keyboard.down('c');
  await page.waitForFunction(
    () => {
      const activeCn = document.querySelector('#chunk-1 .chunk-cn');
      return !!(activeCn && !activeCn.classList.contains('hidden-cn') && Number(getComputedStyle(activeCn).opacity) > 0.9);
    },
    null,
    { timeout: 5000 }
  );
  const chunkHoldDown = await page.evaluate(() => {
    const activeCn = document.querySelector('#chunk-1 .chunk-cn');
    const inactiveCn = document.querySelector('#chunk-0 .chunk-cn');
    return {
      stateVisible: window.__state.chunkCnVisible,
      piniaVisible: window.__piniaStores.chunk.chunkCNVisible,
      activeCnHidden: activeCn ? activeCn.classList.contains('hidden-cn') : null,
      activeCnOpacity: activeCn ? getComputedStyle(activeCn).opacity : '',
      inactiveCnOpacity: inactiveCn ? getComputedStyle(inactiveCn).opacity : ''
    };
  });
  await page.keyboard.up('c');
  await page.waitForFunction(
    () => {
      const activeCn = document.querySelector('#chunk-1 .chunk-cn');
      return !!(activeCn && activeCn.classList.contains('hidden-cn'));
    },
    null,
    { timeout: 5000 }
  );
  const chunkHoldUp = await page.evaluate(() => {
    const activeCn = document.querySelector('#chunk-1 .chunk-cn');
    return {
      stateVisible: window.__state.chunkCnVisible,
      piniaVisible: window.__piniaStores.chunk.chunkCNVisible,
      activeCnHidden: activeCn ? activeCn.classList.contains('hidden-cn') : null
    };
  });
  await page.click('#btn-chunk-focus');
  const chunkFocusToggledGlobal = await page.evaluate(() => ({
    stateMode: window.__state.chunkCnMode,
    piniaFocus: window.__piniaStores.chunk.chunkFocusMode,
    buttonText: document.getElementById('btn-chunk-focus').textContent.trim(),
    rootFocusClass: document.getElementById('chunk-vue-container').classList.contains('cn-mode-focus')
  }));
  await page.click('#btn-chunk-focus');
  const chunkFocusRestored = await page.evaluate(() => ({
    stateMode: window.__state.chunkCnMode,
    piniaFocus: window.__piniaStores.chunk.chunkFocusMode,
    buttonText: document.getElementById('btn-chunk-focus').textContent.trim(),
    rootFocusClass: document.getElementById('chunk-vue-container').classList.contains('cn-mode-focus')
  }));

  await page.evaluate(() => {
    window.__state.markedMap.set(2, { globalIndex: 2, word: 'Second', sourceType: 'test' });
    window.__state.vocabMatchMap.set(2, {
      data: {
        word: 'Second',
        boundary: 'Second line',
        type: 'word',
        meaning: 'second meaning',
        memoryHint: 'remember second'
      }
    });
    const span = document.getElementById('word-2');
    window.notifyAnnotationBubbleWordClick(span, { forceShow: true });
  });
  await page.waitForSelector('#annotation-bubble:not([hidden])', { timeout: 5000 });
  const annotationBubbleContext = await page.evaluate(() => {
    const bubble = document.getElementById('annotation-bubble');
    return {
      visible: !!(bubble && !bubble.hidden && bubble.classList.contains('is-visible')),
      text: bubble ? bubble.textContent : ''
    };
  });

  const chunkInteraction = await page.evaluate(() => {
    const audio = document.getElementById('audio-player');
    return {
      time: audio.currentTime,
      activeChunkIdx: window.__piniaStores.chunk.activeChunkIdx,
      activeChunks: Array.from(document.querySelectorAll('.chunk-active')).map((el) => el.id),
      notePreviewOpen: document.body.classList.contains('note-preview-open'),
      duplicateNoteSidebars: document.querySelectorAll('#note-preview-sidebar').length
    };
  });

  await page.evaluate((audioSrc) => {
    if (window.__state.isChunkMode && typeof window.toggleChunkMode === 'function') {
      window.toggleChunkMode(false);
    }
    const segments = Array.from({ length: 28 }, (_, index) => ({
      start: index * 2,
      end: index * 2 + 1.6,
      words: [
        { word: `Follow line ${index}`, start: index * 2, end: index * 2 + 1.6 }
      ]
    }));
    window.processTranscript({ segments });
    const audio = document.getElementById('audio-player');
    audio.src = audioSrc;
    audio.muted = true;
    audio.currentTime = 34.1;
    window.__state.autoFollow = true;
    window.__state.userScrollSuppress = false;
    window.__state.highlightMode = 2;
    if (typeof window.bridgeToPinia === 'function') window.bridgeToPinia();
    const container = document.getElementById('main-app-area');
    if (container) container.scrollTop = 0;
    window.forceUpdateUI(34.1);
  }, makeSilentWavDataUrl(80));
  await page.waitForSelector('#segment-17.sentence-active', { timeout: 10000 });
  await page.evaluate(() => {
    const container = document.getElementById('main-app-area');
    if (container) container.scrollTop = 0;
    window.__state.userScrollSuppress = false;
    window.__state.lastActiveSegIndex = -1;
    window.forceUpdateUI(34.1);
  });
  const followPagingDesktop = await page.evaluate(() => {
    const container = document.getElementById('main-app-area');
    const active = document.querySelector('.sentence-active');
    const containerRect = container.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const activeCenter = ((activeRect.top + activeRect.bottom) / 2) - containerRect.top;
    return {
      activeId: active ? active.id : '',
      scrollTop: container.scrollTop,
      containerHeight: containerRect.height,
      activeTopDelta: activeRect.top - containerRect.top,
      activeTopRatio: (activeRect.top - containerRect.top) / containerRect.height,
      activeCenterRatio: activeCenter / containerRect.height
    };
  });

  await page.setViewportSize({ width: 1280, height: 520 });
  await page.evaluate(() => {
    const audio = document.getElementById('audio-player');
    const container = document.getElementById('main-app-area');
    if (container) container.scrollTop = 0;
    window.__state.autoFollow = true;
    window.__state.userScrollSuppress = false;
    window.__state.lastActiveSegIndex = -1;
    audio.currentTime = 36.1;
    window.forceUpdateUI(36.1);
  });
  await page.waitForSelector('#segment-18.sentence-active', { timeout: 10000 });
  const followPagingShort = await page.evaluate(() => {
    const container = document.getElementById('main-app-area');
    const active = document.querySelector('.sentence-active');
    const containerRect = container.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const activeCenter = ((activeRect.top + activeRect.bottom) / 2) - containerRect.top;
    return {
      activeId: active ? active.id : '',
      scrollTop: container.scrollTop,
      containerHeight: containerRect.height,
      activeTopDelta: activeRect.top - containerRect.top,
      activeTopRatio: (activeRect.top - containerRect.top) / containerRect.height,
      activeCenterRatio: activeCenter / containerRect.height
    };
  });
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.screenshot({ path: screenshotPath, fullPage: false });

  const report = {
    targetUrl,
    ok: consoleErrors.length === 0
      && pageErrors.length === 0
      && annotationImportUi.hasLightweightButton === true
      && annotationImportUi.hasLightweightInput === true
      && annotationImportUi.hasGeneratedButton === false
      && annotationImportUi.hasGeneratedInput === false
      && annotationImportUi.hasPromptButton === false
      && annotationImportUi.hasPromptPanel === false
      && annotationImportUi.hasPromptStatus === false
      && annotationImportUi.hasPromptEntryUi === false
      && defaultHighlightUi.stateHighlightMode === 2
      && defaultHighlightUi.piniaHighlightMode === 2
      && defaultHighlightUi.bodySentenceClass === true
      && removedFeatureUi.deprecatedOptions === false
      && removedFeatureUi.loadChunkButton === false
      && removedFeatureUi.loadClozeButton === false
      && removedFeatureUi.hotkeyNotesInput === false
      && removedFeatureUi.hotkeyChunkNoteInput === false
      && removedFeatureUi.importChunkNotesButton === false
      && removedFeatureUi.exportChunkNotesButton === false
      && removedFeatureUi.chunkNoteContextMenu === false
      && removedFeatureUi.clozeQuizSection === false
      && normalInteraction.activeSegIdx === 1
      && normalInteraction.currentWordIndex === 2
      && normalInteraction.time >= 1.9
      && normalInteraction.wordStart === '2'
      && normalInteraction.marked === true
      && /_annotation_light\.json$/.test(exportDownload.suggestedFilename)
      && hotkeyCustomization.backwardInput === 'z'
      && hotkeyCustomization.storedBackwardKey === 'z'
      && hotkeyCustomization.legacyBackwardKey === null
      && hotkeyCustomization.audioTimeAfterCustomBackward <= 2.05
      && hotkeyWaitingUi.waiting === true
      && hotkeyWaitingUi.readOnly === true
      && hotkeyWaitingUi.role === 'button'
      && hotkeyWaitingUi.ariaBusy === 'true'
      && hotkeySingleKeyCapture.backwardInput === 'a'
      && hotkeySingleKeyCapture.storedBackwardKey === 'a'
      && hotkeySingleKeyCapture.stateBackwardKey === 'a'
      && hotkeyCapsIgnored.waiting === true
      && hotkeyCapsIgnored.storedChunkCnKey === 'c'
      && hotkeyCapsIgnored.stateChunkCnKey === 'c'
      && hotkeyImeNormalization.chunkCnInput === 'c'
      && hotkeyImeNormalization.storedChunkCnKey === 'c'
      && hotkeyImeNormalization.stateChunkCnKey === 'c'
      && hotkeyImeNormalization.inputLang === 'en'
      && hotkeyImeNormalization.autocomplete === 'off'
      && hotkeyImeNormalization.spellcheck === 'false'
      && controlsInteraction.playbackRate === 1.25
      && controlsInteraction.speed125Active === true
      && controlsInteraction.autoFollow === false
      && controlsInteraction.followButtonOn === false
      && controlsInteraction.highlightMode === 2
      && controlsInteraction.piniaHighlightMode === 2
      && controlsInteraction.activeSentence === 'segment-1'
      && chunkAutoEntry.stateIsChunkMode === true
      && chunkAutoEntry.piniaIsChunkMode === true
      && chunkAutoEntry.buttonActive === true
      && chunkDefaults.stateMode === 'focus'
      && chunkDefaults.stateHold === true
      && chunkDefaults.stateVisible === false
      && chunkDefaults.piniaFocus === true
      && chunkDefaults.piniaHold === true
      && chunkDefaults.piniaVisible === false
      && chunkDefaults.rootFocusClass === true
      && chunkDefaults.activeCnHidden === true
      && chunkDefaults.highlightMode === 2
      && chunkDefaults.piniaActiveWordIdx === -1
      && chunkDefaults.wordHighlights.length === 0
      && chunkHoldDown.stateVisible === true
      && chunkHoldDown.piniaVisible === true
      && chunkHoldDown.activeCnHidden === false
      && Number(chunkHoldDown.activeCnOpacity) > 0.9
      && chunkHoldUp.stateVisible === false
      && chunkHoldUp.piniaVisible === false
      && chunkHoldUp.activeCnHidden === true
      && chunkFocusToggledGlobal.stateMode === 'global'
      && chunkFocusToggledGlobal.piniaFocus === false
      && chunkFocusToggledGlobal.rootFocusClass === false
      && chunkFocusRestored.stateMode === 'focus'
      && chunkFocusRestored.piniaFocus === true
      && chunkFocusRestored.rootFocusClass === true
      && annotationBubbleContext.visible === true
      && annotationBubbleContext.text.includes('second meaning')
      && chunkInteraction.activeChunkIdx === 1
      && chunkInteraction.activeChunks.includes('chunk-1')
      && chunkInteraction.time >= 1.9
      && chunkInteraction.notePreviewOpen === false
      && chunkInteraction.duplicateNoteSidebars === 0
      && followPagingDesktop.activeId === 'segment-17'
      && followPagingDesktop.scrollTop > 0
      && followPagingDesktop.activeTopRatio >= 0
      && followPagingDesktop.activeTopRatio < 0.22
      && followPagingDesktop.activeCenterRatio < 0.35
      && followPagingShort.activeId === 'segment-18'
      && followPagingShort.scrollTop > 0
      && followPagingShort.activeTopRatio >= 0
      && followPagingShort.activeTopRatio < 0.24
      && followPagingShort.activeCenterRatio < 0.38,
    consoleErrors,
    pageErrors,
    annotationImportUi,
    defaultHighlightUi,
    removedFeatureUi,
    normalInteraction,
    exportDownload,
    hotkeyWaitingUi,
    hotkeySingleKeyCapture,
    hotkeyCustomization,
    hotkeyCapsIgnored,
    hotkeyImeNormalization,
    controlsInteraction,
    chunkAutoEntry,
    chunkDefaults,
    chunkHoldDown,
    chunkHoldUp,
    chunkFocusToggledGlobal,
    chunkFocusRestored,
    annotationBubbleContext,
    chunkInteraction,
    followPagingDesktop,
    followPagingShort,
    screenshotPath
  };

  await fs.promises.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await browser.close();

  if (!report.ok) {
    console.error(`read-web interaction check failed. Report: ${reportPath}`);
    process.exitCode = 1;
    return;
  }

  console.log(`read-web interaction check passed. Report: ${reportPath}`);
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
  console.error(`read-web interaction check crashed. Report: ${reportPath}`);
  process.exit(1);
});
