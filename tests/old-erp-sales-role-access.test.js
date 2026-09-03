const assert = require('assert');
const fs = require('fs');

const migration = fs.readFileSync('database/migrations/20260903_restore_old_erp_sales_role_access.sql', 'utf8');

const requiredHeadOfSales = [
  "('head_of_sales','leads','list')",
  "('head_of_sales','leads','update')",
  "('head_of_sales','deals','list')",
  "('head_of_sales','proposals','create')",
  "('head_of_sales','proposals','create_from_deal')",
  "('head_of_sales','agreements','create_from_proposal')",
  "('head_of_sales','clients','list')",
  "('head_of_sales','invoices','list')",
  "('head_of_sales','receipts','list')",
  "('head_of_sales','credit_notes','print')",
  "('head_of_sales','workflow','approve')",
  "('head_of_sales','sales_commissions','manage_all')"
];

for (const permission of requiredHeadOfSales) {
  // sales_commissions is provided by the baseline seed and must not be lost there.
  if (permission.includes("sales_commissions")) {
    const seed = fs.readFileSync('database/seeds/01_roles_and_permissions.sql', 'utf8');
    assert.ok(seed.includes(permission), `Missing Head of Sales permission: ${permission}`);
  } else {
    assert.ok(migration.includes(permission), `Missing Head of Sales permission: ${permission}`);
  }
}

assert.ok(migration.includes("('sales_executive','leads','create')"), 'Sales Executive must retain lead creation');
assert.ok(migration.includes("('sales_executive','proposals','create_from_deal')"), 'Sales Executive must retain proposal conversion');
assert.ok(migration.includes("('sales_executive','operations_onboarding','create')"), 'Sales Executive must retain historical onboarding access');
assert.ok(migration.includes("('accounting','operations_onboarding','update')"), 'Accounting must retain historical onboarding access');
assert.ok(migration.includes("('viewer','credit_notes','print')"), 'Viewer must retain historical Credit Note read/print access');
assert.ok(migration.includes('incheck360_credit_note_read_role_allowed'), 'Credit Note read RLS must be separated from finance write RLS');
assert.ok(migration.includes("'sales_executive','head_of_sales'"), 'Credit Note read RLS must include sales roles');

console.log('old ERP sales role access regressions passed');
