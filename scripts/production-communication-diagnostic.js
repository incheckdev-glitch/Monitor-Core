const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { env, mask, result, printResults } = require('./test-utils');

const results = [];
const supabaseUrl = env('TEST_SUPABASE_URL', 'SUPABASE_URL').replace(/\/+$/, '');
const anonKey = env('TEST_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY');
const serviceKey = env('TEST_SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY');
const testEmail = env('TEST_USER_EMAIL');
const testPassword = env('TEST_USER_PASSWORD');
const confirmation = env('E2E_WRITE_CONFIRM');
const marker = `IC360-COMM-DIAG-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

const pass = (name, details = '') => results.push(result('PASS', name, details));
const fail = (name, error) => results.push(result('FAIL', name, error?.message || error?.details || error?.hint || String(error || 'Unknown error')));

let userClient;
let serviceClient;
let user;
let conversationId;

async function cleanup() {
  if (!serviceClient || !conversationId) return;
  const errors = [];
  for (const table of ['communication_centre_messages', 'communication_centre_participants']) {
    const response = await serviceClient.from(table).delete().eq('conversation_id', conversationId);
    if (response.error) errors.push(`${table}: ${response.error.message}`);
  }
  const conversation = await serviceClient.from('communication_centre_conversations').delete().eq('id', conversationId);
  if (conversation.error) errors.push(`conversation: ${conversation.error.message}`);
  if (errors.length) fail('Communication diagnostic cleanup', errors.join(' | '));
  else pass('Communication diagnostic cleanup', 'conversation, participants and messages removed');
}

async function main() {
  if (confirmation !== 'RUN') throw new Error('Communication diagnostic is locked. Set E2E_WRITE_CONFIRM=RUN only in the dedicated workflow.');
  if (!supabaseUrl || !anonKey || !serviceKey || !testEmail || !testPassword) throw new Error('Production test secrets are required.');

  userClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

  const auth = await userClient.auth.signInWithPassword({ email: testEmail, password: testPassword });
  if (auth.error || !auth.data?.user) throw auth.error || new Error('Test-user login failed.');
  user = auth.data.user;
  const profileResponse = await userClient.from('profiles').select('id,email,role_key,is_active').eq('id', user.id).single();
  if (profileResponse.error) throw profileResponse.error;
  const profile = profileResponse.data;
  if (String(profile.role_key || '').toLowerCase() !== 'admin' || profile.is_active === false) throw new Error('Communication diagnostic requires the active admin test user.');
  pass('Authenticate Communication diagnostic user', `${mask(profile.email || testEmail)} → admin`);

  const permission = await userClient.rpc('cc_has_permission', { p_action: 'manage' });
  if (permission.error) throw permission.error;
  if (permission.data !== true) throw new Error('Admin manage permission is not active.');
  pass('Communication manage permission', 'true');

  const missingCreate = await userClient.rpc('create_communication_centre_conversation', {
    p_title: `${marker} missing-RPC check`,
    p_description: marker,
    p_category: 'General',
    p_priority: 'Normal',
    p_assigned_user_ids: [user.id],
    p_assigned_role: null,
    p_related_resource: null,
    p_related_record_id: null,
  });
  if (!missingCreate.error) throw new Error('Create RPC unexpectedly exists live; strict E2E should be rerun instead of diagnostic continuation.');
  fail('Live create_communication_centre_conversation RPC', missingCreate.error);

  conversationId = crypto.randomUUID();
  const now = new Date().toISOString();
  const seed = await serviceClient.from('communication_centre_conversations').insert({
    id: conversationId,
    conversation_no: `CC/DIAG/${Date.now()}`,
    title: `${marker} Conversation`,
    description: marker,
    category: 'General',
    priority: 'Normal',
    status: 'Open',
    assigned_role: 'admin',
    participant_count: 1,
    unread_count: 0,
    is_assigned_to_me: 1,
    is_pinned: false,
    is_archived: false,
    follow_up_status: 'none',
    is_escalated: false,
    created_at: now,
    updated_at: now,
    created_by: user.id,
  });
  if (seed.error) throw seed.error;

  const participantId = crypto.randomUUID();
  const participant = await serviceClient.from('communication_centre_participants').insert({
    id: participantId,
    conversation_id: conversationId,
    user_id: user.id,
    created_at: now,
  });
  if (participant.error) throw participant.error;
  pass('Service-role diagnostic parent seed', 'conversation + live-shape admin participant');

  const canView = await userClient.rpc('can_view_communication_centre_conversation', { p_conversation_id: conversationId });
  if (canView.error) throw canView.error;
  if (canView.data !== true) throw new Error('Participant-backed conversation is not visible to the authenticated admin.');
  pass('Communication participant visibility', 'can_view = true');

  const reply = await userClient.rpc('add_communication_centre_reply_secure', {
    p_conversation_id: conversationId,
    p_message_body: marker,
    p_message_type: 'message',
    p_reply_to_message_id: null,
  });
  if (reply.error) throw reply.error;
  const replyRaw = Array.isArray(reply.data) ? reply.data[0] : reply.data;
  const messageId = replyRaw?.id || replyRaw?.message_id || replyRaw;
  if (!messageId) throw new Error(`Reply RPC did not return a message id: ${JSON.stringify(reply.data)}`);
  pass('Secure Communication reply create', String(messageId));

  const listed = await userClient.rpc('list_communication_centre_messages_secure', { p_conversation_id: conversationId });
  if (listed.error) throw listed.error;
  const rows = Array.isArray(listed.data) ? listed.data : [];
  const message = rows.find(row => String(row.id || row.message_id || '') === String(messageId)) || rows.find(row => String(row.message_body || row.message || '') === marker);
  if (!message) throw new Error('Secure message listing did not return the new reply.');
  const persistedId = message.id || message.message_id || messageId;
  pass('Secure Communication reply read', String(persistedId));

  const editedBody = `${marker} updated`;
  const edited = await userClient.from('communication_centre_messages').update({
    message_body: editedBody,
    edited_at: new Date().toISOString(),
    edited_by: user.id,
  }).eq('id', persistedId).select('id,message_body,edited_at').single();
  if (edited.error) throw edited.error;
  if (edited.data?.message_body !== editedBody) throw new Error('Authenticated message edit did not persist.');
  pass('Authenticated Communication message edit', String(persistedId));

  const close = await userClient.rpc('close_communication_centre_conversation', { p_conversation_id: conversationId });
  if (close.error) throw close.error;
  const closed = await userClient.from('communication_centre_conversations').select('status').eq('id', conversationId).single();
  if (closed.error) throw closed.error;
  if (String(closed.data?.status || '').toLowerCase() !== 'closed') throw new Error(`Close RPC left status ${closed.data?.status || '(blank)'}.`);
  pass('Close Communication conversation', 'Closed');

  const reopen = await userClient.rpc('reopen_communication_centre_conversation', { p_conversation_id: conversationId });
  if (reopen.error) throw reopen.error;
  const reopened = await userClient.from('communication_centre_conversations').select('status').eq('id', conversationId).single();
  if (reopened.error) throw reopened.error;
  if (String(reopened.data?.status || '').toLowerCase() !== 'open') throw new Error(`Reopen RPC left status ${reopened.data?.status || '(blank)'}.`);
  pass('Reopen Communication conversation', 'Open');
}

(async () => {
  try { await main(); }
  catch (error) { fail('Communication diagnostic downstream lifecycle', error); }
  finally { await cleanup(); }
  const counts = printResults('InCheck360 Production Communication Diagnostic', results);
  if (counts.FAIL > 1) process.exit(1);
})();
