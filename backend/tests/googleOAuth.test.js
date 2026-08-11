const test = require('node:test');
const assert = require('node:assert/strict');

process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';

const passport = require('../config/middleware/passport');

test('buildCallbackUrl uses configured OAuth callback URL when provided', () => {
  process.env.GOOGLE_CALLBACK_URL = 'https://api.example.com/api/auth/google/callback';

  const req = { headers: { host: 'localhost:5000' }, secure: false };
  assert.equal(passport.buildCallbackUrl(req), 'https://api.example.com/api/auth/google/callback');
});

test('buildCallbackUrl derives an absolute URL from the incoming request host', () => {
  delete process.env.GOOGLE_CALLBACK_URL;

  const req = { headers: { host: 'localhost:5000' }, secure: false };
  assert.equal(passport.buildCallbackUrl(req), 'http://localhost:5000/api/auth/google/callback');
});
