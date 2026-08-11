const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeForLog } = require('../utils/logger');

test('sanitizeForLog masks secrets and handles circular references without throwing', () => {
  const payload = {
    email: 'user@example.com',
    password: 'super-secret',
    nested: {
      token: 'abc123',
      ok: true
    }
  };
  payload.self = payload;

  const sanitized = sanitizeForLog(payload);

  assert.equal(sanitized.email, 'user@example.com');
  assert.equal(sanitized.password, '********');
  assert.equal(sanitized.nested.token, '********');
  assert.equal(sanitized.self, '[Circular]');
});
