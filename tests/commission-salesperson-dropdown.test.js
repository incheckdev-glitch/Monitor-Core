const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('commission-tracker.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');

assert(source.includes("select('id,name,email,username,role_key,is_active')"), 'Commission Tracker must query only deployed profile columns');
assert(!source.includes('is_active,active'), 'Commission Tracker must not request the removed profiles.active column');
assert(source.includes("['head_of_sales','sales_executive','sales_manager']"), 'Head of Sales must remain an eligible salesperson role');
assert(!source.includes('row.active!==false'), 'Salesperson eligibility must use profiles.is_active as the source of truth');
assert(index.includes('/commission-tracker.js?v=20260817-salesperson-profile-fix-v37'), 'Commission Tracker cache key must be bumped');

console.log('Commission salesperson dropdown regression checks passed.');
