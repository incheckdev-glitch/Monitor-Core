import {
  callbackRedirect,
  consumeOauthState,
  createOauthRequest,
  createServerClients,
  disconnectOutlook,
  ensureWebhookSubscription,
  exchangeAuthorizationCode,
  loadConnection,
  pullNotificationChange,
  reconcileFromOutlook,
  requireActiveUser,
  safeConnection,
  saveConnectionFromTokens,
  updateConnectionSettings
} from '../src/server/outlookGraph.js';
import { syncCrmToOutlook } from '../src/server/outlookSync.js';

function text(value = '') {
  return String(value ?? '').trim();
}

// Supabase's current Vercel integration uses SUPABASE_SECRET_KEY /
// SUPABASE_PUBLISHABLE_KEY. Keep legacy variable names compatible so the
// Outlook backend works with either generation without exposing a server key.
function bootstrapSupabaseEnvironment() {
  if (!text(process.env.SUPABASE_URL)) {
    process.env.SUPABASE_URL = text(
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL
    ) || 'https://rewgbmfcrbgkzxcbrxjy.supabase.co';
  }

  if (!text(process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    const serverSecret = text(
      process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY
    );
    if (serverSecret) process.env.SUPABASE_SERVICE_ROLE_KEY = serverSecret;
  }

  if (!text(process.env.SUPABASE_ANON_KEY)) {
    const publicKey = text(
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY
    );
    if (publicKey) process.env.SUPABASE_ANON_KEY = publicKey;
  }
}

bootstrapSupabaseEnvironment();

function bodyObject(body) {
  if (body && typeof body === 'object') return body;
  try { return text(body) ? JSON.parse(String(body)) : {}; } catch { return {}; }
}

function queryText(value) {
  return Array.isArray(value) ? text(value[0]) : text(value);
}

function actionOf(req) {
  return queryText(req.query?.action).toLowerCase();
}

function safeWithSettings(connection, req) {
  const safe = safeConnection(connection, req);
  return connection
    ? { ...safe, inviteRelatedContacts: connection.invite_related_contacts === true }
    : { ...safe, inviteRelatedContacts: false };
}

async function connect(req, res) {
  const { user, admin } = await requireActiveUser(req);
  const result = await createOauthRequest(admin, user.id, req);
  return res.status(200).json({ ok: true, ...result });
}

async function status(req, res) {
  const { user, admin } = await requireActiveUser(req);
  let connection = await loadConnection(admin, user.id);
  if (connection?.status === 'connected' && connection?.two_way_enabled !== false) {
    connection = await ensureWebhookSubscription(admin, user.id, req);
  }
  return res.status(200).json({ ok: true, connection: safeWithSettings(connection, req) });
}

async function callback(req, res) {
  const { admin } = createServerClients();
  const rawState = queryText(req.query?.state);
  const stateRow = await consumeOauthState(admin, rawState);
  if (!stateRow) {
    return res.redirect(302, callbackRedirect(req, 'error', 'Microsoft sign-in expired or could not be verified. Please connect Outlook again.'));
  }

  const oauthError = queryText(req.query?.error_description || req.query?.error);
  if (oauthError) return res.redirect(302, callbackRedirect(req, 'error', oauthError));

  const code = queryText(req.query?.code);
  if (!code) return res.redirect(302, callbackRedirect(req, 'error', 'Microsoft did not return an authorization code.'));

  const tokenPayload = await exchangeAuthorizationCode(req, stateRow, code);
  await saveConnectionFromTokens(admin, stateRow.user_id, req, tokenPayload);
  await ensureWebhookSubscription(admin, stateRow.user_id, req);
  return res.redirect(302, callbackRedirect(req, 'connected'));
}

async function settings(req, res) {
  const { user, admin } = await requireActiveUser(req);
  const payload = bodyObject(req.body);
  let connection = await updateConnectionSettings(admin, user.id, {
    twoWayEnabled: typeof payload.twoWayEnabled === 'boolean' ? payload.twoWayEnabled : undefined,
    teamsDefault: typeof payload.teamsDefault === 'boolean' ? payload.teamsDefault : undefined
  }, req);

  if (typeof payload.inviteRelatedContacts === 'boolean') {
    const updated = await admin
      .from('outlook_calendar_connections')
      .update({ invite_related_contacts: payload.inviteRelatedContacts, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .select('*')
      .maybeSingle();
    if (updated.error) throw updated.error;
    connection = updated.data || connection;
  }

  return res.status(200).json({ ok: true, connection: safeWithSettings(connection, req) });
}

async function sync(req, res) {
  const { user, admin } = await requireActiveUser(req);
  const push = await syncCrmToOutlook(admin, user.id, req);
  const pull = push?.connected && !push?.disabled
    ? await reconcileFromOutlook(admin, user.id, req)
    : { processed: 0, updated: 0, deleted: 0, failed: 0 };
  const connection = await loadConnection(admin, user.id);
  return res.status(200).json({ ok: true, push, pull, connection: safeWithSettings(connection, req) });
}

async function disconnect(req, res) {
  const { user, admin } = await requireActiveUser(req);
  const connection = await disconnectOutlook(admin, user.id, req);
  return res.status(200).json({ ok: true, connection: safeWithSettings(connection, req) });
}

async function webhook(req, res) {
  const validationToken = queryText(req.query?.validationToken);
  if (validationToken) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send(validationToken);
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
    if (!subscriptionId) { ignored += 1; continue; }

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

async function maintenance(req, res) {
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
  if (connections.error) throw connections.error;

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

export default async function handler(req, res) {
  const action = actionOf(req);
  const method = String(req.method || 'GET').toUpperCase();

  try {
    if (action === 'connect' && method === 'GET') return await connect(req, res);
    if (action === 'status' && method === 'GET') return await status(req, res);
    if (action === 'callback' && method === 'GET') return await callback(req, res);
    if (action === 'settings' && method === 'POST') return await settings(req, res);
    if (action === 'sync' && method === 'POST') return await sync(req, res);
    if (action === 'disconnect' && method === 'POST') return await disconnect(req, res);
    if (action === 'webhook' && (method === 'POST' || queryText(req.query?.validationToken))) return await webhook(req, res);
    if (action === 'maintenance' && method === 'GET') return await maintenance(req, res);

    return res.status(404).json({ ok: false, error: 'Unknown Outlook Calendar action.' });
  } catch (error) {
    console.error(`[Outlook ${action || 'unknown'}] failed`, error);
    if (action === 'callback') {
      try { return res.redirect(302, callbackRedirect(req, 'error', String(error?.message || 'Unable to connect Microsoft Outlook.'))); } catch (_) {}
    }
    return res.status(Number(error?.status) || 500).json({
      ok: false,
      error: String(error?.message || 'Outlook Calendar request failed.')
    });
  }
}
