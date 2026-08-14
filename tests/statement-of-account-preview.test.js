const assert = require('assert');
const fs = require('fs');

const clients = fs.readFileSync('clients.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');

const exportStart = clients.indexOf('buildStatementExportHtml_(client = {}, rows = [], paymentSchedules = [])');
const exportEnd = clients.indexOf('previewStatementPdf()', exportStart);
const statementExport = clients.slice(exportStart, exportEnd);
const statementHeader = index.match(/<thead><tr><th>Date<\/th><th>Type<\/th><th>Document No<\/th>[\s\S]*?<tbody id="clientStatementTbody">/)?.[0] || '';

assert.match(clients, /getStatementPeriodLabel_\(filters = this\.state\.statementFilters \|\| \{\}\)/, 'statement period must use the applied statement filters');
assert.match(clients, /if \(from && to\) return `From \$\{from\} to \$\{to\}`;/, 'statement period must support a from/to range');
assert.match(clients, /if \(from\) return `From \$\{from\}`;/, 'statement period must support a from-only filter');
assert.match(clients, /if \(to\) return `Until \$\{to\}`;/, 'statement period must support a to-only filter');
assert.match(clients, /return 'All dates';/, 'statement period must support no date filters');
assert.match(statementExport, /<span>Period<\/span><strong>\$\{U\.escapeHtml\(statementPeriod\)\}<\/strong>/, 'preview must display the selected period');
assert.doesNotMatch(statementExport, /Rows:/, 'preview must not display a row count');
assert.doesNotMatch(statementExport, /<th>Reference<\/th>|<th>Notes<\/th>/, 'preview must omit Reference and Notes headers');
assert.doesNotMatch(statementHeader, /<th>Reference<\/th>|<th>Notes<\/th>/, 'on-screen statement table must omit Reference and Notes headers');
assert.match(statementExport, /<th>Date<\/th><th>Activity<\/th><th>Document<\/th><th>Invoice Amount<\/th><th>Payment \/ Credit<\/th><th>Running Balance<\/th><th>Due Date<\/th><th>Status<\/th>/, 'preview must contain the current account-activity columns');
assert.match(statementExport, /Total Invoiced[\s\S]*Total Paid[\s\S]*Balance Due[\s\S]*Scheduled Balance/, 'preview must retain current statement totals and scheduled balance');
assert.match(statementExport, /@page \{ size: A4 landscape;/, 'preview must define the current A4 landscape print sizing');
assert.match(clients, /type: 'Credit Note'[\s\S]*credit: this\.pickAmount_/, 'credit notes must remain statement credits');

console.log('Statement of Account preview checks passed.');
