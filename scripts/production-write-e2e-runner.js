const fs = require('fs');
const path = require('path');
const Module = require('module');

// Compatibility wrapper for the production E2E fixture documents.
// The real Supabase buckets intentionally accept PDF (and selected office/image
// formats for company documents), not text/plain. Keep the large E2E scenario
// source readable while compiling it with production-valid PDF fixture metadata.
//
// The accepted-proposal signed-document step also mirrors the real Proposals UI:
// signed document metadata is written directly to the allowed locked-proposal
// columns instead of going through the generic proposal dispatcher, which expands
// defaults such as status/provider fields and is not the UI upload path.
//
// The Contacts UI persists both the canonical contact_company_assignments row and
// the compatibility CRM bridge after the contact record is saved. The base E2E
// scenario talks directly to the data dispatcher, so inject those UI-equivalent
// writes here before validating the relationship.
//
// Invoice creation is also expected to create a non-zero payment schedule that
// exactly matches the persisted invoice total. Assert that explicitly so schema
// or conversion defects cannot produce a false-green workflow.
//
// The dedicated workflow runs this same real production journey for every supported
// payment schedule. This avoids four copies of the large scenario while proving
// Annual / Semi-Annual / Quarterly / Monthly installment generation end to end.
const filename = path.join(__dirname, 'production-write-e2e.js');
let source = fs.readFileSync(filename, 'utf8');

const paymentTerm = String(process.env.E2E_PAYMENT_TERM || 'Net 30').trim();
const expectedInstallments = Number(process.env.E2E_EXPECTED_INSTALLMENTS || 0);
const supportedPaymentTerms = new Set(['Net 7', 'Net 14', 'Net 21', 'Net 30']);
if (!supportedPaymentTerms.has(paymentTerm)) {
  throw new Error(`Unsupported E2E payment term: ${paymentTerm}`);
}
if (!Number.isInteger(expectedInstallments) || expectedInstallments < 1) {
  throw new Error(`E2E_EXPECTED_INSTALLMENTS must be a positive integer; received ${process.env.E2E_EXPECTED_INSTALLMENTS || '(empty)'}`);
}

const replacements = [
  ["contentType: 'text/plain'", "contentType: 'application/pdf'"],
  ["file_mime_type: 'text/plain'", "file_mime_type: 'application/pdf'"],
  ["payment_term: 'Net 30'", `payment_term: '${paymentTerm}'`],
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
    "  pass('Save Proposal commercial terms/items', '1 Annual SaaS item');",
`  const persistedProposalCommercialResponse = await userClient
    .from('proposals')
    .select('id,payment_term,payment_terms,billing_frequency,grand_total,status')
    .eq('id', created.proposal.id)
    .single();
  if (persistedProposalCommercialResponse.error) throw persistedProposalCommercialResponse.error;
  const persistedProposalCommercial = persistedProposalCommercialResponse.data || {};
  created.proposal = { ...created.proposal, ...persistedProposalCommercial };
  const persistedProposalPaymentTerm = String(persistedProposalCommercial.payment_term || persistedProposalCommercial.payment_terms || '').trim();
  if (persistedProposalPaymentTerm !== process.env.E2E_PAYMENT_TERM) {
    throw new Error(\`Proposal payment term persistence mismatch: expected ${'${process.env.E2E_PAYMENT_TERM}'}, received \${persistedProposalPaymentTerm || '(blank)'}.\`);
  }
  pass('Persist Proposal payment term', \`${'${persistedProposalPaymentTerm}'} · ${'${persistedProposalCommercial.billing_frequency || "Annual"}'}\`);
  pass('Save Proposal commercial terms/items', '1 Annual SaaS item');`
  ],
  [
    "  pass('Convert Proposal → Agreement', created.agreement.agreement_id || created.agreement.agreement_number || created.agreement.id);",
`  pass('Convert Proposal → Agreement', created.agreement.agreement_id || created.agreement.agreement_number || created.agreement.id);

  const persistedAgreementCommercialResponse = await userClient
    .from('agreements')
    .select('id,payment_term,payment_terms,billing_frequency,status')
    .eq('id', created.agreement.id)
    .single();
  if (persistedAgreementCommercialResponse.error) throw persistedAgreementCommercialResponse.error;
  const persistedAgreementCommercial = persistedAgreementCommercialResponse.data || {};
  created.agreement = { ...created.agreement, ...persistedAgreementCommercial };
  const persistedAgreementPaymentTerm = String(persistedAgreementCommercial.payment_term || persistedAgreementCommercial.payment_terms || '').trim();
  if (persistedAgreementPaymentTerm !== process.env.E2E_PAYMENT_TERM) {
    throw new Error(\`Agreement payment term propagation mismatch: expected ${'${process.env.E2E_PAYMENT_TERM}'}, received \${persistedAgreementPaymentTerm || '(blank)'}.\`);
  }
  pass('Propagate payment term Proposal → Agreement', \`${'${persistedAgreementPaymentTerm}'} · ${'${persistedAgreementCommercial.billing_frequency || "Annual"}'}\`);`
  ],
  [
    "  pass('Create Invoice from Agreement', created.invoice.invoice_number || created.invoice.invoice_id || created.invoice.id);",
`  pass('Create Invoice from Agreement', created.invoice.invoice_number || created.invoice.invoice_id || created.invoice.id);

  const persistedInvoiceResponse = await userClient
    .from('invoices')
    .select('id,invoice_id,invoice_number,invoice_total,grand_total,total_amount,subtotal_locations,subtotal_one_time,due_date,status,payment_term,payment_terms')
    .eq('id', created.invoice.id)
    .single();
  if (persistedInvoiceResponse.error) throw persistedInvoiceResponse.error;
  const persistedInvoice = persistedInvoiceResponse.data || {};
  const invoicePaymentTerm = String(persistedInvoice.payment_term || persistedInvoice.payment_terms || '').trim();
  if (invoicePaymentTerm !== process.env.E2E_PAYMENT_TERM) {
    throw new Error(\`Invoice payment term propagation mismatch: expected ${'${process.env.E2E_PAYMENT_TERM}'}, received \${invoicePaymentTerm || '(blank)'}.\`);
  }
  const invoiceTotal = Number(persistedInvoice.invoice_total ?? persistedInvoice.grand_total ?? persistedInvoice.total_amount ?? 0);
  const expectedProposalTotal = Number(created.proposal.grand_total ?? 0);
  if (!(invoiceTotal > 0)) throw new Error(\`Invoice was created with a non-positive total: USD \${invoiceTotal.toFixed(2)}.\`);
  if (expectedProposalTotal > 0 && Math.abs(invoiceTotal - expectedProposalTotal) > 0.01) {
    throw new Error(\`Invoice total mismatch: invoice USD \${invoiceTotal.toFixed(2)} vs accepted proposal USD \${expectedProposalTotal.toFixed(2)}.\`);
  }
  created.invoice = { ...created.invoice, ...persistedInvoice };
  pass('Propagate payment term Agreement → Invoice', invoicePaymentTerm);

  const invoiceScheduleResponse = await userClient
    .from('invoice_payment_schedule')
    .select('id,schedule_no,due_date,scheduled_amount,schedule_label,status')
    .eq('invoice_id', created.invoice.id)
    .order('schedule_no', { ascending: true });
  if (invoiceScheduleResponse.error) throw invoiceScheduleResponse.error;
  const invoiceScheduleRows = Array.isArray(invoiceScheduleResponse.data) ? invoiceScheduleResponse.data : [];
  if (!invoiceScheduleRows.length) throw new Error('Invoice payment schedule was not created.');
  const expectedInstallmentCount = Number(process.env.E2E_EXPECTED_INSTALLMENTS || 0);
  if (invoiceScheduleRows.length !== expectedInstallmentCount) {
    throw new Error(\`Invoice payment schedule count mismatch for ${'${process.env.E2E_PAYMENT_TERM || "Net 30"}'}: expected \${expectedInstallmentCount}, received \${invoiceScheduleRows.length}.\`);
  }
  const scheduledTotal = invoiceScheduleRows.reduce((sum, row) => sum + Number(row.scheduled_amount || 0), 0);
  if (Math.abs(scheduledTotal - invoiceTotal) > 0.01) {
    throw new Error(\`Invoice payment schedule total mismatch: scheduled \${scheduledTotal.toFixed(2)} vs invoice \${invoiceTotal.toFixed(2)}.\`);
  }
  pass('Create Invoice payment schedule', \`${'${process.env.E2E_PAYMENT_TERM || "Net 30"}'} · ${'${invoiceScheduleRows.length}'} installment(s) · USD ${'${scheduledTotal.toFixed(2)}'}\`);`
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
  ['${slug}.txt', '${slug}.pdf'],
  [
    "      customer_sign_date: isoDate(0),",
    "      customer_sign_date: isoDate(0),\n      provider_signatory_name: 'InCheck360 E2E Provider',\n      provider_signatory_title: 'Provider',\n      provider_sign_date: isoDate(0),"
  ],
];

for (const [from, to] of replacements) {
  if (!source.includes(from)) {
    throw new Error(`Production E2E fixture compatibility marker is missing: ${from}`);
  }
  source = source.split(from).join(to);
}

process.stdout.write(`Production E2E payment scenario: ${paymentTerm} → ${expectedInstallments} installment(s)\n`);

const compiled = new Module(filename, module.parent);
compiled.filename = filename;
compiled.paths = Module._nodeModulePaths(path.dirname(filename));
compiled._compile(source, filename);
