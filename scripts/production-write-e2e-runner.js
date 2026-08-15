const fs = require('fs');
const path = require('path');
const Module = require('module');

// Compatibility wrapper for the production E2E fixture documents.
// The real Supabase buckets intentionally accept PDF (and selected office/image
// formats for company documents), not text/plain. Keep the large E2E scenario
// source readable while compiling it with production-valid PDF fixture metadata.
const filename = path.join(__dirname, 'production-write-e2e.js');
let source = fs.readFileSync(filename, 'utf8');

const replacements = [
  ["contentType: 'text/plain'", "contentType: 'application/pdf'"],
  ["file_mime_type: 'text/plain'", "file_mime_type: 'application/pdf'"],
  ['${slug}.txt', '${slug}.pdf'],
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
