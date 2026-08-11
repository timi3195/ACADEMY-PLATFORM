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

test('sanitizeForLog strips Mongoose internals and reduces noisy document payloads', () => {
  const material = {
    _id: 'material-1',
    title: 'Intro to Programming',
    password: 'should-be-hidden',
    lecturer: { name: 'test user' },
    $__: { activePaths: { paths: { title: 'init' } } },
    _doc: { title: 'Intro to Programming', lecturer: { name: 'test user' } }
  };
  material.lecturer.parent = material;

  const sanitized = sanitizeForLog(material);

  assert.equal(sanitized.title, 'Intro to Programming');
  assert.equal(sanitized.password, '********');
  assert.equal(Object.prototype.hasOwnProperty.call(sanitized, '$__'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(sanitized, '_doc'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(sanitized.lecturer, 'parent'), false);
  assert.equal(sanitized.lecturer.name, 'test user');
});
