const test = require('node:test');
const assert = require('node:assert/strict');

const { extractTokenFromHeader } = require('../utils/token');
const protect = require('../config/middleware/authMiddleware');

test('extractTokenFromHeader ignores nullish bearer values', () => {
  assert.equal(extractTokenFromHeader('Bearer null'), null);
  assert.equal(extractTokenFromHeader('Bearer undefined'), null);
  assert.equal(extractTokenFromHeader('Bearer   '), null);
});

test('protect rejects malformed bearer tokens before JWT verification', () => {
  let statusCode = null;
  let jsonBody = null;

  const req = {
    headers: {
      authorization: 'Bearer null'
    },
    cookies: {}
  };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      jsonBody = body;
      return this;
    }
  };

  protect(req, res, () => {
    throw new Error('next should not be called for malformed token');
  });

  assert.equal(statusCode, 401);
  assert.deepEqual(jsonBody, {
    success: false,
    message: 'Not authorized. Please provide a valid token.'
  });
});
