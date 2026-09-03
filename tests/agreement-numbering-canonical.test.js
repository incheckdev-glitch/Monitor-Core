const assert = require('assert');
const fs = require('fs');

const bootstrap = fs.readFileSync('database/bootstrap/06_agreement_id_autogeneration.sql', 'utf8');
const restart = fs.readFileSync('database/migrations/20260903_restart_business_numbering.sql', 'utf8');

for (const sql of [bootstrap, restart]) {
  assert.ok(
    sql.includes('drop trigger if exists trg_allocate_agreement_number on public.agreements;'),
    'legacy agreement-number trigger must be removed'
  );

  assert.ok(
    sql.includes("new.agreement_number := new.agreement_id;"),
    'generated agreement_number must match agreement_id'
  );

  assert.ok(
    sql.includes("new.agreement_number := 'Agreement#' || lpad(v_existing_seq::text, 5, '0');"),
    'caller-supplied Agreement# IDs must synchronize agreement_number'
  );
}

assert.ok(
  restart.includes("set company_id = 'Company#00001'"),
  'production restart must reset the singleton company baseline to Company#00001'
);
assert.ok(
  restart.includes("set contact_id = 'Contact#00001'"),
  'production restart must reset the singleton contact baseline to Contact#00001'
);
assert.ok(
  restart.includes("agreement_id = 'Agreement#00001'") && restart.includes("agreement_number = 'Agreement#00001'"),
  'production restart must reset and synchronize the singleton agreement baseline'
);

console.log('canonical agreement numbering regressions passed');
