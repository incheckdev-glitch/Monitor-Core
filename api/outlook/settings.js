import {
  requireActiveUser,
  safeConnection,
  updateConnectionSettings
} from '../../src/server/outlookGraph.js';

function bodyObject(body) {
  if (body && typeof body === 'object') return body;
  try { return body ? JSON.parse(String(body)) : {}; } catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed. Use POST.' });
  }

  try {
    const { user, admin } = await requireActiveUser(req);
    const payload = bodyObject(req.body);
    const connection = await updateConnectionSettings(admin, user.id, {
      twoWayEnabled: typeof payload.twoWayEnabled === 'boolean' ? payload.twoWayEnabled : undefined,
      teamsDefault: typeof payload.teamsDefault === 'boolean' ? payload.teamsDefault : undefined
    }, req);
    return res.status(200).json({ ok: true, connection: safeConnection(connection, req) });
  } catch (error) {
    console.error('[Outlook settings] failed', error);
    return res.status(Number(error?.status) || 500).json({
      ok: false,
      error: String(error?.message || 'Unable to update Outlook calendar settings.')
    });
  }
}
