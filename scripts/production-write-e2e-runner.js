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
