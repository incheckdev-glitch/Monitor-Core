import { createOauthRequest, requireActiveUser } from '../../src/server/outlookGraph.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed. Use GET.' });
  }

  try {
    const { user, admin } = await requireActiveUser(req);
    const result = await createOauthRequest(admin, user.id, req);
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error('[Outlook connect] failed', error);
    return res.status(Number(error?.status) || 500).json({
      ok: false,
      error: String(error?.message || 'Unable to start Microsoft Outlook connection.')
    });
  }
}
