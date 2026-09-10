import { createHash, randomBytes } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const OAUTH_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'https://graph.microsoft.com/User.Read',
  'https://graph.microsoft.com/Calendars.ReadWrite'
].join(' ');

function text(value = '') {
  return String(value ?? '').trim();
}

function nowIso() {
  return new Date().toISOString();
}

function base64Url(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function sha256(value = '') {
  return createHash('sha256').update(String(value)).digest('hex');
}

function pkceChallenge(verifier) {
  return base64Url(createHash('sha256').update(verifier).digest());
}

function bearerToken(req) {
  return text(req?.headers?.authorization || req?.headers?.Authorization).replace(/^Bearer\s+/i, '');
}

function isUuid(value = '') {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(value));
}

function supabaseConfig() {
  const url = text(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL);
  const anon = text(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY);
  const service = text(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !service) throw new Error('Supabase server configuration is incomplete.');
  return { url, anon: anon || service, service };
}

export function appOrigin(req) {
  const configured = text(process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL).replace(/\/+$/, '');
  if (configured) return configured;
  const proto = text(req?.headers?.['x-forwarded-proto'] || 'https').split(',')[0];
  const host = text(req?.headers?.['x-forwarded-host'] || req?.headers?.host).split(',')[0];
  if (!host) throw new Error('Unable to determine the public application URL.');
  return `${proto}://${host}`.replace(/\/+$/, '');
}

export function outlookRedirectUri(req) {
  return text(process.env.OUTLOOK_REDIRECT_URI) || `${appOrigin(req)}/api/outlook/callback`;
}

export function outlookWebhookUrl(req) {
  return text(process.env.OUTLOOK_WEBHOOK_URL) || `${appOrigin(req)}/api/outlook/webhook`;
}

export function microsoftSettings(req) {
  const clientId = text(process.env.MICROSOFT_CLIENT_ID);
  const clientSecret = text(process.env.MICROSOFT_CLIENT_SECRET);
  const tenantId = text(process.env.MICROSOFT_TENANT_ID) || 'organizations';
  return {
    configured: Boolean(clientId && clientSecret),
    clientId,
    clientSecret,
    tenantId,
    redirectUri: outlookRedirectUri(req),
    webhookUrl: outlookWebhookUrl(req),
    scopes: OAUTH_SCOPES
  };
}

export function createServerClients() {
  const cfg = supabaseConfig();
  const authClient = createClient(cfg.url, cfg.anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const admin = createClient(cfg.url, cfg.service, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  return { authClient, admin };
}

export async function requireActiveUser(req) {
  const token = bearerToken(req);
  if (!token) {
    const error = new Error('Your session expired. Please log in again.');
    error.status = 401;
    throw error;
  }

  const { authClient, admin } = createServerClients();
  const verified = await authClient.auth.getUser(token);
  const user = verified?.data?.user;
  if (verified.error || !user?.id) {
    const error = new Error('Your session expired. Please log in again.');
    error.status = 401;
    throw error;
  }

  const profile = await admin
    .from('profiles')
    .select('id,role_key,is_active,display_name,email')
    .eq('id', user.id)
    .maybeSingle();
  if (profile.error) throw profile.error;
  if (!profile.data || profile.data.is_active === false) {
    const error = new Error('Your user profile is inactive or unavailable.');
    error.status = 403;
    throw error;
  }

  return { user, profile: profile.data, admin, token };
}

export function safeConnection(connection, req) {
  const cfg = microsoftSettings(req);
  if (!connection) {
    return {
      configured: cfg.configured,
      connected: false,
      status: 'disconnected',
      redirectUri: cfg.redirectUri,
      permissions: ['User.Read', 'Calendars.ReadWrite']
    };
  }
  return {
    configured: cfg.configured,
    connected: connection.status === 'connected' && Boolean(connection.refresh_token),
    status: connection.status,
    email: connection.microsoft_email || null,
    displayName: connection.microsoft_display_name || null,
    tenantId: connection.tenant_id || null,
    calendarName: connection.primary_calendar_name || 'Calendar',
    twoWayEnabled: connection.two_way_enabled !== false,
    teamsDefault: connection.teams_default === true,
    teamsAvailable: Array.isArray(connection.allowed_online_meeting_providers)
      && connection.allowed_online_meeting_providers.includes('teamsForBusiness'),
    lastSyncAt: connection.last_sync_at || null,
    webhookActive: Boolean(connection.webhook_subscription_id && connection.webhook_expires_at && new Date(connection.webhook_expires_at) > new Date()),
    webhookExpiresAt: connection.webhook_expires_at || null,
    lastError: connection.last_error || null,
    syncMode: connection.sync_mode || 'crm_only',
    redirectUri: cfg.redirectUri,
    permissions: ['User.Read', 'Calendars.ReadWrite']
  };
}

export async function loadConnection(admin, userId) {
  const result = await admin
    .from('outlook_calendar_connections')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data || null;
}

async function tokenRequest(config, params) {
  const body = new URLSearchParams(params);
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = text(payload?.error_description || payload?.error?.message || payload?.error || 'Microsoft token request failed.');
    const error = new Error(message);
    error.status = response.status;
    error.microsoftCode = payload?.error || null;
    throw error;
  }
  return payload;
}

export async function createOauthRequest(admin, userId, req) {
  const config = microsoftSettings(req);
  if (!config.configured) {
    const error = new Error('Microsoft Outlook integration is not configured yet.');
    error.status = 503;
    throw error;
  }

  await admin.from('outlook_oauth_states').delete().eq('user_id', userId);
  await admin.from('outlook_oauth_states').delete().lt('expires_at', nowIso());

  const state = base64Url(randomBytes(32));
  const verifier = base64Url(randomBytes(64));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const stored = await admin.from('outlook_oauth_states').insert({
    state_hash: sha256(state),
    user_id: userId,
    code_verifier: verifier,
    redirect_uri: config.redirectUri,
    return_hash: '#employee-calendar',
    expires_at: expiresAt
  });
  if (stored.error) throw stored.error;

  const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/authorize`);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', config.scopes);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', pkceChallenge(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('prompt', 'select_account');
  return { authorizationUrl: url.toString(), redirectUri: config.redirectUri };
}

export async function consumeOauthState(admin, rawState) {
  const state = text(rawState);
  if (!state) return null;
  const result = await admin
    .from('outlook_oauth_states')
    .select('*')
    .eq('state_hash', sha256(state))
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data || new Date(result.data.expires_at) <= new Date()) return null;
  await admin.from('outlook_oauth_states').delete().eq('state_hash', result.data.state_hash);
  return result.data;
}

export async function exchangeAuthorizationCode(req, stateRow, code) {
  const config = microsoftSettings(req);
  if (!config.configured) throw new Error('Microsoft Outlook integration is not configured yet.');
  const payload = await tokenRequest(config, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'authorization_code',
    code: text(code),
    redirect_uri: stateRow.redirect_uri,
    code_verifier: stateRow.code_verifier,
    scope: config.scopes
  });
  return payload;
}

export async function graphFetch(accessToken, pathOrUrl, options = {}) {
  const url = /^https:\/\//i.test(pathOrUrl) ? pathOrUrl : `${GRAPH_BASE}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
  const headers = {
    authorization: `Bearer ${accessToken}`,
    accept: 'application/json',
    ...(options.headers || {})
  };
  let body = options.body;
  if (body && typeof body !== 'string') {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const response = await fetch(url, { ...options, headers, body });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(text(payload?.error?.message || payload?.error_description || `Microsoft Graph request failed (${response.status}).`));
    error.status = response.status;
    error.graphCode = payload?.error?.code || null;
    throw error;
  }
  return payload;
}

export async function saveConnectionFromTokens(admin, userId, req, tokenPayload) {
  const config = microsoftSettings(req);
  const accessToken = text(tokenPayload?.access_token);
  const refreshToken = text(tokenPayload?.refresh_token);
  if (!accessToken || !refreshToken) throw new Error('Microsoft did not return the required calendar tokens.');

  const profile = await graphFetch(accessToken, '/me?$select=id,displayName,mail,userPrincipalName');
  const calendar = await graphFetch(accessToken, '/me/calendar?$select=id,name,allowedOnlineMeetingProviders,defaultOnlineMeetingProvider');
  const tenantId = text(tokenPayload?.id_token ? decodeJwtPayload(tokenPayload.id_token)?.tid : '') || config.tenantId;
  const expiresIn = Number(tokenPayload?.expires_in || 3600);
  const row = {
    user_id: userId,
    status: 'connected',
    tenant_id: tenantId,
    microsoft_user_id: text(profile?.id) || null,
    microsoft_email: text(profile?.mail || profile?.userPrincipalName) || null,
    microsoft_display_name: text(profile?.displayName) || null,
    primary_calendar_id: text(calendar?.id) || null,
    primary_calendar_name: text(calendar?.name) || 'Calendar',
    allowed_online_meeting_providers: Array.isArray(calendar?.allowedOnlineMeetingProviders) ? calendar.allowedOnlineMeetingProviders : [],
    default_online_meeting_provider: text(calendar?.defaultOnlineMeetingProvider) || null,
    access_token: accessToken,
    access_token_expires_at: new Date(Date.now() + Math.max(60, expiresIn - 60) * 1000).toISOString(),
    refresh_token: refreshToken,
    token_type: text(tokenPayload?.token_type) || 'Bearer',
    scope: text(tokenPayload?.scope) || OAUTH_SCOPES,
    connected_at: nowIso(),
    last_error: null,
    updated_at: nowIso()
  };
  const saved = await admin
    .from('outlook_calendar_connections')
    .upsert(row, { onConflict: 'user_id' })
    .select('*')
    .single();
  if (saved.error) throw saved.error;
  return saved.data;
}

function decodeJwtPayload(jwt) {
  try {
    const segment = String(jwt).split('.')[1];
    if (!segment) return null;
    return JSON.parse(Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

export async function validAccessToken(admin, connection, req) {
  if (!connection) throw new Error('Outlook is not connected.');
  const expiresAt = connection.access_token_expires_at ? new Date(connection.access_token_expires_at).getTime() : 0;
  if (connection.access_token && expiresAt > Date.now() + 120000) return connection.access_token;
  if (!connection.refresh_token) {
    await admin.from('outlook_calendar_connections').update({ status: 'needs_reauth', last_error: 'Microsoft refresh token is unavailable.', updated_at: nowIso() }).eq('user_id', connection.user_id);
    const error = new Error('Outlook needs to be reconnected.');
    error.status = 409;
    throw error;
  }

  const config = microsoftSettings(req);
  try {
    const payload = await tokenRequest(config, {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: connection.refresh_token,
      scope: config.scopes
    });
    const expiresIn = Number(payload?.expires_in || 3600);
    const patch = {
      access_token: text(payload?.access_token),
      access_token_expires_at: new Date(Date.now() + Math.max(60, expiresIn - 60) * 1000).toISOString(),
      refresh_token: text(payload?.refresh_token) || connection.refresh_token,
      token_type: text(payload?.token_type) || connection.token_type || 'Bearer',
      scope: text(payload?.scope) || connection.scope || config.scopes,
      status: 'connected',
      last_error: null,
      updated_at: nowIso()
    };
    const updated = await admin.from('outlook_calendar_connections').update(patch).eq('user_id', connection.user_id).select('*').single();
    if (updated.error) throw updated.error;
    Object.assign(connection, updated.data);
    return patch.access_token;
  } catch (error) {
    await admin.from('outlook_calendar_connections').update({
      status: error?.microsoftCode === 'invalid_grant' ? 'needs_reauth' : 'error',
      last_error: text(error?.message),
      updated_at: nowIso()
    }).eq('user_id', connection.user_id);
    throw error;
  }
}

function subscriptionExpiry() {
  return new Date(Date.now() + (6 * 24 + 20) * 60 * 60 * 1000).toISOString();
}

export async function ensureWebhookSubscription(admin, userId, req) {
  let connection = await loadConnection(admin, userId);
  if (!connection || connection.status !== 'connected' || !connection.refresh_token || connection.two_way_enabled === false) return connection;
  const currentExpiry = connection.webhook_expires_at ? new Date(connection.webhook_expires_at).getTime() : 0;
  if (connection.webhook_subscription_id && currentExpiry > Date.now() + 24 * 60 * 60 * 1000) return connection;

  const accessToken = await validAccessToken(admin, connection, req);
  const expirationDateTime = subscriptionExpiry();
  const config = microsoftSettings(req);
  try {
    if (connection.webhook_subscription_id) {
      try {
        const renewed = await graphFetch(accessToken, `/subscriptions/${encodeURIComponent(connection.webhook_subscription_id)}`, {
          method: 'PATCH',
          body: { expirationDateTime }
        });
        const updated = await admin.from('outlook_calendar_connections').update({
          webhook_expires_at: renewed?.expirationDateTime || expirationDateTime,
          last_error: null,
          updated_at: nowIso()
        }).eq('user_id', userId).select('*').single();
        if (updated.error) throw updated.error;
        return updated.data;
      } catch (error) {
        if (Number(error?.status) !== 404) throw error;
      }
    }

    const clientState = base64Url(randomBytes(24));
    const created = await graphFetch(accessToken, '/subscriptions', {
      method: 'POST',
      body: {
        changeType: 'created,updated,deleted',
        notificationUrl: config.webhookUrl,
        lifecycleNotificationUrl: config.webhookUrl,
        resource: '/me/events',
        expirationDateTime,
        clientState
      }
    });
    const updated = await admin.from('outlook_calendar_connections').update({
      webhook_subscription_id: created?.id || null,
      webhook_expires_at: created?.expirationDateTime || expirationDateTime,
      webhook_client_state: clientState,
      last_error: null,
      updated_at: nowIso()
    }).eq('user_id', userId).select('*').single();
    if (updated.error) throw updated.error;
    return updated.data;
  } catch (error) {
    await admin.from('outlook_calendar_connections').update({ last_error: `Webhook: ${text(error?.message)}`, updated_at: nowIso() }).eq('user_id', userId);
    return loadConnection(admin, userId);
  }
}

function graphDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace(/Z$/, '');
}

function graphToIso(value) {
  const raw = text(value?.dateTime);
  if (!raw) return null;
  try {
    if (/Z$|[+-]\d\d:\d\d$/i.test(raw)) return new Date(raw).toISOString();
    if (text(value?.timeZone).toUpperCase() === 'UTC') return new Date(`${raw}Z`).toISOString();
    return new Date(raw).toISOString();
  } catch {
    return null;
  }
}

async function relatedAttendees(admin, row) {
  if (text(row?.related_resource) !== 'contacts' || !text(row?.related_id)) return [];
  let query = admin.from('contacts').select('id,contact_id,full_name,first_name,last_name,email').limit(1);
  query = isUuid(row.related_id) ? query.eq('id', row.related_id) : query.eq('contact_id', row.related_id);
  const result = await query.maybeSingle();
  if (result.error) return [];
  const email = text(result.data?.email);
  if (!email) return [];
  const name = text(result.data?.full_name || `${result.data?.first_name || ''} ${result.data?.last_name || ''}`) || email;
  return [{ emailAddress: { address: email, name }, type: 'required' }];
}

function syncHash(row, attendees, teamsEnabled) {
  const attendeeEmails = (attendees || []).map(a => text(a?.emailAddress?.address).toLowerCase()).sort();
  return sha256(JSON.stringify({
    title: text(row?.title),
    description: text(row?.description),
    eventType: text(row?.event_type),
    status: text(row?.status),
    startAt: text(row?.start_at),
    endAt: text(row?.end_at),
    allDay: Boolean(row?.all_day),
    location: text(row?.location),
    privacy: text(row?.privacy),
    showAs: text(row?.show_as),
    relatedResource: text(row?.related_resource),
    relatedId: text(row?.related_id),
    attendees: attendeeEmails,
    teamsEnabled: Boolean(teamsEnabled)
  }));
}

function graphEventPayload(row, attendees, teamsEnabled, create = false) {
  const startAt = graphDateTime(row.start_at);
  const fallbackEnd = new Date(new Date(row.start_at).getTime() + 60 * 60 * 1000).toISOString();
  const endAt = graphDateTime(row.end_at || fallbackEnd);
  const payload = {
    subject: text(row.title),
    body: { contentType: 'text', content: text(row.description) },
    start: { dateTime: startAt, timeZone: 'UTC' },
    end: { dateTime: endAt, timeZone: 'UTC' },
    isAllDay: Boolean(row.all_day),
    showAs: text(row.show_as) === 'free' ? 'free' : 'busy',
    sensitivity: text(row.privacy) === 'private' ? 'private' : 'normal',
    location: { displayName: text(row.location) },
    attendees: attendees || [],
    categories: ['InCheck360 CRM']
  };
  if (create) payload.transactionId = String(row.id);
  if (teamsEnabled) {
    payload.isOnlineMeeting = true;
    payload.onlineMeetingProvider = 'teamsForBusiness';
  }
  return payload;
}

async function clearLocalOutlookLink(admin, row, status = 'synced', errorMessage = null) {
  const patch = {
    outlook_event_id: null,
    outlook_change_key: null,
    outlook_ical_uid: null,
    outlook_web_url: null,
    outlook_last_modified_at: null,
    outlook_last_synced_at: nowIso(),
    outlook_sync_status: status,
    outlook_sync_error: errorMessage,
    outlook_teams_enabled: false
  };
  const result = await admin.from('employee_calendar_events').update(patch).eq('id', row.id).eq('owner_user_id', row.owner_user_id);
  if (result.error) throw result.error;
}

async function deleteRemoteForRow(admin, row, accessToken) {
  if (!row.outlook_event_id) return;
  try {
    await graphFetch(accessToken, `/me/events/${encodeURIComponent(row.outlook_event_id)}`, { method: 'DELETE' });
  } catch (error) {
    if (Number(error?.status) !== 404) throw error;
  }
  await clearLocalOutlookLink(admin, row);
}

async function pushOneEvent(admin, connection, row, accessToken) {
  if (text(row.event_type) === 'Personal') return { skipped: true };
  if (text(row.status) === 'Cancelled') {
    if (row.outlook_event_id) await deleteRemoteForRow(admin, row, accessToken);
    return { deleted: true };
  }

  const attendees = await relatedAttendees(admin, row);
  const teamsAvailable = Array.isArray(connection.allowed_online_meeting_providers)
    && connection.allowed_online_meeting_providers.includes('teamsForBusiness');
  const teamsEnabled = connection.teams_default === true && text(row.event_type) === 'Meeting' && teamsAvailable;
  const desiredHash = syncHash(row, attendees, teamsEnabled);
  if (row.outlook_event_id && row.outlook_sync_status === 'synced' && row.outlook_sync_hash === desiredHash) {
    return { skipped: true };
  }

  let remote = null;
  if (row.outlook_event_id) {
    try {
      remote = await graphFetch(accessToken, `/me/events/${encodeURIComponent(row.outlook_event_id)}`, {
        method: 'PATCH',
        body: graphEventPayload(row, attendees, teamsEnabled, false)
      });
    } catch (error) {
      if (Number(error?.status) !== 404) throw error;
    }
  }
  if (!remote) {
    remote = await graphFetch(accessToken, '/me/calendar/events', {
      method: 'POST',
      body: graphEventPayload(row, attendees, teamsEnabled, true)
    });
  }

  const meetingUrl = text(remote?.onlineMeeting?.joinUrl);
  const patch = {
    outlook_event_id: text(remote?.id) || row.outlook_event_id || null,
    outlook_change_key: text(remote?.changeKey) || null,
    outlook_ical_uid: text(remote?.iCalUId) || null,
    outlook_web_url: text(remote?.webLink) || null,
    outlook_last_modified_at: remote?.lastModifiedDateTime || null,
    outlook_last_synced_at: nowIso(),
    outlook_sync_hash: desiredHash,
    outlook_sync_status: 'synced',
    outlook_sync_error: null,
    outlook_teams_enabled: Boolean(remote?.isOnlineMeeting || teamsEnabled)
  };
  if (meetingUrl) patch.meeting_url = meetingUrl;
  const saved = await admin.from('employee_calendar_events').update(patch).eq('id', row.id).eq('owner_user_id', row.owner_user_id);
  if (saved.error) throw saved.error;
  return { created: !row.outlook_event_id, updated: Boolean(row.outlook_event_id) };
}

export async function syncUserToOutlook(admin, userId, req) {
  let connection = await loadConnection(admin, userId);
  if (!connection || connection.status !== 'connected' || !connection.refresh_token) {
    return { connected: false, processed: 0, created: 0, updated: 0, deleted: 0, failed: 0 };
  }
  if (connection.two_way_enabled === false) {
    return { connected: true, disabled: true, processed: 0, created: 0, updated: 0, deleted: 0, failed: 0 };
  }
  const accessToken = await validAccessToken(admin, connection, req);
  const counts = { connected: true, processed: 0, created: 0, updated: 0, deleted: 0, failed: 0 };

  const tombstones = await admin
    .from('outlook_event_tombstones')
    .select('*')
    .eq('owner_user_id', userId)
    .is('processed_at', null)
    .order('created_at')
    .limit(100);
  if (tombstones.error) throw tombstones.error;
  for (const tombstone of tombstones.data || []) {
    try {
      await graphFetch(accessToken, `/me/events/${encodeURIComponent(tombstone.outlook_event_id)}`, { method: 'DELETE' });
      await admin.from('outlook_event_tombstones').update({ processed_at: nowIso(), last_error: null }).eq('id', tombstone.id);
      counts.deleted += 1;
    } catch (error) {
      if (Number(error?.status) === 404) {
        await admin.from('outlook_event_tombstones').update({ processed_at: nowIso(), last_error: null }).eq('id', tombstone.id);
        counts.deleted += 1;
      } else {
        await admin.from('outlook_event_tombstones').update({ last_error: text(error?.message) }).eq('id', tombstone.id);
        counts.failed += 1;
      }
    }
  }

  const start = new Date(Date.now() - Number(connection.sync_window_past_days || 30) * 86400000).toISOString();
  const end = new Date(Date.now() + Number(connection.sync_window_future_days || 365) * 86400000).toISOString();
  const events = await admin
    .from('employee_calendar_events')
    .select('*')
    .eq('owner_user_id', userId)
    .neq('event_type', 'Personal')
    .gte('start_at', start)
    .lte('start_at', end)
    .order('start_at')
    .limit(500);
  if (events.error) throw events.error;

  for (const row of events.data || []) {
    counts.processed += 1;
    try {
      const result = await pushOneEvent(admin, connection, row, accessToken);
      if (result.created) counts.created += 1;
      if (result.updated) counts.updated += 1;
      if (result.deleted) counts.deleted += 1;
    } catch (error) {
      counts.failed += 1;
      await admin.from('employee_calendar_events').update({
        outlook_sync_status: 'error',
        outlook_sync_error: text(error?.message),
        outlook_last_synced_at: nowIso()
      }).eq('id', row.id).eq('owner_user_id', userId);
    }
  }

  const finishedAt = nowIso();
  await admin.from('outlook_calendar_connections').update({
    last_push_sync_at: finishedAt,
    last_sync_at: finishedAt,
    last_error: counts.failed ? `${counts.failed} calendar item(s) could not be synced.` : null,
    updated_at: finishedAt
  }).eq('user_id', userId);
  connection = await ensureWebhookSubscription(admin, userId, req);
  return { ...counts, webhookActive: Boolean(connection?.webhook_subscription_id) };
}

function plainTextBody(remote) {
  if (text(remote?.body?.contentType).toLowerCase() === 'text') return text(remote?.body?.content);
  return text(remote?.bodyPreview).replace(/<[^>]+>/g, ' ');
}

async function applyRemoteEvent(admin, connection, localRow, remote) {
  const patch = {
    title: text(remote?.subject) || localRow.title,
    description: plainTextBody(remote) || null,
    start_at: graphToIso(remote?.start) || localRow.start_at,
    end_at: graphToIso(remote?.end) || localRow.end_at,
    all_day: Boolean(remote?.isAllDay),
    location: text(remote?.location?.displayName) || null,
    meeting_url: text(remote?.onlineMeeting?.joinUrl) || localRow.meeting_url || null,
    show_as: text(remote?.showAs) === 'free' ? 'free' : 'busy',
    privacy: text(remote?.sensitivity) === 'private' ? 'private' : localRow.privacy,
    status: remote?.isCancelled ? 'Cancelled' : localRow.status,
    outlook_change_key: text(remote?.changeKey) || localRow.outlook_change_key || null,
    outlook_ical_uid: text(remote?.iCalUId) || localRow.outlook_ical_uid || null,
    outlook_web_url: text(remote?.webLink) || localRow.outlook_web_url || null,
    outlook_last_modified_at: remote?.lastModifiedDateTime || null,
    outlook_last_synced_at: nowIso(),
    outlook_sync_status: 'synced',
    outlook_sync_error: null,
    outlook_teams_enabled: Boolean(remote?.isOnlineMeeting)
  };
  const merged = { ...localRow, ...patch };
  const attendees = await relatedAttendees(admin, merged);
  const teamsAvailable = Array.isArray(connection.allowed_online_meeting_providers)
    && connection.allowed_online_meeting_providers.includes('teamsForBusiness');
  const teamsEnabled = connection.teams_default === true && text(merged.event_type) === 'Meeting' && teamsAvailable;
  patch.outlook_sync_hash = syncHash(merged, attendees, teamsEnabled);
  const result = await admin.from('employee_calendar_events').update(patch).eq('id', localRow.id).eq('owner_user_id', localRow.owner_user_id);
  if (result.error) throw result.error;
}

async function markRemoteDeleted(admin, localRow) {
  const patch = {
    status: 'Cancelled',
    outlook_event_id: null,
    outlook_change_key: null,
    outlook_web_url: null,
    outlook_sync_status: 'synced',
    outlook_sync_error: null,
    outlook_last_synced_at: nowIso(),
    outlook_teams_enabled: false
  };
  const result = await admin.from('employee_calendar_events').update(patch).eq('id', localRow.id).eq('owner_user_id', localRow.owner_user_id);
  if (result.error) throw result.error;
}

function eventIdFromNotification(notification) {
  const direct = text(notification?.resourceData?.id);
  if (direct) return direct;
  const resource = text(notification?.resource);
  const match = resource.match(/events\/([^/?]+)(?:$|[/?])/i);
  return match ? decodeURIComponent(match[1]) : '';
}

export async function pullNotificationChange(admin, connection, notification, req) {
  const eventId = eventIdFromNotification(notification);
  if (!eventId) return { ignored: true };
  const local = await admin
    .from('employee_calendar_events')
    .select('*')
    .eq('owner_user_id', connection.user_id)
    .eq('outlook_event_id', eventId)
    .maybeSingle();
  if (local.error) throw local.error;
  if (!local.data) return { ignored: true };

  if (text(notification?.changeType).toLowerCase() === 'deleted') {
    await markRemoteDeleted(admin, local.data);
    return { deleted: true };
  }

  const accessToken = await validAccessToken(admin, connection, req);
  try {
    const remote = await graphFetch(accessToken, `/me/events/${encodeURIComponent(eventId)}`, {
      headers: { Prefer: 'outlook.timezone="UTC"' }
    });
    await applyRemoteEvent(admin, connection, local.data, remote);
    return { updated: true };
  } catch (error) {
    if (Number(error?.status) === 404) {
      await markRemoteDeleted(admin, local.data);
      return { deleted: true };
    }
    throw error;
  }
}

export async function reconcileFromOutlook(admin, userId, req) {
  const connection = await loadConnection(admin, userId);
  if (!connection || connection.status !== 'connected' || !connection.refresh_token || connection.two_way_enabled === false) {
    return { processed: 0, updated: 0, deleted: 0, failed: 0 };
  }
  const accessToken = await validAccessToken(admin, connection, req);
  const locals = await admin
    .from('employee_calendar_events')
    .select('*')
    .eq('owner_user_id', userId)
    .not('outlook_event_id', 'is', null)
    .limit(500);
  if (locals.error) throw locals.error;
  const result = { processed: 0, updated: 0, deleted: 0, failed: 0 };
  for (const row of locals.data || []) {
    result.processed += 1;
    try {
      const remote = await graphFetch(accessToken, `/me/events/${encodeURIComponent(row.outlook_event_id)}`, {
        headers: { Prefer: 'outlook.timezone="UTC"' }
      });
      if (remote?.changeKey && remote.changeKey === row.outlook_change_key) continue;
      await applyRemoteEvent(admin, connection, row, remote);
      result.updated += 1;
    } catch (error) {
      if (Number(error?.status) === 404) {
        await markRemoteDeleted(admin, row);
        result.deleted += 1;
      } else {
        result.failed += 1;
      }
    }
  }
  const finishedAt = nowIso();
  await admin.from('outlook_calendar_connections').update({
    last_pull_sync_at: finishedAt,
    last_sync_at: finishedAt,
    updated_at: finishedAt
  }).eq('user_id', userId);
  return result;
}

export async function updateConnectionSettings(admin, userId, patch = {}, req) {
  const allowed = {};
  if (typeof patch.twoWayEnabled === 'boolean') allowed.two_way_enabled = patch.twoWayEnabled;
  if (typeof patch.teamsDefault === 'boolean') allowed.teams_default = patch.teamsDefault;
  allowed.updated_at = nowIso();
  const result = await admin.from('outlook_calendar_connections').update(allowed).eq('user_id', userId).select('*').maybeSingle();
  if (result.error) throw result.error;
  if (result.data?.two_way_enabled) return ensureWebhookSubscription(admin, userId, req);
  return result.data;
}

export async function disconnectOutlook(admin, userId, req) {
  const connection = await loadConnection(admin, userId);
  if (!connection) return null;
  try {
    const accessToken = connection.refresh_token ? await validAccessToken(admin, connection, req) : null;
    if (accessToken && connection.webhook_subscription_id) {
      try {
        await graphFetch(accessToken, `/subscriptions/${encodeURIComponent(connection.webhook_subscription_id)}`, { method: 'DELETE' });
      } catch (_) {}
    }
  } catch (_) {}
  const result = await admin.from('outlook_calendar_connections').update({
    status: 'disconnected',
    access_token: null,
    access_token_expires_at: null,
    refresh_token: null,
    webhook_subscription_id: null,
    webhook_expires_at: null,
    webhook_client_state: null,
    last_error: null,
    updated_at: nowIso()
  }).eq('user_id', userId).select('*').single();
  if (result.error) throw result.error;
  await admin.from('employee_calendar_events').update({ outlook_sync_status: 'disconnected' }).eq('owner_user_id', userId).not('outlook_event_id', 'is', null);
  return result.data;
}

export function callbackRedirect(req, mode, message = '') {
  const target = new URL('/', appOrigin(req));
  target.searchParams.set('outlook', mode);
  if (message) target.searchParams.set('outlook_error', message.slice(0, 180));
  target.hash = 'employee-calendar';
  return target.toString();
}
