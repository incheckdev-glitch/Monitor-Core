const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const {
  root,
  env,
  mask,
  result,
  printResults,
  writeJson,
  nowIso,
} = require('./test-utils');

const results = [];
const supabaseUrl = env('TEST_SUPABASE_URL', 'SUPABASE_URL').replace(/\/+$/, '');
const anonKey = env('TEST_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY');
const serviceKey = env('TEST_SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY');
const testEmail = env('TEST_USER_EMAIL');
const testPassword = env('TEST_USER_PASSWORD');
const appUrl = env('TEST_APP_URL', 'APP_BASE_URL', 'PUBLIC_APP_URL').replace(/\/+$/, '');

const expectedRoles = [
  'admin', 'dev', 'viewer', 'hoo', 'csm', 'sales_executive',
  'head_of_sales', 'accounting', 'sfc', 'gm', 'hod',
];

const expectedBuckets = [
  'proposal-signed-documents',
  'agreement-signed-documents',
  'hr-employee-documents',
  'company-documents',
  'ticket-attachments',
];

// Intentionally retired resources such as Operations Onboarding and Technical
// Admin Requests must not be treated as active production modules here.
const genericListResources = [
  'users', 'roles', 'role_permissions',
  'tickets', 'events', 'csm',
  'leads', 'lead_note_logs', 'deal_note_logs', 'deals',
  'proposal_catalog', 'proposals', 'agreements',
  'clients', 'invoices', 'receipts', 'credit_notes',
  'notifications', 'notification_settings',
  'companies', 'contacts', 'company_type_options', 'company_industry_options',
  'biners', 'communication_centre_messages',
];

function pass(name, details = '') {
  results.push(result('PASS', name, details));
}
function fail(name, error) {
  results.push(result('FAIL', name, error instanceof Error ? error.message : String(error || 'Unknown error')));
}
function rowsFrom(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.data?.rows)) return value.data.rows;
  return [];
}

async function main() {
  if (!supabaseUrl || !anonKey || !serviceKey || !testEmail || !testPassword) {
    throw new Error('Live resource coverage requires TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, TEST_SUPABASE_SERVICE_ROLE_KEY, TEST_USER_EMAIL and TEST_USER_PASSWORD.');
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: auth, error: authError } = await userClient.auth.signInWithPassword({ email: testEmail, password: testPassword });
  if (authError || !auth?.user || !auth?.session) throw authError || new Error('Test-user login failed.');
  const { data: profile, error: profileError } = await userClient
    .from('profiles')
    .select('id,email,role_key,is_active')
    .eq('id', auth.user.id)
    .single();
  if (profileError) throw profileError;
  if (!profile?.role_key || profile.is_active === false) throw new Error('Test user does not have an active role profile.');
  if (String(profile.role_key).toLowerCase() !== 'admin') throw new Error(`Resource coverage currently requires admin test user; received ${profile.role_key}.`);
  pass('Authenticate production resource test user', `${mask(profile.email || testEmail)} → ${profile.role_key}`);

  global.window = global;
  global.location = { hostname: 'github-actions', origin: appUrl || '' };
  global.navigator = { userAgent: 'github-actions' };
  global.RUNTIME_CONFIG = { SUPABASE_URL: supabaseUrl, SUPABASE_ANON_KEY: anonKey, APP_BASE_URL: appUrl };
  global.SupabaseClient = { getClient: () => userClient };
  global.Session = {
    role: () => profile.role_key,
    userId: () => auth.user.id,
    authContext: () => ({ role: profile.role_key, user: auth.user, profile, session: auth.session }),
  };
  global.AdminOverride = { canOverride: () => true };
  global.AppPermissions = {
    baseMatrix: {},
    canPerformAction: (_resource, _action, role) => String(role || '').toLowerCase() === 'admin',
  };

  delete require.cache[require.resolve('../supabase-data.js')];
  require('../supabase-data.js');
  if (!global.SupabaseData?.dispatch) throw new Error('Unable to load SupabaseData business dispatcher.');
  pass('Load production business dispatcher for all resources', 'supabase-data.js');

  for (const resource of genericListResources) {
    try {
      const response = await global.SupabaseData.dispatch({ resource, action: 'list', page: 1, pageSize: 2, limit: 2 });
      if (!response?.handled) throw new Error('dispatcher returned handled=false');
      const rows = rowsFrom(response.data);
      pass(`Resource list: ${resource}`, `${rows.length} row(s) sampled`);
    } catch (error) {
      fail(`Resource list: ${resource}`, error);
    }
  }

  // Mirror PaymentForecast.rpcFilters(). The production UI sends every filter key
  // (including null/false values), so the live RPC coverage must exercise the same
  // PostgREST overload signature rather than incorrectly calling the RPC with {}.
  const forecastFilters = {
    p_search: null,
    p_status: null,
    p_client: null,
    p_payment_term: null,
    p_currency: null,
    p_date_from: null,
    p_date_to: null,
    p_overdue_only: false,
    p_due_this_week: false,
    p_due_this_month: false,
    p_only_unpaid: false,
    p_follow_up_status: null,
    p_view: 'all',
  };

  const specialChecks = [
    ['workflow:list_rules', { resource: 'workflow', action: 'list_rules', page: 1, pageSize: 2 }],
    ['workflow:list_pending_approvals', { resource: 'workflow', action: 'list_pending_approvals', page: 1, pageSize: 2 }],
    ['workflow:list_audit', { resource: 'workflow', action: 'list_audit', page: 1, pageSize: 2 }],
    ['payment_forecast:summary', { resource: 'payment_forecast', action: 'summary', ...forecastFilters }],
    ['payment_forecast:page', { resource: 'payment_forecast', action: 'page', ...forecastFilters, p_page: 1, p_page_size: 2 }],
    ['payment_forecast:followups_page', {
      resource: 'payment_forecast',
      action: 'followups_page',
      ...forecastFilters,
      p_page: 1,
      p_page_size: 2,
      p_view: 'collection_follow_up',
      p_only_unpaid: true,
    }],
    ['payment_forecast:followup_logs', {
      resource: 'payment_forecast',
      action: 'followup_logs',
      followup_id: '00000000-0000-4000-8000-000000000001',
    }],
    ['payment_forecast:monthly_summary', { resource: 'payment_forecast', action: 'monthly_summary', ...forecastFilters, p_page: 1, p_page_size: 2 }],
    ['payment_forecast:client_distribution', { resource: 'payment_forecast', action: 'client_distribution', ...forecastFilters, p_page: 1, p_page_size: 2 }],
    ['lifecycle_status_logs:history', {
      resource: 'lifecycle_status_logs',
      action: 'history',
      entity_type: 'companies',
      entity_id: '00000000-0000-4000-8000-000000000001',
    }],
  ];

  for (const [name, payload] of specialChecks) {
    try {
      const response = await global.SupabaseData.dispatch(payload);
      if (!response?.handled) throw new Error('dispatcher returned handled=false');
      pass(`Special resource: ${name}`, 'reachable');
    } catch (error) {
      fail(`Special resource: ${name}`, error);
    }
  }

  try {
    const { data: roles, error } = await serviceClient.from('roles').select('role_key,is_active');
    if (error) throw error;
    const active = new Set((roles || []).filter(row => row.is_active !== false).map(row => String(row.role_key || '').trim().toLowerCase()));
    const missing = expectedRoles.filter(role => !active.has(role));
    if (missing.length) throw new Error(`Missing active role(s): ${missing.join(', ')}`);
    pass('Role catalogue coverage', `${expectedRoles.length}/${expectedRoles.length} expected roles active`);
  } catch (error) {
    fail('Role catalogue coverage', error);
  }

  try {
    const { data: permissions, error } = await serviceClient.from('role_permissions').select('role_key,resource,action,is_allowed,is_active');
    if (error) throw error;
    const active = (permissions || []).filter(row => row.is_active !== false && row.is_allowed !== false);
    const byRole = new Map();
    active.forEach(row => {
      const role = String(row.role_key || '').trim().toLowerCase();
      if (!byRole.has(role)) byRole.set(role, 0);
      byRole.set(role, byRole.get(role) + 1);
    });
    const rolesWithoutPermissions = expectedRoles.filter(role => !byRole.get(role));
    if (rolesWithoutPermissions.length) throw new Error(`Role(s) with no active allowed permissions: ${rolesWithoutPermissions.join(', ')}`);
    pass('Role permission matrix populated', `${active.length} active allowed permission row(s)`);
  } catch (error) {
    fail('Role permission matrix populated', error);
  }

  try {
    const { data: buckets, error } = await serviceClient.storage.listBuckets();
    if (error) throw error;
    const names = new Set((buckets || []).map(bucket => String(bucket.name || bucket.id || '').trim()));
    const missing = expectedBuckets.filter(bucket => !names.has(bucket));
    if (missing.length) throw new Error(`Missing storage bucket(s): ${missing.join(', ')}`);
    pass('Storage bucket coverage', `${expectedBuckets.length}/${expectedBuckets.length} required buckets present`);
  } catch (error) {
    fail('Storage bucket coverage', error);
  }
}

(async () => {
  process.stdout.write(`Live resource coverage: supabase=${supabaseUrl} anon=${mask(anonKey)} service=${mask(serviceKey)}\n`);
  try {
    await main();
  } catch (error) {
    fail('Production resource coverage bootstrap', error);
  }

  writeJson(path.join(root, 'test-results', 'production-resource-coverage.json'), {
    generated_at: nowIso(),
    kind: 'production-resource-coverage',
    results,
  });
  const counts = printResults('InCheck360 Production Resource Coverage', results);
  if (counts.FAIL) process.exit(1);
})();
