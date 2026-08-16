const assert = require('assert');
const fs = require('fs');

const sql = fs.readFileSync('database/bootstrap/16_communication_centre_current_app_user_helper.sql', 'utf8');

assert.match(sql, /create or replace function public\.cc_current_app_user_id\(\)/i, 'migration must restore cc_current_app_user_id');
assert.match(sql, /returns uuid/i, 'current app user helper must return a UUID');
assert.match(sql, /where p\.id = auth\.uid\(\)/i, 'helper must anchor the app user to auth.uid()');
assert.match(sql, /coalesce\(p\.is_active, true\)/i, 'helper must reject inactive profiles');
assert.match(sql, /security definer/i, 'helper must be callable from the secure Communication Centre RPC chain');
assert.match(sql, /grant execute on function public\.cc_current_app_user_id\(\) to authenticated/i, 'authenticated users must be able to invoke the helper through secure RPCs');
assert.match(sql, /notify pgrst, 'reload schema'/i, 'migration must reload PostgREST schema');
assert.doesNotMatch(sql, /insert\s+into|update\s+public\.|delete\s+from/i, 'helper migration must not mutate business rows');

console.log('Communication Centre current-user helper contract checks passed.');
