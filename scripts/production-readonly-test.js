const path = require('path');
const {
  root,
  env,
  mask,
  result,
  printResults,
  fetchWithTimeout,
  writeJson,
  nowIso,
} = require('./test-utils');

const results = [];
const appUrl = env('TEST_APP_URL', 'APP_BASE_URL', 'PUBLIC_APP_URL').replace(/\/+$/, '');
const supabaseUrl = env('TEST_SUPABASE_URL', 'SUPABASE_URL').replace(/\/+$/, '');
const anonKey = env('TEST_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY');
const serviceKey = env('TEST_SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY');
const testEmail = env('TEST_USER_EMAIL');
const testPassword = env('TEST_USER_PASSWORD');

const requiredTables = [
  'profiles', 'roles', 'role_permissions',
  'companies', 'contacts', 'leads', 'deals',
  'proposals', 'proposal_items', 'agreements', 'agreement_items',
  'clients', 'renewals', 'invoices', 'invoice_items', 'invoice_payment_schedule',
  'receipts', 'receipt_items', 'credit_notes',
  'workflow_rules', 'workflow_approvals',
  'operations_onboarding', 'technical_admin_requests',
  'tickets', 'events', 'csm_activities',
  'notifications', 'notification_delivery_queue',
  'user_push_subscriptions', 'push_subscriptions', 'crm_contact_company_links',
];

const functions = [
  'process-payment-schedule-reminders',
  'daily-follow-up-reminders',
  'process-notification-queue',
  'send-web-push-v2',
  'send-workflow-approval-email',
  'send-email',
];

async function checkApp() {
  if (!appUrl) {
    results.push(result('SKIP', 'Production app', 'TEST_APP_URL not configured'));
    results.push(result('SKIP', 'Runtime configuration', 'TEST_APP_URL not configured'));
    return;
  }
  try {
    const response = await fetchWithTimeout(appUrl, { redirect: 'follow' });
    const text = await response.text();
    results.push(result(response.ok ? 'PASS' : 'FAIL', 'Production app', `${response.status} ${appUrl}`));
    if (response.ok) {
      const looksLikeApp = /incheck|monitorcore/i.test(text);
      results.push(result(looksLikeApp ? 'PASS' : 'WARN', 'Production app content', looksLikeApp ? 'application shell detected' : 'page loaded but expected app marker not found'));
    }
  } catch (error) {
    results.push(result('FAIL', 'Production app', error.message));
  }

  const runtimeCandidates = [`${appUrl}/api/runtime-config`, `${appUrl}/runtime-config.js`];
  let checked = false;
  for (const url of runtimeCandidates) {
    try {
      const response = await fetchWithTimeout(url, { headers: { Accept: 'application/javascript,text/javascript,*/*' } });
      const text = await response.text();
      if (!response.ok) continue;
      checked = true;
      const hasUrl = /SUPABASE_URL[^\n]*https:\/\//.test(text) || /SUPABASE_URL\s*[:=]\s*["'][^"']+/.test(text);
      const hasKey = /(SUPABASE_ANON_KEY|SUPABASE_PUBLISHABLE_KEY)[^\n]*(sb_publishable_|eyJ|[A-Za-z0-9_-]{20,})/.test(text);
      results.push(result(hasUrl ? 'PASS' : 'FAIL', 'Runtime config SUPABASE_URL', url));
      results.push(result(hasKey ? 'PASS' : 'FAIL', 'Runtime config browser key', url));
      break;
    } catch (_) {
      // try next route
    }
  }
  if (!checked) results.push(result('FAIL', 'Runtime configuration', 'neither /api/runtime-config nor /runtime-config.js returned 200'));
}

async function checkDatabase() {
  if (!supabaseUrl || !serviceKey) {
    for (const table of requiredTables) results.push(result('SKIP', `DB table: ${table}`, 'service-role test secrets not configured'));
    return;
  }

  for (const table of requiredTables) {
    try {
      const response = await fetchWithTimeout(`${supabaseUrl}/rest/v1/${encodeURIComponent(table)}?select=*&limit=0`, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Prefer: 'count=none',
        },
      });
      const body = response.ok ? '' : await response.text();
      results.push(result(response.ok ? 'PASS' : 'FAIL', `DB table: ${table}`, response.ok ? 'reachable' : `${response.status} ${body.slice(0, 180)}`));
    } catch (error) {
      results.push(result('FAIL', `DB table: ${table}`, error.message));
    }
  }
}


async function checkRuntimeDatabaseCompatibility() {
  const names = [
    'RPC: crm_search_companies_for_select',
    'Push columns: user_push_subscriptions',
    'Push columns: push_subscriptions',
  ];

  if (!supabaseUrl || !serviceKey) {
    for (const name of names) results.push(result('SKIP', name, 'service-role test secrets not configured'));
    return;
  }

  try {
    const response = await fetchWithTimeout(`${supabaseUrl}/rest/v1/rpc/crm_search_companies_for_select`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ p_search: '', p_limit: 1 }),
    });
    const body = response.ok ? '' : await response.text();
    results.push(result(
      response.ok ? 'PASS' : 'FAIL',
      'RPC: crm_search_companies_for_select',
      response.ok ? 'reachable' : `${response.status} ${body.slice(0, 220)}`,
    ));
  } catch (error) {
    results.push(result('FAIL', 'RPC: crm_search_companies_for_select', error.message));
  }

  const select = 'id,user_id,auth_user_id,recipient_user_id,profile_id,is_active,last_seen_at';
  for (const table of ['user_push_subscriptions', 'push_subscriptions']) {
    try {
      const response = await fetchWithTimeout(
        `${supabaseUrl}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=0`,
        {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            Accept: 'application/json',
          },
        },
      );
      const body = response.ok ? '' : await response.text();
      results.push(result(
        response.ok ? 'PASS' : 'FAIL',
        `Push columns: ${table}`,
        response.ok ? 'user-id compatibility columns reachable' : `${response.status} ${body.slice(0, 220)}`,
      ));
    } catch (error) {
      results.push(result('FAIL', `Push columns: ${table}`, error.message));
    }
  }
}

async function checkAuth() {
  if (!supabaseUrl || !anonKey || !testEmail || !testPassword) {
    results.push(result('SKIP', 'Authentication + active role', 'TEST_SUPABASE_URL/ANON_KEY/USER_EMAIL/USER_PASSWORD not fully configured'));
    return;
  }

  try {
    const loginResponse = await fetchWithTimeout(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const login = await loginResponse.json().catch(() => ({}));
    if (!loginResponse.ok || !login?.access_token || !login?.user?.id) {
      results.push(result('FAIL', 'Authentication + active role', String(login?.error_description || login?.msg || login?.error || `HTTP ${loginResponse.status}`)));
      return;
    }

    const profileResponse = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(login.user.id)}&select=id,email,role_key,is_active&limit=1`,
      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${login.access_token}`,
          Accept: 'application/json',
        },
      },
    );
    const profiles = await profileResponse.json().catch(() => []);
    const profile = Array.isArray(profiles) ? profiles[0] : null;
    if (!profileResponse.ok) {
      results.push(result('FAIL', 'Authentication + active role', `profile HTTP ${profileResponse.status}`));
    } else if (!profile || !profile.role_key || profile.is_active === false) {
      results.push(result('FAIL', 'Authentication + active role', 'login succeeded but active role_key profile was not found'));
    } else {
      results.push(result('PASS', 'Authentication + active role', `${profile.email || testEmail} → ${profile.role_key}`));
    }
  } catch (error) {
    results.push(result('FAIL', 'Authentication + active role', error.message));
  }
}

async function checkFunctions() {
  if (!supabaseUrl || !anonKey) {
    for (const name of functions) results.push(result('SKIP', `Edge Function deployed: ${name}`, 'Supabase URL/anon key not configured'));
    return;
  }

  for (const name of functions) {
    const url = `${supabaseUrl}/functions/v1/${name}`;
    try {
      const response = await fetchWithTimeout(url, {
        method: 'OPTIONS',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization,content-type,apikey',
          Origin: appUrl || 'https://example.invalid',
        },
      });
      const ok = response.status >= 200 && response.status < 500 && response.status !== 404;
      results.push(result(ok ? 'PASS' : 'FAIL', `Edge Function deployed: ${name}`, `HTTP ${response.status}`));
    } catch (error) {
      results.push(result('FAIL', `Edge Function deployed: ${name}`, error.message));
    }
  }
}

(async () => {
  process.stdout.write(`Live test configuration: app=${appUrl || '(skip)'} supabase=${supabaseUrl || '(skip)'} anon=${anonKey ? mask(anonKey) : '(skip)'} service=${serviceKey ? mask(serviceKey) : '(skip)'}\n`);
  await checkApp();
  await checkDatabase();
  await checkRuntimeDatabaseCompatibility();
  await checkAuth();
  await checkFunctions();

  const report = { generated_at: nowIso(), kind: 'production-readonly', results };
  writeJson(path.join(root, 'test-results', 'production-readonly.json'), report);
  const counts = printResults('InCheck360 Production Read-Only Test', results);
  if (counts.FAIL) process.exit(1);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
