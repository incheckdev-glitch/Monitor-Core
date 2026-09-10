const fs = require('fs');
const assert = require('assert');

const api = fs.readFileSync('api/lead-intelligence.js', 'utf8');
const ui = fs.readFileSync('src/services/leadIntelligence.js', 'utf8');
const migration = fs.readFileSync('database/migrations/20260910_lead_intelligence_module.sql', 'utf8');

assert.match(api, /OPENAI_API_KEY/);
assert.match(api, /https:\/\/api\.openai\.com\/v1\/responses/);
assert.match(api, /type:\s*'web_search'/);
assert.match(api, /type:\s*'json_schema'/);
assert.match(api, /can_use_lead_intelligence/);
assert.match(api, /Bearer\s+/);
assert.doesNotMatch(ui, /OPENAI_API_KEY\s*=/);
assert.match(ui, /lead_intelligence_accept_suggestion/);
assert.match(ui, /Suggested Leads/);
assert.match(migration, /enable row level security/i);
assert.match(migration, /lead_intelligence_accept_suggestion/);
assert.match(migration, /not contacted yet/);

console.log('Lead Intelligence contract checks passed.');
