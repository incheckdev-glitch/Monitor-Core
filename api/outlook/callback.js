import {
  callbackRedirect,
  consumeOauthState,
  createServerClients,
  ensureWebhookSubscription,
  exchangeAuthorizationCode,
  saveConnectionFromTokens
} from '../../src/server/outlookGraph.js';

function queryText(value) {
  return Array.isArray(value) ? String(value[0] || '').trim() : String(value || '').trim();
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method Not Allowed');
  }

  const { admin } = createServerClients();
  try {
    const rawState = queryText(req.query?.state);
    const stateRow = await consumeOauthState(admin, rawState);
    if (!stateRow) {
      return res.redirect(302, callbackRedirect(req, 'error', 'Microsoft sign-in expired or could not be verified. Please connect Outlook again.'));
    }

    const oauthError = queryText(req.query?.error_description || req.query?.error);
    if (oauthError) {
      return res.redirect(302, callbackRedirect(req, 'error', oauthError));
    }

    const code = queryText(req.query?.code);
    if (!code) {
      return res.redirect(302, callbackRedirect(req, 'error', 'Microsoft did not return an authorization code.'));
    }

    const tokenPayload = await exchangeAuthorizationCode(req, stateRow, code);
    await saveConnectionFromTokens(admin, stateRow.user_id, req, tokenPayload);
    await ensureWebhookSubscription(admin, stateRow.user_id, req);

    return res.redirect(302, callbackRedirect(req, 'connected'));
  } catch (error) {
    console.error('[Outlook callback] failed', error);
    return res.redirect(302, callbackRedirect(req, 'error', String(error?.message || 'Unable to connect Microsoft Outlook.')));
  }
}
