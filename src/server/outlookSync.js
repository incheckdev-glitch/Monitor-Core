import { createHash } from 'crypto';
import {
  ensureWebhookSubscription,
  graphFetch,
  loadConnection,
  validAccessToken
} from './outlookGraph.js';

function text(value = '') {
  return String(value ?? '').trim();
}

function nowIso() {
  return new Date().toISOString();
}

function sha256(value = '') {
  return createHash('sha256').update(String(value)).digest('hex');
}

function isUuid(value = '') {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(value));
}

function graphDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace(/Z$/, '');
}

async function relatedAttendees(admin, connection, row) {
  const inviteEnabled = connection?.invite_related_contacts === true || row?.outlook_invite_related_contact === true;
  if (!inviteEnabled || text(row?.related_resource) !== 'contacts' || !text(row?.related_id)) return [];

  let query = admin
    .from('contacts')
    .select('id,contact_id,full_name,first_name,last_name,email')
    .limit(1);
  query = isUuid(row.related_id)
    ? query.eq('id', row.related_id)
    : query.eq('contact_id', row.related_id);

  const result = await query.maybeSingle();
  if (result.error || !result.data) return [];
  const email = text(result.data.email);
  if (!email) return [];
  const name = text(result.data.full_name || `${result.data.first_name || ''} ${result.data.last_name || ''}`) || email;
  return [{ emailAddress: { address: email, name }, type: 'required' }];
}

function teamsEnabled(connection, row) {
  const providers = Array.isArray(connection?.allowed_online_meeting_providers)
    ? connection.allowed_online_meeting_providers
    : [];
  return connection?.teams_default === true
    && text(row?.event_type) === 'Meeting'
    && providers.includes('teamsForBusiness');
}

function desiredHash(row, attendees, withTeams) {
  return sha256(JSON.stringify({
    title: text(row?.title),
    description: text(row?.description),
    type: text(row?.event_type),
    status: text(row?.status),
    start: text(row?.start_at),
    end: text(row?.end_at),
    allDay: Boolean(row?.all_day),
    location: text(row?.location),
    privacy: text(row?.privacy),
    showAs: text(row?.show_as),
    relatedResource: text(row?.related_resource),
    relatedId: text(row?.related_id),
    attendees: (attendees || []).map(a => text(a?.emailAddress?.address).toLowerCase()).sort(),
    teams: Boolean(withTeams)
  }));
}

function graphPayload(row, attendees, withTeams, create = false) {
  const start = graphDateTime(row.start_at);
  const fallbackEnd = new Date(new Date(row.start_at).getTime() + 60 * 60 * 1000).toISOString();
  const end = graphDateTime(row.end_at || fallbackEnd);
  const payload = {
    subject: text(row.title),
    body: { contentType: 'text', content: text(row.description) },
    start: { dateTime: start, timeZone: 'UTC' },
    end: { dateTime: end, timeZone: 'UTC' },
    isAllDay: Boolean(row.all_day),
    showAs: text(row.show_as) === 'free' ? 'free' : 'busy',
    sensitivity: text(row.privacy) === 'private' ? 'private' : 'normal',
    location: { displayName: text(row.location) },
    attendees: attendees || [],
    categories: ['InCheck360 CRM']
  };
  if (create) payload.transactionId = String(row.id);
  if (withTeams) {
    payload.isOnlineMeeting = true;
    payload.onlineMeetingProvider = 'teamsForBusiness';
  }
  return payload;
}

async function markLocalLinkCleared(admin, row) {
  const result = await admin
    .from('employee_calendar_events')
    .update({
      outlook_event_id: null,
      outlook_change_key: null,
      outlook_ical_uid: null,
      outlook_web_url: null,
      outlook_last_modified_at: null,
      outlook_last_synced_at: nowIso(),
      outlook_sync_status: 'synced',
      outlook_sync_error: null,
      outlook_teams_enabled: false
    })
    .eq('id', row.id)
    .eq('owner_user_id', row.owner_user_id);
  if (result.error) throw result.error;
}

async function deleteRemote(admin, row, accessToken) {
  if (!row.outlook_event_id) return false;
  try {
    await graphFetch(accessToken, `/me/events/${encodeURIComponent(row.outlook_event_id)}`, { method: 'DELETE' });
  } catch (error) {
    if (Number(error?.status) !== 404) throw error;
  }
  await markLocalLinkCleared(admin, row);
  return true;
}

async function pushRow(admin, connection, row, accessToken) {
  if (text(row.event_type) === 'Personal') return { skipped: true };
  if (text(row.status) === 'Cancelled') {
    const deleted = await deleteRemote(admin, row, accessToken);
    return deleted ? { deleted: true } : { skipped: true };
  }

  const attendees = await relatedAttendees(admin, connection, row);
  const withTeams = teamsEnabled(connection, row);
  const hash = desiredHash(row, attendees, withTeams);
  if (row.outlook_event_id && row.outlook_sync_status === 'synced' && row.outlook_sync_hash === hash) {
    return { skipped: true };
  }

  let remote = null;
  let created = false;
  if (row.outlook_event_id) {
    try {
      remote = await graphFetch(accessToken, `/me/events/${encodeURIComponent(row.outlook_event_id)}`, {
        method: 'PATCH',
        body: graphPayload(row, attendees, withTeams, false)
      });
    } catch (error) {
      if (Number(error?.status) !== 404) throw error;
    }
  }

  if (!remote) {
    created = true;
    remote = await graphFetch(accessToken, '/me/calendar/events', {
      method: 'POST',
      body: graphPayload(row, attendees, withTeams, true)
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
    outlook_sync_hash: hash,
    outlook_sync_status: 'synced',
    outlook_sync_error: null,
    outlook_teams_enabled: Boolean(remote?.isOnlineMeeting || withTeams)
  };
  if (meetingUrl) patch.meeting_url = meetingUrl;

  const result = await admin
    .from('employee_calendar_events')
    .update(patch)
    .eq('id', row.id)
    .eq('owner_user_id', row.owner_user_id);
  if (result.error) throw result.error;
  return created ? { created: true } : { updated: true };
}

async function processTombstones(admin, userId, accessToken, counts) {
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
      try {
        await graphFetch(accessToken, `/me/events/${encodeURIComponent(tombstone.outlook_event_id)}`, { method: 'DELETE' });
      } catch (error) {
        if (Number(error?.status) !== 404) throw error;
      }
      await admin
        .from('outlook_event_tombstones')
        .update({ processed_at: nowIso(), last_error: null })
        .eq('id', tombstone.id);
      counts.deleted += 1;
    } catch (error) {
      counts.failed += 1;
      await admin
        .from('outlook_event_tombstones')
        .update({ last_error: text(error?.message) })
        .eq('id', tombstone.id);
    }
  }
}

export async function syncCrmToOutlook(admin, userId, req) {
  let connection = await loadConnection(admin, userId);
  if (!connection || connection.status !== 'connected' || !connection.refresh_token) {
    return { connected: false, processed: 0, created: 0, updated: 0, deleted: 0, failed: 0 };
  }
  if (connection.two_way_enabled === false) {
    return { connected: true, disabled: true, processed: 0, created: 0, updated: 0, deleted: 0, failed: 0 };
  }

  const accessToken = await validAccessToken(admin, connection, req);
  const counts = { connected: true, processed: 0, created: 0, updated: 0, deleted: 0, failed: 0 };
  await processTombstones(admin, userId, accessToken, counts);

  const pastDays = Number(connection.sync_window_past_days || 30);
  const futureDays = Number(connection.sync_window_future_days || 365);
  const start = new Date(Date.now() - pastDays * 86400000).toISOString();
  const end = new Date(Date.now() + futureDays * 86400000).toISOString();
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
      const outcome = await pushRow(admin, connection, row, accessToken);
      if (outcome.created) counts.created += 1;
      if (outcome.updated) counts.updated += 1;
      if (outcome.deleted) counts.deleted += 1;
    } catch (error) {
      counts.failed += 1;
      await admin
        .from('employee_calendar_events')
        .update({
          outlook_sync_status: 'error',
          outlook_sync_error: text(error?.message),
          outlook_last_synced_at: nowIso()
        })
        .eq('id', row.id)
        .eq('owner_user_id', userId);
    }
  }

  const finishedAt = nowIso();
  await admin
    .from('outlook_calendar_connections')
    .update({
      last_push_sync_at: finishedAt,
      last_sync_at: finishedAt,
      last_error: counts.failed ? `${counts.failed} calendar item(s) could not be synced.` : null,
      updated_at: finishedAt
    })
    .eq('user_id', userId);

  connection = await ensureWebhookSubscription(admin, userId, req);
  return { ...counts, webhookActive: Boolean(connection?.webhook_subscription_id) };
}
