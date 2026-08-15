const crypto = require('crypto');
const { env } = require('./test-utils');

const supabaseUrl = env('TEST_SUPABASE_URL', 'SUPABASE_URL').replace(/\/+$/, '');
const serviceKey = env('TEST_SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY');

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

async function rest(table, query = '') {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?${query}`, { headers });
  const text = await response.text();
  if (!response.ok) throw new Error(`${table} HTTP ${response.status}: ${text.slice(0, 500)}`);
  try { return JSON.parse(text || '[]'); } catch { return []; }
}

async function probeConversationInsert() {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const payload = {
    id,
    conversation_no: `CC/E2E/${Date.now()}`,
    title: 'Communication Centre schema probe',
    description: 'Temporary automated schema probe',
    category: 'General',
    priority: 'Normal',
    status: 'Open',
    assigned_role: 'admin',
    participant_count: 0,
    unread_count: 0,
    is_assigned_to_me: 1,
    is_pinned: false,
    is_archived: false,
    follow_up_status: 'none',
    is_escalated: false,
    related_resource: null,
    related_record_id: null,
    related_module: null,
    related_record_ref: null,
    related_record_title: null,
    created_at: now,
    updated_at: now,
  };

  const tryInsert = async () => {
    const response = await fetch(`${supabaseUrl}/rest/v1/communication_centre_conversations`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text || 'null'); } catch { body = text; }
    return { response, text, body };
  };

  try {
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const { response, text, body } = await tryInsert();
      if (response.ok) {
        const row = Array.isArray(body) ? body[0] : body;
        console.log('\n=== accepted conversation insert shape ===');
        console.log(`accepted_input_columns=${Object.keys(payload).sort().join(',')}`);
        console.log(`returned_columns=${Object.keys(row || {}).sort().join(',')}`);
        console.log(JSON.stringify({
          conversation_no: row?.conversation_no || '',
          category: row?.category || '',
          priority: row?.priority || '',
          status: row?.status || '',
          assigned_role: row?.assigned_role || '',
          participant_count: row?.participant_count,
          unread_count: row?.unread_count,
          is_assigned_to_me: row?.is_assigned_to_me,
          is_pinned: row?.is_pinned,
          is_archived: row?.is_archived,
          follow_up_status: row?.follow_up_status || '',
          is_escalated: row?.is_escalated,
        }));
        return;
      }

      const message = String(body?.message || text || '');
      const missingColumn =
        message.match(/Could not find the '([^']+)' column/i)?.[1] ||
        message.match(/column [^.]+\.([a-zA-Z0-9_]+) does not exist/i)?.[1];
      if (missingColumn && Object.prototype.hasOwnProperty.call(payload, missingColumn)) {
        console.log(`probe attempt ${attempt}: dropping unavailable column ${missingColumn}`);
        delete payload[missingColumn];
        continue;
      }

      console.log(`probe attempt ${attempt} failed: ${text.slice(0, 800)}`);
      throw new Error(`Unable to establish conversation insert shape: ${text.slice(0, 500)}`);
    }
    throw new Error('Conversation insert probe exhausted retry budget.');
  } finally {
    const cleanup = await fetch(`${supabaseUrl}/rest/v1/communication_centre_conversations?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers,
    });
    if (!cleanup.ok) console.warn(`Conversation probe cleanup HTTP ${cleanup.status}: ${(await cleanup.text()).slice(0, 300)}`);
    else console.log('temporary conversation probe row removed');
  }
}

(async () => {
  if (!supabaseUrl || !serviceKey) throw new Error('Supabase production test secrets are required.');
  const response = await fetch(`${supabaseUrl}/rest/v1/`, {
    headers: { ...headers, Accept: 'application/openapi+json' },
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
  if (Array.isArray(conversations) && conversations.length) {
    for (const row of conversations) console.log(`columns=${Object.keys(row).sort().join(',')}`);
  } else {
    console.log('No live conversations available for structural sampling.');
  }

  await probeConversationInsert();
})().catch(error => {
  console.error(error);
  process.exit(1);
});
