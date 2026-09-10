import {
  disconnectOutlook,
  requireActiveUser,
  safeConnection
} from '../../src/server/outlookGraph.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed. Use POST.' });
  }

  try {
    const { user, admin } = await requireActiveUser(req);
    const connection = await disconnectOutlook(admin, user.id, req);
    return res.status(200).json({ ok: true, connection: safeConnection(connection, req) });
  } catch (error) {
    console.error('[Outlook disconnect] failed', error);
    return res.status(Number(error?.status) || 500).json({
      ok: false,
      error: String(error?.message || 'Unable to disconnect Outlook Calendar.')
    });
  }
}
