from pathlib import Path

path = Path('deals.js')
text = path.read_text()

old_helper = """    const toNumberOrNull = keys => {
      const hasAny = keys.some(hasOwn);
"""
new_helper = """    const toIdOrNull = keys => {
      const hasAny = keys.some(hasOwn);
      if (!hasAny) return undefined;
      const value = keys.map(key => deal[key]).find(value => value !== undefined);
      if (value === undefined || value === null) return null;
      const text = String(value).trim();
      return text || null;
    };
    const toNumberOrNull = keys => {
      const hasAny = keys.some(hasOwn);
"""
if old_helper not in text:
    raise SystemExit('Unable to locate backendDeal helper insertion point')
text = text.replace(old_helper, new_helper, 1)

replacements = {
    "lead_id: toTextOrEmpty(['lead_id', 'leadId']),": "lead_id: toIdOrNull(['lead_id', 'leadId']),",
    "source_lead_uuid: toTextOrEmpty(['source_lead_uuid', 'sourceLeadUuid', 'lead_uuid', 'leadUuid']),": "source_lead_uuid: toIdOrNull(['source_lead_uuid', 'sourceLeadUuid', 'lead_uuid', 'leadUuid']),",
    "company_id: toTextOrEmpty(['company_id', 'companyId']),": "company_id: toIdOrNull(['company_id', 'companyId']),",
    "contact_id: toTextOrEmpty(['contact_id', 'contactId']),": "contact_id: toIdOrNull(['contact_id', 'contactId']),",
    "customer_contact_id: toTextOrEmpty(['customer_contact_id', 'customerContactId']),": "customer_contact_id: toIdOrNull(['customer_contact_id', 'customerContactId']),",
    "client_contact_id: toTextOrEmpty(['client_contact_id', 'clientContactId']),": "client_contact_id: toIdOrNull(['client_contact_id', 'clientContactId']),",
    "primary_contact_id: toTextOrEmpty(['primary_contact_id', 'primaryContactId']),": "primary_contact_id: toIdOrNull(['primary_contact_id', 'primaryContactId']),",
    "selected_contact_id: toTextOrEmpty(['selected_contact_id', 'selectedContactId']),": "selected_contact_id: toIdOrNull(['selected_contact_id', 'selectedContactId']),",
    "contact_uuid: toTextOrEmpty(['contact_uuid', 'contactUuid']),": "contact_uuid: toIdOrNull(['contact_uuid', 'contactUuid']),",
    "converted_by: toTextOrEmpty(['converted_by', 'convertedBy']),": "converted_by: toIdOrNull(['converted_by', 'convertedBy']),",
}
for old, new in replacements.items():
    if old not in text:
        raise SystemExit(f'Unable to locate mapping: {old}')
    text = text.replace(old, new, 1)

path.write_text(text)

index = Path('index.html')
html = index.read_text()
old_script = '/deals.js?v=20260817-friendly-commercial-ids-v1'
new_script = '/deals.js?v=20260817-empty-uuid-fix-v1'
if old_script not in html:
    raise SystemExit('Unable to locate deals script cache key')
html = html.replace(old_script, new_script, 1)
index.write_text(html)

test = Path('tests/deal-empty-uuid.test.js')
test.write_text("""const assert = require('assert');
const fs = require('fs');

const deals = fs.readFileSync('deals.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');

assert.match(deals, /const toIdOrNull = keys => \{[\s\S]*return text \|\| null;/,
  'Deal mapper must normalize blank relational IDs to null');

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
  const pattern = new RegExp(field + ':\\s*toIdOrNull\\(');
  assert.match(deals, pattern, `${field} must use nullable ID normalization`);
});

assert.match(deals, /const isDirectCreate = mode !== 'edit' && !String\(deal\.lead_id \|\| ''\)\.trim\(\);/,
  'Direct Deal creation without a Lead must remain supported');
assert(index.includes('/deals.js?v=20260817-empty-uuid-fix-v1'),
  'Deals script cache key must be bumped so browsers receive the fix');

console.log('Deal empty UUID normalization checks passed.');
""")
