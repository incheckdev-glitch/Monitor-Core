const fs = require('fs');
const path = require('path');
const Module = require('module');

// Diagnostic wrapper around the strict production financial E2E.
// The normal financial E2E remains authoritative and must fail when authenticated
// credit-note RLS is broken. This wrapper records that same failure, then uses the
// configured service role only to continue past the blocked credit-note mutation
// so downstream settlement/cancellation/overpayment behavior can still be tested.
const filename = path.join(__dirname, 'production-financial-e2e-runner.js');
let source = fs.readFileSync(filename, 'utf8');

const createFrom = "  created.creditNote = asRow(await dispatch('credit_notes', 'create', { credit_note: creditPayload }));";
const createTo = [
  "  try {",
  "    created.creditNote = asRow(await dispatch('credit_notes', 'create', { credit_note: creditPayload }));",
  "  } catch (error) {",
  "    const message = String(error?.message || error || '');",
  "    if (!/row-level security/i.test(message)) throw error;",
  "    fail('Authenticated credit-note create RLS', error);",
  "    const originalGetClient = global.SupabaseClient.getClient;",
  "    global.SupabaseClient.getClient = () => serviceClient;",
  "    try {",
  "      created.creditNote = asRow(await dispatch('credit_notes', 'create', { credit_note: creditPayload }));",
  "    } finally {",
  "      global.SupabaseClient.getClient = originalGetClient;",
  "    }",
  "    if (!created.creditNote?.id) throw new Error('Service-role diagnostic could not create the blocked credit note.');",
  "    pass('Service-role diagnostic credit-note continuation', created.creditNote.credit_note_number || created.creditNote.credit_note_id || created.creditNote.id);",
  "  }"
].join('\n');

const cancelFrom = [
  "  created.creditNote = asRow(await dispatch('credit_notes', 'cancel', {",
  "    id: created.creditNote.id,",
  "    credit_note_id: created.creditNote.id,",
  "  })) || created.creditNote;"
].join('\n');
const cancelTo = [
  "  try {",
  "    created.creditNote = asRow(await dispatch('credit_notes', 'cancel', {",
  "      id: created.creditNote.id,",
  "      credit_note_id: created.creditNote.id,",
  "    })) || created.creditNote;",
  "  } catch (error) {",
  "    const message = String(error?.message || error || '');",
  "    if (!/row-level security/i.test(message)) throw error;",
  "    fail('Authenticated credit-note cancel RLS', error);",
  "    const originalGetClient = global.SupabaseClient.getClient;",
  "    global.SupabaseClient.getClient = () => serviceClient;",
  "    try {",
  "      created.creditNote = asRow(await dispatch('credit_notes', 'cancel', {",
  "        id: created.creditNote.id,",
  "        credit_note_id: created.creditNote.id,",
  "      })) || created.creditNote;",
  "    } finally {",
  "      global.SupabaseClient.getClient = originalGetClient;",
  "    }",
  "    pass('Service-role diagnostic credit-note cancellation continuation', created.creditNote.credit_note_number || created.creditNote.credit_note_id || created.creditNote.id);",
  "  }"
].join('\n');

for (const [from, to] of [[createFrom, createTo], [cancelFrom, cancelTo]]) {
  if (!source.includes(from)) throw new Error(`Financial diagnostic fixture marker is missing: ${from}`);
  source = source.replace(from, to);
}

process.stdout.write('Production Financial Diagnostic: strict RLS failures are retained while downstream finance checks continue\n');

const compiled = new Module(filename, module.parent);
compiled.filename = filename;
compiled.paths = Module._nodeModulePaths(path.dirname(filename));
compiled._compile(source, filename);
