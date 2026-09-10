import {
  createServerClients,
  ensureWebhookSubscription,
  pullNotificationChange,
  reconcileFromOutlook
} from '../../src/server/outlookGraph.js';

function text(value = '') {
  return String(value ?? '').trim();
}

function bodyObject(body) {
  if (body && typeof body === 'object') return body;
  try { return text(body) ? JSON.parse(String(body)) : {}; } catch { return {}; }
}

function queryText(value) {
  return Array.isArray(value) ? text(value[0]) : text(value);
}

export default async function handler(req, res) {
  const validationToken = queryText(req.query?.validationToken);
  if (validationToken) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send(validationToken);
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed. Use POST.' });
  }

  const { admin } = createServerClients();
  const payload = bodyObject(req.body);
  const notifications = Array.isArray(payload?.value) ? payload.value.slice(0, 50) : [];

  if (!notifications.length) return res.status(202).json({ ok: true, processed: 0 });

  let processed = 0;
  let ignored = 0;
  let failed = 0;

  for (const notification of notifications) {
    const subscriptionId = text(notification?.subscriptionId);
    if (!subscriptionId) {
      ignored += 1;
      continue;
    }

    let connection = null;
    try {
      const lookup = await admin
        .from('outlook_calendar_connections')
        .select('*')
        .eq('webhook_subscription_id', subscriptionId)
        .maybeSingle();
      if (lookup.error) throw lookup.error;
      connection = lookup.data;
      if (!connection || !connection.webhook_client_state || text(notification?.clientState) !== text(connection.webhook_client_state)) {
        ignored += 1;
        continue;
      }

      const lifecycle = text(notification?.lifecycleEvent).toLowerCase();
      if (lifecycle === 'missed') {
        await reconcileFromOutlook(admin, connection.user_id, req);
      } else if (lifecycle === 'subscriptionremoved') {
        await admin.from('outlook_calendar_connections').update({
          webhook_subscription_id: null,
          webhook_expires_at: null,
          webhook_client_state: null,
          last_webhook_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }).eq('user_id', connection.user_id);
        await ensureWebhookSubscription(admin, connection.user_id, req);
      } else if (lifecycle === 'reauthorizationrequired') {
        await ensureWebhookSubscription(admin, connection.user_id, req);
      } else {
        await pullNotificationChange(admin, connection, notification, req);
      }

      await admin.from('outlook_calendar_connections').update({
        last_webhook_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString()
      }).eq('user_id', connection.user_id);
      processed += 1;
    } catch (error) {
      failed += 1;
      console.error('[Outlook webhook] notification failed', subscriptionId, error);
      if (connection?.user_id) {
        try {
          await admin.from('outlook_calendar_connections').update({
            last_error: `Webhook: ${text(error?.message)}`,
            updated_at: new Date().toISOString()
          }).eq('user_id', connection.user_id);
        } catch (_) {}
      }
    }
  }

  return res.status(202).json({ ok: true, processed, ignored, failed });
}
