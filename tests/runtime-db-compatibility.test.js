const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sqlPath = path.join(root, 'database', 'bootstrap', '02_runtime_compatibility.sql');
assert.ok(fs.existsSync(sqlPath), 'runtime compatibility SQL patch must exist');

const sql = fs.readFileSync(sqlPath, 'utf8');
const selectors = fs.readFileSync(path.join(root, 'crm-form-selectors.js'), 'utf8');

assert.match(selectors, /rpc\('crm_search_companies_for_select'/, 'CRM selector must use crm_search_companies_for_select');
assert.match(sql, /create or replace function public\.crm_search_companies_for_select\s*\(/i, 'bootstrap must create CRM company selector RPC');
assert.match(sql, /create or replace function public\.crm_resolve_company_uuid\s*\(/i, 'bootstrap must create CRM company resolver');
assert.match(sql, /create or replace function public\.crm_get_contacts_for_company\s*\(/i, 'bootstrap must create CRM contact selector RPC');
assert.match(sql, /user_push_subscriptions[\s\S]*recipient_user_id/i, 'user_push_subscriptions must support recipient_user_id compatibility');
assert.match(sql, /user_push_subscriptions[\s\S]*profile_id/i, 'user_push_subscriptions must support profile_id compatibility');
assert.match(sql, /push_subscriptions[\s\S]*profile_id/i, 'push_subscriptions must support profile_id compatibility');
assert.match(sql, /notify pgrst, 'reload schema'/i, 'patch should reload PostgREST schema cache');

console.log('runtime-db-compatibility.test.js passed');
