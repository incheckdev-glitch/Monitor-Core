(function initClientLifecycleOperations(global) {
  'use strict';

  const RESOURCE = 'client_lifecycle';
  const TAB_ID = 'clientLifecycleTab';
  const VIEW_ID = 'clientLifecycleView';
  const STAGES = ['handover','setup','configuration','training','go_live','adoption','active_success','renewal'];
  const STAGE_LABELS = {
    handover:'Commercial Handover', setup:'Setup', configuration:'Configuration', training:'Training',
    go_live:'Go-Live', adoption:'Adoption', active_success:'Active Success', renewal:'Renewal'
  };
  const PHASE_LABELS = {
    handover:'Commercial Handover', setup:'Setup', configuration:'Configuration', training:'Training',
    go_live:'Go-Live Readiness', adoption:'Adoption', success:'Active Success', renewal:'Renewal'
  };
  const state = {
    mounted:false, active:false, loading:false, permissions:{view:false,create:false,update:false,manage:false},
    clients:[], profiles:[], checklist:[], users:[], selectedClientId:'', search:'', stage:'all', health:'all',
    detail:{ agreement:null, invoices:[], renewals:[], csmActivities:[], plans:[], trainings:[], events:[] }
  };

  const clean = v => String(v ?? '').trim();
  const esc = v => clean(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const db = () => { try { return global.SupabaseClient?.getClient?.() || null; } catch { return null; } };
  const iso = v => { const s=clean(v); return s ? s.slice(0,10) : ''; };
  const fmtDate = v => { const s=clean(v); if(!s)return '—'; const d=new Date(s); return Number.isNaN(d.getTime())?s.slice(0,10):d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'2-digit'}); };
  const daysUntil = v => { const s=clean(v); if(!s)return null; const d=new Date(`${s.slice(0,10)}T00:00:00`); if(Number.isNaN(d.getTime()))return null; const now=new Date(); now.setHours(0,0,0,0); return Math.ceil((d-now)/86400000); };
  const daysSince = v => { const s=clean(v); if(!s)return null; const d=new Date(s); if(Number.isNaN(d.getTime()))return null; return Math.floor((Date.now()-d.getTime())/86400000); };
  const number = (v,f=0) => Number.isFinite(Number(v)) ? Number(v) : f;
  const notify = (message,type='success') => { try { if(global.UI?.toast)return global.UI.toast(message,type); } catch{} console[type==='error'?'error':'log']('[ClientLifecycle]',message); };
  const currentRole = () => clean(global.Permissions?.getCurrentUserRole?.() || global.Session?.state?.role_key || global.Session?.state?.role || global.Session?.authContext?.()?.role_key).toLowerCase().replace(/[-\s]+/g,'_');
  const canWrite = () => state.permissions.update || state.permissions.manage;

  async function resolvePermissions(){
    const client=db();
    if(!client)return state.permissions;
    const role=currentRole();
    if(['admin','dev'].includes(role)){
      state.permissions={view:true,create:true,update:true,manage:true};
      return state.permissions;
    }
    const actions=['view','create','update','manage'];
    const results=await Promise.all(actions.map(async action=>{
      try{
        const {data,error}=await client.rpc('app_has_permission',{p_resource:RESOURCE,p_action:action});
        return [action,!error && data===true];
      }catch{return [action,false];}
    }));
    state.permissions=Object.fromEntries(results);
    return state.permissions;
  }

  function menuBody(){
    return document.getElementById('customerSuccessMenuGroupBody') || document.querySelector('[data-menu-group="customer-success"] .view-menu-group-body');
  }
  function contentPanels(){ return document.querySelector('.content-panels'); }

  function ensureShell(){
    const menu=menuBody(), panels=contentPanels();
    if(!menu||!panels)return false;
    let tab=document.getElementById(TAB_ID);
    if(!tab){
      tab=document.createElement('button');
      tab.id=TAB_ID;
      tab.className='view-tab';
      tab.type='button';
      tab.dataset.view='clientLifecycle';
      tab.dataset.permissionResource=RESOURCE;
      tab.dataset.permissionAction='view';
      tab.setAttribute('role','tab');
      tab.setAttribute('aria-selected','false');
      tab.setAttribute('aria-controls',VIEW_ID);
      tab.innerHTML='<span class="icon" aria-hidden="true">🧭</span> Client Lifecycle';
      const anchor=document.getElementById('clientSuccessTab');
      if(anchor?.parentNode===menu) anchor.insertAdjacentElement('afterend',tab); else menu.appendChild(tab);
      tab.addEventListener('click',openModule);
    }
    let view=document.getElementById(VIEW_ID);
    if(!view){
      view=document.createElement('section');
      view.id=VIEW_ID;
      view.className='view client-lifecycle-view';
      view.setAttribute('role','tabpanel');
      view.setAttribute('aria-labelledby',TAB_ID);
      view.innerHTML='<div class="client-lifecycle-loading">Loading Client Lifecycle…</div>';
      panels.appendChild(view);
    }
    state.mounted=true;
    return true;
  }

  function setVisibleByPermission(){
    const tab=document.getElementById(TAB_ID);
    if(tab)tab.style.display=state.permissions.view?'':'none';
    if(!state.permissions.view && state.active) deactivate();
  }

  function activateView(){
    document.querySelectorAll('.view.active').forEach(v=>v.classList.remove('active'));
    document.querySelectorAll('.view-tab.active').forEach(t=>{t.classList.remove('active');t.setAttribute('aria-selected','false');});
    const tab=document.getElementById(TAB_ID), view=document.getElementById(VIEW_ID);
    tab?.classList.add('active'); tab?.setAttribute('aria-selected','true');
    view?.classList.add('active');
    document.body?.classList.add('client-lifecycle-active');
    state.active=true;
  }

  function deactivate(){
    document.getElementById(VIEW_ID)?.classList.remove('active');
    const tab=document.getElementById(TAB_ID); tab?.classList.remove('active'); tab?.setAttribute('aria-selected','false');
    document.body?.classList.remove('client-lifecycle-active');
    closeDetail();
    state.active=false;
  }

  async function openModule(){
    if(!state.permissions.view){ notify('You do not have Client Lifecycle access.','error'); return; }
    activateView();
    await loadOverview();
  }

  function clientName(row={}){ return clean(row.client_name || row.company_name || row.name || 'Unnamed client'); }
  function profileFor(clientId){ return state.profiles.find(p=>clean(p.client_id)===clean(clientId)) || null; }
  function checklistFor(clientId){ return state.checklist.filter(r=>clean(r.client_id)===clean(clientId)); }

  function onboardingProgress(clientId){
    const rows=checklistFor(clientId).filter(r=>['handover','setup','configuration','training','go_live'].includes(r.phase) && r.required);
    if(!rows.length)return 0;
    const done=rows.filter(r=>['completed','not_applicable'].includes(r.status)).length;
    return Math.round(done*100/rows.length);
  }

  function recommendedHealth(profile={},client={}){
    let score = profile.adoption_score==null ? 78 : (44 + number(profile.adoption_score)*0.45);
    const since=daysSince(profile.last_cs_contact_at);
    if(since==null) score-=8; else if(since>30)score-=16; else if(since>14)score-=8;
    const overdue=profile.next_action_due && daysUntil(profile.next_action_due)<0;
    if(overdue)score-=14;
    const risk=clean(profile.renewal_risk);
    if(risk==='high')score-=25; else if(risk==='medium')score-=10; else if(risk==='not_renewing')score-=45; else if(risk==='confirmed')score+=8;
    const renewalDays=daysUntil(profile.renewal_due_date);
    if(renewalDays!=null && renewalDays>=0 && renewalDays<=60 && !['confirmed','renewed'].includes(profile.renewal_status))score-=10;
    const due=number(client.total_due);
    const value=number(client.total_value);
    if(value>0 && due/value>0.5)score-=8;
    return Math.max(0,Math.min(100,Math.round(score)));
  }
  function healthBand(profile={},client={}){
    if(profile.health_override)return profile.health_override;
    const score=recommendedHealth(profile,client);
    return score>=75?'healthy':score>=55?'watch':'at_risk';
  }
  function healthLabel(v){ return ({healthy:'Healthy',watch:'Watch',at_risk:'At Risk'})[v] || 'Not scored'; }
  function healthClass(v){ return v==='healthy'?'good':v==='watch'?'watch':'risk'; }

  function clientRows(){
    const q=state.search.toLowerCase();
    return state.clients.map(c=>({client:c,profile:profileFor(c.id)})).filter(({client,profile})=>{
      if(!profile)return false;
      if(q && !clientName(client).toLowerCase().includes(q) && !clean(client.client_id).toLowerCase().includes(q))return false;
      if(state.stage!=='all' && profile.stage!==state.stage)return false;
      if(state.health!=='all' && healthBand(profile,client)!==state.health)return false;
      return true;
    });
  }

  function attentionItems(){
    const items=[];
    for(const client of state.clients){
      const p=profileFor(client.id); if(!p)continue;
      const name=clientName(client), band=healthBand(p,client), score=recommendedHealth(p,client);
      const rows=checklistFor(client.id);
      const blocked=rows.filter(r=>r.status==='blocked');
      if(blocked.length)items.push({priority:1,client,name,title:`${blocked.length} blocked implementation item${blocked.length===1?'':'s'}`,detail:blocked.slice(0,2).map(x=>x.item_label).join(' · ')});
      if(p.next_action_due && daysUntil(p.next_action_due)<0)items.push({priority:1,client,name,title:'CS next action overdue',detail:`${clean(p.next_action)||'Follow-up'} · due ${fmtDate(p.next_action_due)}`});
      if(band==='at_risk')items.push({priority:1,client,name,title:`Health at risk · ${score}/100`,detail:p.health_override_reason||'Review adoption, engagement and renewal risk.'});
      const rd=daysUntil(p.renewal_due_date);
      if(rd!=null && rd>=0 && rd<=90 && !['confirmed','renewed'].includes(p.renewal_status))items.push({priority:2,client,name,title:`Renewal in ${rd} day${rd===1?'':'s'}`,detail:`Status: ${clean(p.renewal_status).replace(/_/g,' ')}`});
      const contactAge=daysSince(p.last_cs_contact_at);
      if(contactAge!=null && contactAge>30)items.push({priority:3,client,name,title:`No recorded CS activity for ${contactAge} days`,detail:'Review customer engagement cadence.'});
    }
    return items.sort((a,b)=>a.priority-b.priority).slice(0,10);
  }

  function renderOverview(){
    const host=document.getElementById(VIEW_ID); if(!host)return;
    const rows=clientRows();
    const implementations=state.profiles.filter(p=>!['active_success','renewal'].includes(p.stage)).length;
    const active=state.profiles.filter(p=>p.stage==='active_success').length;
    const renewals=state.profiles.filter(p=>{const d=daysUntil(p.renewal_due_date);return d!=null&&d>=0&&d<=120;}).length;
    const atRisk=state.clients.filter(c=>{const p=profileFor(c.id);return p&&healthBand(p,c)==='at_risk';}).length;
    const attention=attentionItems();
    host.innerHTML=`
      <div class="cl-page">
        <header class="cl-header">
          <div><div class="cl-eyebrow">Internal post-sales operations</div><h1>Client Lifecycle</h1><p>Manage the internal journey from signed sale through implementation, success and renewal. Customers do not access this ERP workspace.</p></div>
          <button class="btn ghost" type="button" data-cl-refresh>Refresh</button>
        </header>
        <div class="cl-flow">${STAGES.map((s,i)=>`<div class="cl-flow-step"><span>${i+1}</span><strong>${esc(STAGE_LABELS[s])}</strong></div>`).join('')}</div>
        <div class="cl-kpis">
          <div class="cl-kpi"><span>Implementation</span><strong>${implementations}</strong><small>Handover → Go-Live / Adoption</small></div>
          <div class="cl-kpi"><span>Active Success</span><strong>${active}</strong><small>Live customer relationships</small></div>
          <div class="cl-kpi"><span>Renewals ≤120d</span><strong>${renewals}</strong><small>Need forward planning</small></div>
          <div class="cl-kpi"><span>At Risk</span><strong>${atRisk}</strong><small>Requires CS attention</small></div>
        </div>
        <section class="cl-attention">
          <div class="cl-section-head"><div><h2>Needs Attention</h2><p>Prioritized from implementation blockers, overdue CS actions, health and renewal timing.</p></div></div>
          ${attention.length?`<div class="cl-attention-list">${attention.map(item=>`<button type="button" class="cl-attention-item p${item.priority}" data-cl-open="${esc(item.client.id)}"><span></span><div><strong>${esc(item.name)} — ${esc(item.title)}</strong><small>${esc(item.detail)}</small></div></button>`).join('')}</div>`:'<div class="cl-empty">No urgent lifecycle items right now.</div>'}
        </section>
        <section class="cl-clients">
          <div class="cl-section-head cl-section-head-row"><div><h2>Clients</h2><p>${rows.length} of ${state.clients.length} clients</p></div>
            <div class="cl-filters"><input type="search" data-cl-search placeholder="Search clients…" value="${esc(state.search)}"><select data-cl-stage><option value="all">All stages</option>${STAGES.map(s=>`<option value="${s}" ${state.stage===s?'selected':''}>${esc(STAGE_LABELS[s])}</option>`).join('')}</select><select data-cl-health><option value="all">All health</option><option value="healthy" ${state.health==='healthy'?'selected':''}>Healthy</option><option value="watch" ${state.health==='watch'?'selected':''}>Watch</option><option value="at_risk" ${state.health==='at_risk'?'selected':''}>At Risk</option></select></div>
          </div>
          <div class="cl-table-wrap"><table class="cl-table"><thead><tr><th>Client</th><th>Stage</th><th>Implementation</th><th>Adoption</th><th>Health</th><th>Next action</th><th>Renewal</th><th></th></tr></thead><tbody>
            ${rows.map(({client,profile})=>{
              const band=healthBand(profile,client), score=recommendedHealth(profile,client), progress=onboardingProgress(client.id), rd=daysUntil(profile.renewal_due_date);
              return `<tr><td><strong>${esc(clientName(client))}</strong><small>${esc(client.client_id||'')}</small></td><td><span class="cl-stage-chip">${esc(STAGE_LABELS[profile.stage]||profile.stage)}</span></td><td><div class="cl-progress"><span style="width:${progress}%"></span></div><small>${progress}%</small></td><td>${profile.adoption_score==null?'<span class="cl-muted">Not scored</span>':`<strong>${Math.round(number(profile.adoption_score))}%</strong>`}</td><td><span class="cl-health ${healthClass(band)}">${esc(healthLabel(band))} · ${score}</span>${profile.health_override?'<small>CS override</small>':''}</td><td>${profile.next_action?`<strong>${esc(profile.next_action)}</strong><small>${profile.next_action_due?fmtDate(profile.next_action_due):'No due date'}</small>`:'<span class="cl-muted">Not set</span>'}</td><td>${profile.renewal_due_date?`<strong>${fmtDate(profile.renewal_due_date)}</strong><small>${rd==null?'':rd<0?`${Math.abs(rd)}d overdue`:`${rd}d`}</small>`:'<span class="cl-muted">No date</span>'}</td><td><button class="btn ghost sm" type="button" data-cl-open="${esc(client.id)}">Open</button></td></tr>`;
            }).join('') || '<tr><td colspan="8" class="cl-empty">No clients match these filters.</td></tr>'}
          </tbody></table></div>
        </section>
      </div><div id="clientLifecycleDrawer" class="cl-drawer-root" hidden></div>`;
    bindOverview(host);
  }

  function bindOverview(host){
    host.querySelector('[data-cl-refresh]')?.addEventListener('click',()=>loadOverview(true));
    host.querySelector('[data-cl-search]')?.addEventListener('input',e=>{state.search=e.target.value;renderOverview(); requestAnimationFrame(()=>{const x=document.querySelector('[data-cl-search]'); if(x){x.focus();x.setSelectionRange(state.search.length,state.search.length);}});});
    host.querySelector('[data-cl-stage]')?.addEventListener('change',e=>{state.stage=e.target.value;renderOverview();});
    host.querySelector('[data-cl-health]')?.addEventListener('change',e=>{state.health=e.target.value;renderOverview();});
    host.querySelectorAll('[data-cl-open]').forEach(b=>b.addEventListener('click',()=>openDetail(b.dataset.clOpen)));
  }

  async function loadOverview(force=false){
    if(state.loading)return;
    const client=db(); if(!client)return;
    state.loading=true;
    const host=document.getElementById(VIEW_ID); if(host && (force||!state.clients.length))host.innerHTML='<div class="client-lifecycle-loading">Loading Client Lifecycle…</div>';
    try{
      const [clientsRes,profilesRes,checkRes,usersRes]=await Promise.all([
        client.from('clients').select('id,client_id,client_name,company_name,status,source_agreement_id,total_locations,total_value,total_paid,total_due,primary_email,primary_phone,billing_frequency,payment_term,created_at,updated_at').order('client_name',{ascending:true}),
        client.from('client_lifecycle_profiles').select('*').order('updated_at',{ascending:false}),
        client.from('client_lifecycle_checklist').select('*').order('sort_order',{ascending:true}),
        client.from('profiles').select('id,name,full_name,email,role_key,department,job_title,is_active').eq('is_active',true).order('full_name',{ascending:true})
      ]);
      for(const res of [clientsRes,profilesRes,checkRes])if(res.error)throw res.error;
      state.clients=clientsRes.data||[]; state.profiles=profilesRes.data||[]; state.checklist=checkRes.data||[]; state.users=usersRes.error?[]:(usersRes.data||[]);
      renderOverview();
    }catch(err){
      console.error('[ClientLifecycle] overview load failed',err);
      if(host)host.innerHTML=`<div class="cl-error"><strong>Unable to load Client Lifecycle.</strong><span>${esc(err.message||err)}</span><button class="btn ghost" data-cl-retry>Retry</button></div>`;
      host?.querySelector('[data-cl-retry]')?.addEventListener('click',()=>loadOverview(true));
    }finally{state.loading=false;}
  }

  async function loadDetailData(clientId){
    const client=db(), p=profileFor(clientId), c=state.clients.find(x=>clean(x.id)===clean(clientId));
    if(!client||!p||!c)throw new Error('Client lifecycle record not found.');
    const agreementId=clean(p.source_agreement_id || c.source_agreement_id);
    const queries=[
      agreementId?client.from('agreements').select('id,agreement_number,agreement_id,status,service_start_date,service_end_date,billing_frequency,payment_term,grand_total,currency,company_name,customer_name,customer_legal_name,customer_contact_name,customer_contact_email,customer_contact_phone,signed_date,customer_sign_date').eq('id',agreementId).maybeSingle():Promise.resolve({data:null,error:null}),
      client.from('invoices').select('id,invoice_number,issue_date,due_date,invoice_total,grand_total,total_amount,balance_due,payment_status,payment_state,status,currency,agreement_uuid,client_id').eq('client_id',clientId).order('issue_date',{ascending:false}).limit(20),
      client.from('renewals').select('*').eq('client_id',clientId).order('renewal_date',{ascending:false}).limit(20),
      client.from('csm_activities').select('id,activity_id,csm_name,type_of_support,effort_requirement,support_channel,notes,notes_optional,created_at,location_name').eq('client_id',clientId).order('created_at',{ascending:false}).limit(30),
      client.from('client_success_plans').select('*').eq('client_id',clientId).order('created_at',{ascending:false}),
      client.from('client_training_sessions').select('*').eq('client_id',clientId).order('training_date',{ascending:false}),
      client.from('client_lifecycle_events').select('*').eq('client_id',clientId).order('event_at',{ascending:false}).limit(60)
    ];
    const [agreement,invoices,renewals,activities,plans,trainings,events]=await Promise.all(queries);
    state.detail={agreement:agreement.data||null,invoices:invoices.data||[],renewals:renewals.data||[],csmActivities:activities.data||[],plans:plans.data||[],trainings:trainings.data||[],events:events.data||[]};
  }

  function userOptions(selected=''){
    return `<option value="">Unassigned</option>${state.users.map(u=>{const name=clean(u.full_name||u.name||u.email);return `<option value="${esc(u.id)}" data-name="${esc(name)}" ${clean(selected)===clean(u.id)?'selected':''}>${esc(name)} · ${esc(clean(u.role_key).replace(/_/g,' '))}</option>`;}).join('')}`;
  }

  function phaseProgress(clientId,phase){
    const rows=checklistFor(clientId).filter(r=>r.phase===phase && r.required);
    if(!rows.length)return {done:0,total:0,pct:100};
    const done=rows.filter(r=>['completed','not_applicable'].includes(r.status)).length;
    return {done,total:rows.length,pct:Math.round(done*100/rows.length)};
  }

  function renderChecklist(clientId){
    const rows=checklistFor(clientId);
    return Object.keys(PHASE_LABELS).map(phase=>{
      const phaseRows=rows.filter(r=>r.phase===phase); if(!phaseRows.length)return '';
      const progress=phaseProgress(clientId,phase);
      return `<section class="cl-detail-card cl-check-phase"><div class="cl-card-head"><div><h3>${esc(PHASE_LABELS[phase])}</h3><small>${progress.done}/${progress.total} mandatory complete</small></div><span>${progress.pct}%</span></div><div class="cl-check-list">${phaseRows.map(r=>`<div class="cl-check-row ${r.status==='blocked'?'blocked':''}"><div><strong>${esc(r.item_label)}${r.required?' <em>Required</em>':' <em class="optional">Optional</em>'}</strong><small>${esc(r.notes||'')}</small></div><select data-cl-check-status="${esc(r.id)}" ${canWrite()?'':'disabled'}><option value="not_started" ${r.status==='not_started'?'selected':''}>Not Started</option><option value="in_progress" ${r.status==='in_progress'?'selected':''}>In Progress</option><option value="blocked" ${r.status==='blocked'?'selected':''}>Blocked</option><option value="completed" ${r.status==='completed'?'selected':''}>Completed</option><option value="not_applicable" ${r.status==='not_applicable'?'selected':''}>Not Applicable</option></select><button type="button" class="btn ghost sm" data-cl-check-note="${esc(r.id)}" ${canWrite()?'':'disabled'}>Note</button></div>`).join('')}</div></section>`;
    }).join('');
  }

  function timelineRows(clientId){
    const rows=[];
    const a=state.detail.agreement;
    if(a)rows.push({at:a.signed_date||a.customer_sign_date||a.service_start_date,type:'Agreement',title:`Agreement ${a.agreement_number||a.agreement_id||''}`,detail:`${a.status||''} · service ${fmtDate(a.service_start_date)} → ${fmtDate(a.service_end_date)}`});
    state.detail.invoices.forEach(x=>rows.push({at:x.issue_date,type:'Invoice',title:x.invoice_number||'Invoice',detail:`${x.payment_status||x.payment_state||x.status||''} · ${x.currency||''} ${number(x.invoice_total||x.grand_total||x.total_amount).toLocaleString()}`}));
    state.detail.renewals.forEach(x=>rows.push({at:x.renewal_date||x.service_end_date,type:'Renewal',title:`${x.location_name||'Renewal'} · ${x.status||''}`,detail:`Service end ${fmtDate(x.service_end_date)}`}));
    state.detail.csmActivities.forEach(x=>rows.push({at:x.created_at,type:'CS Activity',title:x.type_of_support||'CS activity',detail:[x.csm_name,x.support_channel,x.location_name,x.notes||x.notes_optional].filter(Boolean).join(' · ')}));
    state.detail.trainings.forEach(x=>rows.push({at:x.training_date,type:'Training',title:`${clean(x.training_type).replace(/_/g,' ')} training · ${x.status}`,detail:[x.trainer_name,x.attendees].filter(Boolean).join(' · ')}));
    state.detail.events.forEach(x=>rows.push({at:x.event_at,type:'Lifecycle',title:x.title,detail:x.detail||''}));
    return rows.filter(x=>x.at).sort((a,b)=>new Date(b.at)-new Date(a.at)).slice(0,80);
  }

  function renderDetail(clientId){
    const c=state.clients.find(x=>clean(x.id)===clean(clientId)), p=profileFor(clientId); if(!c||!p)return;
    const root=document.getElementById('clientLifecycleDrawer'); if(!root)return;
    const band=healthBand(p,c), score=recommendedHealth(p,c), progress=onboardingProgress(clientId), agreement=state.detail.agreement, timeline=timelineRows(clientId);
    root.hidden=false;
    root.innerHTML=`<div class="cl-drawer-backdrop" data-cl-close></div><aside class="cl-drawer" role="dialog" aria-modal="true" aria-label="${esc(clientName(c))} lifecycle">
      <header class="cl-drawer-header"><div><span>Client Lifecycle</span><h2>${esc(clientName(c))}</h2><p>${esc(c.client_id||'')} · ${esc(STAGE_LABELS[p.stage]||p.stage)} · ${progress}% implementation</p></div><button class="cl-close" type="button" data-cl-close>×</button></header>
      <div class="cl-drawer-body">
        <div class="cl-stage-rail">${STAGES.map((s,i)=>`<button type="button" data-cl-stage-step="${s}" class="${p.stage===s?'current':''} ${STAGES.indexOf(p.stage)>i?'done':''}" ${canWrite()?'':'disabled'}><span>${i+1}</span><small>${esc(STAGE_LABELS[s])}</small></button>`).join('')}</div>
        <div class="cl-detail-kpis"><div><span>Health</span><strong class="cl-health ${healthClass(band)}">${esc(healthLabel(band))} · ${score}</strong></div><div><span>Adoption</span><strong>${p.adoption_score==null?'Not scored':`${Math.round(number(p.adoption_score))}%`}</strong></div><div><span>Go-Live</span><strong>${fmtDate(p.go_live_date||p.target_go_live_date)}</strong></div><div><span>Renewal</span><strong>${fmtDate(p.renewal_due_date)}</strong></div></div>
        <nav class="cl-detail-tabs"><button class="active" data-cl-detail-tab="control">Control</button><button data-cl-detail-tab="implementation">Implementation</button><button data-cl-detail-tab="success">Success Plan</button><button data-cl-detail-tab="training">Training</button><button data-cl-detail-tab="renewal">Renewal</button><button data-cl-detail-tab="timeline">Timeline</button></nav>
        <div data-cl-detail-panel="control" class="cl-detail-panel active">
          <section class="cl-detail-card"><div class="cl-card-head"><div><h3>Internal Lifecycle Control</h3><small>Internal ownership, health, adoption and next action.</small></div></div>
            <div class="cl-form-grid">
              <label><span>Current Stage</span><select data-cl-field="stage" ${canWrite()?'':'disabled'}>${STAGES.map(s=>`<option value="${s}" ${p.stage===s?'selected':''}>${esc(STAGE_LABELS[s])}</option>`).join('')}</select></label>
              <label><span>CSM</span><select data-cl-field="csm_user_id" ${canWrite()?'':'disabled'}>${userOptions(p.csm_user_id)}</select></label>
              <label><span>Implementation Owner</span><select data-cl-field="implementation_owner_id" ${canWrite()?'':'disabled'}>${userOptions(p.implementation_owner_id)}</select></label>
              <label><span>Target Go-Live</span><input type="date" data-cl-field="target_go_live_date" value="${iso(p.target_go_live_date)}" ${canWrite()?'':'disabled'}></label>
              <label><span>Adoption Score</span><input type="number" min="0" max="100" step="1" data-cl-field="adoption_score" value="${p.adoption_score==null?'':esc(p.adoption_score)}" placeholder="0–100" ${canWrite()?'':'disabled'}></label>
              <label><span>Health Override</span><select data-cl-field="health_override" ${canWrite()?'':'disabled'}><option value="" ${!p.health_override?'selected':''}>Use system score</option><option value="healthy" ${p.health_override==='healthy'?'selected':''}>Healthy</option><option value="watch" ${p.health_override==='watch'?'selected':''}>Watch</option><option value="at_risk" ${p.health_override==='at_risk'?'selected':''}>At Risk</option></select></label>
              <label class="wide"><span>Override Reason <em>Required when overriding</em></span><input data-cl-field="health_override_reason" value="${esc(p.health_override_reason||'')}" ${canWrite()?'':'disabled'}></label>
              <label class="wide"><span>Next Internal Action</span><input data-cl-field="next_action" value="${esc(p.next_action||'')}" placeholder="e.g. Schedule adoption review" ${canWrite()?'':'disabled'}></label>
              <label><span>Next Action Due</span><input type="date" data-cl-field="next_action_due" value="${iso(p.next_action_due)}" ${canWrite()?'':'disabled'}></label>
              <label><span>Last CS Contact</span><input type="date" data-cl-field="last_cs_contact_at" value="${iso(p.last_cs_contact_at)}" ${canWrite()?'':'disabled'}></label>
              <label class="wide"><span>Internal Notes</span><textarea data-cl-field="notes" rows="3" ${canWrite()?'':'disabled'}>${esc(p.notes||'')}</textarea></label>
            </div>
            <div class="cl-actions"><button type="button" class="btn primary" data-cl-save-profile ${canWrite()?'':'disabled'}>Save Lifecycle</button>${!['adoption','active_success','renewal'].includes(p.stage)?`<button type="button" class="btn ghost" data-cl-go-live ${canWrite()?'':'disabled'}>Confirm Go-Live</button>`:''}</div>
          </section>
          <section class="cl-detail-card"><div class="cl-card-head"><div><h3>Commercial Handover Snapshot</h3><small>Read from existing ERP records — no duplicate commercial data.</small></div></div><div class="cl-snapshot">
            <div><span>Agreement</span><strong>${esc(agreement?.agreement_number||agreement?.agreement_id||'—')}</strong></div><div><span>Agreement Status</span><strong>${esc(agreement?.status||'—')}</strong></div><div><span>Locations</span><strong>${esc(c.total_locations??'—')}</strong></div><div><span>Billing</span><strong>${esc(agreement?.billing_frequency||c.billing_frequency||'—')}</strong></div><div><span>Service Start</span><strong>${fmtDate(agreement?.service_start_date)}</strong></div><div><span>Service End</span><strong>${fmtDate(agreement?.service_end_date||p.renewal_due_date)}</strong></div><div><span>Primary Contact</span><strong>${esc(agreement?.customer_contact_name||'—')}</strong></div><div><span>Commercial Value</span><strong>${agreement?.grand_total!=null?`${esc(agreement.currency||'USD')} ${number(agreement.grand_total).toLocaleString()}`:'—'}</strong></div>
          </div></section>
        </div>
        <div data-cl-detail-panel="implementation" class="cl-detail-panel">${renderChecklist(clientId)}</div>
        <div data-cl-detail-panel="success" class="cl-detail-panel">${renderSuccessPanel(c,p)}</div>
        <div data-cl-detail-panel="training" class="cl-detail-panel">${renderTrainingPanel(c,p)}</div>
        <div data-cl-detail-panel="renewal" class="cl-detail-panel">${renderRenewalPanel(c,p)}</div>
        <div data-cl-detail-panel="timeline" class="cl-detail-panel"><section class="cl-detail-card"><div class="cl-card-head"><div><h3>Customer Timeline</h3><small>Internal chronology from Agreements, Invoices, CSM Activity, Training, Renewals and Lifecycle changes.</small></div></div><div class="cl-timeline">${timeline.length?timeline.map(x=>`<div class="cl-time-row"><span></span><div><small>${fmtDate(x.at)} · ${esc(x.type)}</small><strong>${esc(x.title)}</strong><p>${esc(x.detail)}</p></div></div>`).join(''):'<div class="cl-empty">No lifecycle history yet.</div>'}</div></section></div>
      </div></aside>`;
    bindDetail(root,c,p);
  }

  function renderSuccessPanel(c,p){
    const plans=state.detail.plans;
    return `<section class="cl-detail-card"><div class="cl-card-head"><div><h3>Success Plan</h3><small>Internal objectives that define whether the customer is achieving the reason they bought InCheck 360.</small></div></div>
      ${canWrite()?`<form class="cl-inline-form" data-cl-plan-form><input name="objective" required placeholder="Success objective *"><input name="metric" placeholder="Metric"><input name="target" placeholder="Target"><input name="current" placeholder="Current"><input name="due" type="date"><button class="btn primary sm">Add Objective</button></form>`:''}
      <div class="cl-plan-list">${plans.length?plans.map(x=>`<div class="cl-plan"><div><strong>${esc(x.objective)}</strong><small>${[x.metric&&`Metric: ${x.metric}`,x.target_value&&`Target: ${x.target_value}`,x.current_value&&`Current: ${x.current_value}`,x.due_date&&`Due: ${fmtDate(x.due_date)}`].filter(Boolean).join(' · ')}</small></div><select data-cl-plan-status="${esc(x.id)}" ${canWrite()?'':'disabled'}><option value="open" ${x.status==='open'?'selected':''}>Open</option><option value="on_track" ${x.status==='on_track'?'selected':''}>On Track</option><option value="at_risk" ${x.status==='at_risk'?'selected':''}>At Risk</option><option value="completed" ${x.status==='completed'?'selected':''}>Completed</option><option value="cancelled" ${x.status==='cancelled'?'selected':''}>Cancelled</option></select></div>`).join(''):'<div class="cl-empty">No success objectives yet.</div>'}</div>
    </section>`;
  }

  function renderTrainingPanel(c,p){
    const rows=state.detail.trainings;
    return `<section class="cl-detail-card"><div class="cl-card-head"><div><h3>Training</h3><small>Internal record of customer enablement. The customer does not access this ERP.</small></div></div>
      ${canWrite()?`<form class="cl-inline-form cl-training-form" data-cl-training-form><select name="type"><option value="admin">Admin</option><option value="end_user">End User</option><option value="operational">Operational</option><option value="refresher">Refresher</option><option value="other">Other</option></select><input name="date" type="date" required value="${iso(new Date().toISOString())}"><input name="attendees" placeholder="Attendees / team"><input name="count" type="number" min="0" placeholder="#"><select name="status"><option value="planned">Planned</option><option value="completed">Completed</option><option value="reschedule_required">Reschedule Required</option><option value="cancelled">Cancelled</option></select><button class="btn primary sm">Add Training</button></form>`:''}
      <div class="cl-plan-list">${rows.length?rows.map(x=>`<div class="cl-plan"><div><strong>${esc(clean(x.training_type).replace(/_/g,' '))} · ${fmtDate(x.training_date)}</strong><small>${[x.trainer_name,x.attendees,x.attendee_count!=null?`${x.attendee_count} attendees`:'',x.material_sent?'Material sent':''].filter(Boolean).join(' · ')}</small></div><select data-cl-training-status="${esc(x.id)}" ${canWrite()?'':'disabled'}><option value="planned" ${x.status==='planned'?'selected':''}>Planned</option><option value="completed" ${x.status==='completed'?'selected':''}>Completed</option><option value="reschedule_required" ${x.status==='reschedule_required'?'selected':''}>Reschedule Required</option><option value="cancelled" ${x.status==='cancelled'?'selected':''}>Cancelled</option></select></div>`).join(''):'<div class="cl-empty">No training sessions recorded yet.</div>'}</div>
    </section>`;
  }

  function renderRenewalPanel(c,p){
    const rd=daysUntil(p.renewal_due_date), rows=state.detail.renewals;
    return `<section class="cl-detail-card"><div class="cl-card-head"><div><h3>Renewal Readiness</h3><small>Plan before the expiry date instead of waiting for the final month.</small></div><strong>${rd==null?'No renewal date':rd<0?`${Math.abs(rd)} days overdue`:`${rd} days remaining`}</strong></div>
      <div class="cl-form-grid"><label><span>Renewal Due</span><input data-cl-renewal-field="renewal_due_date" type="date" value="${iso(p.renewal_due_date)}" ${canWrite()?'':'disabled'}></label><label><span>Renewal Status</span><select data-cl-renewal-field="renewal_status" ${canWrite()?'':'disabled'}><option value="not_started" ${p.renewal_status==='not_started'?'selected':''}>Not Started</option><option value="planning" ${p.renewal_status==='planning'?'selected':''}>Planning (120d)</option><option value="review" ${p.renewal_status==='review'?'selected':''}>Health Review (90d)</option><option value="commercial_confirmation" ${p.renewal_status==='commercial_confirmation'?'selected':''}>Commercial Confirmation (60d)</option><option value="confirmed" ${p.renewal_status==='confirmed'?'selected':''}>Confirmed</option><option value="not_renewing" ${p.renewal_status==='not_renewing'?'selected':''}>Not Renewing</option><option value="renewed" ${p.renewal_status==='renewed'?'selected':''}>Renewed</option></select></label><label><span>Renewal Risk</span><select data-cl-renewal-field="renewal_risk" ${canWrite()?'':'disabled'}><option value="unknown" ${p.renewal_risk==='unknown'?'selected':''}>Unknown</option><option value="low" ${p.renewal_risk==='low'?'selected':''}>Low</option><option value="medium" ${p.renewal_risk==='medium'?'selected':''}>Medium</option><option value="high" ${p.renewal_risk==='high'?'selected':''}>High</option><option value="confirmed" ${p.renewal_risk==='confirmed'?'selected':''}>Confirmed</option><option value="not_renewing" ${p.renewal_risk==='not_renewing'?'selected':''}>Not Renewing</option></select></label></div>${canWrite()?'<div class="cl-actions"><button class="btn primary" type="button" data-cl-save-renewal>Save Renewal Readiness</button></div>':''}
      <div class="cl-subsection"><h4>Existing ERP Renewal Records</h4>${rows.length?`<div class="cl-mini-table">${rows.map(x=>`<div><strong>${esc(x.location_name||'Client renewal')}</strong><span>${fmtDate(x.renewal_date||x.service_end_date)} · ${esc(x.status||'')}</span></div>`).join('')}</div>`:'<div class="cl-empty">No renewal records linked yet.</div>'}</div>
    </section>`;
  }

  function bindDetail(root,c,p){
    root.querySelectorAll('[data-cl-close]').forEach(x=>x.addEventListener('click',closeDetail));
    root.querySelectorAll('[data-cl-detail-tab]').forEach(btn=>btn.addEventListener('click',()=>{
      root.querySelectorAll('[data-cl-detail-tab]').forEach(x=>x.classList.toggle('active',x===btn));
      root.querySelectorAll('[data-cl-detail-panel]').forEach(x=>x.classList.toggle('active',x.dataset.clDetailPanel===btn.dataset.clDetailTab));
    }));
    root.querySelectorAll('[data-cl-stage-step]').forEach(btn=>btn.addEventListener('click',()=>updateProfile(p.id,{stage:btn.dataset.clStageStep},c.id)));
    root.querySelector('[data-cl-save-profile]')?.addEventListener('click',()=>saveProfileForm(root,c,p));
    root.querySelector('[data-cl-go-live]')?.addEventListener('click',()=>confirmGoLive(c,p));
    root.querySelectorAll('[data-cl-check-status]').forEach(sel=>sel.addEventListener('change',()=>updateChecklist(sel.dataset.clCheckStatus,{status:sel.value},c.id)));
    root.querySelectorAll('[data-cl-check-note]').forEach(btn=>btn.addEventListener('click',()=>editChecklistNote(btn.dataset.clCheckNote,c.id)));
    root.querySelector('[data-cl-plan-form]')?.addEventListener('submit',e=>addPlan(e,c,p));
    root.querySelectorAll('[data-cl-plan-status]').forEach(sel=>sel.addEventListener('change',()=>updateChild('client_success_plans',sel.dataset.clPlanStatus,{status:sel.value},c.id)));
    root.querySelector('[data-cl-training-form]')?.addEventListener('submit',e=>addTraining(e,c,p));
    root.querySelectorAll('[data-cl-training-status]').forEach(sel=>sel.addEventListener('change',()=>updateChild('client_training_sessions',sel.dataset.clTrainingStatus,{status:sel.value},c.id)));
    root.querySelector('[data-cl-save-renewal]')?.addEventListener('click',()=>saveRenewalForm(root,c,p));
  }

  async function openDetail(clientId){
    state.selectedClientId=clientId;
    let root=document.getElementById('clientLifecycleDrawer');
    if(!root){renderOverview();root=document.getElementById('clientLifecycleDrawer');}
    if(root){root.hidden=false;root.innerHTML='<div class="cl-drawer-backdrop" data-cl-close></div><aside class="cl-drawer"><div class="client-lifecycle-loading">Loading client lifecycle…</div></aside>';root.querySelector('[data-cl-close]')?.addEventListener('click',closeDetail);}
    try{await loadDetailData(clientId);renderDetail(clientId);document.body?.classList.add('cl-drawer-open');}catch(err){console.error(err);notify(err.message||'Unable to open client lifecycle.','error');closeDetail();}
  }
  function closeDetail(){const root=document.getElementById('clientLifecycleDrawer');if(root){root.hidden=true;root.innerHTML='';}document.body?.classList.remove('cl-drawer-open');state.selectedClientId='';}

  async function updateProfile(id,patch,clientId,quiet=false){
    if(!canWrite())return notify('You have view-only access.','error');
    const client=db(); if(!client)return;
    const {data,error}=await client.from('client_lifecycle_profiles').update(patch).eq('id',id).select('*').single();
    if(error){notify(error.message,'error');return;}
    state.profiles=state.profiles.map(x=>x.id===id?data:x);
    if(!quiet)notify('Lifecycle updated.');
    if(clientId){await loadDetailData(clientId);renderDetail(clientId);}else renderOverview();
  }

  async function saveProfileForm(root,c,p){
    const get=name=>root.querySelector(`[data-cl-field="${name}"]`);
    const healthOverride=clean(get('health_override')?.value), reason=clean(get('health_override_reason')?.value);
    if(healthOverride && !reason)return notify('Health override reason is required when overriding the system health.','error');
    const csm=get('csm_user_id'), impl=get('implementation_owner_id');
    const adoptionRaw=clean(get('adoption_score')?.value); const adoption=adoptionRaw===''?null:Number(adoptionRaw);
    if(adoption!=null && (adoption<0||adoption>100))return notify('Adoption score must be between 0 and 100.','error');
    const csmUser=state.users.find(u=>u.id===csm?.value), implUser=state.users.find(u=>u.id===impl?.value);
    const patch={
      stage:get('stage')?.value || p.stage,
      csm_user_id:csm?.value||null,csm_name:csmUser?clean(csmUser.full_name||csmUser.name||csmUser.email):null,
      implementation_owner_id:impl?.value||null,implementation_owner_name:implUser?clean(implUser.full_name||implUser.name||implUser.email):null,
      target_go_live_date:get('target_go_live_date')?.value||null, adoption_score:adoption,
      health_override:healthOverride||null,health_override_reason:reason||null,
      next_action:clean(get('next_action')?.value)||null,next_action_due:get('next_action_due')?.value||null,
      last_cs_contact_at:get('last_cs_contact_at')?.value?`${get('last_cs_contact_at').value}T12:00:00Z`:null,
      notes:clean(get('notes')?.value)||null
    };
    patch.health_score=recommendedHealth({...p,...patch},c);
    await updateProfile(p.id,patch,c.id);
  }

  async function updateChecklist(id,patch,clientId){
    if(!canWrite())return;
    const client=db(); const {data,error}=await client.from('client_lifecycle_checklist').update(patch).eq('id',id).select('*').single();
    if(error)return notify(error.message,'error');
    state.checklist=state.checklist.map(x=>x.id===id?data:x);
    await loadDetailData(clientId);renderDetail(clientId);renderOverview();
  }
  async function editChecklistNote(id,clientId){
    const row=state.checklist.find(x=>x.id===id); if(!row)return;
    const value=global.prompt('Internal note for this item:',row.notes||''); if(value===null)return;
    await updateChecklist(id,{notes:clean(value)||null},clientId);
  }

  async function confirmGoLive(c,p){
    const required=checklistFor(c.id).filter(r=>['handover','setup','configuration','training','go_live'].includes(r.phase)&&r.required);
    const missing=required.filter(r=>!['completed','not_applicable'].includes(r.status));
    if(missing.length){
      notify(`Go-Live blocked: ${missing.length} mandatory item${missing.length===1?' is':'s are'} incomplete. First: ${missing[0].item_label}`,'error');
      const root=document.getElementById('clientLifecycleDrawer');root?.querySelector('[data-cl-detail-tab="implementation"]')?.click();
      return;
    }
    const date=global.prompt('Confirm actual go-live date (YYYY-MM-DD):',iso(p.go_live_date)||iso(new Date().toISOString()));
    if(date===null)return; if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return notify('Enter a valid go-live date in YYYY-MM-DD format.','error');
    await updateProfile(p.id,{go_live_date:date,stage:'adoption',health_score:recommendedHealth({...p,go_live_date:date,stage:'adoption'},c)},c.id);
    notify('Go-Live confirmed. Client moved to Adoption.');
  }

  async function addPlan(event,c,p){
    event.preventDefault(); if(!canWrite())return;
    const f=event.currentTarget, objective=clean(f.elements.objective?.value); if(!objective)return;
    const owner=state.users.find(u=>u.id===p.csm_user_id);
    const payload={lifecycle_id:p.id,client_id:c.id,objective,metric:clean(f.elements.metric?.value)||null,target_value:clean(f.elements.target?.value)||null,current_value:clean(f.elements.current?.value)||null,due_date:f.elements.due?.value||null,owner_user_id:p.csm_user_id||null,owner_name:owner?clean(owner.full_name||owner.name||owner.email):p.csm_name||null};
    const {error}=await db().from('client_success_plans').insert(payload); if(error)return notify(error.message,'error');
    notify('Success objective added.');await openDetail(c.id);
  }
  async function addTraining(event,c,p){
    event.preventDefault(); if(!canWrite())return;
    const f=event.currentTarget, trainer=state.users.find(u=>u.id===p.csm_user_id);
    const payload={lifecycle_id:p.id,client_id:c.id,training_type:f.elements.type?.value||'admin',training_date:f.elements.date?.value,status:f.elements.status?.value||'planned',attendees:clean(f.elements.attendees?.value)||null,attendee_count:clean(f.elements.count?.value)===''?null:Number(f.elements.count.value),trainer_user_id:p.csm_user_id||null,trainer_name:trainer?clean(trainer.full_name||trainer.name||trainer.email):p.csm_name||null};
    const {error}=await db().from('client_training_sessions').insert(payload); if(error)return notify(error.message,'error');
    notify('Training session added.');await openDetail(c.id);
  }
  async function updateChild(table,id,patch,clientId){
    if(!canWrite())return;
    const {error}=await db().from(table).update(patch).eq('id',id); if(error)return notify(error.message,'error');
    await openDetail(clientId);
  }
  async function saveRenewalForm(root,c,p){
    const get=n=>root.querySelector(`[data-cl-renewal-field="${n}"]`);
    const patch={renewal_due_date:get('renewal_due_date')?.value||null,renewal_status:get('renewal_status')?.value||'not_started',renewal_risk:get('renewal_risk')?.value||'unknown'};
    if(['planning','review','commercial_confirmation'].includes(patch.renewal_status) && p.stage==='active_success')patch.stage='renewal';
    patch.health_score=recommendedHealth({...p,...patch},c);
    await updateProfile(p.id,patch,c.id);
  }

  function installNavigationIsolation(){
    document.addEventListener('click',event=>{
      const tab=event.target?.closest?.('.view-tab');
      if(!tab||tab.id===TAB_ID)return;
      if(state.active)deactivate();
    },true);
    if(typeof MutationObserver!=='undefined'){
      const observer=new MutationObserver(()=>{
        if(!state.active)return;
        const own=document.getElementById(TAB_ID), view=document.getElementById(VIEW_ID);
        const other=Array.from(document.querySelectorAll('.view-tab.active')).find(x=>x!==own);
        if(other){deactivate();return;}
        if(view && !view.classList.contains('active'))view.classList.add('active');
      });
      observer.observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['class']});
    }
  }

  async function boot(){
    if(document.body?.classList.contains('auth-locked')){
      const wait=new MutationObserver(()=>{if(!document.body?.classList.contains('auth-locked')){wait.disconnect();boot();}});wait.observe(document.body,{attributes:true,attributeFilter:['class']});return;
    }
    if(!ensureShell())return setTimeout(boot,500);
    await resolvePermissions();setVisibleByPermission();installNavigationIsolation();
    global.Session?.subscribe?.((_u,detail={})=>{if(detail.reason==='signed_out'){deactivate();return;}setTimeout(async()=>{await resolvePermissions();setVisibleByPermission();},120);});
  }

  const api=Object.freeze({open:openModule,refresh:async()=>{if(!state.mounted)ensureShell();await resolvePermissions();setVisibleByPermission();if(state.active)await loadOverview(true);},close:deactivate});
  global.ClientLifecycleOperations=api;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>boot(),{once:true});else boot();
})(window);
