const { env } = require('./test-utils');

const supabaseUrl = env('TEST_SUPABASE_URL', 'SUPABASE_URL').replace(/\/+$/, '');
const serviceKey = env('TEST_SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY');
const wanted = ['operations_onboarding', 'technical_admin_requests'];

(async () => {
  if (!supabaseUrl || !serviceKey) throw new Error('Production Supabase URL/service role key are required.');
  const response = await fetch(`${supabaseUrl}/rest/v1/`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: 'application/openapi+json',
    },
  });
  if (!response.ok) throw new Error(`OpenAPI HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const spec = await response.json();
  for (const table of wanted) {
    const definition = spec.definitions?.[table] || spec.components?.schemas?.[table] || {};
    const properties = definition.properties || {};
    const required = new Set(definition.required || []);
    console.log(`\n=== ${table} ===`);
    console.log(`required=${[...required].sort().join(',') || '(none advertised)'}`);
    for (const [name, prop] of Object.entries(properties).sort(([a], [b]) => a.localeCompare(b))) {
      const type = prop.type || prop.format || prop.$ref || 'unknown';
      const format = prop.format ? `/${prop.format}` : '';
      const nullable = prop.nullable === true ? ' nullable' : '';
      const hasDefault = Object.prototype.hasOwnProperty.call(prop, 'default') ? ` default=${JSON.stringify(prop.default)}` : '';
      console.log(`${required.has(name) ? '*' : ' '} ${name}: ${type}${format}${nullable}${hasDefault}`);
    }
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
