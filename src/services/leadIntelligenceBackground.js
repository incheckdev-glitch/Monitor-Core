(function installLeadIntelligenceBackground(global){
'use strict';
if(global.InCheck360LeadIntelligenceBackground)return;

const API='/api/lead-intelligence-job';
const VERSION='20260911-li-bg3';
const MAX_COUNT=5;
const DEFAULT_COUNT=3;
let active='',polling=false,resumeTried=false;

const txt=v=>String(v??'').replace(/\s+/g,' ').trim();
const list=v=>txt(v).split(',').map(txt).filter(Boolean);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function db(){return global.SupabaseClient?.getClient?.()||global.supabase||null}

async function ctx(){
  const s=db();
  if(!s)throw Error('Supabase is not available.');
  const r=await s.auth.getSession();
  if(r.error||!r.data?.session?.access_token)throw Error('Please sign in again.');
  return{supabase:s,session:r.data.session,user:r.data.session.user};
}

function toast(m,t=''){
  try{
    if(global.UI?.toast)return global.UI.toast(m,t||undefined);
    if(global.U?.toast)return global.U.toast(m,t||undefined);
  }catch(_){}
  console[t==='error'?'error':'log']('[Lead Intelligence]',m);
}

function applyBalancedUi(){
  const count=document.getElementById('liCount');
  if(count){
    const current=Math.min(MAX_COUNT,Math.max(1,Number(count.value)||DEFAULT_COUNT));
    count.innerHTML='<option value="1">1 — Minimum</option><option value="2">2</option><option value="3">3 — Lower usage</option><option value="5">5 — Maximum</option>';
    count.value=String([1,2,3,5].includes(current)?current:DEFAULT_COUNT);
  }
  const hint=document.getElementById('liGenerateHint');
  if(hint&&!active){
    hint.textContent='Balanced quality · GPT-5.6 Luna · max 5 web searches · low reasoning · up to 5 prospects. Identical searches within 24h are reused.';
  }
}

function crit(){
  const requested=Number(document.getElementById('liCount')?.value||DEFAULT_COUNT);
  return{
    countries:list(document.getElementById('liCountries')?.value),
    industries:list(document.getElementById('liIndustries')?.value),
    target_roles:list(document.getElementById('liRoles')?.value),
    min_locations:Number(document.getElementById('liMinLocations')?.value||3),
    count:Math.min(MAX_COUNT,Math.max(1,Number.isFinite(requested)?requested:DEFAULT_COUNT)),
    company_profile:txt(document.getElementById('liCompanyProfile')?.value),
    keywords:list(document.getElementById('liKeywords')?.value),
    exclusions:list(document.getElementById('liExclusions')?.value)
  };
}

async function call(body){
  const{session}=await ctx();
  const r=await fetch(API,{
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
    body:JSON.stringify(body),
    cache:'no-store'
  });
  const p=await r.json().catch(()=>({}));
  if(!r.ok||p?.ok===false)throw Error(txt(p?.error)||`Research request failed (${r.status}).`);
  return p;
}

function busy(on,msg=''){
  const b=document.getElementById('liGenerateBtn'),h=document.getElementById('liGenerateHint');
  if(b){b.disabled=!!on;b.textContent=on?'Research in progress…':'Generate Suggested Leads';}
  if(h&&msg)h.textContent=msg;
  if(!on&&!msg)applyBalancedUi();
}

function error(m=''){
  const e=document.getElementById('liError');
  if(e){e.hidden=!m;e.textContent=m;}
}

function select(id){
  if(global.InCheck360LeadIntelligence?.state)global.InCheck360LeadIntelligence.state.selectedRunId=id;
}

async function refresh(id=''){
  if(id)select(id);
  try{await global.InCheck360LeadIntelligence?.refresh?.();}catch(_){}
  applyBalancedUi();
}

async function poll(id,resumed=false){
  if(!id||polling)return;
  polling=true;active=id;select(id);
  const started=Date.now();
  let wait=3000;
  busy(true,resumed?'Resuming existing research — no duplicate OpenAI charge.':'Balanced-quality research is running. Results will appear automatically.');
  try{
    while(active===id){
      const p=await call({action:'status',run_id:id}),s=txt(p.status).toLowerCase();
      if(s==='completed'){
        active='';error('');
        busy(false,`${Number(p.result_count||0)} suggestions are ready · balanced quality.`);
        await refresh(id);
        toast(`${Number(p.result_count||0)} suggested leads ready.`);
        return;
      }
      const sec=Math.max(1,Math.round((Date.now()-started)/1000));
      busy(true,`${s==='queued'||s==='starting'?'Preparing':'Researching'} · balanced quality · ${sec}s elapsed.`);
      if(Date.now()-started>12*60*1000){
        active='';
        busy(false,'Research is still running in the background. It was not duplicated or cancelled.');
        await refresh(id);
        toast('Research is still running. You can return later.');
        return;
      }
      await sleep(wait);
      wait=Math.min(9000,Math.round(wait*1.35));
    }
  }catch(e){
    active='';
    error(txt(e.message)||'Lead research failed.');
    busy(false,'Research stopped. No automatic retry will be started.');
    await refresh(id);
    toast(txt(e.message)||'Lead research failed.','error');
  }finally{
    polling=false;
  }
}

async function start(){
  if(active||polling){toast('A Lead Intelligence research job is already running.');return;}
  applyBalancedUi();
  const c=crit();
  if(!c.countries.length&&!c.industries.length&&!c.target_roles.length&&!c.company_profile){
    toast('Add at least one country, industry, target role or company profile.','error');
    return;
  }
  error('');
  busy(true,'Checking for a reusable search before spending OpenAI usage…');
  try{
    const p=await call({action:'start',criteria:c});
    if(!p.run_id)throw Error('Research job did not return a run ID.');
    select(p.run_id);
    await refresh(p.run_id);
    if(p.cached){
      active='';
      busy(false,`${Number(p.result_count||0)} suggestions loaded from the last identical balanced search · $0 new OpenAI research.`);
      toast('Identical recent search reused. No new OpenAI research was started.');
      return;
    }
    if(p.resumed)toast('Existing research resumed instead of creating another OpenAI request.');
    await poll(p.run_id,!!p.resumed);
  }catch(e){
    error(txt(e.message)||'Unable to start research.');
    busy(false,'Research could not start. No automatic retry will be made.');
    toast(txt(e.message)||'Unable to start research.','error');
  }
}

async function resume(){
  if(resumeTried||active||polling)return;
  resumeTried=true;
  try{
    const{supabase,user}=await ctx(),cut=new Date(Date.now()-3600000).toISOString();
    const r=await supabase.from('lead_intelligence_runs')
      .select('id,status,openai_response_id,started_at,research_profile')
      .eq('created_by',user.id)
      .eq('status','running')
      .eq('research_profile','balanced-v2')
      .not('openai_response_id','is',null)
      .gte('started_at',cut)
      .order('started_at',{ascending:false})
      .limit(1)
      .maybeSingle();
    if(!r.error&&r.data?.id)await poll(r.data.id,true);
  }catch(_){}
}

function onSubmit(e){
  if(e.target?.id!=='liCriteriaForm')return;
  e.preventDefault();
  e.stopImmediatePropagation();
  void start();
}

function install(){
  document.addEventListener('submit',onSubmit,true);
  const observer=new MutationObserver(()=>{
    if(document.getElementById('liCriteriaForm')){
      applyBalancedUi();
      observer.disconnect();
    }
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});
  applyBalancedUi();

  const s=db();
  if(s?.auth?.onAuthStateChange)s.auth.onAuthStateChange((_e,session)=>{
    if(!session){active='';polling=false;resumeTried=false;return;}
    resumeTried=false;
    setTimeout(()=>void resume(),800);
  });
  setTimeout(()=>void resume(),1200);
}

global.InCheck360LeadIntelligenceBackground=Object.freeze({
  version:VERSION,
  start,
  resume,
  get activeRunId(){return active}
});

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
else install();
})(window);
