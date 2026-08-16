const assert = require('assert');
const fs = require('fs');

const data = fs.readFileSync('supabase-data.js', 'utf8');
const migration = fs.readFileSync('database/bootstrap/17_admin_locked_proposal_rpc_and_items.sql', 'utf8');

assert.match(data, /function buildProposalLineItemId[\s\S]*PITEM-/, 'proposal-scoped line ID generator must exist');
assert.match(data, /sourceParentUuid === parentUuid && incomingItemId/, 'existing rows from the same proposal should preserve their line ID');
assert.match(data, /item_id: buildProposalLineItemId\(record, proposalUuid\)/, 'proposal item sanitizer must use proposal-scoped IDs');
assert.match(migration, /v_existing_item_ids text\[\]/, 'locked-proposal RPC must retain existing proposal-line identities');
assert.match(migration, /PITEM-[\s\S]*replace\(p_proposal_id::text/, 'locked-proposal RPC must generate proposal-scoped IDs for new lines');
console.log('proposal item identity regressions passed');
