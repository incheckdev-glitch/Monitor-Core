const assert = require('assert');
const fs = require('fs');

const leads = fs.readFileSync('leads.js', 'utf8');
assert.match(leads, /currentConverterIdentity\(\)[\s\S]*Session\.userId\?\.\(\)[\s\S]*find\(value => this\.isUuid\(value\)\)/, 'converter identity must resolve an authenticated UUID');
assert.doesNotMatch(leads, /currentConverterIdentity\(\) \{\s*return String\(Session\.displayName/, 'converter identity must not use display name');
assert.match(leads, /\['lead_id', 'source_lead_uuid', 'company_id', 'contact_id', 'customer_contact_id', 'converted_by'\][\s\S]*!this\.isUuid\(value\)[\s\S]*delete sanitized\[key\]/, 'deal conversion must strip non-UUID values from UUID-only fields');
console.log('deal converter UUID regression tests passed');
