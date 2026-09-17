import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 60 };

const SB_URL = 'https://rewgbmfcrbgkzxcbrxjy.supabase.co';
const MODEL = 'gpt-5.6-luna';
const CACHE_DAYS = 30;
const MAX_OUTPUT_TOKENS = 1800;

const txt = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const clamp = (value, lo, hi, fallback = 0) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};
const list = (value, max = 5) => [...new Set((Array.isArray(value) ? value : []).map(txt).filter(Boolean))].slice(0, max);

function safeUrl(value) {
  try {
    const u = new URL(txt(value));
    return /^https?:$/.test(u.protocol) ? u.toString() : '';
  } catch {
    return '';
  }
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
  const user = await db.auth.getUser(token);
  if (user.error || !user.data?.user) throw Object.assign(new Error('Your session is invalid or expired.'), { status: 401 });
  const allowed = await db.rpc('can_use_lead_intelligence');
  if (allowed.error || allowed.data !== true) throw Object.assign(new Error('You do not have permission to use Lead Intelligence.'), { status: 403 });
  return { db, user: user.data.user };
}

function openaiHeaders() {
  const key = txt(process.env.OPENAI_API_KEY);
  if (!key) throw Object.assign(new Error('OpenAI is not configured yet.'), { status: 503 });
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function oa(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      ...init,
      headers: { ...openaiHeaders(), ...(init.headers || {}) },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(txt(payload?.error?.message) || `OpenAI request failed (${response.status}).`), { status: 502 });
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') throw Object.assign(new Error('OpenAI did not acknowledge the qualification job in time.'), { status: 504 });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function outputText(payload = {}) {
  if (txt(payload.output_text)) return txt(payload.output_text);
  return (payload.output || [])
    .flatMap(item => item?.type === 'message' ? (item.content || []) : [])
    .filter(item => item?.type === 'output_text')
    .map(item => item.text || '')
    .join('\n')
    .trim();
}

const SCORE_FIELDS = ['role_seniority', 'multi_location', 'operational_pain', 'industry', 'decision_authority', 'evidence_quality'];
const SCORE_MAX = { role_seniority: 25, multi_location: 25, operational_pain: 20, industry: 15, decision_authority: 10, evidence_quality: 5 };

const FORMAT = {
  type: 'json_schema',
  name: 'lead_sales_qualification',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'refined_fit_score', 'fit_breakdown', 'decision_authority',
      'location_verification', 'verified_locations', 'role_verification',
      'data_conflicts', 'why_now', 'why_now_verified', 'sales_action',
      'source_urls', 'linkedin_connection_note', 'linkedin_after_acceptance',
      'linkedin_no_reply_followup', 'linkedin_meeting_request'
    ],
    properties: {
      refined_fit_score: { type: 'integer', minimum: 0, maximum: 100 },
      fit_breakdown: {
        type: 'object',
        additionalProperties: false,
        required: SCORE_FIELDS,
        properties: {
          role_seniority: { type: 'integer', minimum: 0, maximum: 25 },
          multi_location: { type: 'integer', minimum: 0, maximum: 25 },
          operational_pain: { type: 'integer', minimum: 0, maximum: 20 },
          industry: { type: 'integer', minimum: 0, maximum: 15 },
          decision_authority: { type: 'integer', minimum: 0, maximum: 10 },
          evidence_quality: { type: 'integer', minimum: 0, maximum: 5 },
        },
      },
      decision_authority: { type: 'string', enum: ['high', 'medium', 'low', 'unknown'] },
      location_verification: { type: 'string', enum: ['verified', 'estimated', 'conflict', 'unknown'] },
      verified_locations: { type: ['integer', 'null'], minimum: 0 },
      role_verification: { type: 'string', enum: ['verified', 'estimated', 'conflict', 'unknown'] },
      data_conflicts: { type: 'array', maxItems: 3, items: { type: 'string' } },
      why_now: { type: 'string' },
      why_now_verified: { type: 'boolean' },
      sales_action: { type: 'string', enum: ['pursue_now', 'nurture', 'low_priority'] },
      source_urls: {
        type: 'array',
        maxItems: 4,
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
      linkedin_connection_note: { type: 'string' },
      linkedin_after_acceptance: { type: 'string' },
      linkedin_no_reply_followup: { type: 'string' },
      linkedin_meeting_request: { type: 'string' },
    },
  },
};

function chooseWebSearchCap(suggestion = {}) {
  const score = clamp(suggestion.fit_score, 0, 100, 0);
  const locations = Number.isInteger(suggestion.estimated_locations) ? suggestion.estimated_locations : null;
  const title = txt(suggestion.job_title).toLowerCase();
  const senior = /(head|director|chief|vp|vice president|regional|group|general manager|operations manager|quality manager|qhse|compliance)/i.test(title);
  if (score >= 90 && (senior || locations === null || locations >= 3)) return 2;
  if (score >= 80) return 1;
  return 0;
}

function prompt(suggestion, webSearchCap) {
  const sources = (Array.isArray(suggestion.source_urls) ? suggestion.source_urls : [])
    .map(source => ({ title: txt(source?.title), url: safeUrl(source?.url), supports: txt(source?.supports) }))
    .filter(source => source.url)
    .slice(0, 4);
  const evidence = list(suggestion.public_evidence, 5);

  return `Qualify this existing InCheck 360 prospect for sales time and improve the LinkedIn outreach. This is NOT a new lead search and NOT a contact lookup.

Prospect: ${txt(suggestion.person_name)}
Current title from initial research: ${txt(suggestion.job_title) || 'Unknown'}
Company: ${txt(suggestion.company_name)}
Country/city: ${[txt(suggestion.city), txt(suggestion.country)].filter(Boolean).join(', ') || 'Unknown'}
Industry: ${txt(suggestion.industry) || 'Unknown'}
Company size: ${txt(suggestion.company_size) || 'Unknown'}
Initial location estimate: ${Number.isInteger(suggestion.estimated_locations) ? suggestion.estimated_locations : 'Unknown'}
Initial fit score: ${clamp(suggestion.fit_score, 0, 100, 0)}
Initial confidence: ${txt(suggestion.confidence) || 'unknown'}
Initial fit rationale: ${txt(suggestion.why_fit) || 'None'}
Likely pains: ${list(suggestion.likely_pain_points, 4).join(' | ') || 'None'}
Existing evidence: ${evidence.join(' | ') || 'None'}
Existing sources: ${JSON.stringify(sources)}

Cost-control mode: ${webSearchCap === 0 ? 'Do not use web search. Qualify only from the supplied evidence.' : `You may use at most ${webSearchCap} web search${webSearchCap === 1 ? '' : 'es'} to verify only the highest-value uncertainties: current role, multi-location/site count, or a real recent trigger. Stop early if the existing evidence is enough.`}

Qualification rules:
- InCheck 360 is strongest for multi-location F&B/hospitality/retail/manufacturing operators with recurring checks, audits, issue reporting, corrective actions, evidence and follow-up to closure.
- A single-site restaurant manager can be useful for networking/referrals but should not score close to a senior multi-site decision-maker.
- Decision authority is separate from operational relevance. Use high/medium/low/unknown.
- Never present an estimated site count as verified. Use location_verification = verified only when a public source explicitly supports the count or scope.
- If sources disagree about the current role, site count, employer or scope, set the relevant verification to conflict and describe it briefly in data_conflicts.
- Never claim a promotion, new role, expansion, opening or other 'why now' trigger unless a public source explicitly verifies it. If not verified, why_now should be empty and why_now_verified=false.
- Do not invent source URLs, titles, dates, site counts or facts.
- Score exactly with these weights: role/seniority 25, multi-location fit 25, operational pain fit 20, industry 15, decision authority 10, evidence quality 5. The six breakdown values must sum to refined_fit_score.
- sales_action: pursue_now only for genuinely strong prospects worth near-term sales effort; nurture for relevant but uncertain/lower-authority prospects; low_priority for weak or single-site/low-authority prospects.

LinkedIn message rules:
- Write like a real R&D professional, not a marketing bot: concise, specific, calm and low pressure.
- Use only facts supported by the supplied evidence or verified sources. Do not turn likely pain points into claims about the prospect's actual problems.
- Never mention a promotion, expansion, opening, exact site count, employer scope or multi-site responsibility unless it is verified. If location scope is estimated or unknown, use neutral wording such as "operations" rather than a specific number or "across your locations".
- Never imply that a restaurant/site manager controls group purchasing or strategy. Match the message to decision_authority and the verified scope of the role.
- Avoid generic phrases such as "impressive background", "your work caught my attention", "I came across your profile", "synergy", "explore collaboration", "revolutionize", "game-changing", or exaggerated praise.
- Avoid feature dumping. Mention only the part of InCheck 360 that naturally fits the prospect's verified role: daily operational checks, audits, issue/corrective-action follow-up, evidence, sensors, or cross-location visibility as appropriate.
- Do not mention internal ERP, Monitor Core, lead scores, AI research, confidence levels or research sources in outreach.
- Connection note must be <=200 characters. Use one concrete, verified relevance point where possible. Keep it primarily about connecting; do not hard-pitch or ask for a meeting.
- After-acceptance message should be no more than two short paragraphs. Thank them once, make one role-relevant connection to InCheck 360, then ask exactly one useful discovery question. Do not ask for a meeting in the same message unless the prospect has already shown interest.
- If authority is low/unknown or the business appears single-site, make the after-acceptance message exploratory and operational; do not write as if they are the buyer. If authority is medium/high and multi-location scope is verified, it may reference standardization, visibility and corrective-action follow-up across locations.
- No-reply follow-up should be short and materially different from the first message. Do not repeat the full pitch, use guilt language, or imply urgency. Give the prospect an easy way to respond later.
- Meeting request is for a prospect who has shown interest or engaged positively. Propose a short 15-minute walkthrough with the team, state what they would see in one sentence, and ask for a suitable day/time. Do not invent calendar availability or fixed slots.
- Prefer plain English and short sentences. No hashtags, emojis, exclamation-heavy copy, or sales buzzwords.`;
}

function normalize(raw = {}) {
  const breakdown = {};
  for (const key of SCORE_FIELDS) breakdown[key] = clamp(raw?.fit_breakdown?.[key], 0, SCORE_MAX[key], 0);
  const score = SCORE_FIELDS.reduce((sum, key) => sum + breakdown[key], 0);
  const enumValue = (value, allowed, fallback) => allowed.includes(txt(value).toLowerCase()) ? txt(value).toLowerCase() : fallback;
  const sources = (Array.isArray(raw.source_urls) ? raw.source_urls : [])
    .map(source => ({
      title: txt(source?.title).slice(0, 180),
      url: safeUrl(source?.url),
      supports: txt(source?.supports).slice(0, 320),
    }))
    .filter(source => source.url)
    .slice(0, 4);
  const locations = Number.isInteger(raw.verified_locations) && raw.verified_locations >= 0 ? raw.verified_locations : null;

  return {
    refined_fit_score: score,
    fit_breakdown: breakdown,
    decision_authority: enumValue(raw.decision_authority, ['high', 'medium', 'low', 'unknown'], 'unknown'),
    location_verification: enumValue(raw.location_verification, ['verified', 'estimated', 'conflict', 'unknown'], 'unknown'),
    verified_locations: locations,
    role_verification: enumValue(raw.role_verification, ['verified', 'estimated', 'conflict', 'unknown'], 'unknown'),
    data_conflicts: list(raw.data_conflicts, 3).map(value => value.slice(0, 320)),
    why_now: txt(raw.why_now).slice(0, 500),
    why_now_verified: raw.why_now_verified === true && Boolean(txt(raw.why_now)),
    sales_action: enumValue(raw.sales_action, ['pursue_now', 'nurture', 'low_priority'], 'nurture'),
    source_urls: sources,
    linkedin_connection_note: txt(raw.linkedin_connection_note).slice(0, 200),
    linkedin_after_acceptance: txt(raw.linkedin_after_acceptance).slice(0, 650),
    linkedin_no_reply_followup: txt(raw.linkedin_no_reply_followup).slice(0, 450),
    linkedin_meeting_request: txt(raw.linkedin_meeting_request).slice(0, 450),
  };
}

function webSearchCalls(payload = {}) {
  return Math.min(2, (payload.output || []).filter(item => item?.type === 'web_search_call').length);
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function estimateCost(usage = {}, webCalls = 0) {
  const input = Number(usage?.input_tokens || 0);
  const output = Number(usage?.output_tokens || 0);
  const cached = Number(usage?.input_tokens_details?.cached_tokens || 0);
  const cacheWrite = Number(usage?.input_tokens_details?.cache_write_tokens || 0);
  const uncached = Math.max(input - cached - cacheWrite, 0);
  const inputRate = numberEnv('OPENAI_LUNA_INPUT_PER_MILLION_USD', 0.20);
  const cachedRate = numberEnv('OPENAI_LUNA_CACHED_INPUT_PER_MILLION_USD', 0.02);
  const cacheWriteRate = numberEnv('OPENAI_LUNA_CACHE_WRITE_PER_MILLION_USD', 0.25);
  const outputRate = numberEnv('OPENAI_LUNA_OUTPUT_PER_MILLION_USD', 1.20);
  const searchRate = numberEnv('OPENAI_WEB_SEARCH_USD', 0.01);
  const tokenCost = (uncached * inputRate + cached * cachedRate + cacheWrite * cacheWriteRate + output * outputRate) / 1000000;
  return Math.round((tokenCost + webCalls * searchRate) * 1000000) / 1000000;
}

async function suggestionById(a, id) {
  const query = await a.db
    .from('lead_intelligence_suggestions')
    .select('id,created_by,person_name,job_title,company_name,company_website,linkedin_url,country,city,industry,company_size,estimated_locations,fit_score,confidence,why_fit,likely_pain_points,public_evidence,source_urls,qualification_status,qualified_at')
    .eq('id', id)
    .eq('created_by', a.user.id)
    .maybeSingle();
  if (query.error) throw query.error;
  if (!query.data) throw Object.assign(new Error('Suggested lead not found.'), { status: 404 });
  return query.data;
}

async function reusableQualification(a, suggestionId) {
  const cutoff = new Date(Date.now() - CACHE_DAYS * 86400000).toISOString();
  const completed = await a.db
    .from('lead_intelligence_qualifications')
    .select('*')
    .eq('suggestion_id', suggestionId)
    .eq('created_by', a.user.id)
    .eq('status', 'completed')
    .gte('started_at', cutoff)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!completed.error && completed.data) return completed.data;

  const running = await a.db
    .from('lead_intelligence_qualifications')
    .select('*')
    .eq('suggestion_id', suggestionId)
    .eq('created_by', a.user.id)
    .eq('status', 'running')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!running.error && running.data) return running.data;
  return null;
}

function publicResult(row = {}) {
  return {
    refined_fit_score: row.refined_fit_score,
    fit_breakdown: row.fit_breakdown || {},
    decision_authority: txt(row.decision_authority) || 'unknown',
    location_verification: txt(row.location_verification) || 'unknown',
    verified_locations: Number.isInteger(row.verified_locations) ? row.verified_locations : null,
    role_verification: txt(row.role_verification) || 'unknown',
    data_conflicts: Array.isArray(row.data_conflicts) ? row.data_conflicts : [],
    why_now: txt(row.why_now),
    why_now_verified: row.why_now_verified === true,
    sales_action: txt(row.sales_action) || 'nurture',
    source_urls: Array.isArray(row.source_urls) ? row.source_urls : [],
    linkedin_connection_note: txt(row.linkedin_connection_note),
    linkedin_after_acceptance: txt(row.linkedin_after_acceptance),
    linkedin_no_reply_followup: txt(row.linkedin_no_reply_followup),
    linkedin_meeting_request: txt(row.linkedin_meeting_request),
    web_searches_used: Number(row.web_searches_used || 0),
    estimated_cost_usd: Number(row.estimated_cost_usd || 0),
  };
}

async function fail(a, qualificationId, suggestionId, message, usage = {}) {
  const now = new Date().toISOString();
  await a.db.from('lead_intelligence_qualifications').update({
    status: 'failed', error_message: txt(message), usage: usage || {}, completed_at: now,
  }).eq('id', qualificationId).eq('created_by', a.user.id);
  await a.db.from('lead_intelligence_suggestions').update({
    qualification_status: 'failed', qualification_error: txt(message),
  }).eq('id', suggestionId).eq('created_by', a.user.id);
}

async function start(a, suggestionId) {
  const suggestion = await suggestionById(a, suggestionId);
  const reusable = await reusableQualification(a, suggestionId);
  if (reusable) {
    return {
      ok: true,
      cached: reusable.status === 'completed',
      resumed: reusable.status === 'running',
      qualification_id: reusable.id,
      suggestion_id: suggestionId,
      status: reusable.status,
      model: reusable.model || MODEL,
      web_search_cap: reusable.web_search_cap || 0,
      result: reusable.status === 'completed' ? publicResult(reusable) : undefined,
    };
  }

  const webSearchCap = chooseWebSearchCap(suggestion);
  const created = await a.db.from('lead_intelligence_qualifications').insert({
    suggestion_id: suggestionId,
    created_by: a.user.id,
    status: 'running',
    model: MODEL,
    web_search_cap: webSearchCap,
    started_at: new Date().toISOString(),
  }).select('*').single();
  if (created.error) {
    if (String(created.error.code) === '23505') {
      const running = await reusableQualification(a, suggestionId);
      if (running) return {
        ok: true, cached: running.status === 'completed', resumed: running.status === 'running',
        qualification_id: running.id, suggestion_id: suggestionId, status: running.status,
        model: running.model || MODEL, web_search_cap: running.web_search_cap || 0,
        result: running.status === 'completed' ? publicResult(running) : undefined,
      };
    }
    throw created.error;
  }

  const job = created.data;
  await a.db.from('lead_intelligence_suggestions').update({
    qualification_status: 'running', qualification_error: null,
  }).eq('id', suggestionId).eq('created_by', a.user.id);

  try {
    const body = {
      model: MODEL,
      background: true,
      store: true,
      reasoning: { effort: 'low' },
      instructions: 'You are the cost-conscious second-stage sales qualification and LinkedIn messaging engine for InCheck 360. Verify only when useful, never invent facts, write natural low-pressure outreach, and follow the JSON schema exactly.',
      input: prompt(suggestion, webSearchCap),
      text: { format: FORMAT, verbosity: 'low' },
      max_output_tokens: MAX_OUTPUT_TOKENS,
      prompt_cache_key: 'monitor-core-lead-sales-qualification-v2',
      metadata: {
        monitor_core_qualification_id: job.id,
        monitor_core_suggestion_id: suggestionId,
        purpose: 'lead_sales_qualification_v2',
      },
    };
    if (webSearchCap > 0) {
      body.tools = [{ type: 'web_search', search_context_size: 'low' }];
      body.tool_choice = 'auto';
      body.max_tool_calls = webSearchCap;
    }

    const payload = await oa('https://api.openai.com/v1/responses', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!payload.id) throw new Error('OpenAI did not return a qualification job ID.');

    const updated = await a.db.from('lead_intelligence_qualifications').update({
      openai_response_id: payload.id, model: MODEL, error_message: null,
    }).eq('id', job.id).eq('created_by', a.user.id);
    if (updated.error) throw updated.error;

    return {
      ok: true, cached: false, resumed: false, qualification_id: job.id,
      suggestion_id: suggestionId, status: payload.status || 'queued', model: MODEL,
      web_search_cap: webSearchCap,
    };
  } catch (error) {
    await fail(a, job.id, suggestionId, error.message || 'Qualification failed.');
    throw error;
  }
}

async function status(a, qualificationId) {
  const query = await a.db.from('lead_intelligence_qualifications')
    .select('*').eq('id', qualificationId).eq('created_by', a.user.id).maybeSingle();
  if (query.error) throw query.error;
  if (!query.data) throw Object.assign(new Error('Qualification job not found.'), { status: 404 });
  const row = query.data;

  if (row.status === 'completed') return {
    ok: true, qualification_id: row.id, suggestion_id: row.suggestion_id,
    status: 'completed', model: row.model || MODEL, usage: row.usage || {}, result: publicResult(row),
  };
  if (row.status === 'failed') return {
    ok: false, qualification_id: row.id, suggestion_id: row.suggestion_id,
    status: 'failed', error: row.error_message || 'Qualification failed.',
  };
  if (!row.openai_response_id) return {
    ok: true, qualification_id: row.id, suggestion_id: row.suggestion_id,
    status: 'starting', model: MODEL,
  };

  const payload = await oa(`https://api.openai.com/v1/responses/${encodeURIComponent(row.openai_response_id)}`, { method: 'GET' });
  const currentStatus = txt(payload.status).toLowerCase() || 'in_progress';
  if (!['completed', 'failed', 'cancelled', 'incomplete'].includes(currentStatus)) return {
    ok: true, qualification_id: row.id, suggestion_id: row.suggestion_id,
    status: currentStatus, model: MODEL,
  };

  if (currentStatus !== 'completed') {
    await fail(a, row.id, row.suggestion_id, txt(payload?.error?.message) || `OpenAI qualification ended with status ${currentStatus}.`, payload.usage || {});
    return { ok: false, qualification_id: row.id, suggestion_id: row.suggestion_id, status: 'failed', error: `Qualification ended with status ${currentStatus}.` };
  }

  try {
    const rawText = outputText(payload);
    if (!rawText) throw new Error('Qualification returned no structured output.');
    const normalized = normalize(JSON.parse(rawText));
    const webCalls = webSearchCalls(payload);
    const cost = estimateCost(payload.usage || {}, webCalls);
    const now = new Date().toISOString();

    const resultPatch = {
      status: 'completed',
      refined_fit_score: normalized.refined_fit_score,
      fit_breakdown: normalized.fit_breakdown,
      decision_authority: normalized.decision_authority,
      location_verification: normalized.location_verification,
      verified_locations: normalized.verified_locations,
      role_verification: normalized.role_verification,
      data_conflicts: normalized.data_conflicts,
      why_now: normalized.why_now,
      why_now_verified: normalized.why_now_verified,
      sales_action: normalized.sales_action,
      source_urls: normalized.source_urls,
      linkedin_connection_note: normalized.linkedin_connection_note,
      linkedin_after_acceptance: normalized.linkedin_after_acceptance,
      linkedin_no_reply_followup: normalized.linkedin_no_reply_followup,
      linkedin_meeting_request: normalized.linkedin_meeting_request,
      usage: payload.usage || {},
      web_searches_used: webCalls,
      estimated_cost_usd: cost,
      error_message: null,
      completed_at: now,
    };

    const saved = await a.db.from('lead_intelligence_qualifications').update(resultPatch)
      .eq('id', row.id).eq('created_by', a.user.id);
    if (saved.error) throw saved.error;

    const suggestionPatch = {
      qualification_status: 'completed',
      qualified_at: now,
      refined_fit_score: normalized.refined_fit_score,
      qualification_fit_breakdown: normalized.fit_breakdown,
      decision_authority: normalized.decision_authority,
      location_verification: normalized.location_verification,
      verified_locations: normalized.verified_locations,
      role_verification: normalized.role_verification,
      data_conflicts: normalized.data_conflicts,
      why_now: normalized.why_now,
      why_now_verified: normalized.why_now_verified,
      sales_action: normalized.sales_action,
      qualification_sources: normalized.source_urls,
      linkedin_connection_note: normalized.linkedin_connection_note,
      linkedin_after_acceptance: normalized.linkedin_after_acceptance,
      linkedin_no_reply_followup: normalized.linkedin_no_reply_followup,
      linkedin_meeting_request: normalized.linkedin_meeting_request,
      qualification_usage: payload.usage || {},
      qualification_web_searches: webCalls,
      qualification_estimated_cost_usd: cost,
      qualification_error: null,
    };
    const suggestionSaved = await a.db.from('lead_intelligence_suggestions').update(suggestionPatch)
      .eq('id', row.suggestion_id).eq('created_by', a.user.id);
    if (suggestionSaved.error) throw suggestionSaved.error;

    return {
      ok: true, qualification_id: row.id, suggestion_id: row.suggestion_id,
      status: 'completed', model: MODEL, usage: payload.usage || {},
      result: { ...normalized, web_searches_used: webCalls, estimated_cost_usd: cost },
    };
  } catch (error) {
    await fail(a, row.id, row.suggestion_id, error.message || 'Unable to parse qualification result.', payload.usage || {});
    throw error;
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'Method not allowed.' });
    }
    const a = await auth(req);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const action = txt(body.action).toLowerCase();

    if (action === 'start') {
      const id = txt(body.suggestion_id);
      if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ ok: false, error: 'A valid suggested lead ID is required.' });
      return res.status(200).json(await start(a, id));
    }
    if (action === 'status') {
      const id = txt(body.qualification_id);
      if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ ok: false, error: 'A valid qualification job ID is required.' });
      return res.status(200).json(await status(a, id));
    }
    return res.status(400).json({ ok: false, error: 'Unsupported action.' });
  } catch (error) {
    const statusCode = Number(error?.status) || 500;
    return res.status(statusCode).json({ ok: false, error: txt(error?.message) || 'Qualification request failed.' });
  }
}
