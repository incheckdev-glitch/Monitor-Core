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
  for (const name of names) {
    console.log(`\n=== ${name} ===`);
    const post = paths[name]?.post || paths[name] || {};
    const params = Array.isArray(post.parameters) ? post.parameters : [];
    for (const param of params) {
      console.log(`param ${param.name || '(unnamed)'} in=${param.in || ''} required=${Boolean(param.required)} schema=${JSON.stringify(param.schema || {})}`);
    }
  }

  console.log('\n=== actual conversation row shape (PII-free) ===');
  const conversations = await rest('communication_centre_conversations', 'select=*&order=created_at.desc&limit=3');
  if (!Array.isArray(conversations) || !conversations.length) {
    console.log('No live conversations available for structural sampling.');
    return;
  }
  for (const row of conversations) {
    console.log(`columns=${Object.keys(row).sort().join(',')}`);
    console.log(JSON.stringify({
      conversation_no: row.conversation_no || '',
      category: row.category || '',
      priority: row.priority || '',
      status: row.status || '',
      assigned_role: row.assigned_role || '',
      participant_count: Number(row.participant_count || 0),
      unread_count: Number(row.unread_count || 0),
      is_assigned_to_me: row.is_assigned_to_me,
      is_pinned: row.is_pinned,
      is_archived: row.is_archived,
      follow_up_status: row.follow_up_status || '',
      is_escalated: row.is_escalated,
      has_related_resource: Boolean(row.related_resource),
      has_related_record_id: Boolean(row.related_record_id),
    }));
  }

  const sampleId = conversations[0]?.id;
  if (!sampleId) return;
  console.log('\n=== actual participant row shape (PII-free) ===');
  const participants = await rest('communication_centre_participants', `select=*&conversation_id=eq.${encodeURIComponent(sampleId)}&limit=10`);
  for (const row of (Array.isArray(participants) ? participants : [])) {
    console.log(`columns=${Object.keys(row).sort().join(',')}`);
    console.log(JSON.stringify({
      user_role: row.user_role || '',
      is_active: row.is_active,
      is_muted: row.is_muted,
      has_joined_at: Boolean(row.joined_at),
      has_last_read_at: Boolean(row.last_read_at),
    }));
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
