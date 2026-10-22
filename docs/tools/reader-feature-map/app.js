(() => {
  'use strict';
  const catalog = window.READWEB_FEATURE_MAP;
  const storageKey = 'readweb.feature-map.opinions.v1';
  const choices = { undecided:'待判断', keep:'保留', unused:'疑似无用', duplicate:'疑似重复', merge:'合并候选', split:'拆分候选', add:'新增想法' };
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  let state = { reviews:{}, ideas:[] };
  let selected = 'seek-back';
  let query = '';
  let filter = 'all';
  const expanded = new Set(['playback']);
  let expandAll = false;
  const plainResults = {
    'seek-back':'回到当前句或切分块的开头，快速再按可回到上一句或上一块。具体位置随阅读模式变化。',
    'seek-forward':'跳到下一句或下一块，更新播放位置与文本高亮。',
    'play-toggle':'开始或暂停当前音频、视频。',
    'play-speed':'把当前音频或视频切换到你选的播放速度。',
    'word-click':'定位到所点单词，并尝试显示对应释义。',
    'chunk-click':'定位到所点切分块的开头。',
    'follow-playback':'开启或关闭页面随当前播放内容移动。',
    'marks-import':'用文件中的标记替换当前重点标记。',
    'marks-export':'把当前重点标记下载为 JSON 文件。',
    'text-export':'下载全文 TXT，并用符号标出重点词。',
    'preview-settings':'调整下一组预习的词数，当前批次保持原样。',
  };
  function status(message, error = false) {
    $('save-status').textContent = message;
    $('save-status').classList.toggle('error', error);
  }
  function items() { return [...catalog.items, ...state.ideas]; }
  function opinion(id) { return state.reviews[id] || {decision:'undecided',note:'',proposedName:'',target:''}; }
  function isMarked(id) {
    const r = opinion(id);
    return r.decision !== 'undecided' || Boolean(r.note || r.proposedName || r.target);
  }
  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({format:'readweb-feature-map',schema:1,snapshot:catalog.snapshot,...state}));
      status('已保存到当前浏览器。');
      return true;
    } catch {
      status('浏览器未能保存意见；当前意见仍在页面中，请导出 JSON 备份。', true);
      return false;
    }
  }
  function normalize(payload) {
    if (!payload || payload.format !== 'readweb-feature-map' || payload.schema !== 1 || !Array.isArray(payload.ideas) || !payload.reviews || typeof payload.reviews !== 'object' || Array.isArray(payload.reviews)) throw new Error('这不是功能地图 v1 的意见文件。');
    if (payload.ideas.length > 300 || Object.keys(payload.reviews).length > 1000) throw new Error('意见条目超出支持范围。');
    const groups = new Set(catalog.groups.map(g => g.id));
    const known = new Set(catalog.items.map(i => i.id));
    const ideas = payload.ideas.map(i => {
      if (!i || typeof i.id !== 'string' || !/^idea-[a-z0-9-]{1,80}$/.test(i.id) || known.has(i.id) || !groups.has(i.group) || typeof i.title !== 'string' || !i.title.trim() || i.title.length > 120 || typeof i.purpose !== 'string' || i.purpose.length > 4000) throw new Error('新增想法的名称、分组或内容无效。');
      known.add(i.id);
      return makeIdea(i.id, i.group, i.title.trim(), i.purpose);
    });
    const reviews = {};
    let ignored = 0;
    for (const [id,r] of Object.entries(payload.reviews)) {
      if (!known.has(id)) { ignored++; continue; }
      if (!r || !Object.hasOwn(choices, r.decision) || typeof r.note !== 'string' || r.note.length > 4000 || typeof r.proposedName !== 'string' || r.proposedName.length > 120 || typeof r.target !== 'string' || (r.target && !known.has(r.target) && !groups.has(r.target)) || r.target === id) throw new Error('取舍意见、备注或归并目标无效。');
      reviews[id] = {decision:r.decision,note:r.note,proposedName:r.proposedName,target:r.target};
    }
    return {reviews,ideas,ignored};
  }
  function makeIdea(id, group, title, purpose) {
    return {id,group,title,purpose:purpose || '尚未补充预期行为。',entries:['拟新增入口，尚未实现'],branches:[{when:'希望新增',then:purpose || '请在备注中补充入口、条件和预期结果。'}],data:'这是你的产品想法，未接入阅读器，也没有数据副作用。',related:[],sources:[],evidence:'idea'};
  }
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const restored = normalize(JSON.parse(raw));
      state = {reviews:restored.reviews,ideas:restored.ideas};
      status('已恢复你的意见。');
    }
  } catch {
    status('无法读取已保存意见；可导入备份。新意见保存前请先检查备份。', true);
  }
  for (const [value,label] of Object.entries(choices)) $('filter').add(new Option(label, value));
  for (const group of catalog.groups) $('idea-parent').add(new Option(group.title, group.id));
  function matches(item) {
    const r = opinion(item.id);
    const text = [item.title,item.purpose,...item.entries,item.data,...item.branches.map(b => `${b.when} ${b.then}`),...item.sources.map(s => `${s.path} ${s.anchor}`),r.note,r.proposedName].join(' ').toLocaleLowerCase();
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return terms.every(term => text.includes(term)) && (filter === 'all' || (filter === 'marked' ? isMarked(item.id) : r.decision === filter));
  }
  function renderTree() {
    const all = items();
    const visible = all.filter(matches);
    $('catalog-summary').textContent = `${all.length} 项`;
    $('result-count').hidden = !query.trim() && filter === 'all';
    $('result-count').textContent = `找到 ${visible.length} 项${filter !== 'all' ? ` · ${$('filter').selectedOptions[0].textContent}` : ''}`;
    $('tree').innerHTML = visible.length ? catalog.groups.map(group => {
      const rows = visible.filter(i => i.group === group.id);
      if (!rows.length) return '';
      const open = expanded.has(group.id) || Boolean(query.trim()) || filter !== 'all';
      return `<details class="group" data-group="${group.id}" ${open?'open':''}><summary>${escape(group.title)}</summary><div>${rows.map(item => {
        const r = opinion(item.id);
        return `<button class="leaf" data-id="${escape(item.id)}" aria-current="${item.id===selected}"><span>${escape(item.title)}</span><span class="marker ${isMarked(item.id)?'marked':''}">${escape(r.decision==='undecided'?(isMarked(item.id)?'有备注':''):choices[r.decision])}</span></button>`;
      }).join('')}</div></details>`;
    }).join('') : '<p class="empty">没有匹配功能。试试其它词，或切换为全部功能。</p>';
  }
  function renderDetail() {
    const item = items().find(i => i.id === selected);
    if (!item) { $('detail').innerHTML = '<p class="empty">在左侧选择一个功能，查看它的行为与取舍意见。</p>'; return; }
    const group = catalog.groups.find(g => g.id === item.group);
    const r = opinion(item.id);
    const related = item.related.map(id => items().find(i => i.id === id)).filter(Boolean);
    const targetOptions = [...catalog.groups.map(g=>({id:g.id,title:`功能组：${g.title}`})),...items().filter(i=>i.id!==item.id)];
    $('detail').innerHTML = `<div class="detail-content"><p class="breadcrumb">${escape(group.title)}${item.evidence==='idea'?' · 新想法':''}</p><h2>${escape(item.title)}</h2><p class="lead">${escape(plainResults[item.id] || item.purpose)}</p>
      ${item.evidence==='entry'?'<p class="overview-caveat">已核对操作入口，完整行为仍待确认。</p>':item.evidence==='idea'?'<p class="overview-caveat">这是预期行为，尚未实现。</p>':''}
      <section class="judgment"><label for="decision">你的判断</label><select id="decision">${Object.entries(choices).map(([value,label])=>`<option value="${value}" ${r.decision===value?'selected':''}>${label}</option>`).join('')}</select></section>
      <div class="disclosures">
      <details class="disclosure"><summary>操作方式与具体条件</summary><div class="disclosure-content"><h3>操作入口</h3><ul class="entry-list">${item.entries.map(e=>`<li>${escape(e)}</li>`).join('')}</ul><dl class="branches">${item.branches.map(b=>`<div class="branch"><dt>${escape(b.when)}</dt><dd>${escape(b.then)}</dd></div>`).join('')}</dl></div></details>
      <details class="disclosure"><summary>备注与整理<span id="opinion-indicator">${r.note||r.proposedName||r.target?'已填写':''}</span></summary><div class="disclosure-content"><label class="note-field">原因或想法<textarea id="review-note" maxlength="4000" rows="3" placeholder="例如：我很少使用，或希望和另一功能合并…">${escape(r.note)}</textarea></label><div class="edit-grid"><label>拟调整后的名称<input id="proposed-name" maxlength="120" value="${escape(r.proposedName)}" placeholder="沿用当前名称"></label><label>建议归并到 / 关联目标<select id="merge-target"><option value="">尚未指定</option>${targetOptions.map(i=>`<option value="${escape(i.id)}" ${r.target===i.id?'selected':''}>${escape(i.title)}</option>`).join('')}</select></label></div></div></details>
      <details class="disclosure"><summary>关联功能${related.length?`<span>${related.length} 项</span>`:''}</summary><div class="disclosure-content">${related.length?`<div class="related">${related.map(i=>`<button data-related="${escape(i.id)}">${escape(i.title)}</button>`).join('')}</div>`:'<p class="pending-note">关联尚未补充。</p>'}</div></details>
      <details class="disclosure sources"><summary>数据影响与确认范围</summary><div class="disclosure-content"><p class="data-note">${escape(item.data)}</p><h3>确认程度</h3><p class="pending-note">${item.evidence==='idea'?'新增想法尚未实现。':item.evidence==='logic'?'关键逻辑已查代码；真实阅读器旅程：NOT_VERIFIED。':'操作入口已核对，完整调用链待核对；真实阅读器旅程：NOT_VERIFIED。'}</p><h3>代码依据</h3><ul>${item.sources.map(s=>`<li><code>${escape(s.path)}</code><br>${escape(s.anchor)}</li>`).join('') || '<li>新增想法尚无实现文件。</li>'}</ul><p class="pending-note">人工整理的源码快照，尚未完成全应用盘点。功能 ID：${escape(item.id)}。</p></div></details>
      </div></div>`;
  }
  function select(id, navigate = false) {
    const item = items().find(i => i.id === id);
    if (!item) return;
    selected = id;
    if (!expandAll) expanded.clear();
    expanded.add(item.group);
    if (navigate) { query = ''; filter = 'all'; $('search').value = ''; $('filter').value = 'all'; }
    renderTree(); renderDetail();
    if (navigate || matchMedia('(max-width:640px)').matches) {
      $('detail').scrollIntoView({block:'start'});
      $('detail').scrollTop = 0;
      const heading = $('detail').querySelector('h2');
      heading.tabIndex = -1; heading.focus({preventScroll:true});
    } else {
      $('detail').scrollTop = 0;
      $('tree').querySelector(`[data-id="${id}"]`)?.focus({preventScroll:true});
    }
  }
  function update(fields) {
    state.reviews[selected] = {...opinion(selected),...fields};
    save(); renderTree();
    const r = opinion(selected);
    $('opinion-indicator').textContent = r.note || r.proposedName || r.target ? '已填写' : '';
  }
  $('tree').addEventListener('click', event => {
    const button = event.target.closest('[data-id]');
    if (button) select(button.dataset.id);
  });
  $('tree').addEventListener('toggle', event => {
    const id = event.target.dataset.group;
    if (!id || !event.target.isConnected || query.trim() || filter !== 'all') return;
    if (event.target.open) {
      if (!expandAll) {
        expanded.clear();
        $('tree').querySelectorAll('details').forEach(d=>{if(d!==event.target)d.open=false;});
      }
      expanded.add(id);
    } else expanded.delete(id);
  }, true);
  $('detail').addEventListener('click', event => {
    const related = event.target.closest('[data-related]');
    if (related) { select(related.dataset.related,true); return; }
  });
  $('detail').addEventListener('input', event => {
    if (event.target.id==='review-note') update({note:event.target.value});
    if (event.target.id==='proposed-name') update({proposedName:event.target.value});
  });
  $('detail').addEventListener('change', event => {
    if (event.target.id==='merge-target') update({target:event.target.value});
    if (event.target.id==='decision') update({decision:event.target.value});
  });
  function filterChanged() {
    const visible = items().filter(matches);
    if (!visible.some(i=>i.id===selected)) selected = visible[0]?.id || '';
    renderTree(); renderDetail();
  }
  $('search').addEventListener('input', event => {query=event.target.value;filterChanged();});
  $('filter').addEventListener('change', event => {filter=event.target.value;filterChanged();});
  $('expand-all').addEventListener('click', () => {expandAll=true;catalog.groups.forEach(g=>expanded.add(g.id));renderTree();});
  $('collapse-all').addEventListener('click', () => {
    expandAll = false;
    expanded.clear();
    $('tree').querySelectorAll('details').forEach(d=>{d.open=false;});
  });
  $('new-idea').addEventListener('click', () => {
    $('idea-form').reset();
    $('idea-parent').value = items().find(i=>i.id===selected)?.group || catalog.groups[0].id;
    $('idea-dialog').showModal(); $('idea-name').focus();
  });
  $('idea-cancel').addEventListener('click', () => $('idea-dialog').close());
  $('idea-form').addEventListener('submit', event => {
    event.preventDefault();
    const title = $('idea-name').value.trim();
    if (!title) {$('idea-name').setCustomValidity('请输入功能名称。');$('idea-name').reportValidity();return;}
    if (state.ideas.length >= 300) {status('新增想法已达 300 项，请先导出整理。',true);return;}
    const id = `idea-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
    state.ideas.push(makeIdea(id,$('idea-parent').value,title,$('idea-description').value.trim()));
    state.reviews[id] = {decision:'add',note:'',proposedName:'',target:''};
    $('idea-dialog').close(); save(); select(id,true);
  });
  $('idea-name').addEventListener('input',()=> $('idea-name').setCustomValidity(''));
  function download(content,type,extension) {
    const url = URL.createObjectURL(new Blob([content],{type}));
    const link = document.createElement('a'); link.href=url;link.download=`reader-feature-opinions-${new Date().toISOString().slice(0,10)}.${extension}`;
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    status('已生成下载文件；请在浏览器下载中检查。');
  }
  $('export-json').addEventListener('click',()=>download(JSON.stringify({format:'readweb-feature-map',schema:1,snapshot:catalog.snapshot,exportedAt:new Date().toISOString(),...state},null,2),'application/json','json'));
  $('export-md').addEventListener('click',()=> {
    const all=items(); const named=id=>all.find(i=>i.id===id)?.title || catalog.groups.find(g=>g.id===id)?.title || id;
    const safe=value=>String(value).replace(/([\\`*_{}\[\]<>#|])/g,'\\$1').replace(/\r\n?/g,'\n').replace(/\n/g,'\n  ');
    const lines=['# 阅读器功能整理意见','',`代码快照：${catalog.snapshot}。初版盘点，真实阅读器旅程 NOT_VERIFIED。`,'','意见不会自动改变产品功能。',''];
    for(const group of catalog.groups){
      const rows=all.filter(i=>i.group===group.id && isMarked(i.id)); if(!rows.length)continue;
      lines.push(`## ${group.title}`,'');
      for(const i of rows){const r=opinion(i.id);lines.push(`### ${safe(i.title)} (${i.id})`,'',`- 意见：${choices[r.decision]}`,`- 拟调整名称：${safe(r.proposedName||'沿用当前名称')}`,`- 归并或关联目标：${safe(r.target?named(r.target):'未指定')}`,`- 原因与想法：${safe(r.note||'未补充')}`,`- 功能用途：${safe(i.purpose)}`,'');}
    }
    if(!all.some(i=>isMarked(i.id)))lines.push('尚未填写取舍意见。');
    download(lines.join('\n'),'text/markdown;charset=utf-8','md');
  });
  $('import-button').addEventListener('click',()=>$('import-file').click());
  $('import-file').addEventListener('change',async event=> {
    const file=event.target.files[0];if(!file)return;
    try {
      if(file.size>2*1024*1024)throw new Error('文件超过 2 MB，请检查是否选对意见文件。');
      const payload=JSON.parse(await file.text());const incoming=normalize(payload);
      const combined=new Map(state.ideas.map(i=>[i.id,i])); incoming.ideas.forEach(i=>combined.set(i.id,i));
      if(combined.size>300)throw new Error('合并后的新增想法超过 300 项。');
      state={ideas:[...combined.values()],reviews:{...state.reviews,...incoming.reviews}};
      const persisted = save(); filterChanged();
      const message = `已导入 ${Object.keys(incoming.reviews).length} 项意见；同一功能以导入意见为准，其它意见保留。${incoming.ignored?` 跳过 ${incoming.ignored} 个未知功能。`:''}${payload.snapshot!==catalog.snapshot?' 文件快照不同，请复核功能说明。':''}`;
      status(message + (persisted ? '' : ' 浏览器保存失败，请立即导出 JSON 备份。'), !persisted);
    }catch(error){status(`导入失败，原意见保留：${error.message}`,true);}
    finally{event.target.value='';}
  });
  renderTree(); renderDetail();
})();
