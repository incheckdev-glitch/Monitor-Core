const crypto = require('crypto');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { root, env, mask, result, printResults, writeJson, nowIso } = require('./test-utils');

const results = [];
const created = [];
const supabaseUrl = env('TEST_SUPABASE_URL', 'SUPABASE_URL').replace(/\/+$/, '');
const anonKey = env('TEST_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY');
const serviceKey = env('TEST_SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY');
const testEmail = env('TEST_USER_EMAIL');
const testPassword = env('TEST_USER_PASSWORD');
const confirmation = env('E2E_WRITE_CONFIRM');
const marker = `IC360-NONCOMM-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

const pass = (name, details = '') => results.push(result('PASS', name, details));
function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    return String(error.message || error.details || error.hint || error.code || JSON.stringify(error));
  }
  return String(error || 'Unknown error');
}
const fail = (name, error) => results.push(result('FAIL', name, errorMessage(error)));

let userClient;
let serviceClient;
let authUser;

async function createReadUpdate({ table, label, row, updates, verify }) {
  const id = row.id;
  try {
    const inserted = await userClient.from(table).insert(row);
    if (inserted.error) throw inserted.error;
    created.push({ table, id });
    pass(`${label}: authenticated create`, id);

    const read = await userClient.from(table).select('*').eq('id', id).single();
    if (read.error) throw read.error;
    pass(`${label}: authenticated read`, id);

    const updated = await userClient.from(table).update({ ...updates, updated_at: new Date().toISOString(), updated_by: authUser.id }).eq('id', id);
    if (updated.error) throw updated.error;
    pass(`${label}: authenticated update`, Object.keys(updates).join(', '));

    const checked = await serviceClient.from(table).select('*').eq('id', id).single();
    if (checked.error) throw checked.error;
    verify(checked.data || {});
    pass(`${label}: persisted update verification`, id);
  } catch (error) {
    fail(`${label}: write lifecycle`, error);
  }
}

async function cleanupConversation(conversationId) {
  const errors = [];
  for (const table of ['communication_centre_messages', 'communication_centre_participants']) {
    const response = await serviceClient.from(table).delete().eq('conversation_id', conversationId);
    if (response.error) errors.push(`${table}: ${errorMessage(response.error)}`);
  }
  const conversationDelete = await serviceClient.from('communication_centre_conversations').delete().eq('id', conversationId);
  if (conversationDelete.error) errors.push(`communication_centre_conversations: ${errorMessage(conversationDelete.error)}`);
  if (errors.length) throw new Error(errors.join(' | '));
}

async function cleanup() {
  const errors = [];
  for (const item of [...created].reverse()) {
    try {
      if (item.kind === 'communication_conversation') {
        await cleanupConversation(item.id);
        continue;
      }
      const response = await serviceClient.from(item.table).delete().eq('id', item.id);
      if (response.error) throw response.error;
    } catch (error) {
      errors.push(`${item.table}/${item.id}: ${errorMessage(error)}`);
    }
  }
  if (errors.length) fail('Cleanup non-commercial E2E data', errors.join(' | '));
  else pass('Cleanup non-commercial E2E data', `${created.length} temporary root row(s) removed`);
}

async function testCommunicationCentre(profile) {
  try {
    const access = await userClient.rpc('cc_has_permission', { p_action: 'manage' });
    if (access.error) throw access.error;
    if (access.data !== true) throw new Error('Authenticated admin does not have Communication Centre manage permission in the database.');
    pass('Communication Centre: manage permission', 'cc_has_permission(manage) = true');

    const createResponse = await userClient.rpc('create_communication_centre_conversation', {
      p_title: `${marker} Conversation`,
      p_description: marker,
      p_category: 'General',
      p_priority: 'Normal',
      p_assigned_user_ids: [authUser.id],
      p_assigned_role: null,
      p_related_resource: null,
      p_related_record_id: null,
    });
    if (createResponse.error) throw createResponse.error;
    const conversation = Array.isArray(createResponse.data) ? createResponse.data[0] : createResponse.data;
    if (!conversation?.id) throw new Error(`Conversation RPC did not return a record: ${JSON.stringify(createResponse.data)}`);
    const conversationId = conversation.id;
    created.push({ table: 'communication_centre_conversations', id: conversationId, kind: 'communication_conversation' });
    pass('Communication Centre: secure conversation create', conversation.conversation_no || conversationId);

    const conversationRead = await userClient.from('communication_centre_conversations').select('*').eq('id', conversationId).single();
    if (conversationRead.error) throw conversationRead.error;
    pass('Communication Centre: authenticated conversation read', conversationId);

    const participantRead = await userClient
      .from('communication_centre_participants')
      .select('*')
      .eq('conversation_id', conversationId);
    if (participantRead.error) throw participantRead.error;
    const participant = (participantRead.data || []).find(row => String(row.user_id || '') === String(authUser.id));
    if (!participant) throw new Error('Conversation creation did not persist the assigned admin participant.');
    pass('Communication Centre: participant assignment', profile.email || authUser.id);

    const replyResponse = await userClient.rpc('add_communication_centre_reply_secure', {
      p_conversation_id: conversationId,
      p_message_body: marker,
      p_message_type: 'message',
      p_reply_to_message_id: null,
    });
    if (replyResponse.error) throw replyResponse.error;
    const rawMessage = Array.isArray(replyResponse.data) ? replyResponse.data[0] : replyResponse.data;
    const messageId = rawMessage?.message_id || rawMessage?.id || rawMessage;
    if (!messageId) throw new Error(`Reply RPC did not return a message ID: ${JSON.stringify(replyResponse.data)}`);
    pass('Communication Centre: secure reply create', String(messageId));

    const secureMessages = await userClient.rpc('list_communication_centre_messages_secure', { p_conversation_id: conversationId });
    if (secureMessages.error) throw secureMessages.error;
    const message = (Array.isArray(secureMessages.data) ? secureMessages.data : []).find(row => String(row.id || row.message_id || '') === String(messageId))
      || (Array.isArray(secureMessages.data) ? secureMessages.data : []).find(row => String(row.message_body || row.message || '') === marker);
    if (!message) throw new Error('Secure message list did not return the newly created reply.');
    const persistedMessageId = message.id || message.message_id || messageId;
    pass('Communication Centre: secure reply read', String(persistedMessageId));

    const editedBody = `${marker} updated`;
    const editResponse = await userClient
      .from('communication_centre_messages')
      .update({ message_body: editedBody, edited_at: new Date().toISOString() })
      .eq('id', persistedMessageId)
      .select('*')
      .single();
    if (editResponse.error) throw editResponse.error;
    if (editResponse.data?.message_body !== editedBody) throw new Error('Communication Centre message edit did not persist expected text.');
    pass('Communication Centre: authenticated message edit', String(persistedMessageId));

    const closeResponse = await userClient.rpc('close_communication_centre_conversation', { p_conversation_id: conversationId });
    if (closeResponse.error) throw closeResponse.error;
    const closed = await userClient.from('communication_centre_conversations').select('id,status').eq('id', conversationId).single();
    if (closed.error) throw closed.error;
    if (String(closed.data?.status || '').trim().toLowerCase() !== 'closed') throw new Error(`Close RPC returned but status is ${closed.data?.status || '(blank)'}.`);
    pass('Communication Centre: close conversation', 'Closed');

    const reopenResponse = await userClient.rpc('reopen_communication_centre_conversation', { p_conversation_id: conversationId });
    if (reopenResponse.error) throw reopenResponse.error;
    const reopened = await userClient.from('communication_centre_conversations').select('id,status').eq('id', conversationId).single();
    if (reopened.error) throw reopened.error;
    if (String(reopened.data?.status || '').trim().toLowerCase() !== 'open') throw new Error(`Reopen RPC returned but status is ${reopened.data?.status || '(blank)'}.`);
    pass('Communication Centre: reopen conversation', 'Open');
  } catch (error) {
    fail('Communication Centre: secure write lifecycle', error);
  }
}

async function main() {
  if (confirmation !== 'RUN') throw new Error('Non-commercial production write E2E is locked. Set E2E_WRITE_CONFIRM=RUN only in the dedicated workflow.');
  if (!supabaseUrl || !anonKey || !serviceKey || !testEmail || !testPassword) {
    throw new Error('TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, TEST_SUPABASE_SERVICE_ROLE_KEY, TEST_USER_EMAIL and TEST_USER_PASSWORD are required.');
  }

  userClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

  const { data: auth, error: authError } = await userClient.auth.signInWithPassword({ email: testEmail, password: testPassword });
  if (authError || !auth?.user || !auth?.session) throw authError || new Error('Test-user login failed.');
  authUser = auth.user;
  const profileResponse = await userClient.from('profiles').select('id,email,role_key,is_active').eq('id', auth.user.id).single();
  if (profileResponse.error) throw profileResponse.error;
  const profile = profileResponse.data;
  if (!profile?.role_key || profile.is_active === false) throw new Error('Test user does not have an active role profile.');
  if (String(profile.role_key).toLowerCase() !== 'admin') throw new Error(`Non-commercial write E2E requires admin; received ${profile.role_key}.`);
  pass('Authenticate non-commercial production test user', `${mask(profile.email || testEmail)} → ${profile.role_key}`);

  const now = new Date().toISOString();
  const later = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  await createReadUpdate({
    table: 'tickets',
    label: 'Ticket',
    row: {
      id: crypto.randomUUID(),
      ticket_id: `E2E-TICKET-${Date.now()}`,
      date_submitted: now,
      title: `${marker} Ticket`,
      status: 'New',
      name: 'E2E Test User',
      department: 'Testing',
      description: marker,
      priority: 'Low',
      module: 'Backend',
      created_at: now,
      updated_at: now,
      created_by: auth.user.id,
      updated_by: auth.user.id,
    },
    updates: { status: 'Not Started Yet', priority: 'Medium' },
    verify: row => {
      if (row.status !== 'Not Started Yet' || row.priority !== 'Medium') throw new Error('Ticket update did not persist expected status/priority.');
    },
  });

  await createReadUpdate({
    table: 'events',
    label: 'Event',
    row: {
      id: crypto.randomUUID(),
      event_code: `E2E-EVENT-${Date.now()}`,
      title: `${marker} Event`,
      description: marker,
      status: 'Planned',
      all_day: false,
      readiness: {},
      start_at: now,
      end_at: later,
      type: 'Test',
      environment: 'Production E2E',
      created_at: now,
      updated_at: now,
      created_by: auth.user.id,
      updated_by: auth.user.id,
    },
    updates: { status: 'Completed', location: 'Automated E2E' },
    verify: row => {
      if (row.status !== 'Completed' || row.location !== 'Automated E2E') throw new Error('Event update did not persist expected status/location.');
    },
  });

  await createReadUpdate({
    table: 'csm_activities',
    label: 'CSM Activity',
    row: {
      id: crypto.randomUUID(),
      activity_id: `E2E-CSM-${Date.now()}`,
      activity_context: 'manual_client',
      time_spent_minutes: 1,
      manual_client_name: marker,
      client: marker,
      client_name: marker,
      csm_email: profile.email || testEmail,
      csm_name: 'E2E Test User',
      csm_user_id: auth.user.id,
      notes_optional: marker,
      created_at: now,
      updated_at: now,
      created_by: auth.user.id,
      updated_by: auth.user.id,
    },
    updates: { time_spent_minutes: 2, support_channel: 'Automated E2E' },
    verify: row => {
      if (Number(row.time_spent_minutes) !== 2 || row.support_channel !== 'Automated E2E') throw new Error('CSM Activity update did not persist expected duration/channel.');
    },
  });

  await testCommunicationCentre(profile);
}

(async () => {
  process.stdout.write(`Non-commercial production write E2E marker: ${marker}\n`);
  try {
    await main();
  } catch (error) {
    fail('Non-commercial production write bootstrap', error);
  } finally {
    if (serviceClient) await cleanup();
  }

  writeJson(path.join(root, 'test-results', 'production-noncommercial-write-e2e.json'), {
    generated_at: nowIso(),
    kind: 'production-noncommercial-write-e2e',
    marker,
    results,
  });
  const counts = printResults('InCheck360 Production Non-Commercial Write E2E', results);
  if (counts.FAIL) process.exit(1);
})();
