function text(value = '') {
  return String(value ?? '').trim();
}

const MONITOR_CORE_PUSH_CONFIG_URL =
  'https://rewgbmfcrbgkzxcbrxjy.supabase.co/functions/v1/notification-push-public-config';

async function loadMonitorCorePublicKey() {
  const response = await fetch(MONITOR_CORE_PUSH_CONFIG_URL, {
    method: 'GET',
    headers: { Accept: 'application/json' }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.ok === false) {
    throw new Error(text(result?.error) || `Monitor Core push config failed with HTTP ${response.status}`);
  }
  return text(result?.vapidPublicKey || result?.publicKey);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }

  let publicKey = text(
    process.env.VAPID_PUBLIC_KEY ||
      process.env.PUSH_VAPID_PUBLIC_KEY ||
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
      process.env.VITE_VAPID_PUBLIC_KEY
  );

  try {
    if (!publicKey) publicKey = await loadMonitorCorePublicKey();
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: text(error?.message || error) || 'Unable to load the push public key.'
    });
  }

  if (!publicKey) {
    return res.status(500).json({ ok: false, error: 'Push public key is unavailable.' });
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  return res.status(200).json({
    ok: true,
    vapidPublicKey: publicKey,
    publicKey,
    first12: publicKey.slice(0, 12),
    last12: publicKey.slice(-12)
  });
}
