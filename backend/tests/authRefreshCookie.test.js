const test = require('node:test');
const assert = require('node:assert/strict');
const { getRefreshTokenCookieOptions } = require('../routes/auth');

test('refresh cookie is sent through the app in development and includes a root path', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';

  try {
    const options = getRefreshTokenCookieOptions({ secure: false, headers: {} });

    assert.equal(options.httpOnly, true);
    assert.equal(options.path, '/');
    assert.equal(options.sameSite, 'lax');
    assert.equal(options.secure, false);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
  }
});

test('refresh cookie uses cross-site compatible settings in production', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  try {
    const options = getRefreshTokenCookieOptions();

    assert.equal(options.httpOnly, true);
    assert.equal(options.path, '/');
    assert.equal(options.sameSite, 'none');
    assert.equal(options.secure, true);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
  }
});
