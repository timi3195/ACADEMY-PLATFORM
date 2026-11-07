const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const backendUrl = process.env.BACKEND_URL;
const lecturerToken = process.env.PAYSTACK_TEST_LECTURER_TOKEN;
const skipReason = !process.env.PAYSTACK_SECRET_KEY
  ? 'PAYSTACK_SECRET_KEY is unavailable'
  : !backendUrl
    ? 'BACKEND_URL is unavailable'
    : !lecturerToken
      ? 'PAYSTACK_TEST_LECTURER_TOKEN is unavailable'
      : false;

test('live Paystack integration: authenticated lecturer can load the bank list', {
  skip: skipReason
}, async () => {
  const response = await axios.get(`${backendUrl.replace(/\/$/, '')}/api/lecturer/payment/banks`, {
    headers: { Authorization: `Bearer ${lecturerToken}` },
    timeout: 15000
  });

  assert.equal(response.status, 200);
  assert.equal(response.data.success, true);
  assert.ok(Array.isArray(response.data.banks));
});
