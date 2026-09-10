const EDGE_GATEWAY = 'https://rewgbmfcrbgkzxcbrxjy.supabase.co/functions/v1/outlook-calendar-gateway';
const DEFAULT_CLIENT_ID = '163ee873-b3b3-4a08-b0cd-9a933a8c2861';
const DEFAULT_TENANT_ID = '5deca149-2c90-4af4-8dae-b6b2b12f5548';
const OUTLOOK_PUBLIC_BASE_URL = 'https://portal.incheck360.com';

function text(value = '') {
  return String(value ?? '').trim();
}

function queryText(value) {
  return Array.isArray(value) ? text(value[0]) : text(value);
}

function actionOf(req) {
  return queryText(req.query?.action).toLowerCase();
}

function publicErrorRedirect(message = '') {
  const target = new URL('/', OUTLOOK_PUBLIC_BASE_URL);
  target.searchParams.set('outlook', 'error');
  target.searchParams.set('outlook_error', text(message || 'Unable to connect Microsoft Outlook.').slice(0, 180));
  target.hash = 'employee-calendar';
  return target.toString();
}

function gatewayHeaders(req) {
  const clientSecret = text(process.env.MICROSOFT_CLIENT_SECRET);
  if (!clientSecret) {
    const error = new Error('Microsoft Outlook integration is not configured yet.');
    error.status = 503;
    throw error;
  }

  const headers = {
    accept: 'application/json',
    'x-monitor-ms-client-id': text(process.env.MICROSOFT_CLIENT_ID) || DEFAULT_CLIENT_ID,
    'x-monitor-ms-client-secret': clientSecret,
    'x-monitor-ms-tenant-id': text(process.env.MICROSOFT_TENANT_ID) || DEFAULT_TENANT_ID,
    // Outlook OAuth/webhook URLs must always use the canonical production portal,
    // never a Vercel deployment alias or an old APP_BASE_URL environment value.
    'x-monitor-app-base-url': OUTLOOK_PUBLIC_BASE_URL,
  };

  const authorization = text(req.headers?.authorization || req.headers?.Authorization);
  if (authorization) headers.authorization = authorization;
  return headers;
}

function targetUrl(req, action) {
  const target = new URL(EDGE_GATEWAY);
  target.searchParams.set('action', action);
  for (const key of ['code', 'state', 'error', 'error_description', 'validationToken']) {
    const value = queryText(req.query?.[key]);
    if (value) target.searchParams.set(key, value);
  }
  return target.toString();
}

function serializedBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  if (req.body == null || req.body === '') return '{}';
  return typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
}

async function forward(req, action) {
  const headers = gatewayHeaders(req);
  const body = serializedBody(req);
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(targetUrl(req, action), {
    method: req.method,
    headers,
    body,
    cache: 'no-store',
  });
}

export default async function handler(req, res) {
  const action = actionOf(req);
  const method = String(req.method || 'GET').toUpperCase();

  try {
    if (!['connect', 'status', 'callback', 'settings', 'sync', 'disconnect', 'webhook', 'maintenance'].includes(action)) {
      return res.status(404).json({ ok: false, error: 'Unknown Outlook Calendar action.' });
    }

    // Webhook renewal also runs whenever a connected user opens Calendar/status.
    // Keep the scheduled route harmless until a server-authenticated maintenance channel is added.
    if (action === 'maintenance') {
      return res.status(200).json({ ok: true, skipped: true });
    }

    if (action === 'connect' && method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed.' });
    if (action === 'status' && method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed.' });
    if (action === 'callback' && method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed.' });
    if (action === 'settings' && method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed.' });
    if (action === 'sync' && method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed.' });
    if (action === 'disconnect' && method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed.' });
    if (action === 'webhook' && method !== 'POST' && !queryText(req.query?.validationToken)) {
      return res.status(405).json({ ok: false, error: 'Method not allowed.' });
    }

    const response = await forward(req, action);
    const raw = await response.text();
    const contentType = response.headers.get('content-type') || '';

    if (action === 'callback') {
      let payload = {};
      try { payload = raw ? JSON.parse(raw) : {}; } catch (_) {}
      if (payload?.redirectUrl) return res.redirect(302, payload.redirectUrl);
      return res.redirect(302, publicErrorRedirect(payload?.error || payload?.message || `Outlook callback failed (${response.status}).`));
    }

    if (action === 'webhook' && queryText(req.query?.validationToken)) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(response.status).send(raw);
    }

    res.setHeader('Cache-Control', 'no-store, max-age=0');
    if (contentType.includes('application/json')) {
      let payload = {};
      try { payload = raw ? JSON.parse(raw) : {}; } catch (_) {
        payload = { ok: false, error: raw || `Outlook gateway failed (${response.status}).` };
      }
      if (payload && payload.ok === false && !payload.error && payload.message) payload.error = payload.message;
      return res.status(response.status).json(payload);
    }

    res.setHeader('Content-Type', contentType || 'text/plain; charset=utf-8');
    return res.status(response.status).send(raw);
  } catch (error) {
    if (action === 'callback') {
      return res.redirect(302, publicErrorRedirect(error?.message));
    }
    return res.status(Number(error?.status) || 500).json({
      ok: false,
      error: text(error?.message) || 'Outlook Calendar request failed.',
    });
  }
}
