const fs = require('fs');
const assert = require('assert');

const job = fs.readFileSync('api/lead-intelligence-job.js', 'utf8');
const legacy = fs.readFileSync('api/lead-intelligence.js', 'utf8');
const client = fs.readFileSync('src/services/leadIntelligenceBackground.js', 'utf8');
const enrich = fs.readFileSync('api/lead-intelligence-enrich.js', 'utf8');

assert.match(job, /const MODEL = 'gpt-5\.6-luna'/);
assert.match(job, /const PROFILE = 'balanced-v2'/);
assert.match(job, /const MAX = 5/);
assert.match(job, /const DEFAULT_COUNT = 3/);
assert.match(job, /const MAX_WEB_CALLS = 5/);
assert.match(job, /const MAX_OUTPUT_TOKENS = 3000/);
assert.match(job, /reasoning:\s*\{\s*effort:\s*'low'\s*\}/);
assert.match(job, /search_context_size:\s*'low'/);
assert.match(job, /max_tool_calls:\s*MAX_WEB_CALLS/);
assert.match(job, /verbosity:\s*'low'/);
assert.match(job, /CACHE_HOURS = 24/);
assert.match(job, /research_profile:\s*PROFILE/);
assert.match(job, /web_search_cap:\s*MAX_WEB_CALLS/);
assert.match(job, /cached:/);
assert.doesNotMatch(job, /gpt-5\.6-sol/);
assert.doesNotMatch(job, /gpt-5\.6-terra/);

assert.match(legacy, /Synchronous Lead Intelligence research is disabled/);
assert.doesNotMatch(legacy, /api\.openai\.com\/v1\/responses/);

assert.match(client, /MAX_COUNT=5/);
assert.match(client, /DEFAULT_COUNT=3/);
assert.match(client, /Balanced quality/);
assert.match(client, /max 5 web searches/);
assert.match(client, /low reasoning/);
assert.match(client, /\$0 new OpenAI research/);

assert.match(enrich, /const MODEL = 'gpt-5\.6-luna'/);
assert.match(enrich, /const MAX_WEB_CALLS = 2/);
assert.match(enrich, /const MAX_OUTPUT_TOKENS = 900/);

console.log('Lead Intelligence balanced-quality cost guards passed.');
