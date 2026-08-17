const assert = require('assert');
const fs = require('fs');

const users = fs.readFileSync('users.js', 'utf8');
const supabaseData = fs.readFileSync('supabase-data.js', 'utf8');
const createUserFn = fs.readFileSync('supabase/functions/admin-create-user/index.ts', 'utf8');
const resetPasswordFn = fs.readFileSync('supabase/functions/admin-set-temporary-password/index.ts', 'utf8');

assert(supabaseData.includes("client.functions.invoke('admin-create-user'"), 'User creation must invoke admin-create-user');
assert(users.includes("'admin-set-temporary-password'"), 'Password reset must invoke admin-set-temporary-password');

assert(createUserFn.includes('supabaseAdmin.auth.admin.createUser'), 'admin-create-user must create Supabase Auth users with the service role');
assert(createUserFn.includes('.from("profiles")'), 'admin-create-user must verify/upsert profiles');
assert(createUserFn.includes('profile?.role_key === "admin"'), 'admin-create-user must require an active Admin caller');
assert(createUserFn.includes('getUser'), 'admin-create-user must authenticate the caller token');

assert(resetPasswordFn.includes('supabaseAdmin.auth.admin.updateUserById'), 'temporary-password function must update Auth user through admin API');
assert(resetPasswordFn.includes('profile?.role_key !== "admin"'), 'temporary-password function must require an Admin caller');

console.log('User admin Edge Function source checks passed.');
