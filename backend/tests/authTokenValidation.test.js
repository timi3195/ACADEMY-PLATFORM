const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'priority-1-7-test-secret';
const { generateAccessToken } = require('../utils/token');

const { extractTokenFromHeader } = require('../utils/token');
const protect = require('../config/middleware/authMiddleware');
const USER_ID = '507f1f77bcf86cd799439011';

const runProtect = (req) => {
  let statusCode = null;
  let jsonBody = null;
  let nextCalled = false;
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
    nextCalled = true;
  });
  return { statusCode, jsonBody, nextCalled, req };
};

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

test('protect accepts a valid JWT and normalizes the verified identity', () => {
  const token = generateAccessToken(USER_ID, { email: 'student@example.test', role: 'student' });
  const result = runProtect({
    headers: { authorization: `Bearer ${token}` },
    cookies: {},
    body: { id: '507f1f77bcf86cd799439099', role: 'admin' },
    query: { userId: '507f1f77bcf86cd799439099' }
  });

  assert.equal(result.nextCalled, true);
  assert.equal(result.req.user.id, USER_ID);
  assert.equal(result.req.user._id, USER_ID);
  assert.equal(result.req.user.role, 'student');
  assert.equal(result.req.user.email, 'student@example.test');
});

test('protect rejects a missing JWT even when req.user is forged', () => {
  const result = runProtect({
    headers: {},
    cookies: {},
    user: { id: USER_ID, role: 'admin' },
    body: { id: USER_ID, role: 'admin' }
  });

  assert.equal(result.statusCode, 401);
  assert.equal(result.nextCalled, false);
});

test('protect rejects expired JWTs', () => {
  const token = jwt.sign(
    { id: USER_ID, type: 'access' },
    process.env.JWT_SECRET,
    { expiresIn: -1 }
  );
  const result = runProtect({
    headers: { authorization: `Bearer ${token}` },
    cookies: {}
  });

  assert.equal(result.statusCode, 401);
  assert.equal(result.nextCalled, false);
  assert.match(result.jsonBody.message, /token.*expired|invalid token/i);
});
