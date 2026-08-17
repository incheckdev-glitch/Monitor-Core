const assert = require('assert');
const fs = require('fs');

const endpoint = fs.readFileSync('api/communication-centre-create.js', 'utf8');
const client = fs.readFileSync('supabase-client.js', 'utf8');

assert.match(endpoint, /req\.method !== 'POST'/, 'server fallback must be POST-only');
assert.match(endpoint, /SUPABASE_SERVICE_ROLE_KEY/, 'server fallback must require the service-role key server-side');
assert.match(endpoint, /auth\.getUser\(token\)/, 'server fallback must verify the caller access token');
assert.match(endpoint, /rpc\('cc_has_permission', \{ p_action: 'manage' \}\)/, 'server fallback must enforce backend Communication Centre manage permission');
assert.match(endpoint, /if \(permission\.data !== true\)/, 'server fallback must deny callers without manage permission');
assert.match(endpoint, /communication_centre_conversations/, 'server fallback must create the conversation in the live table');
const conversationInsert = endpoint.match(/insertConversationWithRetry\(admin, \{([\s\S]*?)\n    \}\);/)?.[1] || '';
assert.ok(conversationInsert, 'server fallback must expose an explicit conversation insert payload');
assert.doesNotMatch(conversationInsert, /\bassigned_user_ids\b/, 'server fallback must not write the stale assigned_user_ids conversation column');
assert.match(endpoint, /communication_centre_participants/, 'server fallback must create participant rows');
assert.match(endpoint, /conversation_id: conversationId,[\s\S]*user_id: userId,[\s\S]*created_at: now/, 'participant rows must use the accepted live columns');
assert.match(endpoint, /const participantIds = new Set\(\[user\.id\]\)/, 'the authenticated creator must always be a participant');
assert.match(endpoint, /rpc\('add_communication_centre_reply_secure'/, 'the first message must use the existing secure reply RPC');
assert.match(endpoint, /cleanupPartial\(admin, conversationId\)/, 'partial conversation data must be rolled back when creation fails');
assert.match(endpoint, /String\(result\.error\?\.code \|\| ''\) !== '23505'/, 'conversation-number collisions must be retried safely');

assert.match(client, /COMMUNICATION_CREATE_RPC = 'create_communication_centre_conversation'/, 'browser fallback must target only the create-conversation RPC');
assert.match(client, /if \(String\(fn \|\| ''\) !== COMMUNICATION_CREATE_RPC\) \{\s*return nativeRpc\(fn, args, options\);/s, 'all unrelated RPC calls must retain native Supabase behavior');
assert.match(client, /const nativeResult = await nativeRpc\(fn, args, options\)/, 'native create RPC must always be tried first');
assert.match(client, /!isMissingRpcError\(nativeResult\.error, COMMUNICATION_CREATE_RPC\)/, 'fallback must not run for ordinary permission or business errors');
assert.match(client, /code === 'PGRST202'/, 'PostgREST missing-function code must activate the fallback');
assert.match(client, /fetch\('\/api\/communication-centre-create'/, 'missing create RPC must use the secure Vercel endpoint');
assert.match(client, /Authorization: `Bearer \$\{accessToken\}`/, 'server fallback must forward the authenticated Supabase session');
assert.match(client, /body: JSON\.stringify\(args \|\| \{\}\)/, 'the fallback must preserve the existing RPC argument contract');

console.log('Communication Centre secure server fallback checks passed.');
