const fs = require('fs');
const path = require('path');
const Module = require('module');

// Production E2E variant for the explicit admin exception:
// an admin may create the invoice before an agreement is signed. Build this on
// the proven production-write wrapper so PDF storage, contact relationships,
// payment-term propagation and payment-schedule assertions remain identical to
// the standard production E2E; only the invoice/signature ordering changes.
const wrapperFilename = path.join(__dirname, 'production-write-e2e-runner.js');
let wrapperSource = fs.readFileSync(wrapperFilename, 'utf8');

process.env.E2E_PAYMENT_TERM = process.env.E2E_PAYMENT_TERM || 'Net 30';
process.env.E2E_EXPECTED_INSTALLMENTS = process.env.E2E_EXPECTED_INSTALLMENTS || '1';

const signBlock = `  const agreementDocPath = \`${'${created.agreement.id}'}/${'${Date.now()}'}_${'${slug}'}.txt\`;
  await uploadTextFile(userClient, 'agreement-signed-documents', agreementDocPath, \`Automated signed agreement ${'${marker}'}\\n\`);
  created.agreement = asRow(await dispatch('agreements', 'update', {
    id: created.agreement.id,
    updates: {
      status: 'Signed',
      signed_date: isoDate(0),
      customer_official_signatory_name: 'E2E Authorized Signatory',
      customer_official_signatory_title: 'Test Director',
      customer_official_sign_date: isoDate(0),
      provider_official_signatory_1_name: 'InCheck360 E2E Provider',
      provider_official_signatory_1_title: 'Provider',
      provider_official_signatory_1_sign_date: isoDate(0),
      signed_document_path: agreementDocPath,
      signed_document_name: \`${'${slug}'}.txt\`,
      signed_document_uploaded_at: new Date().toISOString(),
      signed_document_uploaded_by: auth.user.id,
    },
  })) || created.agreement;
  pass('Sign Agreement', 'Signed');`;

const invoiceBlock = `  created.invoice = asRow(await dispatch('invoices', 'create_from_agreement', {
    agreement_uuid: created.agreement.id,
    agreement_id: created.agreement.agreement_id,
  }));
  if (!created.invoice?.id) created.invoice = await singleBy('invoices', { agreement_id: created.agreement.id });
  if (!created.invoice?.id) throw new Error('Agreement did not create an invoice.');
  pass('Create Invoice from Agreement', created.invoice.invoice_number || created.invoice.invoice_id || created.invoice.id);`;

const combined = `${signBlock}\n\n${invoiceBlock}`;
const unsignedInvoiceBlock = `  const unsignedAgreementStatus = String(created.agreement.status || '').trim().toLowerCase();
  if (unsignedAgreementStatus === 'signed') {
    throw new Error('Unsigned-invoice E2E expected a not-yet-signed agreement before invoice creation.');
  }

  created.invoice = asRow(await dispatch('invoices', 'create_from_agreement', {
    agreement_uuid: created.agreement.id,
    agreement_id: created.agreement.agreement_id,
  }));
  if (!created.invoice?.id) created.invoice = await singleBy('invoices', { agreement_id: created.agreement.id });
  if (!created.invoice?.id) throw new Error('Admin could not create an invoice from the unsigned agreement.');
  pass(
    'Admin create Invoice from unsigned Agreement',
    \`${'${created.invoice.invoice_number || created.invoice.invoice_id || created.invoice.id}'} · agreement status ${'${created.agreement.status || "(blank)"}'}\`,
  );
  pass('Create Invoice from Agreement', created.invoice.invoice_number || created.invoice.invoice_id || created.invoice.id);`;

const reordered = `${unsignedInvoiceBlock}\n\n${signBlock}`;
const marker = 'const replacements = [';
if (!wrapperSource.includes(marker)) {
  throw new Error('Production write wrapper replacement array marker is missing.');
}

// Inject this reorder as the first compatibility transform. The standard wrapper
// then applies all its normal PDF/storage/commercial/payment-schedule transforms
// to the moved blocks exactly as it does in the normal production journey.
wrapperSource = wrapperSource.replace(
  marker,
  `${marker}\n  [${JSON.stringify(combined)}, ${JSON.stringify(reordered)}],`,
);

process.stdout.write('Production Admin Unsigned-Invoice E2E: invoice before signature, then full lifecycle\n');

const compiled = new Module(wrapperFilename, module.parent);
compiled.filename = wrapperFilename;
compiled.paths = Module._nodeModulePaths(path.dirname(wrapperFilename));
compiled._compile(wrapperSource, wrapperFilename);
