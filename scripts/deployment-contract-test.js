const fs = require('fs');
const path = require('path');
const { root, result, printResults, writeJson, nowIso } = require('./test-utils');

const results = [];

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function requirePath(rel, label = rel) {
  if (exists(rel)) results.push(result('PASS', label));
  else results.push(result('FAIL', label, `missing ${rel}`));
}

const coreFiles = [
  'index.html',
  'app.js',
  'api.js',
  'supabase-client.js',
  'supabase-data.js',
  'permissions.js',
  'companies.js',
  'contacts.js',
  'leads.js',
  'deals.js',
  'proposals.js',
  'agreements.js',
  'invoices.js',
  'receipts.js',
  'credit-notes.js',
  'clients.js',
  'tickets.js',
  'events.js',
  'communication-centre.js',
  'hr.js',
  'accounting.js',
  'workflow.js',
  'notification-service.js',
  'notifications.js',
];

for (const file of coreFiles) requirePath(file, `Core file: ${file}`);

const functions = [
  'process-payment-schedule-reminders',
  'daily-follow-up-reminders',
  'process-notification-queue',
  'send-web-push-v2',
  'send-workflow-approval-email',
  'send-email',
];
for (const name of functions) {
  requirePath(`supabase/functions/${name}/index.ts`, `Edge Function source: ${name}`);
}

const expectedBuckets = [
  'proposal-signed-documents',
  'agreement-signed-documents',
  'hr-employee-documents',
  'company-documents',
  'ticket-attachments',
];
if (exists('database/bootstrap/01_storage_buckets.sql')) {
  const sql = read('database/bootstrap/01_storage_buckets.sql');
  for (const bucket of expectedBuckets) {
    results.push(result(sql.includes(bucket) ? 'PASS' : 'FAIL', `Storage bucket contract: ${bucket}`));
  }
} else {
  results.push(result('WARN', 'Storage bucket contract', 'database/bootstrap/01_storage_buckets.sql not found'));
}

if (exists('database/seeds/01_roles_and_permissions.sql')) {
  const sql = read('database/seeds/01_roles_and_permissions.sql').toLowerCase();
  for (const role of ['admin', 'dev', 'viewer', 'hoo', 'csm', 'sales_executive', 'head_of_sales', 'accounting', 'sfc', 'gm']) {
    results.push(result(sql.includes(`'${role}'`) ? 'PASS' : 'FAIL', `Baseline role: ${role}`));
  }
} else {
  results.push(result('WARN', 'Baseline roles source', 'database/seeds/01_roles_and_permissions.sql not found'));
}


requirePath('database/bootstrap/02_runtime_compatibility.sql', 'Runtime DB compatibility patch');
if (exists('database/bootstrap/02_runtime_compatibility.sql')) {
  const sql = read('database/bootstrap/02_runtime_compatibility.sql').toLowerCase();
  const checks = [
    ['crm_search_companies_for_select', 'CRM company selector RPC contract'],
    ['crm_resolve_company_uuid', 'CRM company resolver RPC contract'],
    ['crm_get_contacts_for_company', 'CRM contact selector RPC contract'],
    ['recipient_user_id', 'Push recipient_user_id compatibility'],
    ['profile_id', 'Push profile_id compatibility'],
    ["notify pgrst, 'reload schema'", 'PostgREST schema reload'],
  ];
  for (const [needle, label] of checks) {
    results.push(result(sql.includes(needle) ? 'PASS' : 'FAIL', label));
  }
}

if (exists('tests')) {
  const count = fs.readdirSync(path.join(root, 'tests')).filter(name => name.endsWith('.test.js')).length;
  results.push(result(count >= 32 ? 'PASS' : 'FAIL', 'Regression test inventory', `${count} tests found; expected at least 32`));
}

const retired = [
  'ai-assistant.js',
  'ai-insights-service.js',
  'insights.js',
  'supabase/functions/incheck360-ai-assistant/index.ts',
];
for (const rel of retired) {
  results.push(result(!exists(rel) ? 'PASS' : 'FAIL', `Retired feature absent: ${rel}`));
}

if (exists('index.html')) {
  const html = read('index.html').toLowerCase();
  const forbiddenRefs = ['ai-assistant.js', 'ai-insights-service.js'];
  for (const ref of forbiddenRefs) {
    results.push(result(!html.includes(ref) ? 'PASS' : 'FAIL', `No retired script reference: ${ref}`));
  }
}

if (exists('api/runtime-config.js')) {
  const runtimeApi = read('api/runtime-config.js');
  results.push(result(runtimeApi.includes('SUPABASE_URL') ? 'PASS' : 'FAIL', 'Runtime config exposes SUPABASE_URL'));
  results.push(result(runtimeApi.includes('SUPABASE_ANON_KEY') || runtimeApi.includes('SUPABASE_PUBLISHABLE_KEY') ? 'PASS' : 'FAIL', 'Runtime config exposes browser-safe Supabase key'));
} else {
  results.push(result('FAIL', 'Runtime config API', 'api/runtime-config.js missing'));
}

if (exists('runtime-config.js') && exists('vercel.json')) {
  try {
    const vercel = JSON.parse(read('vercel.json'));
    const rewrite = (vercel.rewrites || []).some(item => item && item.source === '/runtime-config.js' && item.destination === '/api/runtime-config');
    if (rewrite) {
      results.push(result('WARN', 'Runtime config routing', 'physical runtime-config.js and /runtime-config.js rewrite both exist; verify production serves /api/runtime-config'));
    } else {
      results.push(result('PASS', 'Runtime config routing'));
    }
  } catch (error) {
    results.push(result('FAIL', 'vercel.json parse', error.message));
  }
}

const report = {
  generated_at: nowIso(),
  kind: 'deployment-contract',
  results,
};
writeJson(path.join(root, 'test-results', 'deployment-contract.json'), report);
const counts = printResults('InCheck360 Deployment Contract Test', results);
if (counts.FAIL) process.exit(1);
