function firstEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

export default function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }

  const config = {
    SUPABASE_URL: firstEnv('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'VITE_SUPABASE_URL'),
    SUPABASE_ANON_KEY: firstEnv('SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY'),
    APP_BASE_URL: firstEnv('APP_BASE_URL', 'PUBLIC_APP_URL'),
    BUSINESS_TIMEZONE: firstEnv('BUSINESS_TIMEZONE') || 'UTC',
    PUSH_VAPID_PUBLIC_KEY: firstEnv('PUSH_VAPID_PUBLIC_KEY', 'VAPID_PUBLIC_KEY', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'VITE_VAPID_PUBLIC_KEY'),
    TICKET_REPLY_EMAIL: firstEnv('TICKET_REPLY_EMAIL', 'SUPPORT_EMAIL')
  };

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'HEAD') return res.status(200).end();
  return res.status(200).send(`window.RUNTIME_CONFIG = Object.assign({}, window.RUNTIME_CONFIG || {}, ${JSON.stringify(config)});\n`);
}
