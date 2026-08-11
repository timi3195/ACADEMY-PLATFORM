const test = require('node:test');
const assert = require('node:assert/strict');
const { getRefreshTokenCookieOptions } = require('../routes/auth');

test('refresh cookie is sent through the app in development and includes a root path', () => {
  const options = getRefreshTokenCookieOptions({ secure: false, headers: {} });

  assert.equal(options.httpOnly, true);
  assert.equal(options.path, '/');
  assert.equal(options.sameSite, 'lax');
  assert.equal(options.secure, false);
});
