const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../app');

test('OPTIONS preflight from production Vercel origin is accepted', async () => {
  const res = await request(app)
    .options('/api/admin/lecturers/test-id/approve')
    .set('Origin', 'https://academy-platform-lac-five.vercel.app')
    .set('Access-Control-Request-Method', 'PATCH')
    .set('Access-Control-Request-Headers', 'authorization,content-type');

  assert.equal(res.status, 204);
  assert.equal(res.headers['access-control-allow-origin'], 'https://academy-platform-lac-five.vercel.app');
  assert.match(res.headers['access-control-allow-methods'], /PATCH/i);
  assert.match(res.headers['access-control-allow-headers'], /authorization/i);
  assert.match(res.headers['access-control-allow-headers'], /content-type/i);
});

test('unauthorized PATCH requests are still rejected', async () => {
  const res = await request(app)
    .patch('/api/admin/lecturers/test-id/approve')
    .set('Origin', 'https://academy-platform-lac-five.vercel.app')
    .send({});

  assert.equal(res.status, 401);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message.includes('token') || res.body.message.includes('authorized'), true);
});

test('authorized admin patch request reaches the approval route', async () => {
  const mongoose = require('mongoose');
  const jwt = require('jsonwebtoken');
  const validId = new mongoose.Types.ObjectId().toString();
  const token = jwt.sign({ id: 'admin-id', role: 'admin', email: 'admin@example.com', type: 'access' }, process.env.JWT_SECRET, { expiresIn: '15m' });

  const res = await request(app)
    .patch(`/api/admin/lecturers/${validId}/approve`)
    .set('Origin', 'https://academy-platform-lac-five.vercel.app')
    .set('Authorization', `Bearer ${token}`)
    .send({});

  assert.equal(res.status, 404);
  assert.equal(res.headers['access-control-allow-origin'], 'https://academy-platform-lac-five.vercel.app');
  assert.equal(res.body.success, false);
});
