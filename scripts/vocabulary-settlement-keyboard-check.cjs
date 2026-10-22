// New bounded S16/S17 entry; old failed status/selection runners remain untouched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const out = process.env.N5_06_EVIDENCE || 'C:/Users/0/AppData/Local/Temp/reader-n5-completion-20261007/06';
const entry = `
import '/styles.css';
import '/src/features/learning-ui/learning-ui.css';
import '/src/styles/workflow-ui.css';
import { createSettlementDialog } from '/src/features/vocabulary-preview/create-article-settlement-dialog.js';
import { createDialogController } from '/src/services/runtime/dialog-controller.js';
import { isReaderShortcutEventAllowed } from '/src/composables/reader-shortcut-scope.js';
const trigger=document.querySelector('#open'),input=document.querySelector('#typing');
const targets=[['river','bank','河岸'],['financial','bank','银行'],['phrase','in front of','在前面']].map(([id,text,meaning])=>({targetId:id,lemma:text,markedText:text,entry_type:id==='phrase'?'phrase':'word',eligible:true,group:'ready',meaning:meaning+'。'+('这是一段保留原始解释的长文本。'.repeat(18)),simple_meaning:meaning,context:{sentence:id,meaning}}));
let changes=[],spoken=[],stops=0,failSelection=false,resolveSelection,pendingRefines=[],refineProgress,applies=[],bodyKeys=0;
const pronunciation={stop(){stops++},prefetch:async()=>{},speak(text){spoken.push(text);return new Promise(resolve=>window.finishSpeech=resolve)}};
const dialog=createSettlementDialog({documentObject:document,windowObject:window,pronunciationService:pronunciation,
onToggleRemove:async info=>{changes.push({targetId:info.targetId,removed:info.removed});if(failSelection)throw Error('declared selection failure');if(window.holdSelection)await new Promise(r=>resolveSelection=r)},
onRefineMeanings:async info=>{if(window.holdRefine){refineProgress=info.onProgress;return new Promise(r=>pendingRefines.push(r))}return {requested:0}},
onApply:async info=>{applies.push({mode:info.mode,targets:info.candidates.filter(c=>!info.removedTargetIds.includes(c.targetId)&& (info.mode!=='words'||c.entry_type==='word')).map(c=>c.targetId)});return false},onSkip:async()=>false});
const secondary=createDialogController({documentObject:document});
document.addEventListener('keydown',e=>{if(isReaderShortcutEventAllowed(e,document)&&e.key==='m')bodyKeys++});
trigger.onclick=()=>dialog.open({articleId:'s16-fixture',candidates:targets,summary:{}},trigger);
window.test06={open:()=>trigger.click(),snapshot:()=>({changes,spoken,stops,applies,bodyKeys,active:document.querySelector('[data-active="true"]')?.dataset.targetId,focus:document.activeElement?.className,region:document.activeElement?.dataset.meaningRegion}),
setFailure:v=>failSelection=v,finishSelection:()=>resolveSelection?.(),startRefine:()=>{window.holdRefine=true;targets[0].simple_meaning='';dialog.open({articleId:'s16-fixture',candidates:targets,summary:{}},trigger)},
progress:()=>refineProgress?.(),finishRefine:()=>{window.holdRefine=false;pendingRefines.shift()?.({requested:1,updated:1})},
top:()=>{const el=document.querySelector('#other');el.hidden=false;secondary.open(el,{initialFocus:el.querySelector('button'),onRequestClose:()=>{secondary.close();el.hidden=true}})},
removeTarget:()=>{targets.splice(1,1);refineProgress?.()},empty:()=>{targets.splice(0);refineProgress?.()},close:()=>dialog.close()};
`;
async function main() {
  fs.mkdirSync(out, { recursive: true });
  let server, browser;
  const evidence = [], errors = [];
  try {
    const { createServer } = await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')));
    const plugin = { name: 'n5-06-bounded-check', resolveId(id) { if (id === '/__06-entry.js') return '\0n5-06'; }, load(id) { if (id === '\0n5-06') return entry; }, configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
      if (req.url !== '/__06.html') return next();
      res.setHeader('Content-Type', 'text/html');
      res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html><head><title>N5-06 bounded dialog check</title></head><body><button id="open">整理本篇生词</button><input id="typing"><section id="other" hidden><button>上层窗口</button></section><script type="module" src="/__06-entry.js"></script></body></html>'));
    }); } };
    server = await createServer({ root, configFile: path.join(root, 'vite.config.mjs'), plugins: [plugin], server: { host: '127.0.0.1', port: 5184, strictPort: true } });
    await server.listen();
    browser = await chromium.launch({ headless: true });
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 } });
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
      await page.route('**/api/**', route => route.abort('blockedbyclient'));
      await page.goto('http://127.0.0.1:5184/__06.html');
      assert.equal(await page.title(), 'N5-06 bounded dialog check');
      await page.locator('#open').click();
      const dialog = page.locator('.vocabulary-preview-dialog--settlement');
      const rows = dialog.locator('.vocabulary-preview-dialog__item');
      await rows.first().locator('.vocabulary-preview-dialog__item-main').focus();
      await page.keyboard.press('ArrowUp');
      assert.match(await dialog.locator('.vocabulary-preview-dialog__status').innerText(), /第一个/);
      await page.keyboard.press('ArrowDown');
      assert.equal((await page.evaluate(() => test06.snapshot())).active, 'financial');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      assert.match(await dialog.locator('.vocabulary-preview-dialog__status').innerText(), /最后一个/);
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('d');
      assert.equal((await page.evaluate(() => test06.snapshot())).region, 'original');
      await page.keyboard.press('d');
      assert.equal((await page.evaluate(() => test06.snapshot())).region, 'simple');
      const meaningGeometry = await page.evaluate(() => {
        const focus=document.activeElement.getBoundingClientRect(),list=document.querySelector('.vocabulary-preview-dialog__list').getBoundingClientRect();
        return { focusTop:focus.top,focusBottom:focus.bottom,listTop:list.top,listBottom:list.bottom };
      });
      assert.ok(meaningGeometry.focusTop >= meaningGeometry.listTop - 1 && meaningGeometry.focusBottom <= meaningGeometry.listBottom + 1, 'D must reveal the focused meaning region inside the list');
      await page.keyboard.press('e');
      assert.equal(await rows.nth(1).getAttribute('data-expanded'), 'true');
      await page.keyboard.press('e');
      assert.equal(await rows.nth(1).getAttribute('data-expanded'), 'false');
      await page.keyboard.press('Enter');
      assert.equal(await rows.nth(1).getAttribute('data-expanded'), 'true');
      await page.keyboard.press('r');
      assert.deepEqual((await page.evaluate(() => test06.snapshot())).spoken, ['bank']);
      await page.keyboard.press('r');
      assert.equal(await rows.nth(1).locator('.vocabulary-preview-dialog__speaker').getAttribute('aria-pressed'), 'false');
      await page.evaluate(() => finishSpeech());
      await page.keyboard.press('m');
      await page.waitForFunction(() => document.querySelector('[data-target-id="financial"] .vocabulary-preview-dialog__selection-button').disabled === false);
      assert.equal(await rows.nth(1).getAttribute('data-removed'), 'true');
      assert.equal((await page.evaluate(() => test06.snapshot())).active, 'financial');
      await page.keyboard.press('m');
      await page.waitForFunction(() => document.querySelector('[data-target-id="financial"]').dataset.removed === 'false');
      await page.evaluate(() => test06.setFailure(true));
      await page.keyboard.press('m');
      await page.waitForFunction(() => document.querySelector('.vocabulary-preview-dialog__status').textContent.includes('declared selection failure'));
      assert.equal(await rows.nth(1).getAttribute('data-removed'), 'false');
      await page.evaluate(() => test06.setFailure(false));
      await rows.first().locator('.vocabulary-preview-dialog__item-main').click();
      assert.equal((await page.evaluate(() => test06.snapshot())).active, 'river');
      assert.equal(await page.evaluate(() => document.activeElement.closest('[data-target-id]')?.dataset.targetId), 'river');
      // Repeat, modifiers, composition, recording and editable fields do not act.
      const before = (await page.evaluate(() => test06.snapshot())).changes.length;
      await rows.first().dispatchEvent('keydown', { key: 'm', repeat: true });
      await rows.first().dispatchEvent('keydown', { key: 'm', isComposing: true });
      await page.keyboard.press('Control+m');
      await page.evaluate(() => document.querySelector('#typing').classList.add('is-hotkey-waiting'));
      await page.keyboard.press('m');
      await page.evaluate(() => document.querySelector('#typing').classList.remove('is-hotkey-waiting'));
      for (const tag of ['input', 'select', 'textarea', 'div']) {
        await page.evaluate(tag => { const el=document.createElement(tag);el.id='editable';if(tag==='div')el.contentEditable='true';document.querySelector('.vocabulary-preview-dialog__list').append(el);el.focus(); }, tag);
        await page.keyboard.press('m');
        await page.evaluate(() => document.querySelector('#editable').remove());
      }
      assert.equal((await page.evaluate(() => test06.snapshot())).changes.length, before);
      await rows.first().locator('.vocabulary-preview-dialog__item-main').focus();
      await page.evaluate(() => test06.top());
      await rows.first().dispatchEvent('keydown', { key: 'm' });
      assert.equal((await page.evaluate(() => test06.snapshot())).changes.length, before);
      await page.keyboard.press('Escape');
      await rows.nth(1).locator('.vocabulary-preview-dialog__item-main').focus();
      await page.evaluate(() => test06.startRefine());
      await rows.nth(1).locator('.vocabulary-preview-dialog__item-main').focus();
      await page.keyboard.press('d');
      await page.evaluate(() => test06.progress());
      assert.equal((await page.evaluate(() => test06.snapshot())).active, 'financial');
      assert.equal((await page.evaluate(() => test06.snapshot())).region, 'original');
      await page.evaluate(() => test06.finishRefine());
      await page.waitForFunction(() => document.querySelector('.vocabulary-preview-dialog__status').textContent.includes('AI 精简完成'));
      assert.equal((await page.evaluate(() => test06.snapshot())).active, 'financial');
      assert.equal((await page.evaluate(() => test06.snapshot())).region, 'original');
      await page.evaluate(() => test06.startRefine());
      await page.keyboard.press('Escape');
      await page.locator('#open').click();
      await page.evaluate(() => test06.finishRefine());
      assert.equal((await page.evaluate(() => test06.snapshot())).active, 'river');
      await page.evaluate(() => test06.finishRefine());
      await rows.first().locator('.vocabulary-preview-dialog__item-main').focus();
      await page.evaluate(() => window.holdSelection = true);
      await page.keyboard.press('m');
      const pendingCount = (await page.evaluate(() => test06.snapshot())).changes.length;
      await page.keyboard.press('m');
      assert.equal((await page.evaluate(() => test06.snapshot())).changes.length, pendingCount);
      await dialog.locator('.vocabulary-preview-dialog__close').click();
      await page.locator('#open').click();
      await page.evaluate(() => { window.holdSelection=false;test06.finishSelection(); });
      await dialog.locator('.vocabulary-preview-dialog__primary-actions button').filter({ hasText: '只加入单词' }).click();
      assert.deepEqual((await page.evaluate(() => test06.snapshot())).applies.at(-1).targets, ['river', 'financial']);
      assert.equal(await rows.count(), 3);
      const other = dialog.locator('.vocabulary-preview-dialog__other-actions');
      await other.locator('summary').click();
      await other.getByRole('button', { name: '跳过本篇剩余候选', exact: true }).click();
      await rows.first().dispatchEvent('keydown', { key: 'r' });
      assert.equal((await page.evaluate(() => test06.snapshot())).spoken.length, 1);
      await other.getByRole('button', { name: '取消', exact: true }).click();
      const geometry = await rows.first().evaluate(row => { const p=row.querySelector('.vocabulary-preview-dialog__pronunciation-actions').getBoundingClientRect(),s=row.querySelector('.vocabulary-preview-dialog__selection-actions').getBoundingClientRect();return {gap: s.x>=p.right?s.x-p.right:s.y-p.bottom,overflow:row.scrollWidth>row.clientWidth+1}; });
      assert.ok(geometry.gap >= 15.5);
      assert.equal(geometry.overflow, false);
      await page.screenshot({ path: path.join(out, `dialog-${width}.png`) });
      const focusable = dialog.locator('button:not([disabled]):visible, [tabindex="0"]:visible');
      await focusable.last().focus();
      await page.keyboard.press('Tab');
      assert.equal(await dialog.locator('.vocabulary-preview-dialog__close').evaluate(el => el === document.activeElement), true, 'Tab from last visible control must wrap inside the dialog');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await focusable.last().evaluate(el => el === document.activeElement), true, 'Shift+Tab from first visible control must wrap to last visible control');
      // Existing pointer drag/resize remains real visible interaction.
      const box = await dialog.boundingBox();
      await page.mouse.move(box.x+80,box.y+20);await page.mouse.down();await page.mouse.move(box.x+100,box.y+35);await page.mouse.up();
      const moved = await dialog.boundingBox();assert.ok(Math.abs(moved.x-box.x)>1 || Math.abs(moved.y-box.y)>1 || width===390);
      const handle = await dialog.locator('.vocabulary-preview-dialog__resize-handle').boundingBox();
      await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x-10,handle.y-10);await page.mouse.up();
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.activeElement.id === 'open');
      for (let i=0;i<3;i++) { await page.locator('#open').click();await rows.first().locator('.vocabulary-preview-dialog__item-main').focus();await page.keyboard.press('ArrowDown');assert.equal((await page.evaluate(() => test06.snapshot())).active,'financial');await page.keyboard.press('Escape'); }
      await page.keyboard.press('m');
      assert.equal((await page.evaluate(() => test06.snapshot())).bodyKeys, 1);
      await page.evaluate(() => test06.startRefine());
      await rows.nth(1).locator('.vocabulary-preview-dialog__item-main').focus();
      await page.evaluate(() => test06.removeTarget());
      assert.equal((await page.evaluate(() => test06.snapshot())).active, 'phrase');
      await page.evaluate(() => test06.empty());
      assert.equal((await page.evaluate(() => test06.snapshot())).active, undefined);
      assert.equal(await dialog.locator('.vocabulary-preview-dialog__close').evaluate(el => el === document.activeElement), true);
      await page.evaluate(() => test06.finishRefine());
      await page.keyboard.press('Escape');
      evidence.push({ width, title:await page.title(), url:page.url(), keyboardMouse:true, targetFocus:true, boundaries:true, regions:true, expansion:true, speech:'controlled dependency', restoreAndFailure:true, topAndEditableIsolation:true, asyncEpochAndFocus:true, wordsRetainsPhrase:true, gap:geometry.gap, dragResize:true, repeatedOpenAndReturn:true });
      await page.close();
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ evidence, errors, Browser:'not available', scope:'controlled real product dialog; no live owner/AI' }, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
    console.log('PASS bounded S16/S17 controlled dialog checks.');
  } finally { if(browser)await browser.close();if(server)await server.close(); }
}
main().catch(error => { fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'failure.txt'),String(error.stack||error));console.error(error);process.exitCode=1; });
