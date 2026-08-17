const assert = require('assert');
const fs = require('fs');

const deals = fs.readFileSync('deals.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');

assert(deals.includes('const toIdOrNull = keys => {'), 'Deal mapper must define nullable ID normalization');
assert(deals.includes('return text || null;'), 'Blank relational IDs must normalize to null');

[
  'lead_id',
  'source_lead_uuid',
  'company_id',
  'contact_id',
  'customer_contact_id',
  'client_contact_id',
  'primary_contact_id',
  'selected_contact_id',
  'contact_uuid',
  'converted_by'
].forEach(field => {
  assert(deals.includes(`${field}: toIdOrNull(`), `${field} must use nullable ID normalization`);
});

assert(deals.includes("const isDirectCreate = mode !== 'edit' && !String(deal.lead_id || '').trim();"),
  'Direct Deal creation without a Lead must remain supported');
assert(index.includes('/deals.js?v=20260817-empty-uuid-fix-v1'),
  'Deals script cache key must be bumped so browsers receive the fix');

console.log('Deal empty UUID normalization checks passed.');
