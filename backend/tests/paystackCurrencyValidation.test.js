const test = require('node:test');
const assert = require('node:assert/strict');

const { validateCurrency, SUBSCRIPTION_PRICES } = require('../routes/payments');

test('currency validation accepts the configured Paystack currency and rejects mismatches', () => {
  const configuredCurrency = (process.env.PAYSTACK_CURRENCY || 'NGN').toUpperCase();

  assert.equal(validateCurrency(configuredCurrency), configuredCurrency);
  assert.throws(() => validateCurrency('USD'), /Unsupported payment currency/);
});

test('subscription amounts come from server-side plan pricing', () => {
  assert.deepEqual(SUBSCRIPTION_PRICES, { basic: 7500, premium: 15000 });
});
