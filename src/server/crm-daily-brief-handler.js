import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 60 };

const SB_URL = 'https://rewgbmfcrbgkzxcbrxjy.supabase.co';
const MODEL = 'gpt-5.6-luna';
const PROMPT_VERSION = 'crm-daily-brief-v1';
const MAX_OUTPUT_TOKENS = 2600;

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

function serverClient(token) {
  const anonKey = clean(
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY
  );
  if (!anonKey) throw Object.assign(new Error('Supabase server authentication is not configured.'), { status: 503 });
  return createClient(clean(process.env.SUPABASE_URL) || SB_URL, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function auth(req) {
  const token = clean(req.headers?.authorization || req.headers?.Authorization).replace(/^Bearer\s+/i, '');
  if (!token) throw Object.assign(new Error('Authentication is required.'), { status: 401 });
  const db = serverClient(token);
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) throw Object.assign(new Error('Your session is invalid or expired.'), { status: 401 });
  return { db, user: data.user, token };
}

async function requireView(a) {
  const { data, error } = await a.db.rpc('can_view_crm_daily_brief');
  if (error || data !== true) throw Object.assign(new Error('You do not have permission to view the CRM Daily Brief.'), { status: 403 });
}

async function requireAdmin(a) {
  const { data, error } = await a.db.rpc('crm_daily_brief_is_admin');
  if (error || data !== true) throw Object.assign(new Error('Admin or GM access is required to generate the CRM Daily Brief.'), { status: 403 });
}

function localDateString(value) {
  const v = clean(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return new Date().toISOString().slice(0, 10);
}

function outputText(payload = {}) {
  if (clean(payload.output_text)) return String(payload.output_text).trim();
  return (payload.output || [])
    .flatMap(item => item?.type === 'message' ? (item.content || []) : [])
    .filter(item => item?.type === 'output_text')
    .map(item => item.text || '')
    .join('\n')
    .trim();
}

function estimatedCost(usage = {}) {
  const input = Number(usage.input_tokens || 0);
  const output = Number(usage.output_tokens || 0);
  const details = usage.input_tokens_details || {};
  const cached = Number(details.cached_tokens || 0);
  const cacheWrite = Number(details.cache_write_tokens || 0);
  const uncached = Math.max(input - cached - cacheWrite, 0);
  return Number(((uncached * 0.20 + cached * 0.02 + cacheWrite * 0.25 + output * 1.20) / 1000000).toFixed(6));
}

const ITEM_FIELDS = {
  priority: { type: 'string', enum: ['high', 'medium', 'low'] },
  title: { type: 'string' },
  detail: { type: 'string' },
  recommended_action: { type: 'string' },
  entity_type: { type: 'string', enum: ['lead', 'deal', 'proposal', 'calendar_event', 'company', 'contact', 'none'] },
  entity_id: { type: 'string' },
  entity_number: { type: 'string' },
  evidence: { type: 'string' },
};

const ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: Object.keys(ITEM_FIELDS),
  properties: ITEM_FIELDS,
};

const FORMAT = {
  type: 'json_schema',
  name: 'crm_daily_brief',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['executive_summary', 'key_metrics', 'immediate_attention', 'follow_ups', 'opportunities', 'recent_activity', 'upcoming'],
    properties: {
      executive_summary: { type: 'string' },
      key_metrics: {
        type: 'array', maxItems: 6,
        items: {
          type: 'object', additionalProperties: false,
          required: ['label', 'value'],
          properties: { label: { type: 'string' }, value: { type: 'string' } },
        },
      },
      immediate_attention: { type: 'array', maxItems: 8, items: ITEM_SCHEMA },
      follow_ups: { type: 'array', maxItems: 10, items: ITEM_SCHEMA },
      opportunities: { type: 'array', maxItems: 8, items: ITEM_SCHEMA },
      recent_activity: { type: 'array', maxItems: 10, items: ITEM_SCHEMA },
      upcoming: { type: 'array', maxItems: 8, items: ITEM_SCHEMA },
    },
  },
};

async function callOpenAI(snapshot, reportDate) {
  const key = clean(process.env.OPENAI_API_KEY);
  if (!key) throw Object.assign(new Error('OpenAI is not configured yet.'), { status: 503 });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        store: false,
        reasoning: { effort: 'low' },
        instructions: `You create the shared daily CRM management brief for the internal Monitor Core ERP. Use ONLY the supplied CRM snapshot. Do not browse the web and do not invent facts, dates, statuses, values, people, IDs, or actions already completed. Prioritize overdue follow-ups, stale records, proposal deadlines, high-priority/qualified opportunities, meaningful status changes, and upcoming CRM meetings/calls. Keep the brief concise and operational. Every referenced entity_id and entity_number must come exactly from the supplied snapshot; otherwise use entity_type "none" and empty strings. Evidence must briefly state the source fact that justified the item. Recent activity describes what happened; recommended_action may be empty when no action is needed. This report is shared across CRM users, so avoid speculation and clearly distinguish fact from recommendation.`,
        input: `Report date: ${reportDate}\nCRM source snapshot:\n${JSON.stringify(snapshot)}`,
        text: { format: FORMAT, verbosity: 'low' },
        max_output_tokens: MAX_OUTPUT_TOKENS,
        prompt_cache_key: 'monitor-core-crm-daily-brief-v1',
        metadata: { purpose: 'crm_daily_brief', report_date: reportDate, prompt_version: PROMPT_VERSION },
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(new Error(clean(payload?.error?.message) || `OpenAI request failed (${response.status}).`), { status: 502 });
    }
    const text = outputText(payload);
    if (!text) throw Object.assign(new Error('OpenAI returned an empty CRM brief.'), { status: 502 });
    let report;
    try { report = JSON.parse(text); }
    catch { throw Object.assign(new Error('OpenAI returned an invalid CRM brief format.'), { status: 502 }); }
    return { report, usage: payload.usage || {}, responseId: payload.id || '' };
  } catch (error) {
    if (error?.name === 'AbortError') throw Object.assign(new Error('CRM Daily Brief generation timed out. Please retry.'), { status: 504 });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function listReports(a, req) {
  await requireView(a);
  const max = Math.max(1, Math.min(30, Number.parseInt(req.query?.limit || '14', 10) || 14));
  const [adminResult, rowsResult] = await Promise.all([
    a.db.rpc('crm_daily_brief_is_admin'),
    a.db.from('crm_daily_briefs')
      .select('id,report_date,generated_at,generated_by_name,status,model,prompt_version,report,usage,estimated_cost_usd,generation_count,error_message')
      .order('report_date', { ascending: false })
      .limit(max),
  ]);
  if (rowsResult.error) throw rowsResult.error;
  return { ok: true, is_admin: adminResult.data === true && !adminResult.error, reports: rowsResult.data || [] };
}

async function generate(a, req) {
  await requireAdmin(a);
  const reportDate = localDateString(req.body?.report_date);
  const snapshotResult = await a.db.rpc('crm_daily_brief_source_snapshot', { p_as_of: new Date().toISOString() });
  if (snapshotResult.error) throw snapshotResult.error;
  const snapshot = snapshotResult.data || {};

  const ai = await callOpenAI(snapshot, reportDate);
  const usage = ai.usage || {};
  const cost = estimatedCost(usage);

  const profile = await a.db.from('profiles')
    .select('display_name,full_name,name,email')
    .eq('id', a.user.id)
    .maybeSingle();
  const p = profile.data || {};
  const generatedByName = clean(p.display_name || p.full_name || p.name || p.email || a.user.email || 'Admin');

  const existing = await a.db.from('crm_daily_briefs')
    .select('id,generation_count')
    .eq('report_date', reportDate)
    .maybeSingle();
  if (existing.error) throw existing.error;

  const record = {
    report_date: reportDate,
    generated_at: new Date().toISOString(),
    generated_by: a.user.id,
    generated_by_name: generatedByName,
    status: 'completed',
    model: MODEL,
    prompt_version: PROMPT_VERSION,
    report: ai.report,
    source_snapshot: snapshot,
    usage,
    estimated_cost_usd: cost,
    generation_count: Math.max(1, Number(existing.data?.generation_count || 0) + 1),
    error_message: null,
    updated_at: new Date().toISOString(),
  };

  let saved;
  if (existing.data?.id) {
    saved = await a.db.from('crm_daily_briefs')
      .update(record)
      .eq('id', existing.data.id)
      .select('id,report_date,generated_at,generated_by_name,status,model,prompt_version,report,usage,estimated_cost_usd,generation_count,error_message')
      .single();
  } else {
    saved = await a.db.from('crm_daily_briefs')
      .insert(record)
      .select('id,report_date,generated_at,generated_by_name,status,model,prompt_version,report,usage,estimated_cost_usd,generation_count,error_message')
      .single();
  }
  if (saved.error) throw saved.error;
  return { ok: true, is_admin: true, report: saved.data, openai_response_id: ai.responseId };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  try {
    const a = await auth(req);
    const method = String(req.method || 'GET').toUpperCase();
    if (method === 'GET') return res.status(200).json(await listReports(a, req));
    if (method === 'POST') return res.status(200).json(await generate(a, req));
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  } catch (error) {
    console.error('[CRM Daily Brief]', error);
    return res.status(Number(error?.status) || 500).json({ ok: false, error: clean(error?.message) || 'CRM Daily Brief request failed.' });
  }
}
