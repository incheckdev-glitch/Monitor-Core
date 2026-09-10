import {
  createServerClients,
  ensureWebhookSubscription,
  reconcileFromOutlook
} from '../../src/server/outlookGraph.js';
import { syncCrmToOutlook } from '../../src/server/outlookSync.js';

function text(value = '') {
  return String(value ?? '').trim();
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed. Use GET.' });
  }

  const expected = text(process.env.CRON_SECRET);
  const auth = text(req.headers?.authorization || req.headers?.Authorization);
  if (!expected) return res.status(503).json({ ok: false, error: 'CRON_SECRET is not configured.' });
  if (auth !== `Bearer ${expected}`) return res.status(401).json({ ok: false, error: 'Unauthorized.' });

  const { admin } = createServerClients();
  const connections = await admin
    .from('outlook_calendar_connections')
    .select('user_id,status,two_way_enabled')
    .eq('status', 'connected')
    .eq('two_way_enabled', true)
    .limit(250);

  if (connections.error) {
    console.error('[Outlook maintenance] connection query failed', connections.error);
    return res.status(500).json({ ok: false, error: connections.error.message });
  }

  const result = { processed: 0, succeeded: 0, failed: 0 };
  for (const connection of connections.data || []) {
    result.processed += 1;
    try {
      await ensureWebhookSubscription(admin, connection.user_id, req);
      await syncCrmToOutlook(admin, connection.user_id, req);
      await reconcileFromOutlook(admin, connection.user_id, req);
      result.succeeded += 1;
    } catch (error) {
      result.failed += 1;
      console.error('[Outlook maintenance] user failed', connection.user_id, error);
      try {
        await admin.from('outlook_calendar_connections').update({
          last_error: `Maintenance: ${text(error?.message)}`,
          updated_at: new Date().toISOString()
        }).eq('user_id', connection.user_id);
      } catch (_) {}
    }
  }

  return res.status(200).json({ ok: true, ...result });
}
