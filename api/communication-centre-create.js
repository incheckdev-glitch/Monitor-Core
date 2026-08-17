import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const CREATE_RPC = 'create_communication_centre_conversation';

function text(value = '') {
  return String(value ?? '').trim();
}

function normalizeRole(value = '') {
  return text(value).toLowerCase().replace(/[\s-]+/g, '_');
}

function isUuid(value = '') {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(value));
}

function bearerToken(req) {
  return text(req.headers?.authorization || req.headers?.Authorization).replace(/^Bearer\s+/i, '').trim();
}

function bodyObject(body) {
  if (body && typeof body === 'object') return body;
  try {
    return text(body) ? JSON.parse(String(body)) : {};
  } catch {
    return {};
  }
}

function errorMessage(error) {
  return text(error?.message || error?.details || error?.hint || error || 'Unknown error');
}

async function cleanupPartial(admin, conversationId) {
  if (!conversationId) return;
  await admin.from('communication_centre_messages').delete().eq('conversation_id', conversationId);
  await admin.from('communication_centre_participants').delete().eq('conversation_id', conversationId);
  await admin.from('communication_centre_conversations').delete().eq('id', conversationId);
}

async function nextConversationNumber(admin) {
  const year = String(new Date().getUTCFullYear());
  const prefix = `CC/${year}/`;
  const response = await admin
    .from('communication_centre_conversations')
    .select('conversation_no')
    .like('conversation_no', `${prefix}%`)
    .limit(10000);
  if (response.error) throw response.error;

  let max = 0;
  const pattern = new RegExp(`^CC/${year}/(\\d+)$`, 'i');
  for (const row of response.data || []) {
    const match = text(row?.conversation_no).match(pattern);
    if (match) max = Math.max(max, Number(match[1]) || 0);
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

async function insertConversationWithRetry(admin, doc) {
  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const conversationNo = await nextConversationNumber(admin);
    const result = await admin
      .from('communication_centre_conversations')
      .insert({ ...doc, conversation_no: conversationNo })
      .select('*')
      .single();
    if (!result.error) return result.data;
    lastError = result.error;
    if (String(result.error?.code || '') !== '23505') break;
  }
  throw lastError || new Error('Unable to allocate a Communication Centre conversation number.');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed. Use POST.' });
  }

  const supabaseUrl = text(process.env.SUPABASE_URL);
  const anonKey = text(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY);
  const serviceRoleKey = text(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return res.status(500).json({ ok: false, error: 'Communication Centre server configuration is incomplete.' });
  }

  const token = bearerToken(req);
  if (!token) return res.status(401).json({ ok: false, error: 'Your session expired. Please log in again.' });

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  const verified = await authClient.auth.getUser(token);
  const user = verified?.data?.user;
  if (verified.error || !user?.id) {
    return res.status(401).json({ ok: false, error: 'Your session expired. Please log in again.' });
  }

  const profileResult = await admin
    .from('profiles')
    .select('id,role_key,is_active')
    .eq('id', user.id)
    .maybeSingle();
  if (profileResult.error) return res.status(500).json({ ok: false, error: `Unable to verify your profile: ${profileResult.error.message}` });
  if (!profileResult.data || profileResult.data.is_active === false) {
    return res.status(403).json({ ok: false, error: 'Your user profile is inactive or unavailable.' });
  }

  const permission = await userClient.rpc('cc_has_permission', { p_action: 'manage' });
  if (permission.error) {
    return res.status(503).json({ ok: false, error: `Unable to verify Communication Centre permission: ${errorMessage(permission.error)}` });
  }
  if (permission.data !== true) {
    return res.status(403).json({ ok: false, error: 'You do not have permission to create Communication Centre conversations.' });
  }

  const payload = bodyObject(req.body);
  const title = text(payload.p_title ?? payload.title);
  const description = text(payload.p_description ?? payload.description ?? payload.message);
  const category = text(payload.p_category ?? payload.category) || 'General';
  const priority = text(payload.p_priority ?? payload.priority) || 'Normal';
  const assignedRole = normalizeRole(payload.p_assigned_role ?? payload.assigned_role ?? payload.assignedRole);
  const relatedResource = text(payload.p_related_resource ?? payload.related_resource ?? payload.relatedResource) || null;
  const relatedRecordId = text(payload.p_related_record_id ?? payload.related_record_id ?? payload.relatedRecordId) || null;
  const rawAssignedUsers = Array.isArray(payload.p_assigned_user_ids)
    ? payload.p_assigned_user_ids
    : Array.isArray(payload.assigned_user_ids)
      ? payload.assigned_user_ids
      : [];
  const assignedUserIds = [...new Set(rawAssignedUsers.map(text).filter(Boolean))];

  if (!title) return res.status(400).json({ ok: false, error: 'Conversation title is required.' });
  if (!description) return res.status(400).json({ ok: false, error: 'First message is required.' });
  if (!assignedUserIds.length && !assignedRole) {
    return res.status(400).json({ ok: false, error: 'Assign at least one user or role.' });
  }
  const invalidUserId = assignedUserIds.find(id => !isUuid(id));
  if (invalidUserId) return res.status(400).json({ ok: false, error: 'One or more assigned users are invalid.' });

  let conversationId = null;
  try {
    const now = new Date().toISOString();
    conversationId = randomUUID();
    const conversation = await insertConversationWithRetry(admin, {
      id: conversationId,
      title,
      description,
      category,
      priority,
      status: 'Open',
      assigned_role: assignedRole || null,
      participant_count: 0,
      unread_count: 0,
      is_assigned_to_me: 1,
      is_pinned: false,
      is_archived: false,
      follow_up_status: 'none',
      is_escalated: false,
      related_resource: relatedResource,
      related_module: relatedResource,
      related_record_id: relatedRecordId,
      created_at: now,
      updated_at: now,
      created_by: user.id
    });

    const participantIds = new Set([user.id]);
    if (assignedUserIds.length) {
      const explicitProfiles = await admin.from('profiles').select('id,is_active').in('id', assignedUserIds);
      if (explicitProfiles.error) throw explicitProfiles.error;
      for (const row of explicitProfiles.data || []) {
        if (row?.id && row.is_active !== false) participantIds.add(row.id);
      }
    }

    if (assignedRole) {
      const roleProfiles = await admin.from('profiles').select('id,role_key,is_active').eq('is_active', true).limit(5000);
      if (roleProfiles.error) throw roleProfiles.error;
      for (const row of roleProfiles.data || []) {
        if (row?.id && normalizeRole(row.role_key) === assignedRole) participantIds.add(row.id);
      }
    }

    const participantRows = [...participantIds].map(userId => ({
      id: randomUUID(),
      conversation_id: conversationId,
      user_id: userId,
      created_at: now
    }));
    const participantInsert = await admin.from('communication_centre_participants').insert(participantRows);
    if (participantInsert.error) throw participantInsert.error;

    const syncConversation = await admin
      .from('communication_centre_conversations')
      .update({ participant_count: participantRows.length, updated_at: new Date().toISOString() })
      .eq('id', conversationId)
      .select('*')
      .single();
    if (syncConversation.error) throw syncConversation.error;

    const firstMessage = await userClient.rpc('add_communication_centre_reply_secure', {
      p_conversation_id: conversationId,
      p_message_body: description,
      p_message_type: 'message',
      p_reply_to_message_id: null
    });
    if (firstMessage.error) throw firstMessage.error;

    return res.status(200).json({
      ok: true,
      data: syncConversation.data || conversation,
      source: 'vercel-secure-fallback',
      native_rpc: CREATE_RPC
    });
  } catch (error) {
    await cleanupPartial(admin, conversationId);
    console.error('[Communication Centre create fallback] failed', error);
    return res.status(500).json({ ok: false, error: `Unable to create conversation: ${errorMessage(error)}` });
  }
}
