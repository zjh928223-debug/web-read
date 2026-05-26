const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [], pageErrs = [];
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text().substring(0, 200)); });
  p.on('pageerror', e => pageErrs.push(e.message.substring(0, 200)));

  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 30000 });
  await p.waitForTimeout(2000);

  // 1. Core checks
  var r = await p.evaluate(function () {
    return {
      flag: window.__USE_VUE_RENDERING === true,
      stateExists: !!window.__state,
      globals: typeof window.handleBackwardClick === 'function' && typeof window.openChunkStyleModal === 'function',
      modules: ['__glassEffects','__finalCore','__importModule','__notesModule','__styleEditor','__appHandlers','__chunkNoteLayout']
        .every(function (n) { return typeof window[n] === 'object'; }),
      stores: !!window.__themeStore && !!window.__audioStore && !!window.__uiStore,
      pinia: !!window.__piniaStores,
      themeIcon: document.getElementById('theme-toggle')?.textContent,
      oldHidden: document.getElementById('transcript-container')?.style.display === 'none',
      transcriptVue: !!document.getElementById('transcript-vue-container'),
    };
  });

  console.log('Flag:', r.flag ? 'OK' : 'FAIL');
  console.log('State:', r.stateExists ? 'OK' : 'FAIL');
  console.log('Globals:', r.globals ? 'OK' : 'FAIL');
  console.log('Modules (7/7):', r.modules ? 'OK' : 'FAIL');
  console.log('Stores:', r.stores ? 'OK' : 'FAIL');
  console.log('Theme:', r.themeIcon ? 'OK (' + r.themeIcon + ')' : 'FAIL');
  console.log('Old hidden:', r.oldHidden ? 'OK' : 'FAIL');
  console.log('Vue container:', r.transcriptVue ? 'OK' : 'FAIL');

  // 2. Transcript load
  var t = { segments: [
    { start: 0, end: 2, words: [{ word: 'Extraction', start: 0, end: 1 }, { word: 'Complete', start: 1, end: 2 }] },
    { start: 2, end: 4, words: [{ word: 'All', start: 2, end: 3 }, { word: 'Modules', start: 3, end: 4 }], translation: '全模块完成' }
  ]};
  var fi = await p.$('#transcript-file');
  await fi.setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(t)) });
  await p.waitForTimeout(1500);

  var r2 = await p.evaluate(function () {
    return {
      stateWords: window.__state.words.length,
      vueWords: document.getElementById('transcript-vue-container')?.querySelectorAll('[data-word-index]').length || 0,
      word0: document.getElementById('word-0')?.textContent,
      word3: document.getElementById('word-3')?.textContent,
      translation: document.getElementById('note-1')?.textContent,
    };
  });
  console.log('State words:', r2.stateWords === 4 ? 'OK' : 'FAIL (' + r2.stateWords + ')');
  console.log('Vue words:', r2.vueWords === 4 ? 'OK' : 'FAIL (' + r2.vueWords + ')');
  console.log('word-0:', r2.word0 === 'Extraction' ? 'OK' : 'FAIL');
  console.log('word-3:', r2.word3 === 'Modules' ? 'OK ("Modules")' : 'FAIL ("' + r2.word3 + '")');
  console.log('Translation:', r2.translation === '全模块完成' ? 'OK' : 'FAIL');

  // 3. Theme, Toast, Cloze
  await p.evaluate(function () { window.__themeStore.applyMode('dark'); });
  await p.waitForTimeout(200);
  var dark = await p.evaluate(function () { return document.documentElement.getAttribute('data-theme'); });
  console.log('Theme:', dark === 'dark' ? 'OK' : 'FAIL');
  await p.evaluate(function () { window.__themeStore.applyMode('light'); });

  await p.evaluate(function () { window.__uiStore.showToast('FinalOK', 'success'); });
  await p.waitForTimeout(600);
  var toast = await p.evaluate(function () { var e = document.getElementById('app-toast'); return e ? e.textContent : 'no'; });
  console.log('Toast:', toast === 'FinalOK' ? 'OK' : 'FAIL');

  await p.evaluate(function () {
    window.__piniaStores.cloze.items = [{ clozeSentence: 'Done ___ Modules', targetWord: 'All', wordType: 'noun' }];
    window.__piniaStores.cloze.answerState = [{ checked: false, correct: false, userAnswer: '' }];
    window.__piniaStores.cloze.hasData = true;
    window.__piniaStores.chunk.isChunkMode = true;
  });
  await p.waitForTimeout(500);
  var cloze = await p.evaluate(function () { return document.querySelector('.cloze-sentence')?.textContent; });
  console.log('Cloze:', cloze === 'Done ___ Modules' ? 'OK' : 'FAIL');

  console.log('\n=== ERRORS ===');
  console.log('Console:', errors.length);
  if (errors.length) errors.slice(0, 3).forEach(function (e) { console.log(' ', e.substring(0, 200)); });
  console.log('Page:', pageErrs.length);
  if (pageErrs.length) pageErrs.slice(0, 3).forEach(function (e) { console.log(' ', e.substring(0, 200)); });

  var ok = r.flag && r.stateExists && r.globals && r.modules && r.stores
    && r2.stateWords === 4 && r2.vueWords === 4 && r2.word0 === 'Extraction' && r2.translation === '全模块完成'
    && dark === 'dark' && toast === 'FinalOK' && cloze === 'Done ___ Modules'
    && errors.length === 0 && pageErrs.length === 0;

  console.log('\n' + (ok ? 'ALL MODULES EXTRACTED: VERIFIED' : 'ISSUES FOUND'));
  await b.close();
  process.exit(ok ? 0 : 1);
})();
