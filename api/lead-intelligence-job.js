import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 60 };

const SB_URL = 'https://rewgbmfcrbgkzxcbrxjy.supabase.co';
const MAX = 12;
const txt = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const arr = (v, n = 12) => [...new Set((Array.isArray(v) ? v : txt(v).split(',')).map(txt).filter(Boolean))].slice(0, n);
const int = (v, lo, hi, d) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

function criteria(b = {}) {
  return {
    countries: arr(b.countries, 8), industries: arr(b.industries, 8),
    target_roles: arr(b.target_roles || b.roles, 12),
    company_profile: txt(b.company_profile || b.companyProfile).slice(0, 500),
    min_locations: int(b.min_locations, 1, 5000, 3),
    keywords: arr(b.keywords, 12), exclusions: arr(b.exclusions, 12),
    count: int(b.count, 1, MAX, 8)
  };
}

async function auth(req) {
  const token = txt(req.headers?.authorization || req.headers?.Authorization).replace(/^Bearer\s+/i, '');
  if (!token) throw Object.assign(new Error('Authentication is required.'), { status: 401 });
  const anon = txt(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY);
  if (!anon) throw Object.assign(new Error('Supabase server authentication is not configured.'), { status: 503 });
  const db = createClient(txt(process.env.SUPABASE_URL) || SB_URL, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const u = await db.auth.getUser(token);
  if (u.error || !u.data?.user) throw Object.assign(new Error('Your session is invalid or expired.'), { status: 401 });
  const ok = await db.rpc('can_use_lead_intelligence');
  if (ok.error || ok.data !== true) throw Object.assign(new Error('You do not have permission to use Lead Intelligence.'), { status: 403 });
  return { db, user: u.data.user };
}

const FIELDS = {
  person_name:{type:'string'}, job_title:{type:'string'}, person_email:{type:'string'},
  company_name:{type:'string'}, company_website:{type:'string'}, linkedin_url:{type:'string'},
  country:{type:'string'}, city:{type:'string'}, industry:{type:'string'}, company_size:{type:'string'},
  estimated_locations:{type:['integer','null']}, fit_score:{type:'integer',minimum:0,maximum:100},
  confidence:{type:'string',enum:['high','medium','low']}, why_fit:{type:'string'},
  likely_pain_points:{type:'array',items:{type:'string'}}, public_evidence:{type:'array',items:{type:'string'}},
  source_urls:{type:'array',items:{type:'object',additionalProperties:false,required:['title','url','supports'],properties:{title:{type:'string'},url:{type:'string'},supports:{type:'string'}}}},
  suggested_connection_note:{type:'string'}, suggested_follow_up:{type:'string'}
};
const FORMAT = { type:'json_schema', name:'lead_intelligence_result', strict:true, schema:{
  type:'object', additionalProperties:false, required:['suggestions'], properties:{
    suggestions:{type:'array',items:{type:'object',additionalProperties:false,required:Object.keys(FIELDS),properties:FIELDS}}
  }
}};

function prompt(c) {
  return `Research real, current B2B prospects for the customer-facing InCheck 360 operations platform.
InCheck 360 helps multi-location teams execute digital inspections/checks, issue reporting, corrective actions, evidence, follow-up to closure, and cross-location management visibility. Do not confuse it with Monitor Core, the internal ERP.

Countries: ${c.countries.join(', ') || 'Any relevant market'}
Industries: ${c.industries.join(', ') || 'F&B, hospitality, retail, manufacturing'}
Target roles: ${c.target_roles.join(', ') || 'Head of Operations, Operations Director, Quality Manager, QHSE Manager'}
Company profile: ${c.company_profile || 'Multi-location operator with recurring quality, safety, compliance, maintenance or inspection workflows'}
Minimum sites when evidence exists: ${c.min_locations}
Keywords: ${c.keywords.join(', ') || 'none'}
Exclude: ${c.exclusions.join(', ') || 'none'}
Return at most ${c.count} prospects.

Use current public web evidence. Never invent people, employers, titles, emails, LinkedIn URLs, websites, location counts or source URLs. Include a business email only if explicitly public and a LinkedIn URL only if the exact public profile is found. Prefer operational decision makers. Omit weak candidates. Fit score = role relevance 40%, operational/multi-site complexity 25%, industry fit 20%, evidence confidence 15%. Connection note <=200 characters, natural and non-pitchy. Follow-up concise and low-pressure with one pain-discovery question.`;
}

function openaiHeaders() {
  const key = txt(process.env.OPENAI_API_KEY);
  if (!key) throw Object.assign(new Error('OpenAI is not configured yet.'), { status: 503 });
  return { Authorization:`Bearer ${key}`, 'Content-Type':'application/json' };
}
const model = () => txt(process.env.OPENAI_LEAD_MODEL) || 'gpt-5.6-sol';

async function oa(url, init = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { ...init, headers:{...openaiHeaders(), ...(init.headers||{})}, signal:ctl.signal });
    const p = await r.json().catch(()=>({}));
    if (!r.ok) throw Object.assign(new Error(txt(p?.error?.message) || `OpenAI request failed (${r.status}).`), { status:502 });
    return p;
  } catch(e) {
    if (e?.name === 'AbortError') throw Object.assign(new Error('OpenAI did not acknowledge the background job in time.'), { status:504 });
    throw e;
  } finally { clearTimeout(timer); }
}

function outputText(p = {}) {
  if (txt(p.output_text)) return txt(p.output_text);
  return (p.output || []).flatMap(x => x?.type === 'message' ? (x.content || []) : [])
    .filter(x => x?.type === 'output_text').map(x => x.text || '').join('\n').trim();
}
function url(v) { try { const u=new URL(txt(v)); return /^https?:$/.test(u.protocol)?u.toString():''; } catch { return ''; } }
function normalize(x = {}) {
  const person=txt(x.person_name).slice(0,220), company=txt(x.company_name).slice(0,260);
  if (!person || !company) return null;
  const linkedin=url(x.linkedin_url);
  return {
    person_name:person, job_title:txt(x.job_title).slice(0,220), person_email:txt(x.person_email).slice(0,320),
    company_name:company, company_website:url(x.company_website), linkedin_url:linkedin,
    country:txt(x.country).slice(0,120), city:txt(x.city).slice(0,120), industry:txt(x.industry).slice(0,180),
    company_size:txt(x.company_size).slice(0,180),
    estimated_locations:Number.isInteger(x.estimated_locations)&&x.estimated_locations>=0?x.estimated_locations:null,
    fit_score:int(x.fit_score,0,100,0), confidence:['high','medium','low'].includes(txt(x.confidence).toLowerCase())?txt(x.confidence).toLowerCase():'low',
    why_fit:txt(x.why_fit).slice(0,1800), likely_pain_points:arr(x.likely_pain_points,8).map(v=>v.slice(0,500)),
    public_evidence:arr(x.public_evidence,10).map(v=>v.slice(0,800)),
    source_urls:(x.source_urls||[]).map(s=>({title:txt(s?.title).slice(0,240),url:url(s?.url),supports:txt(s?.supports).slice(0,500)})).filter(s=>s.url).slice(0,8),
    suggested_connection_note:txt(x.suggested_connection_note).slice(0,200),
    suggested_follow_up:txt(x.suggested_follow_up).slice(0,1400),
    fingerprint:(linkedin || `${person}|${company}`).toLowerCase().replace(/[^a-z0-9@./|:_-]+/g,' ').trim().slice(0,500)
  };
}

async function start(a, c) {
  const cutoff=new Date(Date.now()-3600000).toISOString();
  const old=await a.db.from('lead_intelligence_runs').select('*').eq('created_by',a.user.id).eq('status','running')
    .not('openai_response_id','is',null).gte('started_at',cutoff).order('started_at',{ascending:false}).limit(1).maybeSingle();
  if (!old.error && old.data) return {ok:true,resumed:true,run_id:old.data.id,status:'running',model:old.data.model||model()};

  const run=await a.db.from('lead_intelligence_runs').insert({created_by:a.user.id,criteria:c,status:'running',started_at:new Date().toISOString()}).select('*').single();
  if (run.error) throw run.error;
  try {
    const p=await oa('https://api.openai.com/v1/responses',{method:'POST',body:JSON.stringify({
      model:model(), background:true, store:true, reasoning:{effort:'medium'},
      tools:[{type:'web_search'}], tool_choice:'auto', max_tool_calls:16,
      include:['web_search_call.action.sources'],
      instructions:'You are the Lead Intelligence research engine for InCheck 360. Accuracy and verifiable public evidence are more important than quantity. Follow the JSON schema exactly.',
      input:prompt(c), text:{format:FORMAT}, max_output_tokens:6000,
      metadata:{monitor_core_run_id:run.data.id,purpose:'lead_intelligence'}
    })});
    if (!p.id) throw new Error('OpenAI did not return a research job ID.');
    const up=await a.db.from('lead_intelligence_runs').update({openai_response_id:p.id,model:p.model||model(),error_message:null}).eq('id',run.data.id).eq('created_by',a.user.id);
    if (up.error) throw up.error;
    return {ok:true,resumed:false,run_id:run.data.id,status:p.status||'queued',model:p.model||model()};
  } catch(e) {
    await a.db.from('lead_intelligence_runs').update({status:'failed',error_message:txt(e.message),completed_at:new Date().toISOString()}).eq('id',run.data.id).eq('created_by',a.user.id);
    throw e;
  }
}

async function status(a, id) {
  const q=await a.db.from('lead_intelligence_runs').select('*').eq('id',id).eq('created_by',a.user.id).maybeSingle();
  if (q.error) throw q.error;
  if (!q.data) throw Object.assign(new Error('Research job not found.'),{status:404});
  const run=q.data;
  if (run.status==='completed') return {ok:true,run_id:id,status:'completed',result_count:run.result_count||0,model:run.model||model()};
  if (run.status==='failed') return {ok:false,run_id:id,status:'failed',error:run.error_message||'Research failed.'};
  if (!run.openai_response_id) return {ok:true,run_id:id,status:'starting',result_count:0};

  const p=await oa(`https://api.openai.com/v1/responses/${encodeURIComponent(run.openai_response_id)}`,{method:'GET'});
  const s=txt(p.status).toLowerCase()||'in_progress';
  if (!['completed','failed','cancelled','incomplete'].includes(s)) return {ok:true,run_id:id,status:s,model:p.model||run.model||model()};

  if (s!=='completed') {
    const reason=txt(p?.error?.message||p?.incomplete_details?.reason)||`OpenAI research ended with status: ${s}.`;
    await a.db.from('lead_intelligence_runs').update({status:'failed',error_message:reason,completed_at:new Date().toISOString()}).eq('id',id).eq('created_by',a.user.id);
    return {ok:false,run_id:id,status:'failed',error:reason};
  }

  let parsed;
  try { parsed=JSON.parse(outputText(p)); } catch { throw new Error('OpenAI completed the research but returned an unreadable structured result.'); }
  const c=criteria(run.criteria||{}), seen=new Set();
  const suggestions=(parsed?.suggestions||[]).map(normalize).filter(Boolean).filter(x=>!seen.has(x.fingerprint)&&seen.add(x.fingerprint)).sort((x,y)=>y.fit_score-x.fit_score).slice(0,c.count);
  const rows=suggestions.map(x=>({...x,run_id:id,created_by:a.user.id,status:'new',raw_payload:x}));
  if (rows.length) {
    const ins=await a.db.from('lead_intelligence_suggestions').upsert(rows,{onConflict:'run_id,fingerprint',ignoreDuplicates:true});
    if (ins.error) throw ins.error;
  }
  const done=await a.db.from('lead_intelligence_runs').update({status:'completed',model:p.model||run.model||model(),result_count:suggestions.length,usage:p.usage||{},error_message:null,completed_at:new Date().toISOString()}).eq('id',id).eq('created_by',a.user.id);
  if (done.error) throw done.error;
  return {ok:true,run_id:id,status:'completed',result_count:suggestions.length,model:p.model||run.model||model()};
}

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store, max-age=0');
  try {
    const a=await auth(req), method=String(req.method||'GET').toUpperCase();
    if (method==='GET') return res.status(200).json({ok:true,configured:Boolean(txt(process.env.OPENAI_API_KEY)),model:model(),mode:'background',max_suggestions:MAX});
    if (method!=='POST') return res.status(405).json({ok:false,error:'Method not allowed.'});
    const b=req.body&&typeof req.body==='object'?req.body:{}, action=txt(b.action||'start').toLowerCase();
    if (action==='status') {
      const id=txt(b.run_id);
      if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ok:false,error:'A valid research run ID is required.'});
      const r=await status(a,id); return res.status(r.ok===false?422:200).json(r);
    }
    if (action!=='start') return res.status(400).json({ok:false,error:'Unknown Lead Intelligence action.'});
    const c=criteria(b.criteria&&typeof b.criteria==='object'?b.criteria:b);
    if (!c.countries.length&&!c.industries.length&&!c.target_roles.length&&!c.company_profile) return res.status(400).json({ok:false,error:'Add at least one country, industry, target role or company profile.'});
    return res.status(202).json(await start(a,c));
  } catch(e) {
    return res.status(Number(e?.status)||500).json({ok:false,error:txt(e?.message)||'Lead Intelligence request failed.'});
  }
}
