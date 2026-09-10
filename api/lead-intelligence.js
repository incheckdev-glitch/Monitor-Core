import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 60 };

const SUPABASE_URL_FALLBACK = 'https://rewgbmfcrbgkzxcbrxjy.supabase.co';
const MAX_SUGGESTIONS = 12;

function clean(value = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function list(value, max = 12) {
  const input = Array.isArray(value) ? value : clean(value).split(',');
  return [...new Set(input.map(clean).filter(Boolean))].slice(0, max);
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeCriteria(body = {}) {
  return {
    countries: list(body.countries, 8),
    industries: list(body.industries, 8),
    target_roles: list(body.target_roles || body.roles, 12),
    company_profile: clean(body.company_profile || body.companyProfile).slice(0, 500),
    min_locations: clampInt(body.min_locations, 1, 5000, 3),
    keywords: list(body.keywords, 12),
    exclusions: list(body.exclusions, 12),
    count: clampInt(body.count, 1, MAX_SUGGESTIONS, 8),
  };
}

function bearerToken(req) {
  const raw = clean(req.headers?.authorization || req.headers?.Authorization);
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? clean(match[1]) : '';
}

function supabaseEnv() {
  return {
    url: clean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL) || SUPABASE_URL_FALLBACK,
    anonKey: clean(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY),
  };
}

async function requireAuthorizedUser(req) {
  const token = bearerToken(req);
  if (!token) {
    const error = new Error('Authentication is required.');
    error.status = 401;
    throw error;
  }
  const env = supabaseEnv();
  if (!env.anonKey) {
    const error = new Error('Supabase server authentication is not configured.');
    error.status = 503;
    throw error;
  }
  const supabase = createClient(env.url, env.anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    const authError = new Error('Your session is invalid or expired.');
    authError.status = 401;
    throw authError;
  }
  const { data: allowed, error: permissionError } = await supabase.rpc('can_use_lead_intelligence');
  if (permissionError || allowed !== true) {
    const permissionDenied = new Error('You do not have permission to use Lead Intelligence.');
    permissionDenied.status = 403;
    throw permissionDenied;
  }
  return { user: data.user, supabase };
}

const OUTPUT_SCHEMA = {
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
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'person_name','job_title','person_email','company_name','company_website','linkedin_url',
            'country','city','industry','company_size','estimated_locations','fit_score','confidence',
            'why_fit','likely_pain_points','public_evidence','source_urls','suggested_connection_note','suggested_follow_up'
          ],
          properties: {
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
            confidence: { type: 'string', enum: ['high','medium','low'] },
            why_fit: { type: 'string' },
            likely_pain_points: { type: 'array', items: { type: 'string' } },
            public_evidence: { type: 'array', items: { type: 'string' } },
            source_urls: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['title','url','supports'],
                properties: {
                  title: { type: 'string' },
                  url: { type: 'string' },
                  supports: { type: 'string' },
                },
              },
            },
            suggested_connection_note: { type: 'string' },
            suggested_follow_up: { type: 'string' },
          },
        },
      },
    },
  },
};

function promptFor(criteria) {
  return [
    'Research real, current B2B prospects for the customer-facing InCheck 360 operations platform.',
    'InCheck 360 helps multi-location teams execute digital checks and inspections, report issues, assign corrective actions, follow up to closure, collect evidence, and give management cross-location visibility.',
    'Do NOT confuse this product with Monitor Core, the internal ERP.',
    '',
    `Countries: ${criteria.countries.join(', ') || 'Any relevant market'}`,
    `Industries: ${criteria.industries.join(', ') || 'F&B, hospitality, retail, manufacturing and other operationally intensive businesses'}`,
    `Target roles: ${criteria.target_roles.join(', ') || 'Head of Operations, Operations Director, Quality Manager, QHSE Manager'}`,
    `Company profile: ${criteria.company_profile || 'Multi-location operator with recurring quality, safety, compliance or maintenance execution needs'}`,
    `Minimum locations/sites when evidence is available: ${criteria.min_locations}`,
    `Additional keywords: ${criteria.keywords.join(', ') || 'none'}`,
    `Exclude: ${criteria.exclusions.join(', ') || 'none'}`,
    `Return at most ${criteria.count} prospects.`,
    '',
    'Quality rules:',
    '- Use public web research. Return only real people whose current role and current company are supported by public evidence.',
    '- Never invent a person, employer, job title, email address, LinkedIn URL, website, location count, or source URL.',
    '- A LinkedIn URL may be included only when the exact public profile URL is found. Otherwise return an empty string.',
    '- A business email may be included only when it is explicitly public. Never infer email patterns.',
    '- Prefer decision makers who can own operations, quality, QHSE, food safety, compliance, maintenance, facilities or multi-site execution.',
    '- Avoid recruiters, students, generic consultants and roles without operational buying influence unless the criteria explicitly request them.',
    '- Source URLs must be direct public URLs that support the candidate. Do not fabricate citations.',
    '- If evidence is weak, lower confidence and fit score or omit the candidate entirely.',
    '- Fit score: role relevance 40%, operational/multi-location complexity 25%, industry fit 20%, evidence confidence 15%.',
    '- suggested_connection_note must be natural, non-pitchy, personalized to the role, and <= 200 characters.',
    '- suggested_follow_up should be concise, low-pressure, mention the relevant operational problem, ask one easy pain-discovery question, and offer a short walkthrough.',
    '- Keep likely pain points evidence-based and role-appropriate; label them as likely, not confirmed facts.',
  ].join('\n');
}

function extractOutputText(payload = {}) {
  if (clean(payload.output_text)) return clean(payload.output_text);
  const chunks = [];
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    if (item?.type !== 'message') continue;
    for (const content of Array.isArray(item.content) ? item.content : []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') chunks.push(content.text);
    }
  }
  return chunks.join('\n').trim();
}

function safeUrl(value = '') {
  const raw = clean(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function normalizeSuggestion(source = {}) {
  const person = clean(source.person_name).slice(0, 220);
  const company = clean(source.company_name).slice(0, 260);
  if (!person || !company) return null;
  const linkedin = safeUrl(source.linkedin_url);
  const fingerprint = (linkedin || `${person}|${company}`).toLowerCase().replace(/[^a-z0-9@./|:_-]+/g, ' ').trim().slice(0, 500);
  const sourceUrls = (Array.isArray(source.source_urls) ? source.source_urls : []).map(item => ({
    title: clean(item?.title).slice(0, 240),
    url: safeUrl(item?.url),
    supports: clean(item?.supports).slice(0, 500),
  })).filter(item => item.url).slice(0, 8);
  return {
    person_name: person,
    job_title: clean(source.job_title).slice(0, 220),
    person_email: clean(source.person_email).slice(0, 320),
    company_name: company,
    company_website: safeUrl(source.company_website),
    linkedin_url: linkedin,
    country: clean(source.country).slice(0, 120),
    city: clean(source.city).slice(0, 120),
    industry: clean(source.industry).slice(0, 180),
    company_size: clean(source.company_size).slice(0, 180),
    estimated_locations: Number.isInteger(source.estimated_locations) && source.estimated_locations >= 0 ? source.estimated_locations : null,
    fit_score: clampInt(source.fit_score, 0, 100, 0),
    confidence: ['high','medium','low'].includes(clean(source.confidence).toLowerCase()) ? clean(source.confidence).toLowerCase() : 'low',
    why_fit: clean(source.why_fit).slice(0, 1800),
    likely_pain_points: list(source.likely_pain_points, 8).map(value => value.slice(0, 500)),
    public_evidence: list(source.public_evidence, 10).map(value => value.slice(0, 800)),
    source_urls: sourceUrls,
    suggested_connection_note: clean(source.suggested_connection_note).slice(0, 200),
    suggested_follow_up: clean(source.suggested_follow_up).slice(0, 1400),
    fingerprint,
  };
}

async function callOpenAI(criteria) {
  const apiKey = clean(process.env.OPENAI_API_KEY);
  if (!apiKey) {
    const error = new Error('OpenAI is not configured yet. Add OPENAI_API_KEY to the Vercel project environment.');
    error.status = 503;
    throw error;
  }
  const model = clean(process.env.OPENAI_LEAD_MODEL) || 'gpt-5.6-sol';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55_000);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        store: false,
        reasoning: { effort: 'medium' },
        tools: [{ type: 'web_search' }],
        tool_choice: 'auto',
        include: ['web_search_call.action.sources'],
        instructions: 'You are the Lead Intelligence research engine for InCheck 360. Accuracy and verifiable public evidence are more important than quantity. Follow the requested JSON schema exactly.',
        input: promptFor(criteria),
        text: { format: OUTPUT_SCHEMA },
        max_output_tokens: 6000,
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = clean(payload?.error?.message || payload?.message) || `OpenAI request failed (${response.status}).`;
      const error = new Error(message);
      error.status = response.status >= 400 && response.status < 500 ? 502 : response.status;
      throw error;
    }
    const outputText = extractOutputText(payload);
    if (!outputText) throw new Error('OpenAI returned no structured prospect results.');
    let parsed;
    try { parsed = JSON.parse(outputText); }
    catch { throw new Error('OpenAI returned an unreadable prospect result.'); }
    const seen = new Set();
    const suggestions = (Array.isArray(parsed?.suggestions) ? parsed.suggestions : [])
      .map(normalizeSuggestion)
      .filter(Boolean)
      .filter(item => {
        if (!item.fingerprint || seen.has(item.fingerprint)) return false;
        seen.add(item.fingerprint);
        return true;
      })
      .sort((a, b) => b.fit_score - a.fit_score)
      .slice(0, criteria.count);
    return {
      response_id: clean(payload.id),
      model: clean(payload.model || model),
      usage: payload.usage && typeof payload.usage === 'object' ? payload.usage : {},
      suggestions,
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeout = new Error('Lead research timed out. Please try a narrower search.');
      timeout.status = 504;
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  try {
    await requireAuthorizedUser(req);
    const method = String(req.method || 'GET').toUpperCase();
    if (method === 'GET') {
      return res.status(200).json({
        ok: true,
        configured: Boolean(clean(process.env.OPENAI_API_KEY)),
        model: clean(process.env.OPENAI_LEAD_MODEL) || 'gpt-5.6-sol',
        max_suggestions: MAX_SUGGESTIONS,
      });
    }
    if (method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'Method not allowed.' });
    }
    const criteria = normalizeCriteria(req.body && typeof req.body === 'object' ? req.body : {});
    if (!criteria.countries.length && !criteria.industries.length && !criteria.target_roles.length && !criteria.company_profile) {
      return res.status(400).json({ ok: false, error: 'Add at least one country, industry, target role or company profile.' });
    }
    const result = await callOpenAI(criteria);
    return res.status(200).json({ ok: true, criteria, ...result });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return res.status(status).json({
      ok: false,
      error: clean(error?.message) || 'Lead Intelligence request failed.',
    });
  }
}
