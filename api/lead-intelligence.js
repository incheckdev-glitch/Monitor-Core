import { createClient } from '@supabase/supabase-js';
import crmDailyBriefHandler from '../src/server/crm-daily-brief-handler.js';

export const config = { maxDuration: 60 };

const SB_URL = 'https://rewgbmfcrbgkzxcbrxjy.supabase.co';
const MODEL = 'gpt-5.6-luna';
const MAX_SUGGESTIONS = 5;
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

async function requireAuthorizedUser(req) {
  const token = clean(req.headers?.authorization || req.headers?.Authorization).replace(/^Bearer\s+/i, '');
  if (!token) throw Object.assign(new Error('Authentication is required.'), { status: 401 });

  const anonKey = clean(
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY
  );
  if (!anonKey) throw Object.assign(new Error('Supabase server authentication is not configured.'), { status: 503 });

  const supabase = createClient(clean(process.env.SUPABASE_URL) || SB_URL, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) throw Object.assign(new Error('Your session is invalid or expired.'), { status: 401 });

  const permission = await supabase.rpc('can_use_lead_intelligence');
  if (permission.error || permission.data !== true) {
    throw Object.assign(new Error('You do not have permission to use Lead Intelligence.'), { status: 403 });
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  const mode = clean(req.query?.mode).toLowerCase();
  if (mode === 'crm_daily_brief') {
    return crmDailyBriefHandler(req, res);
  }

  try {
    await requireAuthorizedUser(req);
    const method = String(req.method || 'GET').toUpperCase();

    if (method === 'GET') {
      return res.status(200).json({
        ok: true,
        configured: Boolean(clean(process.env.OPENAI_API_KEY)),
        model: MODEL,
        mode: 'background-economy',
        max_suggestions: MAX_SUGGESTIONS,
        default_suggestions: 3,
        max_web_calls: 3,
      });
    }

    if (method === 'POST') {
      return res.status(410).json({
        ok: false,
        error: 'Synchronous Lead Intelligence research is disabled. Use the background research flow.',
      });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  } catch (error) {
    return res.status(Number(error?.status) || 500).json({
      ok: false,
      error: clean(error?.message) || 'Lead Intelligence request failed.',
    });
  }
}
