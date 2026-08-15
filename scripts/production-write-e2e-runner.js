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
// Invoice creation is also expected to create its payment schedule. Assert that
// explicitly so a schema-cache warning cannot produce a false-green workflow.
const filename = path.join(__dirname, 'production-write-e2e.js');
let source = fs.readFileSync(filename, 'utf8');

const replacements = [
  ["contentType: 'text/plain'", "contentType: 'application/pdf'"],
  ["file_mime_type: 'text/plain'", "file_mime_type: 'application/pdf'"],
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
    "  pass('Create Invoice from Agreement', created.invoice.invoice_number || created.invoice.invoice_id || created.invoice.id);",
`  pass('Create Invoice from Agreement', created.invoice.invoice_number || created.invoice.invoice_id || created.invoice.id);

  const invoiceScheduleResponse = await userClient
    .from('invoice_payment_schedule')
    .select('id,schedule_no,due_date,scheduled_amount,schedule_label,status')
    .eq('invoice_id', created.invoice.id)
    .order('schedule_no', { ascending: true });
  if (invoiceScheduleResponse.error) throw invoiceScheduleResponse.error;
  const invoiceScheduleRows = Array.isArray(invoiceScheduleResponse.data) ? invoiceScheduleResponse.data : [];
  if (!invoiceScheduleRows.length) throw new Error('Invoice payment schedule was not created.');
  const invoiceTotal = Number(created.invoice.invoice_total ?? created.invoice.grand_total ?? created.invoice.total_amount ?? 0);
  const scheduledTotal = invoiceScheduleRows.reduce((sum, row) => sum + Number(row.scheduled_amount || 0), 0);
  if (Math.abs(scheduledTotal - invoiceTotal) > 0.01) {
    throw new Error(\`Invoice payment schedule total mismatch: scheduled \${scheduledTotal.toFixed(2)} vs invoice \${invoiceTotal.toFixed(2)}.\`);
  }
  pass('Create Invoice payment schedule', \`${'${invoiceScheduleRows.length}'} installment(s) · USD ${'${scheduledTotal.toFixed(2)}'}\`);`
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

const compiled = new Module(filename, module.parent);
compiled.filename = filename;
compiled.paths = Module._nodeModulePaths(path.dirname(filename));
compiled._compile(source, filename);
