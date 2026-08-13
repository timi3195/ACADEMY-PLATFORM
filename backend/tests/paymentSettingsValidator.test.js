const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePaymentSettings } = require('../validators/lecturerValidator');

const validSettings = () => ({
  bankName: 'Guaranty Trust Bank', bankCode: '058', accountNumber: '0123456789', accountName: 'Ada Okafor'
});

test('payment settings validator accepts a valid Nigerian account number', () => {
  assert.deepEqual(validatePaymentSettings(validSettings()), []);
});

test('payment settings validator rejects invalid account numbers and missing required data', () => {
  assert.ok(validatePaymentSettings({ ...validSettings(), accountNumber: '1234' }).some(({ field }) => field === 'accountNumber'));
  assert.ok(validatePaymentSettings({ ...validSettings(), bankName: '' }).some(({ field }) => field === 'bankName'));
  assert.ok(validatePaymentSettings({ ...validSettings(), accountName: '' }).some(({ field }) => field === 'accountName'));
});
