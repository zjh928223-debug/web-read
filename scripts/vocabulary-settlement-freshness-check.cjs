// Real controller-open seam; controlled dependencies, no live owner/AI writes.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const entry = `
import { createVocabularyPreviewController } from '/src/composables/vocabulary-preview-module.js';
const articleId='settlement-freshness-fixture';
const item={targetId:'first',markedText:'effort',boundary:'effort',meaning:'努力。',simpleMeaning:'努力',sourceSentence:'An effort is needed.',source:'manual_annotation'};
let items=[item],lookup=new Map(),reads=0;
let progress={article_id:articleId,settlement_target_ids:['first'],applied_target_ids:[],removed_target_ids:[],skipped_target_ids:[],refinements:[],application_claims:[]};
const button=document.createElement('button');document.body.append(button);
const controller=createVocabularyPreviewController({
 settleButton:button,state:{currentAudioMeta:{source:'youtube-workflow',jobId:articleId,title:'Freshness'}},documentObject:document,
 windowObject:{document,AnnotationGenerationStorage:{async loadBundle(){return {generated:{items:structuredClone(items)}}}},addEventListener(){},removeEventListener(){}},
 vocabularyService:{async getWordsAndContextsByLemmas(){reads++;return lookup;}},
 settlementProgressRepository:{async getProgress(){return structuredClone(progress)},async recordSettlementTargets(id,ids,{appliedTargetIds=[]}={}){progress={...progress,settlement_target_ids:ids,applied_target_ids:[...new Set([...progress.applied_target_ids,...appliedTargetIds])]};return structuredClone(progress)}},
 pronunciationService:{async prefetch(){},stop(){}},showError(code,message){throw Error(code+': '+message)}
});
function close(){[...document.querySelectorAll('.vocabulary-preview-dialog')].find(x=>!x.hidden).querySelector('.vocabulary-preview-dialog__close').click()}
window.checkFreshness=async()=>{
 const cases=[];
 let s=await controller.openSettlement();cases.push({case:'initial',group:s.candidates[0].group});close();
 lookup=new Map([['effort',{word:{id:'word-effort',lemma:'effort',status:'ignored',updated_at:'2099-01-01T00:00:00Z'},contexts:[]}]]);
 s=await controller.openSettlement();cases.push({case:'changed current word status',group:s.candidates[0].group,reads});close();
 lookup=new Map([['effort',{word:{id:'word-effort',lemma:'effort',status:'learning'},contexts:[{word_id:'word-effort',source_id:articleId,sentence:item.sourceSentence}]}]]);
 s=await controller.openSettlement();cases.push({case:'new saved source context',excluded:s.excluded.map(c=>({id:c.targetId,reason:c.reason})),applied:s.progress.applied_target_ids});close();
 lookup=new Map();items.push({...item,targetId:'second',markedText:'attempt',boundary:'attempt'});
 s=await controller.openSettlement();cases.push({case:'new annotation after partial save',pending:s.candidates.map(c=>c.targetId),applied:s.progress.applied_target_ids});close();
 items[1]={...items[1],meaning:'尝试达成一件事。',simpleMeaning:'尝试'};
 s=await controller.openSettlement();cases.push({case:'changed annotation text',meaning:s.candidates.find(c=>c.targetId==='second').meaning});close();
 progress.removed_target_ids=['second'];
 s=await controller.openSettlement();cases.push({case:'current progress changed',removed:s.removedTargetIds.includes('second')});close();
 return cases;
};`;
(async()=>{let server,browser;try{
 const {createServer}=await import(pathToFileURL(path.join(root,'node_modules/vite/dist/node/index.js')));
 const plugin={name:'settlement-freshness-check',resolveId(id){if(id==='/__freshness-entry.js')return '\0freshness-entry'},load(id){if(id==='\0freshness-entry')return entry},configureServer(vite){vite.middlewares.use(async(req,res,next)=>{if(req.url!='/__freshness.html')return next();res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml(req.url,'<!doctype html><html><head><title>Settlement freshness check</title></head><body><script type="module" src="/__freshness-entry.js"></script></body></html>'));})}};
 server=await createServer({root,configFile:path.join(root,'vite.config.mjs'),plugins:[plugin],server:{host:'127.0.0.1',port:4588,strictPort:true}});await server.listen();
 browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',r=>r.abort('blockedbyclient'));await page.goto('http://127.0.0.1:4588/__freshness.html');await page.waitForFunction(()=>typeof window.checkFreshness==='function');
 const cases=await page.evaluate(()=>window.checkFreshness());console.log(JSON.stringify(cases,null,2));assert.deepEqual(errors,[]);
 assert.equal(cases[0].group,'ready');assert.equal(cases[1].group,'needs_explicit_relearn');assert.equal(cases[1].reads,2);
 assert.ok(cases[2].excluded.some(c=>c.id==='first'&&c.reason==='already_added_current_article'));
 assert.deepEqual(cases[2].applied,['first']);assert.deepEqual(cases[3].pending,['second']);assert.deepEqual(cases[3].applied,['first']);assert.equal(cases[4].meaning,'尝试达成一件事。');assert.equal(cases[5].removed,true);
 console.log('PASS current word status, source context, partial progress, new/changed annotation and current selection on original controller reopen.');
}finally{if(browser)await browser.close();if(server)await server.close()}})().catch(e=>{console.error(e);process.exitCode=1});
