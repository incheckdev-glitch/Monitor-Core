const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { env, mask, result, printResults } = require('./test-utils');

const results = [];
const supabaseUrl = env('TEST_SUPABASE_URL', 'SUPABASE_URL').replace(/\/+$/, '');
const anonKey = env('TEST_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY');
const serviceKey = env('TEST_SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY');
const testEmail = env('TEST_USER_EMAIL');
const testPassword = env('TEST_USER_PASSWORD');
const appUrl = env('TEST_APP_URL').replace(/\/+$/, '');
const confirmation = env('E2E_WRITE_CONFIRM');
const marker = `IC360-COMM-E2E-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

const pass = (name, details = '') => results.push(result('PASS', name, details));
const fail = (name, error) => results.push(result('FAIL', name, error?.message || error?.details || error?.hint || String(error || 'Unknown error')));

let userClient;
let serviceClient;
let user;
let accessToken = '';
let conversationId;
let messageId;

function errorText(error) {
  return String(error?.message || error?.details || error?.hint || error || '').trim();
}

function isMissingCreateRpc(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = errorText(error).toLowerCase();
  return code === 'PGRST202' || (
    message.includes('create_communication_centre_conversation') &&
    (message.includes('could not find the function') || message.includes('does not exist') || message.includes('schema cache'))
  );
}

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

async function callFallback(args) {
  if (!appUrl) throw new Error('TEST_APP_URL is required to verify the secure Communication Centre fallback.');
  let lastError = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      const response = await fetch(`${appUrl}/api/communication-centre-create`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify(args)
      });
      const raw = await response.text();
      let payload = {};
      try { payload = raw ? JSON.parse(raw) : {}; } catch (_) {}
      if (response.ok && payload?.ok !== false && payload?.data?.id) return payload;
      lastError = new Error(payload?.error || `HTTP ${response.status}: ${raw.slice(0, 300)}`);
      if (response.status !== 404) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt < 8) await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw lastError || new Error('Secure Communication Centre fallback did not return a conversation.');
}

async function createConversation() {
  const args = {
    p_title: `${marker} Conversation`,
    p_description: `${marker} first message`,
    p_category: 'General',
    p_priority: 'Normal',
    p_assigned_user_ids: [user.id],
    p_assigned_role: null,
    p_related_resource: null,
    p_related_record_id: null
  };

  const native = await userClient.rpc('create_communication_centre_conversation', args);
  if (!native.error) {
    const row = Array.isArray(native.data) ? native.data[0] : native.data;
    if (!row?.id) throw new Error(`Native create RPC returned no conversation id: ${JSON.stringify(native.data)}`);
    pass('Communication conversation create path', `native RPC → ${row.conversation_no || row.id}`);
    return row;
  }
  if (!isMissingCreateRpc(native.error)) throw native.error;

  pass('Native Communication create RPC availability', `not installed live (${native.error.code || 'missing'}) — secure server fallback required`);
  const fallback = await callFallback(args);
  pass('Communication conversation create path', `secure Vercel fallback → ${fallback.data.conversation_no || fallback.data.id}`);
  return fallback.data;
}

async function main() {
  if (confirmation !== 'RUN') throw new Error('Communication diagnostic is locked. Set E2E_WRITE_CONFIRM=RUN only in the dedicated workflow.');
  if (!supabaseUrl || !anonKey || !serviceKey || !testEmail || !testPassword) throw new Error('Production test secrets are required.');

  userClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

  const auth = await userClient.auth.signInWithPassword({ email: testEmail, password: testPassword });
  if (auth.error || !auth.data?.user || !auth.data?.session?.access_token) throw auth.error || new Error('Test-user login failed.');
  user = auth.data.user;
  accessToken = auth.data.session.access_token;

  const profileResponse = await userClient.from('profiles').select('id,email,role_key,is_active').eq('id', user.id).single();
  if (profileResponse.error) throw profileResponse.error;
  const profile = profileResponse.data;
  if (String(profile.role_key || '').toLowerCase() !== 'admin' || profile.is_active === false) throw new Error('Communication diagnostic requires the active admin test user.');
  pass('Authenticate Communication diagnostic user', `${mask(profile.email || testEmail)} → admin`);

  const permission = await userClient.rpc('cc_has_permission', { p_action: 'manage' });
  if (permission.error) throw permission.error;
  if (permission.data !== true) throw new Error('Admin manage permission is not active.');
  pass('Communication manage permission', 'true');

  const created = await createConversation();
  conversationId = created.id;

  const stored = await serviceClient
    .from('communication_centre_conversations')
    .select('id,conversation_no,title,status,participant_count,created_by')
    .eq('id', conversationId)
    .single();
  if (stored.error) throw stored.error;
  if (stored.data.title !== `${marker} Conversation`) throw new Error('Created conversation title did not persist.');
  if (String(stored.data.status || '').toLowerCase() !== 'open') throw new Error('Created conversation is not Open.');
  pass('Communication conversation persisted', `${stored.data.conversation_no} / participants=${stored.data.participant_count}`);

  const participants = await serviceClient.from('communication_centre_participants').select('user_id').eq('conversation_id', conversationId);
  if (participants.error) throw participants.error;
  if (!(participants.data || []).some(row => String(row.user_id) === String(user.id))) throw new Error('Conversation creator is not a participant.');
  pass('Communication creator participant', user.id);

  const firstMessages = await userClient.rpc('list_communication_centre_messages_secure', { p_conversation_id: conversationId });
  if (firstMessages.error) throw firstMessages.error;
  const firstRows = Array.isArray(firstMessages.data) ? firstMessages.data : [];
  if (!firstRows.some(row => String(row.message_body || row.message || row.body || '').includes(`${marker} first message`))) {
    throw new Error('Required first message was not persisted.');
  }
  pass('Communication first message persisted', `${firstRows.length} secure message row(s)`);

  const reply = await userClient.rpc('add_communication_centre_reply_secure', {
    p_conversation_id: conversationId,
    p_message_body: `${marker} reply`,
    p_message_type: 'message',
    p_reply_to_message_id: null
  });
  if (reply.error) throw reply.error;
  const replyRaw = Array.isArray(reply.data) ? reply.data[0] : reply.data;
  messageId = replyRaw?.id || replyRaw?.message_id || replyRaw;
  if (!messageId) throw new Error(`Reply RPC returned no message id: ${JSON.stringify(reply.data)}`);
  pass('Secure Communication reply create', String(messageId));

  const editedBody = `${marker} reply updated`;
const edited = await userClient.rpc('edit_communication_centre_message_secure', {
  p_message_id: messageId,
  p_message_body: editedBody
});
if (edited.error) throw edited.error;
const editedRow = Array.isArray(edited.data) ? edited.data[0] : edited.data;
if (editedRow?.message_body !== editedBody) throw new Error('Secure message edit did not persist.');
pass('Secure Communication message edit', String(messageId));

  const close = await userClient.rpc('close_communication_centre_conversation', { p_conversation_id: conversationId });
  if (close.error) throw close.error;
  const closed = await serviceClient.from('communication_centre_conversations').select('status').eq('id', conversationId).single();
  if (closed.error || String(closed.data?.status || '').toLowerCase() !== 'closed') throw closed.error || new Error('Close RPC did not persist Closed status.');
  pass('Close Communication conversation', 'Closed');

  const reopen = await userClient.rpc('reopen_communication_centre_conversation', { p_conversation_id: conversationId });
  if (reopen.error) throw reopen.error;
  const reopened = await serviceClient.from('communication_centre_conversations').select('status').eq('id', conversationId).single();
  if (reopened.error || String(reopened.data?.status || '').toLowerCase() !== 'open') throw reopened.error || new Error('Reopen RPC did not persist Open status.');
  pass('Reopen Communication conversation', 'Open');

const deleted = await userClient.rpc('soft_delete_communication_centre_message_secure', { p_message_id: messageId });
if (deleted.error) throw deleted.error;
const deletedRow = Array.isArray(deleted.data) ? deleted.data[0] : deleted.data;
if (deletedRow?.is_deleted !== true) throw new Error('Secure message soft delete did not persist.');
pass('Secure Communication message soft delete', String(messageId));
}

(async () => {
  try { await main(); }
  catch (error) { fail('Communication production E2E', error); }
  finally { await cleanup(); }
  const counts = printResults('InCheck360 Production Communication Diagnostic', results);
  if (counts.FAIL > 0) process.exit(1);
})();
