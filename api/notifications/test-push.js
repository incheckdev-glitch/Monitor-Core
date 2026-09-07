import { createClient } from '@supabase/supabase-js';

const ADMIN_ROLES = new Set(['admin', 'administrator', 'super_admin', 'dev']);

function text(value = '') {
  return String(value ?? '').trim();
}

function lower(value = '') {
  return text(value).toLowerCase();
}

function extractBearerToken(req) {
  return text(req.headers?.authorization || req.headers?.Authorization)
    .replace(/^Bearer\s+/i, '')
    .trim();
}

function getBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body)); } catch { return {}; }
}

async function findProfile(supabaseAdmin, user) {
  const candidates = [
    ['auth_user_id', user?.id],
    ['id', user?.id],
    ['email', user?.email]
  ];
  for (const [column, value] of candidates) {
    if (!text(value)) continue;
    try {
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq(column, value)
        .limit(1)
        .maybeSingle();
      if (!error && data) return data;
    } catch {}
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }

  const supabaseUrl = text(
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    'https://rewgbmfcrbgkzxcbrxjy.supabase.co'
  );
  const serviceRoleKey = text(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ ok: false, error: 'Server is missing Supabase admin configuration.' });
  }

  const callerToken = extractBearerToken(req);
  if (!callerToken) return res.status(401).json({ ok: false, error: 'Missing authorization.' });

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(callerToken);
  if (userError || !userData?.user) {
    return res.status(401).json({ ok: false, error: 'Invalid authorization.' });
  }

  const profile = await findProfile(supabaseAdmin, userData.user);
  const role = lower(
    profile?.role_key ||
    profile?.role ||
    userData.user?.app_metadata?.role ||
    userData.user?.user_metadata?.role
  );
  const isAdmin = ADMIN_ROLES.has(role);
  const body = getBody(req);

  const forwardBody = {
    ...body,
    title: text(body.title) || 'InCheck360 Server Test',
    body: text(body.body) || 'Server push is working.',
    url: text(body.url) || '/?pushTest=1',
    tag: text(body.tag) || 'server-test-push',
    data: body.data && typeof body.data === 'object' ? body.data : { test: true }
  };

  if (!isAdmin) {
    delete forwardBody.subscription_ids;
    delete forwardBody.subscription_id;
    delete forwardBody.roles;
    delete forwardBody.role;
    delete forwardBody.allow_broadcast;
    forwardBody.user_ids = [text(profile?.id || userData.user.id)];
  }

  try {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/send-web-push-v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey
      },
      body: JSON.stringify(forwardBody)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.ok === false) {
      return res.status(response.status || 500).json({
        ok: false,
        error: text(result?.error || result?.message) || `Push sender failed with HTTP ${response.status}`,
        ...result
      });
    }
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: text(error?.message || error) || 'Server push test failed.'
    });
  }
}
