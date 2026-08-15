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
let openApiDefinitions = null;

async function loadOpenApiDefinitions() {
  if (openApiDefinitions) return openApiDefinitions;
  const response = await fetch(`${supabaseUrl}/rest/v1/`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: 'application/openapi+json',
    },
  });
  if (!response.ok) throw new Error(`OpenAPI schema HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const spec = await response.json();
  openApiDefinitions = spec.definitions || spec.components?.schemas || {};
  return openApiDefinitions;
}

async function printSchemaContract(table) {
  const defs = await loadOpenApiDefinitions();
  const def = defs[table] || {};
  const properties = def.properties || {};
  const required = Array.isArray(def.required) ? def.required : [];
  const columns = Object.keys(properties).sort();
  const requiredTypes = required.map(key => `${key}:${properties[key]?.type || properties[key]?.format || 'unknown'}${properties[key]?.format ? `(${properties[key].format})` : ''}`);
  process.stdout.write(`${table}: columns=${columns.join(',')}\n`);
  process.stdout.write(`${table}: required=${required.join(',') || '(none declared)'}\n`);
  process.stdout.write(`${table}: required_types=${requiredTypes.join(',')}\n`);
  return { columns, required, properties };
}

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

async function cleanup() {
  const errors = [];
  for (const item of [...created].reverse()) {
    const response = await serviceClient.from(item.table).delete().eq('id', item.id);
    if (response.error) errors.push(`${item.table}/${item.id}: ${errorMessage(response.error)}`);
  }
  if (errors.length) fail('Cleanup non-commercial E2E data', errors.join(' | '));
  else pass('Cleanup non-commercial E2E data', `${created.length} temporary row(s) removed`);
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

  await printSchemaContract('communication_centre_conversations');
  await printSchemaContract('communication_centre_participants');
  await printSchemaContract('communication_centre_messages');

  const conversationId = crypto.randomUUID();
  await createReadUpdate({
    table: 'communication_centre_messages',
    label: 'Communication Centre',
    row: {
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      message_type: 'text',
      is_system_message: false,
      is_deleted: false,
      message_body: marker,
      sender_id: auth.user.id,
      sender_name: 'E2E Test User',
      created_at: now,
      updated_at: now,
    },
    updates: { message_body: `${marker} updated`, edited_at: new Date().toISOString(), edited_by: auth.user.id },
    verify: row => {
      if (row.message_body !== `${marker} updated` || !row.edited_at) throw new Error('Communication Centre edit did not persist.');
    },
  });
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
