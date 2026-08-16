const assert = require('assert');
const fs = require('fs');
const source = fs.readFileSync('proposal-catalog.js', 'utf8');

assert.match(source, /generateCatalogItemId\(\)[\s\S]*CAT-\$\{date\}-\$\{token\}/, 'catalog create must generate a business item id');
assert.match(source, /catalog_item_id:\s*this\.getValue\(E\.proposalCatalogFormItemId\) \|\| this\.generateCatalogItemId\(\)/, 'catalog create payload must include catalog_item_id');
assert.match(source, /mode === 'create'[\s\S]*normalized\.catalog_item_id = this\.generateCatalogItemId\(\)/, 'new product form must prefill generated catalog id');
assert.match(source, /if \(!payload\.item_name\)[\s\S]*Item name is required/, 'item name must be required before database insert');
assert(source.includes('proposalCatalogFormErrorMessage'), 'persistent catalog error message element must exist');
assert(source.includes("copy.textContent = 'Copy Error'"), 'catalog errors must have a Copy Error action');
assert.match(source, /catch \(error\)[\s\S]*Unable to save catalog item:[\s\S]*this\.showFormError\(message\)/, 'save errors must be persisted in the form');
console.log('proposal catalog create regression tests passed');
