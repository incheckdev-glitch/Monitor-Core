const path = require('path');
const {
  root,
  env,
  result,
  printResults,
  fetchWithTimeout,
  writeJson,
  nowIso,
} = require('./test-utils');

const results = [];
const supabaseUrl = env('TEST_SUPABASE_URL', 'SUPABASE_URL').replace(/\/+$/, '');
const serviceKey = env('TEST_SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY');
const anonKey = env('TEST_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY');
const testEmail = env('TEST_USER_EMAIL');
const testPassword = env('TEST_USER_PASSWORD');

async function restSelect(table, select, extra = '') {
  const url = `${supabaseUrl}/rest/v1/${table}?select=${encodeURIComponent(select)}${extra}`;
  const response = await fetchWithTimeout(url, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: 'application/json',
      Prefer: 'count=none',
    },
  });
  const text = await response.text();
  return { response, text, data: (() => { try { return JSON.parse(text || '[]'); } catch { return []; } })() };
}

async function checkColumns() {
  const checks = [
    {
      name: 'Credit-note financial columns',
      table: 'credit_notes',
      select: 'id,credit_note_request_key,invoice_id,invoice_number,agreement_id,agreement_number,credit_amount,status,created_by',
    },
    {
      name: 'Invoice settlement columns',
      table: 'invoices',
      select: 'id,invoice_total,grand_total,total_amount,amount_paid,received_amount,credit_note_amount,pending_amount,balance_due,payment_state,payment_status',
    },
  ];

  for (const check of checks) {
    try {
      const { response, text } = await restSelect(check.table, check.select, '&limit=0');
      results.push(result(
        response.ok ? 'PASS' : 'FAIL',
        check.name,
        response.ok ? 'required columns reachable' : `${response.status} ${text.slice(0, 240)}`,
      ));
    } catch (error) {
      results.push(result('FAIL', check.name, error.message));
    }
  }
}

async function checkFinancialPermissions() {
  try {
    const select = 'role_key,resource,action,is_allowed,is_active';
    const query = '&resource=eq.credit_notes&action=in.(create,cancel)&is_allowed=eq.true&is_active=eq.true&limit=200';
    const { response, text, data } = await restSelect('role_permissions', select, query);
    if (!response.ok) {
      results.push(result('FAIL', 'Credit-note financial permission matrix', `${response.status} ${text.slice(0, 240)}`));
      return;
    }
    const rows = Array.isArray(data) ? data : [];
    const normalized = rows.map(row => ({
      role: String(row.role_key || '').trim().toLowerCase(),
      action: String(row.action || '').trim().toLowerCase(),
    }));
    const expectedRoles = ['admin', 'accounting', 'sfc', 'gm'];
    const missing = [];
    for (const role of expectedRoles) {
      for (const action of ['create', 'cancel']) {
        if (!normalized.some(row => row.role === role && row.action === action)) missing.push(`${role}:${action}`);
      }
    }
    results.push(result(
      missing.length ? 'FAIL' : 'PASS',
      'Credit-note financial permission matrix',
      missing.length ? `missing ${missing.join(', ')}` : 'admin/accounting/sfc/gm create + cancel permissions active',
    ));
  } catch (error) {
    results.push(result('FAIL', 'Credit-note financial permission matrix', error.message));
  }
}

async function checkAuthenticatedReadWhenSampleExists() {
  if (!anonKey || !testEmail || !testPassword) {
    results.push(result('SKIP', 'Credit-note authenticated read policy', 'test user credentials not configured'));
    return;
  }

  try {
    const sample = await restSelect('credit_notes', 'id', '&limit=1');
    if (!sample.response.ok) {
      results.push(result('FAIL', 'Credit-note authenticated read policy', `service sample failed: ${sample.response.status}`));
      return;
    }
    const row = Array.isArray(sample.data) ? sample.data[0] : null;
    if (!row?.id) {
      results.push(result('SKIP', 'Credit-note authenticated read policy', 'no live credit-note row available for a non-mutating RLS read check'));
      return;
    }

    const loginResponse = await fetchWithTimeout(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const login = await loginResponse.json().catch(() => ({}));
    if (!loginResponse.ok || !login?.access_token) {
      results.push(result('FAIL', 'Credit-note authenticated read policy', `login HTTP ${loginResponse.status}`));
      return;
    }

    const response = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/credit_notes?id=eq.${encodeURIComponent(row.id)}&select=id&limit=1`,
      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${login.access_token}`,
          Accept: 'application/json',
        },
      },
    );
    const body = await response.json().catch(() => []);
    const visible = response.ok && Array.isArray(body) && body.some(item => item.id === row.id);
    results.push(result(
      visible ? 'PASS' : 'FAIL',
      'Credit-note authenticated read policy',
      visible ? 'configured test user can read a live credit note' : `live row hidden from authenticated test user (HTTP ${response.status})`,
    ));
  } catch (error) {
    results.push(result('FAIL', 'Credit-note authenticated read policy', error.message));
  }
}

(async () => {
  if (!supabaseUrl || !serviceKey) {
    results.push(result('SKIP', 'Production financial schema', 'Supabase URL/service-role test secrets not configured'));
  } else {
    await checkColumns();
    await checkFinancialPermissions();
    await checkAuthenticatedReadWhenSampleExists();
  }

  const report = { generated_at: nowIso(), kind: 'production-financial-schema', results };
  writeJson(path.join(root, 'test-results', 'production-financial-schema.json'), report);
  const counts = printResults('InCheck360 Production Financial Schema Test', results);
  if (counts.FAIL) process.exit(1);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
