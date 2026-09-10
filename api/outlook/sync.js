import {
  loadConnection,
  reconcileFromOutlook,
  requireActiveUser,
  safeConnection,
  syncUserToOutlook
} from '../../src/server/outlookGraph.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed. Use POST.' });
  }

  try {
    const { user, admin } = await requireActiveUser(req);

    // Push CRM changes first. This avoids an old Outlook copy overwriting a CRM edit
    // that the user has just saved before pressing Sync Now.
    const push = await syncUserToOutlook(admin, user.id, req);
    const pull = push?.connected && !push?.disabled
      ? await reconcileFromOutlook(admin, user.id, req)
      : { processed: 0, updated: 0, deleted: 0, failed: 0 };

    const connection = await loadConnection(admin, user.id);
    return res.status(200).json({
      ok: true,
      push,
      pull,
      connection: safeConnection(connection, req)
    });
  } catch (error) {
    console.error('[Outlook sync] failed', error);
    return res.status(Number(error?.status) || 500).json({
      ok: false,
      error: String(error?.message || 'Unable to synchronize Outlook Calendar.')
    });
  }
}
