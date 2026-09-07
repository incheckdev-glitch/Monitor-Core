function text(value = '') {
  return String(value ?? '').trim();
}

function extractBearerToken(req) {
  return text(
    req.headers?.authorization ||
    req.headers?.Authorization ||
    req.headers?.['x-supabase-access-token']
  )
    .replace(/^Bearer\s+/i, '')
    .trim();
}

function getBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body)); } catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }

  const callerToken = extractBearerToken(req);
  if (!callerToken) {
    return res.status(401).json({ ok: false, error: 'Missing authorization.' });
  }

  const supabaseUrl = text(
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    'https://rewgbmfcrbgkzxcbrxjy.supabase.co'
  ).replace(/\/$/, '');

  const body = getBody(req);
  const forwardBody = {
    ...body,
    title: text(body.title) || 'InCheck360 Server Test',
    body: text(body.body) || 'Server push is working.',
    url: text(body.url) || '/?pushTest=1',
    tag: text(body.tag) || 'server-test-push',
    data: body.data && typeof body.data === 'object' ? body.data : { test: true }
  };

  try {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${callerToken}`
    };

    const publicKey = text(
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY
    );
    if (publicKey) headers.apikey = publicKey;

    const response = await fetch(`${supabaseUrl}/functions/v1/send-web-push-v2`, {
      method: 'POST',
      headers,
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
