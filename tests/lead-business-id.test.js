const assert = require('assert');
const fs = require('fs');

const leads = fs.readFileSync('leads.js', 'utf8');

assert.match(leads, /leadWithBusinessId[\s\S]*lead_id: String\(lead\?\.lead_id \|\| ''\)\.trim\(\) \|\| await this\.allocateLeadId\(\)/, 'createLead must defensively allocate a friendly business Lead ID');
assert.match(leads, /const tempLeadId = String\(lead\.lead_id \|\| ''\)\.trim\(\) \|\| await this\.allocateLeadId\(\);[\s\S]*lead\.lead_id = tempLeadId;/, 'create form path must put the allocated friendly Lead ID into the payload');
assert.match(leads, /if \(!String\(sourceLead\.lead_id \|\| ''\)\.trim\(\)\) \{[\s\S]*generatedLeadId[\s\S]*updateLeadWithVerification[\s\S]*lead_id: generatedLeadId/, 'conversion must repair historical leads missing a business Lead ID');
assert.doesNotMatch(leads, /UI\.toast\('Unable to convert lead: missing business Lead ID\.'\)/, 'conversion must not stop solely because an older lead lacks lead_id');

console.log('lead business ID regression tests passed');
