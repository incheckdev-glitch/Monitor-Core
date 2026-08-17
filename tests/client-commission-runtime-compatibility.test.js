const assert = require('assert');
const fs = require('fs');

const clients = fs.readFileSync('clients-service.js', 'utf8');
const commission = fs.readFileSync('commission-tracker.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
const migration = fs.readFileSync('database/bootstrap/19_sales_commission_safe_delete.sql', 'utf8');

const clientColumnsMatch = clients.match(/CLIENT_COLUMNS:\s*new Set\(\[([\s\S]*?)\]\)/);
assert(clientColumnsMatch, 'ClientsService CLIENT_COLUMNS must exist');
assert(!clientColumnsMatch[1].includes("'company_id'"), 'ClientsService must not persist nonexistent clients.company_id');
assert(clients.includes('sanitizeClientPayload(input = {}, { includeCreatedBy = false } = {})'), 'sanitizeClientPayload must exist');
assert(!clients.includes('company_id: input.company_id || input.companyId || input.customer_company_id || input.customerCompanyId || input.client_company_id || input.clientCompanyId,'), 'Client create/update payload must not send company_id');
assert(index.includes('/clients-service.js?v=20260817-client-schema-fix-v2'), 'ClientsService cache key must be bumped');

assert(commission.includes("rpc('delete_sales_commission',{p_commission_id:id})"), 'Commission delete must use safe RPC');
assert(!commission.includes("from('sales_commissions').delete().eq('id',id)"), 'Commission delete must not use raw parent DELETE');
assert(index.includes('/commission-tracker.js?v=20260817-delete-rpc-v38'), 'Commission Tracker cache key must be bumped');
assert(migration.includes('create or replace function public.delete_sales_commission'), 'Safe commission delete migration must be checked in');
assert(migration.includes("lower(coalesce(r.status, 'issued')) not in ('void', 'voided', 'cancelled', 'canceled')"), 'Active receipts must block deletion');
assert(migration.includes('coalesce(i.paid_amount, 0) > 0'), 'Paid installments must block deletion');

console.log('Client schema and commission delete regression checks passed.');
