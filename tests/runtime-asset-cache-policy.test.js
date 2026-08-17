const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const headers = Array.isArray(config.headers) ? config.headers : [];

const mutableRuntimeAssets = [
  '/communication-centre.js',
  '/supabase-client.js',
  '/push-notifications.js',
  '/config.js',
  '/service-worker.js'
];

function headerRuleFor(source) {
  return headers.find(rule => rule && rule.source === source);
}

for (const source of mutableRuntimeAssets) {
  const rule = headerRuleFor(source);
  if (!rule) {
    throw new Error(`Missing explicit cache policy for ${source}`);
  }

  const cacheControl = (rule.headers || []).find(
    header => String(header?.key || '').toLowerCase() === 'cache-control'
  );
  const value = String(cacheControl?.value || '').toLowerCase();

  if (!value.includes('no-store') || !value.includes('max-age=0')) {
    throw new Error(`${source} must be served with no-store and max-age=0; got: ${value || '<missing>'}`);
  }
}

console.log('Runtime asset cache policy contract PASS');
