const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

// Isolated real dialog + in-memory vocabulary writes; never touches the live owner.
const root = path.resolve(__dirname, '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'read-web-settlement-meaning-'));
const entry = `
import '/styles.css';
import '/src/features/learning-ui/learning-ui.css';
import '/src/styles/workflow-ui.css';
import { createSettlementDialog } from '/src/features/vocabulary-preview/create-article-settlement-dialog.js';
import { applyArticleSrsSettlement, createInMemoryVocabularyRepository, createVocabularyService, createSrsScheduler } from '/src/services/vocabulary/index.js';
let service, candidates, applies = 0;
function newService() {
  return createVocabularyService({ repository: createInMemoryVocabularyRepository(), scheduler: createSrsScheduler({ enable_fuzz: false }) });
}
function fixtures() {
  return [['word', 'effort', '努力'], ['phrase', 'in front of', '在前面']].map(([type, lemma, simple]) => ({
    targetId: type, word: lemma, lemma, markedText: lemma, entry_type: type, eligible: true, group: 'ready',
    meaning: '这是只用于说明文章语境的原始长解释。'.repeat(type === 'word' ? 30 : 1), simple_meaning: type === 'word' ? simple : '',
    refinement_attempted: true, refinement_status: type === 'word' ? 'completed' : 'failed',
    context: { source_id: 'meaning-check', source_type: 'manual_annotation', sentence: lemma + ' appears here.', meaning: '原始语境解释。', simple_meaning: type === 'word' ? simple : '' }
  }));
}
const dialog = createSettlementDialog({ documentObject: document, windowObject: window,
  pronunciationService: { stop() {}, async prefetch() {} },
  async onRefineMeanings({ automatic }) {
    if (automatic) return { requested: 0 };
    candidates.forEach(c => { c.simple_meaning = c.entry_type === 'word' ? '努力' : '在前面'; c.context.simple_meaning = c.simple_meaning; c.refinement_status = 'completed'; c.refinement_save_pending = false; });
    return { requested: 2, updated: 2 };
  },
  async onToggleRemove() {},
  async onApply(info) { applies++; return applyArticleSrsSettlement({ ...info, vocabularyService: service }); }
});
window.meaningCheck = {
  open() { dialog.close(); service = newService(); candidates = fixtures(); applies = 0; dialog.open({ articleId: 'meaning-check', candidates, summary: {} }); },
  applies: () => applies,
  async saved() { return [...(await service.getWordsAndContextsByLemmas(['effort', 'in front of'])).values()].filter(v => v.word).map(v => ({ lemma: v.word.lemma, simple: v.contexts[0]?.simple_meaning, original: v.contexts[0]?.meaning })); },
  async serviceCases() {
    const results = [];
    for (const variant of ['missing', 'failed', 'pending', 'unsaved', 'too-long']) {
      const c = fixtures()[0];
      if (variant === 'missing') { c.simple_meaning = ''; c.context.simple_meaning = ''; c.refinement_status = ''; }
      if (variant === 'failed' || variant === 'pending') c.refinement_status = variant;
      if (variant === 'unsaved') c.refinement_save_pending = true;
      if (variant === 'too-long') c.simple_meaning = c.context.simple_meaning = '这是一条超出单词精简释义长度上限的解释';
      const s = newService(); let error = null;
      try { await applyArticleSrsSettlement({ vocabularyService: s, candidates: [c], mode: 'all' }); }
      catch (e) { error = { code: e.code, message: e.message }; }
      results.push({ variant, error, saved: !!await s.getWordByLemma(c.lemma) });
    }
    const mixed = fixtures(); const s = newService(); let error = null;
    try { await applyArticleSrsSettlement({ vocabularyService: s, candidates: mixed, mode: 'all' }); }
    catch (e) { error = e.code; }
    results.push({ variant: 'mixed-atomic', error, saved: !!await s.getWordByLemma('effort') });
    const topOnly = fixtures()[0]; delete topOnly.context.simple_meaning;
    const topService = newService(); await applyArticleSrsSettlement({ vocabularyService: topService, candidates: [topOnly] });
    const top = (await topService.getWordsAndContextsByLemmas(['effort'])).get('effort');
    results.push({ variant: 'top-level-meaning', simple: top.contexts[0]?.simple_meaning });
    return results;
  }
};
`;

(async () => {
  let server, browser;
  try {
    const { createServer } = await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')));
    const plugin = {
      name: 'settlement-meaning-check',
      resolveId(id) { if (id === '/__meaning-entry.js') return '\0meaning-entry'; },
      load(id) { if (id === '\0meaning-entry') return entry; },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (req.url !== '/__meaning.html') return next();
          res.setHeader('Content-Type', 'text/html');
          res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html><head><title>Settlement meaning check</title></head><body><script type="module" src="/__meaning-entry.js"></script></body></html>'));
        });
      },
    };
    server = await createServer({ root, cacheDir: path.join(out, 'vite-cache'), configFile: path.join(root, 'vite.config.mjs'), plugins: [plugin], server: { host: '127.0.0.1', port: 4591, strictPort: true } });
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.route('**/api/**', route => route.abort('blockedbyclient'));
    await page.goto('http://127.0.0.1:4591/__meaning.html');
    await page.waitForFunction(() => window.meaningCheck);
    assert.equal(await page.title(), 'Settlement meaning check');
    const cases = await page.evaluate(() => meaningCheck.serviceCases());
    for (const result of cases.slice(0, 6)) {
      assert.ok(result.error, `${result.variant}: unfinished refinement must be rejected`);
      assert.equal(result.saved, false, `${result.variant}: no vocabulary write is allowed`);
    }
    assert.equal(cases[6].simple, '努力', 'top-level refined meaning must reach the saved context');
    await page.evaluate(() => meaningCheck.open());
    const dialog = page.locator('.vocabulary-preview-dialog--settlement');
    const checkLayout = async () => {
      const rows = dialog.locator('.vocabulary-preview-dialog__item');
      for (const row of await rows.all()) {
        assert.equal(await row.locator('[data-meaning-region="original"]').count(), 0, 'original meaning controls are removed');
        assert.equal(await row.locator('[data-meaning-region="simple"]').isVisible(), true);
        const main = row.locator('.vocabulary-preview-dialog__item-main');
        await main.focus();
        const before = await row.locator('.vocabulary-preview-dialog__speaker').boundingBox();
        await main.click();
        assert.equal(await row.locator('[data-meaning-region="original"]').count(), 0);
        const after = await row.locator('.vocabulary-preview-dialog__speaker').boundingBox();
        assert.ok(Math.abs(before.x - after.x) <= 1, 'long explanations must not move pronunciation horizontally');
        assert.ok(after.x >= (await main.boundingBox()).x + (await main.boundingBox()).width, 'pronunciation remains in the right column');
        assert.equal(await row.getAttribute('data-active'), 'true');
        assert.ok(await row.locator('strong').evaluate(el => parseFloat(getComputedStyle(el).fontSize)) >= 22, 'English word is easy to read');
        const wordBox = await row.locator('.vocabulary-preview-dialog__item-line').boundingBox();
        const simpleBox = await row.locator('[data-meaning-region="simple"]').boundingBox();
        if (page.viewportSize().width > 520) assert.ok(simpleBox.x > wordBox.x + wordBox.width - 1, 'concise meaning occupies the middle column');
        assert.equal(await row.locator('.vocabulary-preview-dialog__participation').count(), 0, 'no redundant participation text');
        assert.equal(await row.locator('.vocabulary-preview-dialog__selection-button').count(),0);
        assert.equal(await dialog.locator('.vocabulary-preview-dialog__current-actions .vocabulary-preview-dialog__selection-button').evaluate(el => getComputedStyle(el).boxShadow), 'none');
        assert.equal(await main.evaluate(el => getComputedStyle(el).outlineStyle), 'none', 'current word has no highlight frame');
        assert.equal(await row.evaluate(el => el.scrollWidth > el.clientWidth + 1), false, 'expanded row must not overflow');
        await main.click();
      }
    };
    await checkLayout();
    const all = dialog.getByRole('button', { name: '加入精简释义', exact: true });
    assert.equal(await all.isDisabled(), true);
    assert.equal(await dialog.getByRole('button', { name: /只加入单词/ }).count(), 0);
    assert.match(await all.getAttribute('title'), /精简/);
    assert.equal(await dialog.innerText().then(t => t.includes('用原义')), false);
    await page.screenshot({ path: path.join(out, 'blocked-desktop.png') });
    await dialog.getByRole('button', { name: '重试精简', exact: true }).click();
    await all.waitFor({ state: 'visible' });
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '加入精简释义').disabled);
    await page.screenshot({ path: path.join(out, 'ready-desktop.png') });
    await all.click();
    await page.waitForFunction(() => document.querySelector('.vocabulary-preview-dialog--settlement').hidden);
    const saved = await page.evaluate(() => meaningCheck.saved());
    assert.deepEqual(saved.map(x => x.simple), ['努力', '在前面']);
    await page.evaluate(() => meaningCheck.open());
    await dialog.locator('[data-target-id="phrase"] .vocabulary-preview-dialog__item-main').click();
    await dialog.locator('.vocabulary-preview-dialog__current-actions .vocabulary-preview-dialog__selection-button').click();
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '加入精简释义').disabled);
    await all.click();
    await page.waitForFunction(() => document.querySelector('.vocabulary-preview-dialog--settlement').hidden);
    assert.equal((await page.evaluate(() => meaningCheck.saved())).length, 1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => meaningCheck.open());
    await checkLayout();
    assert.equal(await all.isDisabled(), true);
    await page.screenshot({ path: path.join(out, 'blocked-mobile.png') });
    assert.equal(await page.locator('vite-error-overlay').count(), 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'PASS', cases, browser: 'Browser plugin not available; repository Playwright used', evidence: out }));
  } finally {
    if (browser) await browser.close();
    if (server) await server.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
