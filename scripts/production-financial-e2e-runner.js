const fs = require('fs');
const path = require('path');
const Module = require('module');

// Financial production E2E built on the proven new-client journey.
// It keeps the base scenario as the source of truth, applies the same UI-equivalent
// compatibility transforms as production-write-e2e-runner.js, then replaces the
// single full-payment receipt with a real accounting sequence:
// partial receipts -> credit note -> idempotency -> settlement -> overpayment guard
// -> credit-note cancellation -> final settlement.
const filename = path.join(__dirname, 'production-write-e2e.js');
let source = fs.readFileSync(filename, 'utf8');

const replacements = [
  ["contentType: 'text/plain'", "contentType: 'application/pdf'"],
  ["file_mime_type: 'text/plain'", "file_mime_type: 'application/pdf'"],
  [
    "const storageFiles = [];",
    "const storageFiles = [];\nconst financialReceiptIds = [];\nconst financialCreditNoteIds = [];"
  ],
  [
    "    updates: { status: 'Sent' },",
    "    updates: { status: 'Sent', payment_term: 'Net 30', payment_terms: 'Net 30', billing_frequency: 'Annual' },"
  ],
  [
    "      status: 'Accepted',\n      accepted_at: new Date().toISOString(),",
    "      status: 'Accepted',\n      payment_term: 'Net 30',\n      payment_terms: 'Net 30',\n      billing_frequency: 'Annual',\n      accepted_at: new Date().toISOString(),"
  ],
  [
    "      status: 'Signed',\n      signed_date: isoDate(0),",
    "      status: 'Signed',\n      payment_term: 'Net 30',\n      payment_terms: 'Net 30',\n      billing_frequency: 'Annual',\n      signed_date: isoDate(0),"
  ],
  [
`  created.proposal = asRow(await dispatch('proposals', 'update', {
    id: created.proposal.id,
    updates: {
      signed_document_path: proposalDocPath,
      signed_document_name: \`${'${slug}'}.txt\`,
      signed_document_uploaded_at: new Date().toISOString(),
      signed_document_uploaded_by: auth.user.id,
    },
  })) || created.proposal;`,
`  const proposalDocUpdate = await userClient
    .from('proposals')
    .update({
      signed_document_path: proposalDocPath,
      signed_document_name: \`${'${slug}'}.txt\`,
      signed_document_uploaded_at: new Date().toISOString(),
      signed_document_uploaded_by: auth.user.id,
      updated_at: new Date().toISOString(),
      updated_by: auth.user.id,
    })
    .eq('id', created.proposal.id)
    .select('*')
    .single();
  if (proposalDocUpdate.error) throw proposalDocUpdate.error;
  created.proposal = proposalDocUpdate.data || created.proposal;`
  ],
  [
    "  pass('Create Contact linked to Company', created.contact.contact_id || created.contact.id);",
`  pass('Create Contact linked to Company', created.contact.contact_id || created.contact.id);

  const contactAssignment = await userClient
    .from('contact_company_assignments')
    .upsert({
      contact_id: created.contact.id,
      company_id: created.company.id,
      is_primary: true,
    }, { onConflict: 'contact_id,company_id' })
    .select('*')
    .single();
  if (contactAssignment.error) throw contactAssignment.error;

  const contactBridgeSync = await userClient.rpc('crm_upsert_contact_company_links', {
    p_contact_key: created.contact.id,
    p_company_keys: [created.company.id],
  });
  if (contactBridgeSync.error) throw contactBridgeSync.error;
  pass('Persist Contact ↔ Company assignment', 'canonical assignment + CRM compatibility bridge');`
  ],
  [
    "      customer_sign_date: isoDate(0),",
    "      customer_sign_date: isoDate(0),\n      provider_signatory_name: 'InCheck360 E2E Provider',\n      provider_signatory_title: 'Provider',\n      provider_sign_date: isoDate(0),"
  ],
  ['${slug}.txt', '${slug}.pdf'],
  [
    "    created.receipt?.id, created.receipt?.receipt_id, created.receipt?.receipt_number,",
    "    created.receipt?.id, created.receipt?.receipt_id, created.receipt?.receipt_number,\n    created.creditNote?.id, created.creditNote?.credit_note_id, created.creditNote?.credit_note_number,"
  ],
  [
    "  await attempt('notification rows', cleanupNotifications);",
`  await attempt('notification rows', cleanupNotifications);

  // Financial E2E can create several receipts and one or more credit-note rows.
  // Delete every finance child linked to the test invoice so cleanup remains safe
  // even if the scenario fails halfway through an assertion.
  if (created.invoice?.id) {
    await attempt('all financial receipt items', async () => {
      const receiptRows = await serviceClient.from('receipts').select('id').eq('invoice_id', created.invoice.id);
      if (receiptRows.error && !['42P01', '42703'].includes(String(receiptRows.error.code || ''))) throw receiptRows.error;
      const receiptIds = (receiptRows.data || []).map(row => row.id).filter(Boolean);
      if (!receiptIds.length) return;
      const deletedItems = await serviceClient.from('receipt_items').delete().in('receipt_id', receiptIds);
      if (deletedItems.error && !['42P01', '42703'].includes(String(deletedItems.error.code || ''))) throw deletedItems.error;
    });
    await attempt('all financial receipts', async () => {
      const deleted = await serviceClient.from('receipts').delete().eq('invoice_id', created.invoice.id);
      if (deleted.error && !['42P01', '42703'].includes(String(deleted.error.code || ''))) throw deleted.error;
    });
    await attempt('all financial credit notes', async () => {
      const deleted = await serviceClient.from('credit_notes').delete().eq('invoice_id', created.invoice.id);
      if (deleted.error && !['42P01', '42703'].includes(String(deleted.error.code || ''))) throw deleted.error;
    });
  }`
  ],
  [
`  created.receipt = asRow(await dispatch('receipts', 'create_from_invoice', {
    invoice_uuid: created.invoice.id,
    invoice_id: created.invoice.invoice_id,
    amount: Number(created.invoice.grand_total || created.invoice.invoice_total || created.invoice.total_amount || 12) || 12,
    payment_method: 'Bank Transfer',
    payment_reference: marker,
    receipt_date: isoDate(0),
    notes: marker,
    silent: true,
    suppress_notifications: true,
  }));
  if (!created.receipt?.id) created.receipt = await singleBy('receipts', { invoice_id: created.invoice.id });
  if (!created.receipt?.id) throw new Error('Invoice payment did not create a receipt.');
  pass('Create Receipt from Invoice', created.receipt.receipt_number || created.receipt.receipt_id || created.receipt.id);`,
`  const moneyNear = (actual, expected, label) => {
    const a = Number(actual ?? 0);
    const e = Number(expected ?? 0);
    if (!Number.isFinite(a) || Math.abs(a - e) > 0.01) {
      throw new Error(\`${'${label}'} mismatch: expected USD ${'${e.toFixed(2)}'}, received USD ${'${Number.isFinite(a) ? a.toFixed(2) : String(actual)}'}.\`);
    }
  };
  const loadInvoiceFinancialState = async () => {
    const response = await userClient
      .from('invoices')
      .select('id,invoice_id,invoice_number,invoice_total,grand_total,total_amount,amount_paid,received_amount,pending_amount,balance_due,credit_note_amount,payment_state,payment_status,status,currency')
      .eq('id', created.invoice.id)
      .single();
    if (response.error) throw response.error;
    return response.data || {};
  };
  const rememberReceipt = row => {
    if (row?.id && !financialReceiptIds.includes(row.id)) financialReceiptIds.push(row.id);
    return row;
  };

  let financeInvoice = await loadInvoiceFinancialState();
  const financeTotal = Number(financeInvoice.invoice_total ?? financeInvoice.grand_total ?? financeInvoice.total_amount ?? 0);
  moneyNear(financeTotal, 12, 'Financial E2E invoice total');

  // Receipt 1: partial payment 4/12.
  const receiptOne = rememberReceipt(asRow(await dispatch('receipts', 'create_from_invoice', {
    invoice_uuid: created.invoice.id,
    invoice_id: created.invoice.invoice_id,
    amount: 4,
    payment_method: 'Bank Transfer',
    payment_reference: \`${'${marker}'}-R1\`,
    receipt_date: isoDate(0),
    notes: marker,
    silent: true,
    suppress_notifications: true,
  })));
  if (!receiptOne?.id) throw new Error('First partial receipt was not created.');
  financeInvoice = await loadInvoiceFinancialState();
  moneyNear(financeInvoice.amount_paid ?? financeInvoice.received_amount, 4, 'Amount paid after first partial receipt');
  moneyNear(financeInvoice.pending_amount ?? financeInvoice.balance_due, 8, 'Outstanding after first partial receipt');
  if (!String(financeInvoice.payment_state || financeInvoice.payment_status || '').toLowerCase().includes('partial')) {
    throw new Error(\`Expected partial payment state after first receipt, received ${'${financeInvoice.payment_state || financeInvoice.payment_status || "(blank)"}'}.\`);
  }
  pass('Partial payment #1', 'USD 4.00 paid · USD 8.00 outstanding');

  // Receipt 2: cumulative payment 7/12.
  const receiptTwo = rememberReceipt(asRow(await dispatch('receipts', 'create_from_invoice', {
    invoice_uuid: created.invoice.id,
    invoice_id: created.invoice.invoice_id,
    amount: 3,
    payment_method: 'Bank Transfer',
    payment_reference: \`${'${marker}'}-R2\`,
    receipt_date: isoDate(0),
    notes: marker,
    silent: true,
    suppress_notifications: true,
  })));
  if (!receiptTwo?.id) throw new Error('Second partial receipt was not created.');
  financeInvoice = await loadInvoiceFinancialState();
  moneyNear(financeInvoice.amount_paid ?? financeInvoice.received_amount, 7, 'Cumulative paid amount after second receipt');
  moneyNear(financeInvoice.pending_amount ?? financeInvoice.balance_due, 5, 'Outstanding after second receipt');
  pass('Multiple receipts accumulate correctly', 'USD 7.00 paid · USD 5.00 outstanding');

  // Credit note: reduce the remaining commercial balance by USD 2.
  const creditRequestKey = \`${'${marker}'}-CN-1\`;
  const creditPayload = {
    invoice_id: created.invoice.id,
    invoice_number: created.invoice.invoice_number || created.invoice.invoice_id,
    agreement_uuid: created.agreement.id,
    agreement_id: created.agreement.id,
    agreement_number: created.agreement.agreement_number || created.agreement.agreement_id,
    client_id: created.invoice.client_id || null,
    company_id: /^[0-9a-f-]{36}$/i.test(String(created.invoice.company_id || '')) ? created.invoice.company_id : null,
    company_name: created.company.company_name,
    customer_name: created.company.legal_name || created.company.company_name,
    client_name: created.company.company_name,
    customer_legal_name: created.company.legal_name || '',
    credit_note_date: isoDate(0),
    description: \`Financial E2E credit ${'${marker}'}\`,
    currency: 'USD',
    credit_amount: 2,
    status: 'issued',
    credit_note_request_key: creditRequestKey,
  };
  created.creditNote = asRow(await dispatch('credit_notes', 'create', { credit_note: creditPayload }));
  if (!created.creditNote?.id) throw new Error('Credit note was not created.');
  financialCreditNoteIds.push(created.creditNote.id);
  financeInvoice = await loadInvoiceFinancialState();
  moneyNear(financeInvoice.credit_note_amount, 2, 'Invoice credited amount');
  moneyNear(financeInvoice.pending_amount ?? financeInvoice.balance_due, 3, 'Outstanding after credit note');
  pass('Apply credit note to invoice', 'USD 2.00 credit · USD 3.00 outstanding');

  // Same request key must be idempotent and return the original credit note.
  const duplicateCredit = asRow(await dispatch('credit_notes', 'create', { credit_note: creditPayload }));
  if (!duplicateCredit?.id || duplicateCredit.id !== created.creditNote.id) {
    throw new Error('Credit-note idempotency failed: duplicate request key created or returned a different record.');
  }
  const creditCountResponse = await serviceClient
    .from('credit_notes')
    .select('id', { count: 'exact', head: false })
    .eq('credit_note_request_key', creditRequestKey);
  if (creditCountResponse.error) throw creditCountResponse.error;
  if ((creditCountResponse.data || []).length !== 1) throw new Error('Credit-note idempotency failed: more than one row exists for the request key.');
  pass('Credit note idempotency', 'duplicate request prevented');

  // Receipt 3 settles the adjusted balance: paid 10 + credit 2 = invoice 12.
  const receiptThree = rememberReceipt(asRow(await dispatch('receipts', 'create_from_invoice', {
    invoice_uuid: created.invoice.id,
    invoice_id: created.invoice.invoice_id,
    amount: 3,
    payment_method: 'Bank Transfer',
    payment_reference: \`${'${marker}'}-R3\`,
    receipt_date: isoDate(0),
    notes: marker,
    silent: true,
    suppress_notifications: true,
  })));
  if (!receiptThree?.id) throw new Error('Adjusted-balance settlement receipt was not created.');
  financeInvoice = await loadInvoiceFinancialState();
  moneyNear(financeInvoice.amount_paid ?? financeInvoice.received_amount, 10, 'Paid amount after adjusted settlement');
  moneyNear(financeInvoice.credit_note_amount, 2, 'Credit amount after adjusted settlement');
  moneyNear(financeInvoice.pending_amount ?? financeInvoice.balance_due, 0, 'Outstanding after adjusted settlement');
  if (String(financeInvoice.payment_state || financeInvoice.payment_status || '').toLowerCase() !== 'paid') {
    throw new Error(\`Expected paid state after receipts + credit note settlement, received ${'${financeInvoice.payment_state || financeInvoice.payment_status || "(blank)"}'}.\`);
  }
  pass('Receipt + credit note settlement', 'USD 10.00 cash + USD 2.00 credit = Paid');

  // Once fully settled, an additional receipt must be rejected.
  let overpaymentRejected = false;
  try {
    const unexpectedReceipt = rememberReceipt(asRow(await dispatch('receipts', 'create_from_invoice', {
      invoice_uuid: created.invoice.id,
      invoice_id: created.invoice.invoice_id,
      amount: 1,
      payment_method: 'Bank Transfer',
      payment_reference: \`${'${marker}'}-OVERPAY\`,
      receipt_date: isoDate(0),
      notes: marker,
      silent: true,
      suppress_notifications: true,
    })));
    if (!unexpectedReceipt?.id) overpaymentRejected = true;
  } catch (error) {
    overpaymentRejected = true;
  }
  if (!overpaymentRejected) throw new Error('Overpayment protection failed: a receipt was accepted after the invoice was already settled.');
  pass('Block overpayment', 'receipt rejected after invoice settlement');

  // Cancelling the credit note must restore USD 2 due and move the invoice out of Paid.
  created.creditNote = asRow(await dispatch('credit_notes', 'cancel', {
    id: created.creditNote.id,
    credit_note_id: created.creditNote.id,
  })) || created.creditNote;
  financeInvoice = await loadInvoiceFinancialState();
  moneyNear(financeInvoice.credit_note_amount, 0, 'Credited amount after cancellation');
  moneyNear(financeInvoice.pending_amount ?? financeInvoice.balance_due, 2, 'Outstanding after credit-note cancellation');
  if (String(financeInvoice.payment_state || financeInvoice.payment_status || '').toLowerCase() === 'paid') {
    throw new Error('Credit-note cancellation failed to reopen the invoice balance.');
  }
  pass('Cancel credit note and reopen balance', 'USD 2.00 restored as outstanding');

  // Receipt 4 settles the restored balance without exceeding the invoice total.
  created.receipt = rememberReceipt(asRow(await dispatch('receipts', 'create_from_invoice', {
    invoice_uuid: created.invoice.id,
    invoice_id: created.invoice.invoice_id,
    amount: 2,
    payment_method: 'Bank Transfer',
    payment_reference: \`${'${marker}'}-R4\`,
    receipt_date: isoDate(0),
    notes: marker,
    silent: true,
    suppress_notifications: true,
  })));
  if (!created.receipt?.id) throw new Error('Final settlement receipt was not created.');
  financeInvoice = await loadInvoiceFinancialState();
  moneyNear(financeInvoice.amount_paid ?? financeInvoice.received_amount, 12, 'Final paid amount');
  moneyNear(financeInvoice.credit_note_amount, 0, 'Final credited amount');
  moneyNear(financeInvoice.pending_amount ?? financeInvoice.balance_due, 0, 'Final outstanding amount');
  if (String(financeInvoice.payment_state || financeInvoice.payment_status || '').toLowerCase() !== 'paid') {
    throw new Error(\`Expected final paid state, received ${'${financeInvoice.payment_state || financeInvoice.payment_status || "(blank)"}'}.\`);
  }
  pass('Final settlement after credit-note cancellation', 'USD 12.00 cash paid · USD 0.00 outstanding');`
  ],
  [
`  const relationshipCheck = await userClient
    .from('crm_contact_company_links')
    .select('contact_id,company_id')
    .eq('contact_id', created.contact.id)
    .eq('company_id', created.company.id)
    .limit(1);
  if (relationshipCheck.error) throw relationshipCheck.error;
  if (!Array.isArray(relationshipCheck.data) || !relationshipCheck.data.length) throw new Error('Contact-company relationship bridge was not created.');
  pass('Verify Contact ↔ Company relationship', 'crm_contact_company_links');`,
`  const relationshipRpc = await userClient.rpc('crm_contact_belongs_to_company', {
    p_contact_key: created.contact.id,
    p_company_key: created.company.id,
  });
  if (relationshipRpc.error) throw relationshipRpc.error;
  if (relationshipRpc.data !== true) throw new Error('CRM contact/company ownership RPC did not confirm the relationship.');

  const relationshipCheck = await serviceClient
    .from('crm_contact_company_links')
    .select('contact_id,company_id,source')
    .eq('contact_id', created.contact.id)
    .eq('company_id', created.company.id)
    .limit(1);
  if (relationshipCheck.error) throw relationshipCheck.error;
  if (!Array.isArray(relationshipCheck.data) || !relationshipCheck.data.length) throw new Error('Contact-company compatibility bridge row was not persisted.');
  pass('Verify Contact ↔ Company relationship', 'ownership RPC + persisted CRM bridge');`
  ],
];

for (const [from, to] of replacements) {
  if (!source.includes(from)) {
    throw new Error(`Production financial E2E fixture marker is missing: ${from}`);
  }
  source = source.split(from).join(to);
}

process.stdout.write('Production Financial E2E: partial payments, multiple receipts, credit notes, cancellation and overpayment protection\n');

const compiled = new Module(filename, module.parent);
compiled.filename = filename;
compiled.paths = Module._nodeModulePaths(path.dirname(filename));
compiled._compile(source, filename);
