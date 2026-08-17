const assert = require('assert');
const fs = require('fs');

const invoices = fs.readFileSync('invoices.js', 'utf8');
const supabaseData = fs.readFileSync('supabase-data.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
const migration12 = fs.readFileSync('database/bootstrap/12_gap_safe_business_id_allocation.sql', 'utf8');

assert(!invoices.includes('return `INV-${datePart}-${randomPart}`'), 'new invoices must not use timestamp/random INV identifiers');
assert(invoices.includes('return `SA/${year}/NEW`'), 'new invoice form must use a friendly SA placeholder before allocation');
assert(invoices.includes('async allocateNextInvoiceBusinessNumber()'), 'invoice UI allocator missing');
assert(invoices.includes('async ensureNewInvoiceBusinessIdentifiers(invoice = {})'), 'invoice UI identifier guard missing');
assert(invoices.includes('await this.ensureNewInvoiceBusinessIdentifiers(invoice);'), 'invoice save must allocate the business ID before validation/create');
assert(invoices.indexOf('await this.ensureNewInvoiceBusinessIdentifiers(invoice);') < invoices.indexOf('if (!this.validateInvoice(invoice)) return;'), 'invoice business ID must be allocated before invoice validation');

assert(supabaseData.includes('async function ensureInvoiceBusinessIdentifiers(client, record = {}, { force = false } = {})'), 'backend invoice identifier guard missing');
assert(supabaseData.includes("if (resource === 'invoices') finalCreateRecord = await ensureInvoiceBusinessIdentifiers(client, finalCreateRecord);"), 'generic invoice create must guarantee invoice identifiers before insert');
assert(supabaseData.includes('async function insertInvoiceWithBusinessIdRetry('), 'invoice unique-conflict retry helper missing');
assert(supabaseData.includes("String(error?.code || '').trim() !== '23505'"), 'invoice retry must only handle unique conflicts');
assert(supabaseData.includes('workingRecord = await ensureInvoiceBusinessIdentifiers(client, workingRecord, { force: true });'), 'invoice collision retry must allocate a fresh SA number');

assert(index.includes('/supabase-data.js?v=20260817-invoice-business-id-v1'), 'supabase-data cache key must be bumped');
assert(index.includes('/invoices.js?v=20260817-invoice-business-id-v1'), 'invoice cache key must be bumped');
assert(migration12.includes("v_no := 'SA/' || v_year || '/' || lpad(v_invoice_seq::text, 2, '0');"), 'database agreement-to-invoice flow must remain aligned to SA/YYYY/NN');

console.log('Invoice business ID allocation checks passed.');
