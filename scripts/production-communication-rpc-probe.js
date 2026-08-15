const { env } = require('./test-utils');

const supabaseUrl = env('TEST_SUPABASE_URL', 'SUPABASE_URL').replace(/\/+$/, '');
const serviceKey = env('TEST_SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY');

async function rest(table, query = '') {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: 'application/json',
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${table} HTTP ${response.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text || '[]'); } catch { return []; }
}

(async () => {
  if (!supabaseUrl || !serviceKey) throw new Error('Supabase production test secrets are required.');
  const response = await fetch(`${supabaseUrl}/rest/v1/`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: 'application/openapi+json',
    },
  });
  if (!response.ok) throw new Error(`OpenAPI schema HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const spec = await response.json();
  const paths = spec.paths || {};
  const names = Object.keys(paths)
    .filter(key => key.startsWith('/rpc/') && /communication_centre|cc_/.test(key))
    .sort();
  if (!names.length) {
    console.log('No Communication Centre RPC paths are exposed.');
  } else {
    for (const name of names) {
      console.log(`\n=== ${name} ===`);
      const post = paths[name]?.post || paths[name] || {};
      const params = Array.isArray(post.parameters) ? post.parameters : [];
      for (const param of params) {
        console.log(`param ${param.name || '(unnamed)'} in=${param.in || ''} required=${Boolean(param.required)} schema=${JSON.stringify(param.schema || {})}`);
      }
      if (post.requestBody) console.log(`requestBody=${JSON.stringify(post.requestBody)}`);
      if (post.responses?.['200']) console.log(`response200=${JSON.stringify(post.responses['200'])}`);
    }
  }

  console.log('\n=== structural conversation samples (PII-free) ===');
  const conversations = await rest(
    'communication_centre_conversations',
    'select=id,conversation_no,category,priority,status,assigned_user_ids,participant_count,unread_count,is_assigned_to_me,is_pinned,is_archived,follow_up_status,is_escalated&order=created_at.desc&limit=5',
  );
  if (!Array.isArray(conversations) || !conversations.length) {
    console.log('No live conversations available for structural sampling.');
    return;
  }

  for (const row of conversations) {
    const assigned = Array.isArray(row.assigned_user_ids)
      ? row.assigned_user_ids
      : (row.assigned_user_ids && typeof row.assigned_user_ids === 'object' ? Object.values(row.assigned_user_ids) : []);
    console.log(JSON.stringify({
      conversation_no: row.conversation_no || '',
      category: row.category || '',
      priority: row.priority || '',
      status: row.status || '',
      assigned_user_ids_json_type: Array.isArray(row.assigned_user_ids) ? 'array' : typeof row.assigned_user_ids,
      assigned_user_count: assigned.length,
      participant_count: Number(row.participant_count || 0),
      unread_count: Number(row.unread_count || 0),
      is_assigned_to_me: row.is_assigned_to_me,
      is_pinned: row.is_pinned,
      is_archived: row.is_archived,
      follow_up_status: row.follow_up_status || '',
      is_escalated: row.is_escalated,
    }));
  }

  const sampleId = conversations[0]?.id;
  if (!sampleId) return;
  console.log('\n=== structural participant sample (PII-free) ===');
  const participants = await rest(
    'communication_centre_participants',
    `select=user_role,is_active,is_muted,joined_at&conversation_id=eq.${encodeURIComponent(sampleId)}&limit=10`,
  );
  console.log(JSON.stringify((Array.isArray(participants) ? participants : []).map(row => ({
    user_role: row.user_role || '',
    is_active: row.is_active,
    is_muted: row.is_muted,
    has_joined_at: Boolean(row.joined_at),
  }))));
})().catch(error => {
  console.error(error);
  process.exit(1);
});
