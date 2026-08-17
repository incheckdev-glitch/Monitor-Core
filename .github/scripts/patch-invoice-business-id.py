from pathlib import Path

# -----------------------------------------------------------------------------
# invoices.js: allocate the canonical SA/YYYY/NN identifier before create.
# -----------------------------------------------------------------------------
invoice_path = Path('invoices.js')
invoice_src = invoice_path.read_text()

old_generator = r'''  generateInvoiceNumber() {
    const now = new Date();
    const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const randomPart = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `INV-${datePart}-${randomPart}`;
  },
  ensureInvoiceNumber(value = '') {
    const existing = String(value || '').trim();
    return existing || this.generateInvoiceNumber();
  },
'''
new_generator = r'''  generateInvoiceNumber() {
    const year = new Date().getFullYear();
    return `SA/${year}/NEW`;
  },
  ensureInvoiceNumber(value = '') {
    const existing = String(value || '').trim();
    return existing || this.generateInvoiceNumber();
  },
  isCanonicalInvoiceBusinessNumber(value = '') {
    return /^SA\/\d{4}\/\d+$/i.test(String(value || '').trim());
  },
  async allocateNextInvoiceBusinessNumber() {
    const client = this.getSupabaseClient();
    if (!client?.from) throw new Error('Unable to allocate invoice number: Supabase is not available.');
    const year = String(new Date().getFullYear());
    const matcher = new RegExp(`^SA\\/${year}\\/([0-9]+)$`, 'i');
    const { data, error } = await client
      .from('invoices')
      .select('invoice_id,invoice_number')
      .order('created_at', { ascending: false })
      .limit(5000);
    if (error) throw new Error(`Unable to allocate invoice number: ${error.message || 'Unknown Supabase error'}`);
    let maxSequence = 0;
    (Array.isArray(data) ? data : []).forEach(row => {
      [row?.invoice_id, row?.invoice_number].forEach(value => {
        const match = String(value || '').trim().match(matcher);
        if (!match) return;
        const sequence = Number(match[1]);
        if (Number.isFinite(sequence)) maxSequence = Math.max(maxSequence, sequence);
      });
    });
    return `SA/${year}/${String(maxSequence + 1).padStart(2, '0')}`;
  },
  async ensureNewInvoiceBusinessIdentifiers(invoice = {}) {
    const source = invoice && typeof invoice === 'object' ? invoice : {};
    const existing = [source.invoice_id, source.invoice_number]
      .map(value => String(value || '').trim())
      .find(value => this.isCanonicalInvoiceBusinessNumber(value));
    const friendly = existing || await this.allocateNextInvoiceBusinessNumber();
    source.invoice_id = friendly;
    source.invoice_number = friendly;
    if (E.invoiceFormInvoiceId) E.invoiceFormInvoiceId.value = friendly;
    if (E.invoiceFormInvoiceNumber) E.invoiceFormInvoiceNumber.value = friendly;
    return friendly;
  },
'''
if old_generator in invoice_src:
    invoice_src = invoice_src.replace(old_generator, new_generator, 1)
elif 'async ensureNewInvoiceBusinessIdentifiers(invoice = {})' not in invoice_src:
    raise SystemExit('invoices.js invoice number generator anchor not found')

save_anchor = r'''    if (!this.validateInvoice(invoice)) return;
    const summary = this.deriveCalculatedSummary(invoice, items);
'''
save_replacement = r'''    try {
      await this.ensureNewInvoiceBusinessIdentifiers(invoice);
    } catch (error) {
      UI.toast(error?.message || 'Unable to allocate invoice number.');
      return;
    }
    if (!this.validateInvoice(invoice)) return;
    const summary = this.deriveCalculatedSummary(invoice, items);
'''
if save_anchor in invoice_src:
    invoice_src = invoice_src.replace(save_anchor, save_replacement, 1)
elif 'await this.ensureNewInvoiceBusinessIdentifiers(invoice);' not in invoice_src:
    raise SystemExit('invoices.js save allocation anchor not found')

invoice_path.write_text(invoice_src)

# -----------------------------------------------------------------------------
# supabase-data.js: backend guarantee + unique-conflict retry.
# -----------------------------------------------------------------------------
supa_path = Path('supabase-data.js')
supa_src = supa_path.read_text()

receipt_marker = "  function sanitizeReceiptsRecord(record = {}, { includeCreatedBy = false, userId = '' } = {}) {\n"
backend_helpers = r'''  function isCanonicalInvoiceBusinessNumber(value = '') {
    return /^SA\/\d{4}\/\d+$/i.test(String(value || '').trim());
  }

  function isInvoiceBusinessIdConflict(error = {}) {
    if (String(error?.code || '').trim() !== '23505') return false;
    const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''} ${error?.constraint || ''}`.toLowerCase();
    return text.includes('invoice_id') || text.includes('invoice_number') || text.includes('invoices_invoice_id') || text.includes('invoices_invoice_number');
  }

  async function allocateInvoiceBusinessNumber(client, { preferred = '', force = false } = {}) {
    const preferredValue = String(preferred || '').trim();
    if (!force && isCanonicalInvoiceBusinessNumber(preferredValue)) return preferredValue;
    const year = String(new Date().getFullYear());
    const matcher = new RegExp(`^SA\\/${year}\\/([0-9]+)$`, 'i');
    const { data, error } = await client
      .from('invoices')
      .select('invoice_id,invoice_number')
      .order('created_at', { ascending: false })
      .limit(5000);
    if (error) throw friendlyError('Unable to allocate invoice business ID', error);
    let maxSequence = 0;
    (Array.isArray(data) ? data : []).forEach(row => {
      [row?.invoice_id, row?.invoice_number].forEach(value => {
        const match = String(value || '').trim().match(matcher);
        if (!match) return;
        const sequence = Number(match[1]);
        if (Number.isFinite(sequence)) maxSequence = Math.max(maxSequence, sequence);
      });
    });
    return `SA/${year}/${String(maxSequence + 1).padStart(2, '0')}`;
  }

  async function ensureInvoiceBusinessIdentifiers(client, record = {}, { force = false } = {}) {
    const source = record && typeof record === 'object' ? { ...record } : {};
    const preferred = [source.invoice_id, source.invoice_number]
      .map(value => String(value || '').trim())
      .find(value => isCanonicalInvoiceBusinessNumber(value)) || '';
    const friendly = await allocateInvoiceBusinessNumber(client, { preferred, force });
    source.invoice_id = friendly;
    source.invoice_number = friendly;
    return source;
  }

  async function insertInvoiceWithBusinessIdRetry(client, table, record = {}, context = 'Unable to create invoices record') {
    let workingRecord = await ensureInvoiceBusinessIdentifiers(client, record);
    let lastError = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await insertSelectSingleWithSchemaRetry(client, table, workingRecord, context);
      if (!result?.error) return { ...result, finalCreateRecord: workingRecord };
      lastError = result.error;
      if (!isInvoiceBusinessIdConflict(lastError)) return { ...result, finalCreateRecord: workingRecord };
      workingRecord = await ensureInvoiceBusinessIdentifiers(client, workingRecord, { force: true });
    }
    return { data: null, error: lastError || new Error('Unable to allocate a unique invoice business ID.'), finalCreateRecord: workingRecord };
  }

'''
if backend_helpers.strip() not in supa_src:
    if receipt_marker not in supa_src:
        raise SystemExit('supabase-data.js receipt sanitizer anchor not found')
    supa_src = supa_src.replace(receipt_marker, backend_helpers + receipt_marker, 1)

create_anchor = "      let finalCreateRecord = sanitizeUuidColumnsForMutation(table, createRecord);\n"
create_replacement = "      let finalCreateRecord = sanitizeUuidColumnsForMutation(table, createRecord);\n      if (resource === 'invoices') finalCreateRecord = await ensureInvoiceBusinessIdentifiers(client, finalCreateRecord);\n"
if create_anchor in supa_src and "if (resource === 'invoices') finalCreateRecord = await ensureInvoiceBusinessIdentifiers(client, finalCreateRecord);" not in supa_src:
    supa_src = supa_src.replace(create_anchor, create_replacement, 1)
elif "if (resource === 'invoices') finalCreateRecord = await ensureInvoiceBusinessIdentifiers(client, finalCreateRecord);" not in supa_src:
    raise SystemExit('supabase-data.js finalCreateRecord anchor not found')

old_insert = r'''      } else {
        const { data: inserted, error } = await insertSelectSingleWithSchemaRetry(
          client,
          table,
          finalCreateRecord,
          `Unable to create ${resource} record`
        );
        if (error && resource === 'credit_notes' && finalCreateRecord.credit_note_request_key && String(error.code || '') === '23505') {
'''
new_insert = r'''      } else {
        let inserted;
        let error;
        if (resource === 'invoices') {
          const invoiceInsert = await insertInvoiceWithBusinessIdRetry(
            client,
            table,
            finalCreateRecord,
            `Unable to create ${resource} record`
          );
          inserted = invoiceInsert?.data;
          error = invoiceInsert?.error;
          finalCreateRecord = invoiceInsert?.finalCreateRecord || finalCreateRecord;
        } else {
          const insertResult = await insertSelectSingleWithSchemaRetry(
            client,
            table,
            finalCreateRecord,
            `Unable to create ${resource} record`
          );
          inserted = insertResult?.data;
          error = insertResult?.error;
        }
        if (error && resource === 'credit_notes' && finalCreateRecord.credit_note_request_key && String(error.code || '') === '23505') {
'''
if old_insert in supa_src:
    supa_src = supa_src.replace(old_insert, new_insert, 1)
elif 'const invoiceInsert = await insertInvoiceWithBusinessIdRetry(' not in supa_src:
    raise SystemExit('supabase-data.js generic insert anchor not found')

supa_path.write_text(supa_src)

# -----------------------------------------------------------------------------
# index.html cache bust for both layers.
# -----------------------------------------------------------------------------
index_path = Path('index.html')
index_src = index_path.read_text()
index_src = index_src.replace(
    '/supabase-data.js?v=20260817-friendly-commercial-ids-v1',
    '/supabase-data.js?v=20260817-invoice-business-id-v1',
    1
)
index_src = index_src.replace(
    '/invoices.js?v=20260803-document-billing-frequency',
    '/invoices.js?v=20260817-invoice-business-id-v1',
    1
)
if '/supabase-data.js?v=20260817-invoice-business-id-v1' not in index_src:
    raise SystemExit('supabase-data cache key was not updated')
if '/invoices.js?v=20260817-invoice-business-id-v1' not in index_src:
    raise SystemExit('invoice cache key was not updated')
index_path.write_text(index_src)

# -----------------------------------------------------------------------------
# Regression test.
# -----------------------------------------------------------------------------
Path('tests/invoice-business-id-allocation.test.js').write_text(r'''const assert = require('assert');
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
''')
