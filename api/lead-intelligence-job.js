import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 60 };

const SB_URL = 'https://rewgbmfcrbgkzxcbrxjy.supabase.co';
const MODEL = 'gpt-5.6-luna';
const PROFILE = 'strict-v3';
const MAX = 5;
const DEFAULT_COUNT = 3;
const MAX_WEB_CALLS = 5;
const MAX_OUTPUT_TOKENS = 3000;
const CACHE_HOURS = 24;
const MIN_FIT_SCORE = 88;
const RECENT_PROSPECT_DAYS = 120;
const RECENT_PROSPECT_LIMIT = 60;

const txt = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const arr = (v, n = 12) => [...new Set((Array.isArray(v) ? v : txt(v).split(',')).map(txt).filter(Boolean))].slice(0, n);
const int = (v, lo, hi, d) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};
const key = v => txt(v)
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

function criteria(b = {}) {
  return {
    countries: arr(b.countries, 6),
    industries: arr(b.industries, 6),
    target_roles: arr(b.target_roles || b.roles, 8),
    company_profile: txt(b.company_profile || b.companyProfile).slice(0, 350),
    min_locations: int(b.min_locations, 1, 5000, 3),
    keywords: arr(b.keywords, 8),
    exclusions: arr(b.exclusions, 8),
    count: int(b.count, 1, MAX, DEFAULT_COUNT),
  };
}

function signature(c = {}) {
  const n = criteria(c);
  return JSON.stringify({
    countries: n.countries.map(x => x.toLowerCase()).sort(),
    industries: n.industries.map(x => x.toLowerCase()).sort(),
    target_roles: n.target_roles.map(x => x.toLowerCase()).sort(),
    company_profile: n.company_profile.toLowerCase(),
    min_locations: n.min_locations,
    keywords: n.keywords.map(x => x.toLowerCase()).sort(),
    exclusions: n.exclusions.map(x => x.toLowerCase()).sort(),
    count: n.count,
  });
}

async function auth(req) {
  const token = txt(req.headers?.authorization || req.headers?.Authorization).replace(/^Bearer\s+/i, '');
  if (!token) throw Object.assign(new Error('Authentication is required.'), { status: 401 });
  const anon = txt(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY);
  if (!anon) throw Object.assign(new Error('Supabase server authentication is not configured.'), { status: 503 });
  const db = createClient(txt(process.env.SUPABASE_URL) || SB_URL, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const u = await db.auth.getUser(token);
  if (u.error || !u.data?.user) throw Object.assign(new Error('Your session is invalid or expired.'), { status: 401 });
  const ok = await db.rpc('can_use_lead_intelligence');
  if (ok.error || ok.data !== true) throw Object.assign(new Error('You do not have permission to use Lead Intelligence.'), { status: 403 });
  return { db, user: u.data.user };
}

const FIELDS = {
  person_name: { type: 'string' },
  job_title: { type: 'string' },
  person_email: { type: 'string' },
  company_name: { type: 'string' },
  company_website: { type: 'string' },
  linkedin_url: { type: 'string' },
  country: { type: 'string' },
  city: { type: 'string' },
  industry: { type: 'string' },
  company_size: { type: 'string' },
  estimated_locations: { type: ['integer', 'null'] },
  fit_score: { type: 'integer', minimum: 0, maximum: 100 },
  confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  why_fit: { type: 'string' },
  likely_pain_points: { type: 'array', maxItems: 3, items: { type: 'string' } },
  public_evidence: { type: 'array', maxItems: 3, items: { type: 'string' } },
  source_urls: {
    type: 'array',
    maxItems: 3,
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'url', 'supports'],
      properties: {
        title: { type: 'string' },
        url: { type: 'string' },
        supports: { type: 'string' },
      },
    },
  },
  suggested_connection_note: { type: 'string' },
  suggested_follow_up: { type: 'string' },
};

const FORMAT = {
  type: 'json_schema',
  name: 'lead_intelligence_result',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['suggestions'],
    properties: {
      suggestions: {
        type: 'array',
        maxItems: MAX,
        items: {
          type: 'object',
          additionalProperties: false,
          required: Object.keys(FIELDS),
          properties: FIELDS,
        },
      },
    },
  },
};

function industryAligned(candidateIndustry, requested = []) {
  if (!requested.length) return true;
  const candidate = key(candidateIndustry);
  if (!candidate) return false;

  return requested.some(value => {
    const wanted = key(value);
    if (!wanted) return false;
    if (/food|beverage|restaurant|f b|qsr|catering/.test(wanted)) {
      return /food|beverage|restaurant|qsr|catering|hospitality/.test(candidate);
    }
    if (/hospitality|hotel|resort/.test(wanted)) {
      return /hospitality|hotel|resort|restaurant|food|beverage|catering/.test(candidate);
    }
    if (/retail|store/.test(wanted)) return /retail|store/.test(candidate);
    if (/manufactur|production|factory|processing/.test(wanted)) return /manufactur|production|factory|processing/.test(candidate);
    if (/facilit/.test(wanted)) return /facilit/.test(candidate);
    const words = wanted.split(' ').filter(word => word.length >= 4);
    return words.some(word => candidate.includes(word));
  });
}

function complexSingleSiteException(x = {}, c = {}) {
  const context = `${key(x.industry)} ${key(c.industries.join(' '))} ${key(c.company_profile)}`;
  const title = key(x.job_title);
  return /manufactur|production|factory|processing|industrial|warehouse/.test(context)
    && /quality|qhse|hseq|operation|compliance|safety/.test(title);
}

function meetsQualityFloor(x = {}, c = {}) {
  if (x.fit_score < MIN_FIT_SCORE) return false;
  if (x.confidence === 'low') return false;
  if (!industryAligned(x.industry, c.industries)) return false;
  if (Number.isInteger(x.estimated_locations) && x.estimated_locations < c.min_locations && !complexSingleSiteException(x, c)) return false;
  return true;
}

async function recentProspects(a) {
  const cutoff = new Date(Date.now() - RECENT_PROSPECT_DAYS * 86400000).toISOString();
  const q = await a.db
    .from('lead_intelligence_suggestions')
    .select('person_name,company_name,linkedin_url,created_at')
    .eq('created_by', a.user.id)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(RECENT_PROSPECT_LIMIT);
  if (q.error) return [];
  const seen = new Set();
  return (q.data || []).filter(row => {
    const person = key(row.person_name);
    if (!person || seen.has(person)) return false;
    seen.add(person);
    return true;
  });
}

function prompt(c, previous = []) {
  const alreadySeen = previous.length
    ? previous.map(row => `${txt(row.person_name)} — ${txt(row.company_name)}`).join(' | ')
    : 'none';

  return `Find up to ${c.count} real, current, high-value B2B prospects for the customer-facing InCheck 360 operations platform.
InCheck 360 supports digital inspections/checks, issue reporting, corrective actions, evidence, follow-up to closure and multi-location management visibility. Do not confuse it with Monitor Core, the internal ERP.

Countries: ${c.countries.join(', ') || 'Any relevant market'}
Industries: ${c.industries.join(', ') || 'F&B, hospitality, retail, manufacturing'}
Roles: ${c.target_roles.join(', ') || 'Head of Operations, Operations Director, Quality Manager, QHSE Manager'}
Company profile: ${c.company_profile || 'Multi-location operator with recurring operational checks'}
Minimum sites when public evidence exists: ${c.min_locations}
Keywords: ${c.keywords.join(', ') || 'none'}
Exclude: ${c.exclusions.join(', ') || 'none'}
Already surfaced recently — do NOT return these people again: ${alreadySeen}

Strict-quality rules:
- Quality is more important than quantity. Return fewer than requested if necessary. Never add medium-fit filler just to reach the requested count.
- Only return prospects you would score at least ${MIN_FIT_SCORE}/100 after verification.
- Prioritize exact requested decision-maker roles. For operations searches, strongly prefer Head, Director, Regional/Group Operations, COO or equivalent senior ownership. Do not substitute shop managers, restaurant managers or junior operations roles unless the user explicitly requested them.
- For Quality/QHSE searches, prefer enterprise, group or multi-site managers with direct responsibility for audits, inspections, compliance, food safety, corrective actions or standards. Do not substitute generic EHS roles unless the role clearly owns these workflows across the target business.
- If industries were specified, the prospect's current company must clearly operate in one of those industries. Do not substitute facility-management firms, consultants, suppliers, recruiters or software vendors unless explicitly requested.
- For F&B/hospitality/retail when minimum sites is ${c.min_locations}, verify the site count when practical. If an exact count cannot be verified, only return the prospect when credible evidence clearly shows multi-site, multi-property, regional, group or franchise responsibility meeting the requested scale. Unknown site count alone is not enough.
- Single-site prospects below the requested site minimum are not acceptable for F&B/hospitality/retail. A complex manufacturing/production operation may be an exception only when the role directly owns recurring quality/compliance workflows.
- Use the web-search budget mainly to verify the person's CURRENT role/employer, decision authority, target-industry fit and multi-site/operational complexity.
- A prospect should only be returned when the person, current role/employer, and company are supported by credible public evidence. Prefer current official/company pages, reputable business pages, event/speaker pages and exact public professional profiles.
- If evidence suggests the role is stale, former, ambiguous, or belongs to another person with a similar name, omit the candidate.
- Do not return anyone listed in the already-surfaced list, even if the company name or title is written differently.
- Prefer one strong source per fact and no more than three useful sources per prospect.
- Never invent people, roles, employers, emails, LinkedIn URLs, websites, site counts or source URLs.
- Email only if explicitly public. LinkedIn only if the exact public profile is found; otherwise use an empty string.
- Do not spend extra searches trying to discover email addresses or phone numbers; contact enrichment is handled separately after the user chooses a prospect.
- Keep evidence, rationale and pain points concise and specific to the verified role/company.
- Score conservatively: role/seniority 30%, decision authority 20%, operational or multi-site complexity 25%, target-industry fit 10%, evidence confidence 15%.
- Connection note <=200 characters, natural and personalized. It should create relevance rather than pitch hard.
- Follow-up is concise, low-pressure and asks one useful pain-discovery question grounded in the verified role/company.`;
}

function openaiHeaders() {
  const keyValue = txt(process.env.OPENAI_API_KEY);
  if (!keyValue) throw Object.assign(new Error('OpenAI is not configured yet.'), { status: 503 });
  return { Authorization: `Bearer ${keyValue}`, 'Content-Type': 'application/json' };
}

async function oa(url, init = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, {
      ...init,
      headers: { ...openaiHeaders(), ...(init.headers || {}) },
      signal: ctl.signal,
    });
    const p = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(txt(p?.error?.message) || `OpenAI request failed (${r.status}).`), { status: 502 });
    return p;
  } catch (e) {
    if (e?.name === 'AbortError') throw Object.assign(new Error('OpenAI did not acknowledge the background job in time.'), { status: 504 });
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function outputText(p = {}) {
  if (txt(p.output_text)) return txt(p.output_text);
  return (p.output || [])
    .flatMap(x => (x?.type === 'message' ? (x.content || []) : []))
    .filter(x => x?.type === 'output_text')
    .map(x => x.text || '')
    .join('\n')
    .trim();
}

function safeUrl(v) {
  try {
    const u = new URL(txt(v));
    return /^https?:$/.test(u.protocol) ? u.toString() : '';
  } catch {
    return '';
  }
}

function normalize(x = {}) {
  const person = txt(x.person_name).slice(0, 220);
  const company = txt(x.company_name).slice(0, 260);
  if (!person || !company) return null;
  const linkedin = safeUrl(x.linkedin_url);
  return {
    person_name: person,
    job_title: txt(x.job_title).slice(0, 220),
    person_email: txt(x.person_email).slice(0, 320),
    company_name: company,
    company_website: safeUrl(x.company_website),
    linkedin_url: linkedin,
    country: txt(x.country).slice(0, 120),
    city: txt(x.city).slice(0, 120),
    industry: txt(x.industry).slice(0, 180),
    company_size: txt(x.company_size).slice(0, 180),
    estimated_locations: Number.isInteger(x.estimated_locations) && x.estimated_locations >= 0 ? x.estimated_locations : null,
    fit_score: int(x.fit_score, 0, 100, 0),
    confidence: ['high', 'medium', 'low'].includes(txt(x.confidence).toLowerCase()) ? txt(x.confidence).toLowerCase() : 'low',
    why_fit: txt(x.why_fit).slice(0, 900),
    likely_pain_points: arr(x.likely_pain_points, 3).map(v => v.slice(0, 260)),
    public_evidence: arr(x.public_evidence, 3).map(v => v.slice(0, 360)),
    source_urls: (Array.isArray(x.source_urls) ? x.source_urls : [])
      .map(s => ({
        title: txt(s?.title).slice(0, 180),
        url: safeUrl(s?.url),
        supports: txt(s?.supports).slice(0, 280),
      }))
      .filter(s => s.url)
      .slice(0, 3),
    suggested_connection_note: txt(x.suggested_connection_note).slice(0, 200),
    suggested_follow_up: txt(x.suggested_follow_up).slice(0, 700),
    fingerprint: (linkedin || `${person}|${company}`)
      .toLowerCase()
      .replace(/[^a-z0-9@./|:_-]+/g, ' ')
      .trim()
      .slice(0, 500),
  };
}

async function findReusableRun(a, c) {
  const cutoff = new Date(Date.now() - CACHE_HOURS * 3600000).toISOString();
  const recent = await a.db
    .from('lead_intelligence_runs')
    .select('id,status,criteria,model,openai_response_id,result_count,started_at,completed_at,research_profile,web_search_cap')
    .eq('created_by', a.user.id)
    .eq('research_profile', PROFILE)
    .in('status', ['running', 'completed'])
    .gte('started_at', cutoff)
    .order('started_at', { ascending: false })
    .limit(20);
  if (recent.error) return null;
  const wanted = signature(c);
  return (recent.data || []).find(row => signature(row.criteria || {}) === wanted) || null;
}

async function start(a, c) {
  const reusable = await findReusableRun(a, c);
  if (reusable) {
    return {
      ok: true,
      resumed: reusable.status === 'running',
      cached: reusable.status === 'completed',
      run_id: reusable.id,
      status: reusable.status,
      model: reusable.model || MODEL,
      profile: reusable.research_profile || PROFILE,
      result_count: reusable.result_count || 0,
    };
  }

  const previous = await recentProspects(a);
  const run = await a.db
    .from('lead_intelligence_runs')
    .insert({
      created_by: a.user.id,
      criteria: c,
      status: 'running',
      started_at: new Date().toISOString(),
      model: MODEL,
      research_profile: PROFILE,
      web_search_cap: MAX_WEB_CALLS,
    })
    .select('*')
    .single();
  if (run.error) throw run.error;

  try {
    const p = await oa('https://api.openai.com/v1/responses', {
      method: 'POST',
      body: JSON.stringify({
        model: MODEL,
        background: true,
        store: true,
        reasoning: { effort: 'low' },
        tools: [{ type: 'web_search', search_context_size: 'low' }],
        tool_choice: 'auto',
        max_tool_calls: MAX_WEB_CALLS,
        instructions: 'You are the strict-quality Lead Intelligence research engine for InCheck 360. Spend the fixed search budget on senior, verified, target-industry prospects. Never use weaker filler to hit the requested count. Do not repeat recently surfaced people. Follow the JSON schema exactly.',
        input: prompt(c, previous),
        text: { format: FORMAT, verbosity: 'low' },
        max_output_tokens: MAX_OUTPUT_TOKENS,
        prompt_cache_key: 'monitor-core-lead-intelligence-strict-v3',
        metadata: { monitor_core_run_id: run.data.id, purpose: 'lead_intelligence_strict_v3' },
      }),
    });
    if (!p.id) throw new Error('OpenAI did not return a research job ID.');
    const up = await a.db
      .from('lead_intelligence_runs')
      .update({ openai_response_id: p.id, model: MODEL, error_message: null })
      .eq('id', run.data.id)
      .eq('created_by', a.user.id);
    if (up.error) throw up.error;
    return { ok: true, resumed: false, cached: false, run_id: run.data.id, status: p.status || 'queued', model: MODEL, profile: PROFILE };
  } catch (e) {
    await a.db
      .from('lead_intelligence_runs')
      .update({ status: 'failed', error_message: txt(e.message), completed_at: new Date().toISOString() })
      .eq('id', run.data.id)
      .eq('created_by', a.user.id);
    throw e;
  }
}

async function status(a, id) {
  const q = await a.db
    .from('lead_intelligence_runs')
    .select('*')
    .eq('id', id)
    .eq('created_by', a.user.id)
    .maybeSingle();
  if (q.error) throw q.error;
  if (!q.data) throw Object.assign(new Error('Research job not found.'), { status: 404 });

  const run = q.data;
  if (run.status === 'completed') {
    return { ok: true, run_id: id, status: 'completed', result_count: run.result_count || 0, model: run.model || MODEL, profile: run.research_profile || '', usage: run.usage || {} };
  }
  if (run.status === 'failed') {
    return { ok: false, run_id: id, status: 'failed', error: run.error_message || 'Research failed.' };
  }
  if (!run.openai_response_id) {
    return { ok: true, run_id: id, status: 'starting', result_count: 0, model: MODEL, profile: run.research_profile || PROFILE };
  }

  const p = await oa(`https://api.openai.com/v1/responses/${encodeURIComponent(run.openai_response_id)}`, { method: 'GET' });
  const s = txt(p.status).toLowerCase() || 'in_progress';

  if (!['completed', 'failed', 'cancelled', 'incomplete'].includes(s)) {
    return { ok: true, run_id: id, status: s, model: MODEL, profile: run.research_profile || PROFILE };
  }

  if (s !== 'completed') {
    const reason = txt(p?.error?.message || p?.incomplete_details?.reason) || `OpenAI research ended with status: ${s}.`;
    await a.db
      .from('lead_intelligence_runs')
      .update({ status: 'failed', error_message: reason, completed_at: new Date().toISOString(), usage: p.usage || {} })
      .eq('id', id)
      .eq('created_by', a.user.id);
    return { ok: false, run_id: id, status: 'failed', error: reason };
  }

  let parsed;
  try {
    parsed = JSON.parse(outputText(p));
  } catch {
    const reason = 'OpenAI completed the research but returned an unreadable structured result.';
    await a.db
      .from('lead_intelligence_runs')
      .update({ status: 'failed', error_message: reason, completed_at: new Date().toISOString(), usage: p.usage || {} })
      .eq('id', id)
      .eq('created_by', a.user.id);
    return { ok: false, run_id: id, status: 'failed', error: reason };
  }

  const c = criteria(run.criteria || {});
  const previous = await recentProspects(a);
  const previousPeople = new Set(previous.map(row => key(row.person_name)).filter(Boolean));
  const seenPeople = new Set();
  const suggestions = (Array.isArray(parsed?.suggestions) ? parsed.suggestions : [])
    .map(normalize)
    .filter(Boolean)
    .filter(x => meetsQualityFloor(x, c))
    .filter(x => {
      const person = key(x.person_name);
      if (!person || previousPeople.has(person) || seenPeople.has(person)) return false;
      seenPeople.add(person);
      return true;
    })
    .sort((x, y) => y.fit_score - x.fit_score)
    .slice(0, c.count);

  const rows = suggestions.map(x => ({
    ...x,
    run_id: id,
    created_by: a.user.id,
    status: 'new',
    raw_payload: x,
  }));

  if (rows.length) {
    const ins = await a.db
      .from('lead_intelligence_suggestions')
      .upsert(rows, { onConflict: 'run_id,fingerprint', ignoreDuplicates: true });
    if (ins.error) throw ins.error;
  }

  const done = await a.db
    .from('lead_intelligence_runs')
    .update({
      status: 'completed',
      model: MODEL,
      result_count: suggestions.length,
      usage: p.usage || {},
      error_message: null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('created_by', a.user.id);
  if (done.error) throw done.error;

  return { ok: true, run_id: id, status: 'completed', result_count: suggestions.length, model: MODEL, profile: run.research_profile || PROFILE, usage: p.usage || {} };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  try {
    const a = await auth(req);
    const method = String(req.method || 'GET').toUpperCase();

    if (method === 'GET') {
      return res.status(200).json({
        ok: true,
        configured: Boolean(txt(process.env.OPENAI_API_KEY)),
        model: MODEL,
        profile: PROFILE,
        mode: 'background-strict',
        max_suggestions: MAX,
        default_suggestions: DEFAULT_COUNT,
        max_web_calls: MAX_WEB_CALLS,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        reasoning_effort: 'low',
        cache_hours: CACHE_HOURS,
        min_fit_score: MIN_FIT_SCORE,
        recent_prospect_days: RECENT_PROSPECT_DAYS,
      });
    }

    if (method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'Method not allowed.' });
    }

    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const action = txt(b.action || 'start').toLowerCase();

    if (action === 'status') {
      const id = txt(b.run_id);
      if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ ok: false, error: 'A valid research run ID is required.' });
      const r = await status(a, id);
      return res.status(r.ok === false ? 422 : 200).json(r);
    }

    if (action !== 'start') return res.status(400).json({ ok: false, error: 'Unknown Lead Intelligence action.' });

    const c = criteria(b.criteria && typeof b.criteria === 'object' ? b.criteria : b);
    if (!c.countries.length && !c.industries.length && !c.target_roles.length && !c.company_profile) {
      return res.status(400).json({ ok: false, error: 'Add at least one country, industry, target role or company profile.' });
    }

    return res.status(202).json(await start(a, c));
  } catch (e) {
    return res.status(Number(e?.status) || 500).json({ ok: false, error: txt(e?.message) || 'Lead Intelligence request failed.' });
  }
}
