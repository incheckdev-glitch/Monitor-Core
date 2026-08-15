const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('supabase-data.js', 'utf8');

const columnsStart = source.indexOf('const AGREEMENT_COLUMNS = new Set([');
assert(columnsStart >= 0, 'AGREEMENT_COLUMNS allowlist must exist');
const columnsEnd = source.indexOf(']);', columnsStart);
assert(columnsEnd > columnsStart, 'AGREEMENT_COLUMNS allowlist must terminate');
const agreementColumns = source.slice(columnsStart, columnsEnd);

assert.doesNotMatch(
  agreementColumns,
  /['"]customer_signatory_Name['"]/,
  'agreement DB column allowlist must not include legacy mixed-case customer_signatory_Name',
);

assert.doesNotMatch(
  source,
  /sanitized\.customer_signatory_Name\s*=\s*sanitized\.customer_signatory_name\s*;/,
  'agreement sanitizer must not emit legacy mixed-case customer_signatory_Name',
);

assert.match(
  source,
  /firstDefined\(record, \[[^\]]*['"]customer_signatory_Name['"][^\]]*['"]customer_signatory_name['"]/,
  'legacy mixed-case customer_signatory_Name must remain accepted as an input alias',
);

console.log('Agreement signatory schema compatibility checks passed.');
