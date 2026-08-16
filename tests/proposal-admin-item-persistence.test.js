const assert = require('assert');
const fs = require('fs');

const proposals = fs.readFileSync('proposals.js', 'utf8');
const data = fs.readFileSync('supabase-data.js', 'utf8');
const migration = fs.readFileSync('database/bootstrap/17_admin_locked_proposal_rpc_and_items.sql', 'utf8');

assert.match(proposals, /requiresAdminOverrideForProposal[\s\S]*accepted[\s\S]*expired[\s\S]*rejected[\s\S]*converted_to_agreement/, 'locked proposal statuses must be explicit');
assert.match(proposals, /const adminOverride = this\.canUseAdminOverride\(\) && this\.state\.adminOverrideActive === true/, 'Admin role alone must not force override RPC');
assert.match(proposals, /adminOverrideRequired = this\.canUseAdminOverride\(\) && this\.requiresAdminOverrideForProposal\(currentRecord\)/, 'submit flow must decide override from current proposal status');
assert.match(proposals, /if \(adminOverrideRequired\)[\s\S]*requestAdminOverrideReason/, 'override reason should only be requested for a locked proposal');
assert.match(proposals, /persistedItems\.length !== items\.length[\s\S]*proposal item persistence was not verified/i, 'UI must verify saved proposal item count');
assert.match(data, /resource === 'proposals' && requestedItems\.length[\s\S]*Proposal item persistence mismatch[\s\S]*partial header was rolled back/, 'proposal create must verify items and rollback partial headers');
assert.match(data, /const deleteResp = await client\.from\(itemTable\)\.delete\(\)\.eq\(fk, parentId\)[\s\S]*deleteResp\.error/, 'proposal item replacement delete errors must be checked');
assert.match(data, /Proposal item persistence mismatch after update/, 'proposal update must verify child persistence');
assert(!migration.includes('jsonb_object_length'), 'fixed RPC must not use nonexistent jsonb_object_length');
assert.match(migration, /p_changes is null or p_changes = '\{\}'::jsonb/, 'RPC must use PostgreSQL-safe JSON emptiness check');
console.log('proposal Admin/item persistence regressions passed');
