const test = require('node:test');
const assert = require('node:assert/strict');
const User = require('../models/User');
const lecturerOnly = require('../config/middleware/lecturerOnly');

const buildRes = () => {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };

  return res;
};

test('lecturerOnly blocks pending lecturers from protected routes', async () => {
  const originalFindById = User.findById;
  User.findById = () => ({
    select: () => ({ _id: 'lecturer-1', role: 'lecturer', lecturerStatus: 'pending' })
  });

  try {
    const req = { user: { id: 'lecturer-1', role: 'lecturer' } };
    const res = buildRes();
    let nextCalled = false;

    await lecturerOnly(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.success, false);
    assert.equal(nextCalled, false);
  } finally {
    User.findById = originalFindById;
  }
});

test('lecturerOnly allows approved lecturers onto protected routes', async () => {
  const originalFindById = User.findById;
  User.findById = () => ({
    select: () => ({ _id: 'lecturer-2', role: 'lecturer', lecturerStatus: 'approved' })
  });

  try {
    const req = { user: { id: 'lecturer-2', role: 'lecturer' } };
    const res = buildRes();
    let nextCalled = false;

    await lecturerOnly(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 200);
    assert.equal(nextCalled, true);
  } finally {
    User.findById = originalFindById;
  }
});
