const fs = require('fs');
const assert = require('assert');

const api = fs.readFileSync('api/lead-intelligence-enrich.js', 'utf8');
const client = fs.readFileSync('src/services/leadIntelligenceContactEnrichment.js', 'utf8');
const patch = fs.readFileSync('src/services/darkModeSafetyPatch.js', 'utf8');
const migration = fs.readFileSync('database/migrations/20260911_lead_intelligence_contact_enrichment.sql', 'utf8');

assert.match(api, /const MODEL = 'gpt-5\.6-luna'/);
assert.match(api, /const MAX_WEB_CALLS = 2/);
assert.match(api, /const MAX_OUTPUT_TOKENS = 900/);
assert.match(api, /const CACHE_DAYS = 30/);
assert.match(api, /reasoning:\s*\{\s*effort:\s*'none'\s*\}/);
assert.match(api, /search_context_size:\s*'low'/);
assert.match(api, /background:\s*true/);
assert.match(api, /Never infer or guess email formats/);
assert.match(api, /Never guess, synthesize, transform, or infer a phone number/);
assert.match(api, /Every non-empty contact value must have its own public source URL/);
assert.doesNotMatch(api, /gpt-5\.6-sol/);
assert.doesNotMatch(api, /gpt-5\.6-terra/);

assert.match(client, /Find Phone & Email/);
assert.match(client, /Retry Phone & Email/);
assert.match(client, /Saved contact lookup reused\. \$0 new OpenAI usage/);
assert.match(client, /Scoped only to Lead Intelligence result cards/);
assert.match(client, /max 2 web searches/);
assert.doesNotMatch(client, /setInterval\s*\(/);

assert.match(patch, /leadIntelligenceContactEnrichment\.js\?v=20260911-li-contact1/);
assert.match(migration, /lead_intelligence_contact_enrichments/);
assert.match(migration, /trg_enforce_lead_intelligence_enrichment_limits/);
assert.match(migration, /uq_li_contact_enrichment_one_running/);
assert.match(migration, /0\.01\*e\.web_search_cap|0\.01 \* e\.web_search_cap/);
assert.match(migration, /public\.lead_intelligence_runs/);
assert.match(migration, /public\.lead_intelligence_contact_enrichments/);

console.log('Lead Intelligence selective contact enrichment guards passed.');
