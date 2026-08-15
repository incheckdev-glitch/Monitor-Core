const assert = require('assert');
const path = require('path');

const helperPath = path.resolve(__dirname, '..', 'notification-template-helpers.js');

global.window = global;
delete global.getRecordRef;
delete global.getRecordDeepLink;
delete global.renderNotificationTemplate;
delete global.NotificationTemplateHelpers;
delete require.cache[helperPath];
require(helperPath);

assert.strictEqual(typeof global.getRecordRef, 'function', 'getRecordRef should be globally available');
assert.strictEqual(typeof global.getRecordDeepLink, 'function', 'getRecordDeepLink should be globally available');
assert.strictEqual(typeof global.renderNotificationTemplate, 'function', 'renderNotificationTemplate should be globally available');

assert.strictEqual(
  global.getRecordRef({ invoice_number: 'SA/2026/77' }),
  'SA/2026/77',
  'invoice display reference should resolve',
);

assert.strictEqual(
  global.getRecordDeepLink({ resource: 'invoices' }, { invoice_number: 'SA/2026/77' }),
  '#invoices?invoice_id=SA%2F2026%2F77',
  'invoice deep link should use the readable invoice reference',
);

assert.strictEqual(
  global.getRecordDeepLink(
    { resource: 'credit_notes', deep_link_template: '#credit-notes?record_id={{id}}&ref={{credit_note_number}}' },
    { id: 'abc-123', credit_note_number: 'CN/2026/5' },
  ),
  '#credit-notes?record_id=abc-123&ref=CN%2F2026%2F5',
  'configured notification deep-link templates should interpolate safely',
);

assert.strictEqual(
  global.renderNotificationTemplate('Credit note {{record_ref}} issued for {client_name}', {
    credit_note_id: 'CN/2026/5',
    client_name: 'Example Client',
  }),
  'Credit note CN/2026/5 issued for Example Client',
  'shared template renderer should support both placeholder formats',
);

assert.strictEqual(global.NotificationTemplateHelpers.getRecordRef, global.getRecordRef);
assert.strictEqual(global.NotificationTemplateHelpers.getRecordDeepLink, global.getRecordDeepLink);
assert.strictEqual(global.NotificationTemplateHelpers.renderNotificationTemplate, global.renderNotificationTemplate);

console.log('Notification template helper checks passed.');
