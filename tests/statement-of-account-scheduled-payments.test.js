const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const api = fs.readFileSync('api.js', 'utf8');
const clients = fs.readFileSync('clients.js', 'utf8');

const apiStart = api.indexOf('async getClientStatementOfAccount(clientOrId = {}, options = {})');
const apiEnd = api.indexOf('async getClientOnboarding', apiStart);
const statementApi = api.slice(apiStart, apiEnd);

assert(apiStart >= 0 && apiEnd > apiStart, 'Statement of Account API method must exist.');
assert.match(statementApi, /fetchLinkedRowsByColumns_\('invoice_payment_schedule'/, 'Statement must load saved invoice payment schedule rows.');
assert.match(statementApi, /fetchPaged\([\s\S]*'client_scheduled_payments'/, 'Statement must retain the scheduled-payments view as a legacy fallback.');
assert.match(statementApi, /paymentSchedules:\s*\{[\s\S]*rows: paymentSchedules/, 'Payment schedules must be returned in their own collection.');
assert.match(statementApi, /payment_schedules: paymentSchedules/, 'Statement API must retain the compatibility payment_schedules alias.');
assert.doesNotMatch(statementApi, /type: 'Scheduled Payment'/, 'Installments must not be mixed into accounting activity rows.');
assert.match(statementApi, /scheduled_amount: scheduledAmount/, 'Schedule records must expose the installment amount.');
assert.match(statementApi, /due_date: dueDate/, 'Schedule records must expose the installment due date.');
assert.match(clients, /Payment Schedule/, 'Statement export must render a separate Payment Schedule section.');
assert.match(clients, /Scheduled Balance/, 'Statement export must report scheduled balance separately from accounting balance.');

const context = {
  window: {},
  console,
  fetch: async () => { throw new Error('Unexpected network request in statement schedule test.'); },
  URL,
  URLSearchParams,
  Headers,
  setTimeout,
  clearTimeout,
  structuredClone: global.structuredClone
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(api, context, { filename: 'api.js' });

const Api = context.window.Api;
Api.getClientOverview = async () => ({
  invoices: {
    rows: [{
      id: '11111111-1111-4111-8111-111111111111',
      invoice_number: 'SA/2026/41',
      invoice_date: '2026-05-12',
      due_date: '2026-05-12',
      grand_total: 726,
      currency: 'USD',
      status: 'issued'
    }]
  },
  receipts: { rows: [] },
  creditNotes: { rows: [] }
});
Api.fetchLinkedRowsByColumns_ = async () => ([
  {
    id: 'schedule-1',
    invoice_id: '11111111-1111-4111-8111-111111111111',
    schedule_no: 1,
    due_date: '2026-05-12',
    scheduled_amount: 363,
    paid_amount: 363,
    balance_due: 0,
    status: 'paid'
  },
  {
    id: 'schedule-2',
    invoice_id: '11111111-1111-4111-8111-111111111111',
    schedule_no: 2,
    due_date: '2026-11-12',
    scheduled_amount: 363,
    paid_amount: 0,
    balance_due: 363,
    status: 'scheduled'
  }
]);

(async () => {
  const result = await Api.getClientStatementOfAccount({ client_id: 'Client#00001' }, { page: 1, pageSize: 25 });
  const schedules = result.paymentSchedules.rows;
  assert.strictEqual(schedules.length, 2, 'Statement must return every invoice installment in the payment-schedule collection.');
  assert.strictEqual(result.statementRows.length, 1, 'Accounting activity must contain the invoice only and must not duplicate schedule installments.');
  assert.strictEqual(schedules[1].invoice_number, 'SA/2026/41', 'Second payment must remain linked to its SA invoice.');
  assert.strictEqual(schedules[1].schedule_no, 2, 'Second payment must retain its installment number.');
  assert.strictEqual(schedules[1].due_date, '2026-11-12', 'Second payment must use its saved due date.');
  assert.strictEqual(schedules[1].scheduled_amount, 363, 'Second payment must show its scheduled amount.');
  assert.strictEqual(result.statementRows[0].running_balance, 726, 'Payment schedules must not duplicate the invoice accounting balance.');
  console.log('Statement of Account scheduled-payment checks passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
