const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { logger, sanitizeForLog } = require('../utils/logger');

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

  assert.equal(sanitized.email, '********');
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

test('request logger redacts sensitive query values in URL and query fields', async () => {
  const app = express();
  app.use(express.json());
  app.use(logger.requestLogger);
  app.get('/log-test', (req, res) => res.json({ success: true }));

  const sensitiveValues = [
    'query-secret-value',
    'query-password-value',
    'query-token-value',
    'query-reset-token-value',
    'query-api-key-value',
    'query-authorization-value',
    'query-smtp-pass-value'
  ];
  const originalLog = console.log;
  const lines = [];
  console.log = (...parts) => lines.push(parts.map(String).join(' '));

  try {
    const response = await request(app)
      .get('/log-test')
      .query({
        secret: sensitiveValues[0],
        password: sensitiveValues[1],
        token: sensitiveValues[2],
        resetToken: sensitiveValues[3],
        'X-API-Key': sensitiveValues[4],
        authorization: sensitiveValues[5],
        smtpPass: sensitiveValues[6],
        page: '2'
      });

    assert.equal(response.status, 200);
    const logs = lines.join('\n');
    for (const value of sensitiveValues) {
      assert.ok(!logs.includes(value));
    }

    const requestEvent = JSON.parse(lines.find((line) => line.includes('"event":"request"')));
    assert.match(requestEvent.url, /secret=\*{8}/);
    assert.match(requestEvent.url, /password=\*{8}/);
    assert.match(requestEvent.url, /page=2/);
    assert.equal(requestEvent.query.secret, '********');
    assert.equal(requestEvent.query.password, '********');
    assert.equal(requestEvent.query.token, '********');
    assert.equal(requestEvent.query.resetToken, '********');
    assert.equal(requestEvent.query['X-API-Key'], '********');
    assert.equal(requestEvent.query.authorization, '********');
    assert.equal(requestEvent.query.smtpPass, '********');
    assert.equal(requestEvent.query.page, '2');
  } finally {
    console.log = originalLog;
  }
});
