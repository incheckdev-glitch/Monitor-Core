import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 60 };

const SB_URL = 'https://rewgbmfcrbgkzxcbrxjy.supabase.co';
const MODEL = 'gpt-5.6-luna';
const MAX_WEB_CALLS = 2;
const MAX_OUTPUT_TOKENS = 900;
const CACHE_DAYS = 30;

const txt = v => String(v ?? '').replace(/\s+/g, ' ').trim();

function safeUrl(value) {
  try {
    const u = new URL(txt(value));
    return /^https?:$/.test(u.protocol) ? u.toString() : '';
  } catch {
    return '';
  }
}

function safeEmail(value) {
  const v = txt(value).toLowerCase().slice(0, 320);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : '';
}

function safePhone(value) {
  const v = txt(value).slice(0, 80);
  const digits = v.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 18) return '';
  return v;
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

function openaiHeaders() {
  const key = txt(process.env.OPENAI_API_KEY);
  if (!key) throw Object.assign(new Error('OpenAI is not configured yet.'), { status: 503 });
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function oa(url, init = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const response = await fetch(url, {
      ...init,
      headers: { ...openaiHeaders(), ...(init.headers || {}) },
      signal: ctl.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(new Error(txt(payload?.error?.message) || `OpenAI request failed (${response.status}).`), { status: 502 });
    }
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw Object.assign(new Error('OpenAI did not acknowledge the contact lookup in time.'), { status: 504 });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function outputText(payload = {}) {
  if (txt(payload.output_text)) return txt(payload.output_text);
  return (payload.output || [])
    .flatMap(item => (item?.type === 'message' ? (item.content || []) : []))
    .filter(item => item?.type === 'output_text')
    .map(item => item.text || '')
    .join('\n')
    .trim();
}

const FORMAT = {
  type: 'json_schema',
  name: 'lead_contact_enrichment',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'email', 'email_source_url',
      'person_phone', 'person_phone_source_url', 'phone_type',
      'company_phone', 'company_phone_source_url',
      'note',
    ],
    properties: {
      email: { type: 'string' },
      email_source_url: { type: 'string' },
      person_phone: { type: 'string' },
      person_phone_source_url: { type: 'string' },
      phone_type: { type: 'string', enum: ['mobile', 'direct', 'office', 'unknown', 'not_found'] },
      company_phone: { type: 'string' },
      company_phone_source_url: { type: 'string' },
      note: { type: 'string' },
    },
  },
};

function prospectPrompt(suggestion, webSearchCap) {
  return `Find publicly available business contact details for this exact prospect only.

Prospect: ${txt(suggestion.person_name)}
Role: ${txt(suggestion.job_title) || 'Unknown'}
Company: ${txt(suggestion.company_name)}
Company website: ${safeUrl(suggestion.company_website) || 'Unknown'}
LinkedIn URL used only as an identity hint: ${safeUrl(suggestion.linkedin_url) || 'Unknown'}
Location: ${[txt(suggestion.city), txt(suggestion.country)].filter(Boolean).join(', ') || 'Unknown'}
Existing public email from prospect research: ${safeEmail(suggestion.person_email) || 'None'}

Rules:
- This is a narrow contact lookup, not a new lead search. Do not return another person.
- Use at most ${webSearchCap} web search${webSearchCap === 1 ? '' : 'es'} and stop early when enough evidence is found.
- Only return a direct/business email or direct phone when a public page explicitly displays that detail for this person.
- Never infer or guess email formats such as firstname.lastname@company.com.
- Never guess, synthesize, transform, or infer a phone number.
- Do not use private, leaked, paywalled, data-broker, or login-only personal information.
- A company switchboard/office number is allowed only as company_phone, not person_phone.
- Every non-empty contact value must have its own public source URL that visibly supports that exact value. If there is no public source URL, return an empty string for that value.
- If the existing email is already supplied above, do not spend an extra search trying to rediscover it; focus the search budget on a direct phone or company phone.
- Return empty strings when a detail cannot be verified. Accuracy is more important than filling fields.
- Keep note very short.`;
}

function normalizeResult(raw = {}) {
  const emailSource = safeUrl(raw.email_source_url);
  const phoneSource = safeUrl(raw.person_phone_source_url);
  const companyPhoneSource = safeUrl(raw.company_phone_source_url);
  const email = emailSource ? safeEmail(raw.email) : '';
  const personPhone = phoneSource ? safePhone(raw.person_phone) : '';
  const companyPhone = companyPhoneSource ? safePhone(raw.company_phone) : '';
  const phoneType = personPhone && ['mobile', 'direct', 'office', 'unknown'].includes(txt(raw.phone_type).toLowerCase())
    ? txt(raw.phone_type).toLowerCase()
    : (personPhone ? 'unknown' : 'not_found');

  const sourceMap = new Map();
  if (email && emailSource) sourceMap.set(emailSource, { title: 'Email source', url: emailSource, supports: `Public source for ${email}` });
  if (personPhone && phoneSource) sourceMap.set(phoneSource, { title: 'Direct phone source', url: phoneSource, supports: `Public source for ${personPhone}` });
  if (companyPhone && companyPhoneSource) sourceMap.set(companyPhoneSource, { title: 'Company phone source', url: companyPhoneSource, supports: `Public source for ${companyPhone}` });

  return {
    email,
    person_phone: personPhone,
    company_phone: companyPhone,
    phone_type: phoneType,
    source_urls: [...sourceMap.values()].slice(0, 3),
    note: txt(raw.note).slice(0, 500),
  };
}

async function suggestionById(a, id) {
  const q = await a.db
    .from('lead_intelligence_suggestions')
    .select('id,person_name,job_title,person_email,company_name,company_website,linkedin_url,country,city,contact_enrichment_status,contact_enriched_at')
    .eq('id', id)
    .maybeSingle();
  if (q.error) throw q.error;
  if (!q.data) throw Object.assign(new Error('Suggested lead not found.'), { status: 404 });
  return q.data;
}

async function reusableEnrichment(a, suggestionId) {
  const cutoff = new Date(Date.now() - CACHE_DAYS * 86400000).toISOString();
  const completed = await a.db
    .from('lead_intelligence_contact_enrichments')
    .select('*')
    .eq('suggestion_id', suggestionId)
    .eq('status', 'completed')
    .gte('started_at', cutoff)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!completed.error && completed.data) return completed.data;

  const running = await a.db
    .from('lead_intelligence_contact_enrichments')
    .select('*')
    .eq('suggestion_id', suggestionId)
    .eq('status', 'running')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!running.error && running.data) return running.data;
  return null;
}

function publicResult(row = {}) {
  return {
    email: txt(row.email),
    person_phone: txt(row.person_phone),
    company_phone: txt(row.company_phone),
    phone_type: txt(row.phone_type) || 'not_found',
    source_urls: Array.isArray(row.source_urls) ? row.source_urls : [],
    note: txt(row.note),
  };
}

async function fail(a, enrichmentId, suggestionId, message, usage = {}) {
  const now = new Date().toISOString();
  await a.db.from('lead_intelligence_contact_enrichments').update({
    status: 'failed',
    error_message: txt(message),
    usage: usage || {},
    completed_at: now,
  }).eq('id', enrichmentId);
  await a.db.from('lead_intelligence_suggestions').update({
    contact_enrichment_status: 'failed',
    contact_enrichment_error: txt(message),
  }).eq('id', suggestionId);
}

async function start(a, suggestionId) {
  const suggestion = await suggestionById(a, suggestionId);
  const reusable = await reusableEnrichment(a, suggestionId);
  if (reusable) {
    return {
      ok: true,
      cached: reusable.status === 'completed',
      resumed: reusable.status === 'running',
      enrichment_id: reusable.id,
      suggestion_id: suggestionId,
      status: reusable.status,
      model: reusable.model || MODEL,
      result: reusable.status === 'completed' ? publicResult(reusable) : undefined,
    };
  }

  const existingEmail = safeEmail(suggestion.person_email);
  const webSearchCap = existingEmail ? 1 : MAX_WEB_CALLS;

  const created = await a.db
    .from('lead_intelligence_contact_enrichments')
    .insert({
      suggestion_id: suggestionId,
      created_by: a.user.id,
      status: 'running',
      model: MODEL,
      web_search_cap: webSearchCap,
      started_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (created.error) {
    if (String(created.error.code) === '23505') {
      const running = await reusableEnrichment(a, suggestionId);
      if (running) {
        return {
          ok: true,
          cached: running.status === 'completed',
          resumed: running.status === 'running',
          enrichment_id: running.id,
          suggestion_id: suggestionId,
          status: running.status,
          model: running.model || MODEL,
          result: running.status === 'completed' ? publicResult(running) : undefined,
        };
      }
    }
    throw created.error;
  }

  const enrichment = created.data;
  await a.db.from('lead_intelligence_suggestions').update({
    contact_enrichment_status: 'running',
    contact_enrichment_error: null,
  }).eq('id', suggestionId);

  try {
    const payload = await oa('https://api.openai.com/v1/responses', {
      method: 'POST',
      body: JSON.stringify({
        model: MODEL,
        background: true,
        store: true,
        reasoning: { effort: 'none' },
        tools: [{ type: 'web_search', search_context_size: 'low' }],
        tool_choice: 'auto',
        max_tool_calls: webSearchCap,
        instructions: 'You are a cost-efficient public business contact verifier. Search only for the exact named prospect. Never infer contact details. Follow the JSON schema exactly.',
        input: prospectPrompt(suggestion, webSearchCap),
        text: { format: FORMAT, verbosity: 'low' },
        max_output_tokens: MAX_OUTPUT_TOKENS,
        prompt_cache_key: 'monitor-core-lead-contact-enrichment-v1',
        metadata: {
          monitor_core_enrichment_id: enrichment.id,
          monitor_core_suggestion_id: suggestionId,
          purpose: 'lead_contact_enrichment',
        },
      }),
    });

    if (!payload.id) throw new Error('OpenAI did not return a contact lookup job ID.');
    const updated = await a.db.from('lead_intelligence_contact_enrichments').update({
      openai_response_id: payload.id,
      model: MODEL,
      error_message: null,
    }).eq('id', enrichment.id);
    if (updated.error) throw updated.error;

    return {
      ok: true,
      cached: false,
      resumed: false,
      enrichment_id: enrichment.id,
      suggestion_id: suggestionId,
      status: payload.status || 'queued',
      model: MODEL,
      web_search_cap: webSearchCap,
    };
  } catch (error) {
    await fail(a, enrichment.id, suggestionId, error.message || 'Contact lookup failed.');
    throw error;
  }
}

async function status(a, enrichmentId) {
  const q = await a.db
    .from('lead_intelligence_contact_enrichments')
    .select('*')
    .eq('id', enrichmentId)
    .maybeSingle();
  if (q.error) throw q.error;
  if (!q.data) throw Object.assign(new Error('Contact lookup not found.'), { status: 404 });

  const row = q.data;
  if (row.status === 'completed') {
    return {
      ok: true,
      enrichment_id: row.id,
      suggestion_id: row.suggestion_id,
      status: 'completed',
      model: row.model || MODEL,
      usage: row.usage || {},
      result: publicResult(row),
    };
  }
  if (row.status === 'failed') {
    return { ok: false, enrichment_id: row.id, suggestion_id: row.suggestion_id, status: 'failed', error: row.error_message || 'Contact lookup failed.' };
  }
  if (!row.openai_response_id) {
    return { ok: true, enrichment_id: row.id, suggestion_id: row.suggestion_id, status: 'starting', model: MODEL };
  }

  const payload = await oa(`https://api.openai.com/v1/responses/${encodeURIComponent(row.openai_response_id)}`, { method: 'GET' });
  const currentStatus = txt(payload.status).toLowerCase() || 'in_progress';
  if (!['completed', 'failed', 'cancelled', 'incomplete'].includes(currentStatus)) {
    return { ok: true, enrichment_id: row.id, suggestion_id: row.suggestion_id, status: currentStatus, model: MODEL };
  }

  if (currentStatus !== 'completed') {
    const reason = txt(payload?.error?.message || payload?.incomplete_details?.reason) || `OpenAI contact lookup ended with status: ${currentStatus}.`;
    await fail(a, row.id, row.suggestion_id, reason, payload.usage || {});
    return { ok: false, enrichment_id: row.id, suggestion_id: row.suggestion_id, status: 'failed', error: reason };
  }

  let parsed;
  try {
    parsed = JSON.parse(outputText(payload));
  } catch {
    const reason = 'OpenAI completed the contact lookup but returned an unreadable structured result.';
    await fail(a, row.id, row.suggestion_id, reason, payload.usage || {});
    return { ok: false, enrichment_id: row.id, suggestion_id: row.suggestion_id, status: 'failed', error: reason };
  }

  const result = normalizeResult(parsed || {});
  const now = new Date().toISOString();
  const done = await a.db.from('lead_intelligence_contact_enrichments').update({
    status: 'completed',
    email: result.email || null,
    person_phone: result.person_phone || null,
    company_phone: result.company_phone || null,
    phone_type: result.phone_type,
    source_urls: result.source_urls,
    note: result.note || null,
    usage: payload.usage || {},
    error_message: null,
    completed_at: now,
  }).eq('id', row.id);
  if (done.error) throw done.error;

  const suggestion = await suggestionById(a, row.suggestion_id);
  const suggestionPatch = {
    person_phone: result.person_phone || null,
    company_phone: result.company_phone || null,
    contact_phone_type: result.phone_type,
    contact_enrichment_status: 'completed',
    contact_enriched_at: now,
    contact_enrichment_sources: result.source_urls,
    contact_enrichment_note: result.note || null,
    contact_enrichment_response_id: payload.id || row.openai_response_id,
    contact_enrichment_usage: payload.usage || {},
    contact_enrichment_error: null,
  };
  if (result.email) suggestionPatch.person_email = result.email;
  else if (suggestion.person_email) suggestionPatch.person_email = suggestion.person_email;

  const suggestionUpdate = await a.db.from('lead_intelligence_suggestions').update(suggestionPatch).eq('id', row.suggestion_id);
  if (suggestionUpdate.error) throw suggestionUpdate.error;

  return {
    ok: true,
    enrichment_id: row.id,
    suggestion_id: row.suggestion_id,
    status: 'completed',
    model: MODEL,
    usage: payload.usage || {},
    result,
  };
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
        mode: 'selective-contact-enrichment',
        max_web_calls: MAX_WEB_CALLS,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        cache_days: CACHE_DAYS,
      });
    }

    if (method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'Method not allowed.' });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const action = txt(body.action || 'start').toLowerCase();

    if (action === 'status') {
      const id = txt(body.enrichment_id);
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return res.status(400).json({ ok: false, error: 'A valid contact lookup ID is required.' });
      }
      const result = await status(a, id);
      return res.status(result.ok === false ? 422 : 200).json(result);
    }

    if (action !== 'start') {
      return res.status(400).json({ ok: false, error: 'Unknown contact lookup action.' });
    }

    const suggestionId = txt(body.suggestion_id);
    if (!/^[0-9a-f-]{36}$/i.test(suggestionId)) {
      return res.status(400).json({ ok: false, error: 'A valid suggested lead ID is required.' });
    }

    return res.status(202).json(await start(a, suggestionId));
  } catch (error) {
    return res.status(Number(error?.status) || 500).json({
      ok: false,
      error: txt(error?.message) || 'Contact lookup failed.',
    });
  }
}
