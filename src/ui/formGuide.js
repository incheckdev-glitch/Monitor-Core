const FormGuide = (() => {
  const S = { observer:null, timer:null, bound:false, rules:new Map() };
  const qsa = (root, sel) => { try { return Array.from((root||document).querySelectorAll(sel)); } catch { return []; } };
  const clean = v => String(v ?? '').replace(/\s+/g,' ').trim();
  const norm = v => clean(v).toLowerCase().replace(/[\s-]+/g,'_');
  const visible = el => {
    if(!(el instanceof Element)) return false;
    if(el.closest('[hidden],.rm-hidden,.workflow-guide-root,.workflow-guide-walkthrough,#loginSection')) return false;
    const s=getComputedStyle(el),r=el.getBoundingClientRect();
    return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;
  };
  const currentModule = () => clean(document.querySelector('.view-tab.active,.view-tab[aria-selected="true"]')?.dataset?.view || '');

  const BUILTIN = {
    userCreateForm:{
      required:['userCreateName','userCreateUsername','userCreateEmail','userCreateRole','userCreatePassword'],
      notes:{
        userCreateName:'Required to identify the user in the ERP.',
        userCreateUsername:'Required for the user profile/login identity.',
        userCreateEmail:'Required account email.',
        userCreateRole:'Required because permissions are role-based.',
        userCreatePassword:'Required when creating the account.'
      }
    },
    userProfileForm:{
      optional:['userProfileUsername','userProfilePhone','userProfileJobTitle','userProfileDepartment'],
      notes:{
        userProfileUsername:'Optional profile identity field.',
        userProfilePhone:'Optional contact detail.',
        userProfileJobTitle:'Optional profile detail.',
        userProfileDepartment:'Optional profile detail.'
      }
    }
  };

  function registerRules(formKey, rules={}){
    if(!formKey) return;
    const prev=S.rules.get(formKey)||{};
    S.rules.set(formKey,{...prev,...rules});
    schedule(0);
  }

  function formKey(root){
    return clean(root?.id || root?.dataset?.formGuideKey || root?.querySelector('form[id]')?.id || currentModule());
  }

  function rulesFor(root){
    const key=formKey(root);
    return { ...(BUILTIN[key]||{}), ...(S.rules.get(key)||{}) };
  }

  function controlId(el){ return clean(el.id||el.name||el.dataset?.field||''); }
  function labelFor(el, root){
    if(el.id){ const l=(root||document).querySelector(`label[for="${CSS.escape(el.id)}"]`); if(l)return l; }
    return el.closest('label') || el.parentElement?.querySelector?.(':scope > label') || null;
  }
  function labelText(el,root){
    const l=labelFor(el,root); if(l)return clean(l.childNodes?.[0]?.textContent || l.textContent).replace(/\*+$/,'').trim();
    return clean(el.getAttribute('aria-label')||el.placeholder||controlId(el)||'Field').replace(/[_-]+/g,' ');
  }
  function hasValue(el){
    if(el.type==='checkbox'||el.type==='radio') return Boolean(el.checked);
    if(el.tagName==='SELECT') return clean(el.value)!=='';
    return clean(el.value)!=='';
  }
  function explicitRule(el, root){
    const r=rulesFor(root),id=controlId(el);
    const match=list=>Array.isArray(list)&&list.some(x=>clean(x)===id);
    if(match(r.required)) return {kind:'required',reason:r.notes?.[id]||'Required by this ERP form rule.'};
    if(match(r.optional)) return {kind:'optional',reason:r.notes?.[id]||'Optional for this form.'};
    if(match(r.readonly)) return {kind:'readonly',reason:r.notes?.[id]||'Controlled by the ERP.'};
    if(r.conditional && Object.prototype.hasOwnProperty.call(r.conditional,id)){
      const rule=r.conditional[id];
      try{
        const active=typeof rule==='function'?Boolean(rule({field:el,root,module:currentModule()})):Boolean(rule?.when?.({field:el,root,module:currentModule()}));
        if(active) return {kind:'required',reason:clean(rule?.reason)||'Required by the current workflow condition.'};
        return {kind:'optional',reason:clean(rule?.optionalReason)||'Optional in the current workflow state.'};
      }catch{return {kind:'conditional',reason:clean(rule?.reason)||'Requirement depends on workflow state.'};}
    }
    return null;
  }
  function classify(el,root){
    const explicit=explicitRule(el,root); if(explicit)return explicit;
    if(el.disabled||el.readOnly||el.getAttribute('aria-readonly')==='true'||el.dataset.systemControlled==='true') return {kind:'readonly',reason:'Read-only or system-controlled.'};
    if(el.required||el.getAttribute('aria-required')==='true'||el.dataset.required==='true'||el.dataset.guideRequired==='true') return {kind:'required',reason:clean(el.dataset.guideReason)||'Required by the active form validation.'};
    const lt=labelText(el,root).toLowerCase();
    if(/\boptional\b/.test(lt)||el.dataset.optional==='true'||el.dataset.guideOptional==='true') return {kind:'optional',reason:clean(el.dataset.guideReason)||'Optional field.'};
    if(el.dataset.guideConditional==='true') return {kind:'conditional',reason:clean(el.dataset.guideReason)||'Required only in certain workflow conditions.'};
    return {kind:'conditional',reason:'No explicit required/optional rule is exposed by this form. The workflow may make it conditional.'};
  }

  function controls(root){
    return qsa(root,'input:not([type="hidden"]):not([type="submit"]):not([type="button"]),select,textarea,[contenteditable="true"]').filter(visible);
  }
  function ensureBadge(el,root,meta){
    const label=labelFor(el,root); if(!label)return;
    let badge=label.querySelector(':scope > .form-guide-field-badge');
    if(!badge){ badge=document.createElement('span'); badge.className='form-guide-field-badge'; label.appendChild(badge); }
    badge.dataset.kind=meta.kind;
    badge.textContent=meta.kind==='required'?'Required':meta.kind==='optional'?'Optional':meta.kind==='readonly'?'Read-only':'Conditional';
    badge.title=meta.reason;
    el.dataset.formGuideKind=meta.kind;
    el.dataset.formGuideReason=meta.reason;
    if(meta.kind==='required') el.setAttribute('aria-required','true');
  }
  function rowFor(el){ return el.closest('.form-row,.field-row,.input-row,.rm-field,.form-group,label') || el.parentElement; }
  function mark(el,root,meta){
    ensureBadge(el,root,meta);
    const row=rowFor(el); if(row){ row.classList.add('form-guide-field'); row.dataset.formGuideKind=meta.kind; }
    if(meta.kind==='required'&&!hasValue(el)) el.classList.add('form-guide-missing'); else el.classList.remove('form-guide-missing');
  }
  function summary(root){
    const items=controls(root).map(el=>({el,...classify(el,root)}));
    const req=items.filter(x=>x.kind==='required'), missing=req.filter(x=>!hasValue(x.el));
    return {
      total:items.length,
      required:req.length,
      requiredDone:req.length-missing.length,
      missing,
      optional:items.filter(x=>x.kind==='optional').length,
      conditional:items.filter(x=>x.kind==='conditional').length,
      readonly:items.filter(x=>x.kind==='readonly').length,
      items
    };
  }
  function ensureSummary(root,s){
    if(!s.total)return;
    let card=root.querySelector(':scope > .form-guide-summary');
    if(!card){
      card=document.createElement('section'); card.className='form-guide-summary'; card.setAttribute('aria-live','polite');
      const first=root.firstElementChild; if(first)root.insertBefore(card,first); else root.appendChild(card);
    }
    const pct=s.required?Math.round((s.requiredDone/s.required)*100):100;
    card.innerHTML=`<div class="form-guide-summary-top"><div><span class="form-guide-kicker">Form Guide</span><strong>${s.missing.length?`${s.missing.length} required field${s.missing.length===1?'':'s'} missing`:'Required fields complete'}</strong></div><span class="form-guide-progress-label">${s.requiredDone}/${s.required} required</span></div><div class="form-guide-progress"><span style="width:${pct}%"></span></div><div class="form-guide-legend"><span data-kind="required">Required ${s.required}</span><span data-kind="optional">Optional ${s.optional}</span><span data-kind="conditional">Conditional ${s.conditional}</span><span data-kind="readonly">Read-only ${s.readonly}</span></div>${s.missing.length?`<button type="button" class="form-guide-next-missing">Go to next required field</button>`:''}<p>Required/optional labels follow exposed form validation and registered ERP rules. Conditional means the requirement can depend on workflow state or legacy validation.</p>`;
    card.querySelector('.form-guide-next-missing')?.addEventListener('click',()=>focusField(s.missing[0]?.el));
  }
  function focusField(el){
    if(!el)return;
    try{el.scrollIntoView({behavior:'smooth',block:'center'});}catch{}
    setTimeout(()=>{try{el.focus({preventScroll:true});}catch{} el.classList.add('form-guide-focus'); setTimeout(()=>el.classList.remove('form-guide-focus'),1800);},220);
  }
  function rootTitle(root){ return clean(root.getAttribute('aria-label')||root.querySelector('h1,h2,h3,.modal-title,.drawer-title')?.textContent||root.id||'Form'); }
  function enhance(root){
    if(!(root instanceof Element)||!visible(root)||root.closest('#loginSection,.workflow-guide-root'))return;
    const list=controls(root); if(!list.length)return;
    list.forEach(el=>mark(el,root,classify(el,root)));
    const s=summary(root); ensureSummary(root,s);
    root.dataset.formGuideEnhanced='true';
    root.dataset.formGuideTitle=rootTitle(root);
  }
  function candidateRoots(){
    const roots=[];
    qsa(document,'form').forEach(f=>{if(visible(f)&&controls(f).length)roots.push(f)});
    qsa(document,'.modal.show,.modal.active,[role="dialog"],.drawer.open,.drawer.active,.icds-drawer').forEach(d=>{if(visible(d)&&controls(d).length&&!roots.some(r=>d.contains(r)||r.contains(d)))roots.push(d)});
    return roots;
  }
  function scan(){ S.timer=null; if(document.body?.classList.contains('auth-locked'))return; candidateRoots().forEach(enhance); }
  function schedule(delay=70){ if(S.timer)clearTimeout(S.timer); S.timer=setTimeout(scan,delay); }
  function bind(){
    if(S.bound)return; S.bound=true;
    document.addEventListener('input',e=>{if(e.target?.matches?.('input,select,textarea'))schedule(40)},true);
    document.addEventListener('change',e=>{if(e.target?.matches?.('input,select,textarea'))schedule(20)},true);
    document.addEventListener('click',()=>schedule(90),true);
    document.addEventListener('submit',e=>{
      const root=e.target?.matches?.('form')?e.target:e.target?.closest?.('form'); if(!root)return;
      enhance(root); const s=summary(root); if(s.missing.length){ s.missing.forEach(x=>x.el.classList.add('form-guide-missing')); focusField(s.missing[0].el); }
    },true);
    window.addEventListener('hashchange',()=>schedule(80));
    window.addEventListener('incheck360:ui:ready',()=>schedule(30));
    if(typeof MutationObserver!=='undefined'){
      S.observer=new MutationObserver(records=>{if(records.some(r=>r.addedNodes?.length||r.type==='attributes'))schedule(100)});
      S.observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden','aria-hidden','disabled','readonly','required']});
    }
    schedule(0);
  }
  function init(){ if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true}); else bind(); }
  init();
  return Object.freeze({ registerRules, refresh:()=>schedule(0), summary:root=>summary(root||candidateRoots()[0]||document), focusNextRequired(){const root=candidateRoots()[0];if(!root)return false;const s=summary(root);if(!s.missing.length)return false;focusField(s.missing[0].el);return true;} });
})();
window.FormGuide=FormGuide;
