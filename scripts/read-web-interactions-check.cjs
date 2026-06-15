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

  const deprecatedOptionsClosed = await page.evaluate(() => {
    function isVisible(selector) {
      const el = document.querySelector(selector);
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    }
    return {
      hasContainer: !!document.querySelector('.deprecated-options'),
      isOpen: !!(document.querySelector('.deprecated-options') && document.querySelector('.deprecated-options').open),
      importButtonVisible: isVisible('#btn-import-chunk-notes'),
      exportButtonVisible: isVisible('#btn-export-chunk-notes'),
      styleButtonVisible: isVisible('#btn-chunk-note-style')
    };
  });
  await page.click('.deprecated-options > summary');
  const deprecatedOptionsOpen = await page.evaluate(() => {
    function isVisible(selector) {
      const el = document.querySelector(selector);
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    }
    return {
      isOpen: !!(document.querySelector('.deprecated-options') && document.querySelector('.deprecated-options').open),
      importButtonVisible: isVisible('#btn-import-chunk-notes'),
      exportButtonVisible: isVisible('#btn-export-chunk-notes'),
      styleButtonVisible: isVisible('#btn-chunk-note-style')
    };
  });
  await page.click('.deprecated-options > summary');

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
  await page.click('#hotkey-notes-input');
  await page.keyboard.press('q');
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
  await page.keyboard.press('q');
  await page.waitForFunction(
    () => {
      const note = document.getElementById('note-1');
      return !!(note && note.open);
    },
    null,
    { timeout: 5000 }
  );
  const hotkeyCustomization = await page.evaluate(() => ({
    backwardInput: document.getElementById('hotkey-backward-input').value,
    notesInput: document.getElementById('hotkey-notes-input').value,
    storedBackwardKey: localStorage.getItem('st.backwardKey'),
    storedNotesKey: localStorage.getItem('st.notesKey'),
    legacyBackwardKey: localStorage.getItem('backwardKey'),
    legacyNotesKey: localStorage.getItem('notesKey'),
    audioTimeAfterCustomBackward: document.getElementById('audio-player').currentTime,
    noteOpen: !!(document.getElementById('note-1') && document.getElementById('note-1').open),
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
    const items = [{
      clozeSentence: 'One ___ line',
      targetWord: 'Second',
      wordType: 'noun',
      reasoning: 'Test explanation'
    }];
    window.__state.clozeItems = items;
    window.__state.hasClozeData = true;
    window.__state.clozeAnswerState = window.createInitialClozeAnswerState(items);
    window.bridgeToPinia();
  });
  await page.waitForSelector('#cloze-quiz-section [data-cloze-input="0"]', { timeout: 10000 });
  await page.fill('#cloze-quiz-section [data-cloze-input="0"]', 'Second');
  await page.click('#cloze-quiz-section [data-cloze-check="0"]');
  await page.waitForSelector('#cloze-quiz-section .cloze-result-ok', { timeout: 10000 });

  const clozeInteraction = await page.evaluate(() => ({
    hasSection: !!document.getElementById('cloze-quiz-section'),
    answerState: window.__piniaStores.cloze.answerState[0] || null,
    okText: document.querySelector('#cloze-quiz-section .cloze-result-ok')
      ? document.querySelector('#cloze-quiz-section .cloze-result-ok').textContent
      : ''
  }));

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

  await page.click('#word-2', { button: 'right' });
  await page.waitForFunction(
    () => {
      const menu = document.getElementById('chunk-note-ctx-menu');
      return !!(menu && getComputedStyle(menu).display !== 'none');
    },
    null,
    { timeout: 5000 }
  );
  const chunkNoteWordContextMenu = await page.evaluate(() => {
    const menu = document.getElementById('chunk-note-ctx-menu');
    const rect = menu ? menu.getBoundingClientRect() : null;
    return {
      visible: !!(menu && getComputedStyle(menu).display !== 'none'),
      text: menu ? menu.textContent.trim() : '',
      left: rect ? rect.left : null,
      top: rect ? rect.top : null
    };
  });
  await page.click('#chunk-note-ctx-add');
  await page.waitForSelector('.chunk-note-modal-input', { timeout: 5000 });
  const chunkNoteWordPopover = await page.evaluate(() => {
    const input = document.querySelector('.chunk-note-modal-input');
    return {
      visible: !!input,
      value: input ? input.value : '',
      focused: document.activeElement === input
    };
  });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.chunk-note-modal-input', { state: 'detached', timeout: 5000 });

  const chunkRootBox = await page.locator('#chunk-vue-container').boundingBox();
  await page.mouse.click(chunkRootBox.x + chunkRootBox.width - 24, chunkRootBox.y + 36, { button: 'right' });
  await page.waitForFunction(
    () => {
      const menu = document.getElementById('chunk-note-ctx-menu');
      return !!(menu && getComputedStyle(menu).display !== 'none');
    },
    null,
    { timeout: 5000 }
  );
  const chunkNoteBlankContextMenu = await page.evaluate(() => {
    const menu = document.getElementById('chunk-note-ctx-menu');
    const rect = menu ? menu.getBoundingClientRect() : null;
    return {
      visible: !!(menu && getComputedStyle(menu).display !== 'none'),
      text: menu ? menu.textContent.trim() : '',
      left: rect ? rect.left : null,
      top: rect ? rect.top : null
    };
  });
  await page.click('#chunk-note-ctx-add');
  await page.waitForSelector('.chunk-note-modal-input', { timeout: 5000 });
  const chunkNoteBlankPopover = await page.evaluate(() => {
    const input = document.querySelector('.chunk-note-modal-input');
    return {
      visible: !!input,
      value: input ? input.value : '',
      focused: document.activeElement === input
    };
  });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.chunk-note-modal-input', { state: 'detached', timeout: 5000 });

  await page.click('#word-3', { button: 'right' });
  await page.waitForFunction(
    () => {
      const menu = document.getElementById('chunk-note-ctx-menu');
      return !!(menu && getComputedStyle(menu).display !== 'none');
    },
    null,
    { timeout: 5000 }
  );
  await page.click('#chunk-note-ctx-add');
  await page.waitForSelector('.chunk-note-modal-input', { timeout: 5000 });
  await page.fill('.chunk-note-modal-input', 'visual note');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.chunk-note-tag', { timeout: 5000 });
  await page.waitForFunction(
    () => {
      const word = document.getElementById('word-3');
      const tag = document.querySelector('.chunk-note-tag');
      return !!(word && tag && word.classList.contains('annotated') && getComputedStyle(tag).display !== 'none');
    },
    null,
    { timeout: 5000 }
  );
  const chunkNoteSavedAnnotation = await page.evaluate(() => {
    const word = document.getElementById('word-3');
    const wordAfter = word ? getComputedStyle(word, '::after') : null;
    const tag = document.querySelector('.chunk-note-tag');
    const tagRect = tag ? tag.getBoundingClientRect() : null;
    const wordRect = word ? word.getBoundingClientRect() : null;
    const wordChunk = word && word.closest('.chunk-block');
    const tagRef = tag ? tag.dataset.noteId.split('::')[0] : '';
    return {
      bodyHidden: document.body.classList.contains('hide-chunk-note'),
      wordAnnotated: !!(word && word.classList.contains('annotated')),
      wordAnnotatedSingle: !!(word && word.classList.contains('annotated-single')),
      wordAfterDisplay: wordAfter ? wordAfter.display : '',
      wordAfterBorderStyle: wordAfter ? wordAfter.borderBottomStyle : '',
      tagVisible: !!(tag && getComputedStyle(tag).display !== 'none' && tagRect && tagRect.width > 0 && tagRect.height > 0),
      tagSelected: !!(tag && tag.classList.contains('selected')),
      tagText: tag ? tag.textContent.trim() : '',
      tagRef,
      tagRect: tagRect ? { left: tagRect.left, top: tagRect.top, right: tagRect.right, bottom: tagRect.bottom } : null,
      wordRect: wordRect ? { left: wordRect.left, top: wordRect.top, right: wordRect.right, bottom: wordRect.bottom } : null,
      wordChunkId: wordChunk ? wordChunk.id : '',
      wordChunkRef: wordChunk ? wordChunk.dataset.chunkRef || '' : '',
      wordLegacyChunkRef: wordChunk ? wordChunk.dataset.legacyChunkRef || '' : '',
      duplicatedLegacyRefCount: wordChunk ? document.querySelectorAll(`.chunk-block[data-legacy-chunk-ref="${wordChunk.dataset.legacyChunkRef}"]`).length : 0,
      noteCount: document.querySelectorAll('.chunk-note-tag').length
    };
  });
  await page.hover('.chunk-note-tag');
  await page.waitForFunction(
    () => document.querySelectorAll('.chunk-note-connector').length > 0,
    null,
    { timeout: 5000 }
  );
  const chunkNoteHoverConnector = await page.evaluate(() => {
    const connectors = Array.from(document.querySelectorAll('.chunk-note-connector'));
    const first = connectors[0] || null;
    return {
      count: connectors.length,
      opacity: first ? getComputedStyle(first).opacity : '',
      d: first ? first.getAttribute('d') : '',
      noteId: document.querySelector('.chunk-note-tag')
        ? document.querySelector('.chunk-note-tag').dataset.noteId || ''
        : ''
    };
  });
  await page.keyboard.press('Delete');
  await page.waitForSelector('.chunk-note-delete-dialog', { timeout: 5000 }).catch(() => {});
  const chunkNoteDeletePrompt = await page.evaluate(() => {
    const dialog = document.querySelector('.chunk-note-delete-dialog');
    const selectedTag = document.querySelector('.chunk-note-tag.selected');
    return {
      visible: !!(dialog && getComputedStyle(dialog).display !== 'none'),
      text: dialog ? dialog.textContent.trim() : '',
      selectedTag: !!selectedTag
    };
  });
  if (chunkNoteDeletePrompt.visible) {
    await page.click('.chunk-note-delete-dialog .chunk-note-delete-btn:not(.danger)');
  }

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
      && defaultHighlightUi.buttonText === '高亮:句'
      && defaultHighlightUi.bodySentenceClass === true
      && deprecatedOptionsClosed.hasContainer === true
      && deprecatedOptionsClosed.isOpen === false
      && deprecatedOptionsClosed.importButtonVisible === false
      && deprecatedOptionsClosed.exportButtonVisible === false
      && deprecatedOptionsClosed.styleButtonVisible === false
      && deprecatedOptionsOpen.isOpen === true
      && deprecatedOptionsOpen.importButtonVisible === true
      && deprecatedOptionsOpen.exportButtonVisible === true
      && deprecatedOptionsOpen.styleButtonVisible === true
      && normalInteraction.activeSegIdx === 1
      && normalInteraction.currentWordIndex === 2
      && normalInteraction.time >= 1.9
      && normalInteraction.wordStart === '2'
      && normalInteraction.marked === true
      && /_annotation_light\.json$/.test(exportDownload.suggestedFilename)
      && hotkeyCustomization.backwardInput === 'z'
      && hotkeyCustomization.notesInput === 'q'
      && hotkeyCustomization.storedBackwardKey === 'z'
      && hotkeyCustomization.storedNotesKey === 'q'
      && hotkeyCustomization.legacyBackwardKey === null
      && hotkeyCustomization.legacyNotesKey === null
      && hotkeyCustomization.audioTimeAfterCustomBackward <= 2.05
      && hotkeyCustomization.noteOpen === true
      && hotkeyWaitingUi.value === '按键'
      && hotkeyWaitingUi.waiting === true
      && hotkeyWaitingUi.readOnly === true
      && hotkeyWaitingUi.role === 'button'
      && hotkeyWaitingUi.ariaBusy === 'true'
      && hotkeySingleKeyCapture.backwardInput === 'a'
      && hotkeySingleKeyCapture.storedBackwardKey === 'a'
      && hotkeySingleKeyCapture.stateBackwardKey === 'a'
      && hotkeyCapsIgnored.value === '按键'
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
      && clozeInteraction.hasSection === true
      && clozeInteraction.answerState
      && clozeInteraction.answerState.checked === true
      && clozeInteraction.answerState.correct === true
      && chunkAutoEntry.stateIsChunkMode === true
      && chunkAutoEntry.piniaIsChunkMode === true
      && chunkAutoEntry.buttonActive === true
      && chunkAutoEntry.buttonText === 'AI切分(已就绪)'
      && chunkDefaults.stateMode === 'focus'
      && chunkDefaults.stateHold === true
      && chunkDefaults.stateVisible === false
      && chunkDefaults.piniaFocus === true
      && chunkDefaults.piniaHold === true
      && chunkDefaults.piniaVisible === false
      && chunkDefaults.focusButtonText === '聚焦'
      && chunkDefaults.holdButtonText === '按住'
      && chunkDefaults.rootFocusClass === true
      && chunkDefaults.activeCnHidden === true
      && chunkDefaults.highlightMode === 2
      && chunkDefaults.piniaActiveWordIdx === -1
      && chunkDefaults.wordHighlights.length === 0
      && chunkHoldDown.stateVisible === true
      && chunkHoldDown.piniaVisible === true
      && chunkHoldDown.activeCnHidden === false
      && Number(chunkHoldDown.activeCnOpacity) > 0.9
      && Number(chunkHoldDown.inactiveCnOpacity) === 0
      && chunkHoldUp.stateVisible === false
      && chunkHoldUp.piniaVisible === false
      && chunkHoldUp.activeCnHidden === true
      && chunkFocusToggledGlobal.stateMode === 'global'
      && chunkFocusToggledGlobal.piniaFocus === false
      && chunkFocusToggledGlobal.buttonText === '全局'
      && chunkFocusToggledGlobal.rootFocusClass === false
      && chunkFocusRestored.stateMode === 'focus'
      && chunkFocusRestored.piniaFocus === true
      && chunkFocusRestored.buttonText === '聚焦'
      && chunkFocusRestored.rootFocusClass === true
      && chunkNoteWordContextMenu.visible === true
      && chunkNoteWordContextMenu.text.includes('添加备注')
      && chunkNoteWordPopover.visible === true
      && chunkNoteWordPopover.focused === true
      && chunkNoteBlankContextMenu.visible === true
      && chunkNoteBlankContextMenu.text.includes('添加备注')
      && chunkNoteBlankPopover.visible === true
      && chunkNoteBlankPopover.focused === true
      && chunkNoteSavedAnnotation.bodyHidden === false
      && chunkNoteSavedAnnotation.wordAnnotated === true
      && chunkNoteSavedAnnotation.wordAnnotatedSingle === true
      && chunkNoteSavedAnnotation.wordAfterDisplay === 'block'
      && chunkNoteSavedAnnotation.wordAfterBorderStyle === 'dashed'
      && chunkNoteSavedAnnotation.tagVisible === true
      && chunkNoteSavedAnnotation.tagSelected === true
      && chunkNoteSavedAnnotation.tagText.includes('visual note')
      && chunkNoteSavedAnnotation.tagRef === chunkNoteSavedAnnotation.wordChunkRef
      && chunkNoteSavedAnnotation.wordLegacyChunkRef
      && chunkNoteSavedAnnotation.duplicatedLegacyRefCount > 1
      && Math.abs(chunkNoteSavedAnnotation.tagRect.top - chunkNoteSavedAnnotation.wordRect.top) < 120
      && chunkNoteSavedAnnotation.noteCount >= 1
      && chunkNoteHoverConnector.count >= 1
      && Number(chunkNoteHoverConnector.opacity) > 0.9
      && chunkNoteHoverConnector.d.startsWith('M')
      && chunkNoteHoverConnector.noteId
      && chunkNoteDeletePrompt.visible === true
      && chunkNoteDeletePrompt.selectedTag === true
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
    deprecatedOptionsClosed,
    deprecatedOptionsOpen,
    normalInteraction,
    exportDownload,
    hotkeyWaitingUi,
    hotkeySingleKeyCapture,
    hotkeyCustomization,
    hotkeyCapsIgnored,
    hotkeyImeNormalization,
    controlsInteraction,
    clozeInteraction,
    chunkAutoEntry,
    chunkDefaults,
    chunkHoldDown,
    chunkHoldUp,
    chunkFocusToggledGlobal,
    chunkFocusRestored,
    chunkNoteWordContextMenu,
    chunkNoteWordPopover,
    chunkNoteBlankContextMenu,
    chunkNoteBlankPopover,
    chunkNoteSavedAnnotation,
    chunkNoteHoverConnector,
    chunkNoteDeletePrompt,
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
