const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../app');

test('OPTIONS preflight from production Vercel origin is accepted', async () => {
  const res = await request(app)
    .options('/api/admin/content/dashboard')
    .set('Origin', 'https://academy-platform-lac-five.vercel.app')
    .set('Access-Control-Request-Method', 'GET')
    .set('Access-Control-Request-Headers', 'authorization,content-type');

  assert.equal(res.status, 204);
  assert.equal(res.headers['access-control-allow-origin'], 'https://academy-platform-lac-five.vercel.app');
  assert.match(res.headers['access-control-allow-methods'], /GET/i);
  assert.match(res.headers['access-control-allow-headers'], /authorization/i);
  assert.match(res.headers['access-control-allow-headers'], /content-type/i);
});

test('untrusted Vercel and Netlify preview origins are not allowed to read credentialed responses', async () => {
  for (const origin of ['https://attacker.vercel.app', 'https://attacker.netlify.app']) {
    const res = await request(app)
      .options('/api/question-extractions/private-batch')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'GET');

    assert.notEqual(res.status, 204);
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  }
});

test('unauthenticated requests to admin content are still rejected', async () => {
  const res = await request(app)
    .get('/api/admin/content/dashboard')
    .set('Origin', 'https://academy-platform-lac-five.vercel.app')
    .send();

  assert.equal(res.status, 401);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message.includes('token') || res.body.message.includes('authorized'), true);
});

test('legacy lecturer account-management endpoints are not mounted', async () => {
  const res = await request(app)
    .patch('/api/admin/lecturers/test-id/approve')
    .set('Origin', 'https://academy-platform-lac-five.vercel.app')
    .send({});

  assert.equal(res.status, 404);
  assert.equal(res.headers['access-control-allow-origin'], 'https://academy-platform-lac-five.vercel.app');
});
