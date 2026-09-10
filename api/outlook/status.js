import {
  ensureWebhookSubscription,
  loadConnection,
  requireActiveUser,
  safeConnection
} from '../../src/server/outlookGraph.js';

function safeWithSettings(connection, req) {
  const safe = safeConnection(connection, req);
  return connection
    ? { ...safe, inviteRelatedContacts: connection.invite_related_contacts === true }
    : { ...safe, inviteRelatedContacts: false };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed. Use GET.' });
  }

  try {
    const { user, admin } = await requireActiveUser(req);
    let connection = await loadConnection(admin, user.id);
    if (connection?.status === 'connected' && connection?.two_way_enabled !== false) {
      connection = await ensureWebhookSubscription(admin, user.id, req);
    }
    return res.status(200).json({ ok: true, connection: safeWithSettings(connection, req) });
  } catch (error) {
    console.error('[Outlook status] failed', error);
    return res.status(Number(error?.status) || 500).json({
      ok: false,
      error: String(error?.message || 'Unable to load Outlook connection status.')
    });
  }
}
