const { env } = require('./test-utils');

const supabaseUrl = env('TEST_SUPABASE_URL', 'SUPABASE_URL').replace(/\/+$/, '');
const serviceKey = env('TEST_SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY');

(async () => {
  if (!supabaseUrl || !serviceKey) throw new Error('Supabase production test secrets are required.');
  const response = await fetch(`${supabaseUrl}/rest/v1/`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: 'application/openapi+json',
    },
  });
  if (!response.ok) throw new Error(`OpenAPI schema HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const spec = await response.json();
  const paths = spec.paths || {};
  const names = Object.keys(paths)
    .filter(key => key.startsWith('/rpc/') && /communication_centre|cc_/.test(key))
    .sort();
  if (!names.length) {
    console.log('No Communication Centre RPC paths are exposed.');
    return;
  }
  for (const name of names) {
    console.log(`\n=== ${name} ===`);
    const post = paths[name]?.post || paths[name] || {};
    const params = Array.isArray(post.parameters) ? post.parameters : [];
    for (const param of params) {
      console.log(`param ${param.name || '(unnamed)'} in=${param.in || ''} required=${Boolean(param.required)} schema=${JSON.stringify(param.schema || {})}`);
    }
    if (post.requestBody) console.log(`requestBody=${JSON.stringify(post.requestBody)}`);
    if (post.responses?.['200']) console.log(`response200=${JSON.stringify(post.responses['200'])}`);
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
