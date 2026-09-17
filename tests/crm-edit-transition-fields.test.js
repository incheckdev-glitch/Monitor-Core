const assert = require('assert');
const fs = require('fs');

const bridge = fs.readFileSync('src/services/crmEditTransitionFields.js', 'utf8');
const loader = fs.readFileSync('src/services/darkModeSafetyPatch.js', 'utf8');

assert(bridge.includes("'leadFormStatus'"), 'Lead Status must trigger related-field refresh');
assert(bridge.includes("'dealFormStage'"), 'Deal Stage must trigger related-field refresh');
assert.match(bridge, /InCheck360CrmPipelineIntelligenceFields\?\.refresh\?\.\(\)/,
  'Edit transition must reuse the canonical CRM conditional-field refresh');
assert.match(bridge, /addEventListener\('change',\s*refreshRelatedFields,\s*true\)/,
  'Status/stage change must be captured even when another handler stops bubbling');
assert.match(bridge, /addEventListener\('input',\s*refreshRelatedFields,\s*true\)/,
  'Interactive edit changes should refresh immediately');
assert(loader.includes("./crmEditTransitionFields.js?v=20260917-crm-edit-transition1"),
  'The edit transition bridge must be loaded with a cache-busting version');
assert(loader.indexOf('crmPipelineIntelligenceFields.js') < loader.indexOf('crmEditTransitionFields.js'),
  'The canonical field engine must load before the edit transition bridge');

console.log('CRM edit status/stage transition field regression tests passed');
