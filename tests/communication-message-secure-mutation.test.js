const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('supabase-data.js', 'utf8');
const diagnostic = fs.readFileSync('scripts/production-communication-diagnostic.js', 'utf8');
const migration = fs.readFileSync('database/bootstrap/20_communication_centre_secure_message_mutation.sql', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');

assert(source.includes("rpc('edit_communication_centre_message_secure'"), 'Communication edits must use secure RPC');
assert(source.includes("rpc('soft_delete_communication_centre_message_secure'"), 'Communication deletes must use secure RPC');
assert(!source.includes("from('communication_centre_messages').update(updates).eq('id', id).select('*').single()"), 'Communication message mutation must not use direct table UPDATE');
assert(diagnostic.includes("rpc('edit_communication_centre_message_secure'"), 'Production diagnostic must verify secure edit RPC');
assert(diagnostic.includes("rpc('soft_delete_communication_centre_message_secure'"), 'Production diagnostic must verify secure delete RPC');
assert(migration.includes("interval '5 minutes'"), 'Secure mutation RPCs must enforce the five-minute window');
assert(migration.includes('v_message.sender_id is distinct from v_actor'), 'Secure mutation RPCs must enforce sender ownership');
assert(index.includes('/supabase-data.js?v=20260817-communication-message-rpc-v2'), 'SupabaseData cache key must be bumped');

console.log('Communication secure message mutation checks passed.');
