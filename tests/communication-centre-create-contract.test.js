const assert = require('assert');
const fs = require('fs');

const ui = fs.readFileSync('communication-centre.js', 'utf8');
const sql = fs.readFileSync('database/bootstrap/15_communication_centre_create_conversation_rpc.sql', 'utf8');

assert.match(
  ui,
  /rpc\('create_communication_centre_conversation'[\s\S]*p_title[\s\S]*p_description[\s\S]*p_category[\s\S]*p_priority[\s\S]*p_assigned_user_ids[\s\S]*p_assigned_role[\s\S]*p_related_resource[\s\S]*p_related_record_id/,
  'Communication Centre UI must call the secured create RPC with the expected argument contract',
);
assert.match(ui, /if \(!message\) return showFriendlyError\('First message is required\.'\)/, 'create UI must continue treating p_description as the required first message');
assert.match(
  sql,
  /create or replace function public\.create_communication_centre_conversation\(\s*p_title text,\s*p_description text default null,\s*p_category text default 'General',\s*p_priority text default 'Normal',\s*p_assigned_user_ids uuid\[\] default array\[\]::uuid\[\],\s*p_assigned_role text default null,\s*p_related_resource text default null,\s*p_related_record_id text default null\s*\)/i,
  'migration must expose the exact UI RPC signature',
);
assert.match(sql, /public\.cc_has_permission\('manage'\)/, 'create RPC must enforce Communication Centre manage permission');
assert.match(sql, /public\.cc_normalize_role_key\(p_assigned_role\)/, 'assigned roles must use the live role normalizer');
assert.match(sql, /if nullif\(btrim\(coalesce\(p_description, ''\)\), ''\) is null then\s*raise exception 'First message is required'/i, 'create RPC must reject a missing first message');
assert.match(sql, /insert into public\.communication_centre_participants\(\s*id,\s*conversation_id,\s*user_id,\s*created_at\s*\)/i, 'participant insert must use the live accepted participant columns');
assert.doesNotMatch(sql, /insert into public\.communication_centre_participants[\s\S]{0,350}(is_active|is_muted|joined_at|last_read_at|updated_at|user_role)/i, 'migration must not write stale participant columns');
assert.match(sql, /select v_actor/, 'conversation creator must remain a participant');
assert.match(sql, /participant_count = v_participant_count/i, 'conversation participant count must be synchronized');
assert.match(sql, /perform public\.add_communication_centre_reply_secure\(\s*v_id,\s*btrim\(p_description\),\s*'message',\s*null\s*\)/i, 'create RPC must persist the required first message through the live secure reply path');

const participantInsertIndex = sql.search(/insert into public\.communication_centre_participants/i);
const firstMessageIndex = sql.search(/perform public\.add_communication_centre_reply_secure/i);
assert.ok(participantInsertIndex >= 0 && firstMessageIndex > participantInsertIndex, 'participants must be established before the first secure message is created');

const conversationInsertColumns = sql.match(/insert into public\.communication_centre_conversations\s*\(([^)]*)\)/i)?.[1] || '';
assert.ok(conversationInsertColumns, 'migration must contain a Communication Centre conversation insert column list');
assert.doesNotMatch(conversationInsertColumns, /\bassigned_user_ids\b/i, 'migration must not write stale assigned_user_ids conversation column');
assert.doesNotMatch(conversationInsertColumns, /\brelated_record_ref\b|\brelated_record_title\b/i, 'migration must not write stale related-record columns rejected by production');

assert.match(sql, /grant execute on function public\.create_communication_centre_conversation/i, 'authenticated users must receive RPC execute permission');
assert.match(sql, /notify pgrst, 'reload schema'/i, 'migration must reload PostgREST schema');

console.log('Communication Centre create RPC contract checks passed.');
