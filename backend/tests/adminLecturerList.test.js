const test = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeAdminLecturer, getAdminLecturerList } = require('../services/adminService');
const User = require('../models/User');

test('sanitizeAdminLecturer returns a JSON-safe object with expected admin fields only', () => {
  const lecturer = {
    _id: '68b1a0a5f3f3ff0001abc123',
    name: 'Ada Lecturer',
    email: 'ada@example.com',
    matricNumber: '2024/1234',
    department: '68b1a0a5f3f3ff0001abc456',
    yearOfStudy: 'ND1',
    lecturerStatus: 'pending',
    lecturerApplication: { submittedAt: '2026-01-01T00:00:00.000Z', rejectionReason: 'Needs approval' },
    password: 'hashed-secret',
    paystackPayment: { secretKey: 'sk_test_123', businessName: 'Example' },
    refreshTokens: [{ token: 'token-123' }],
    googleId: 'google-123',
    role: 'lecturer'
  };

  const sanitized = sanitizeAdminLecturer(lecturer);

  assert.equal(sanitized._id, '68b1a0a5f3f3ff0001abc123');
  assert.equal(sanitized.name, 'Ada Lecturer');
  assert.equal(sanitized.email, 'ada@example.com');
  assert.equal(sanitized.matricNumber, '2024/1234');
  assert.equal(sanitized.department, '68b1a0a5f3f3ff0001abc456');
  assert.equal(sanitized.yearOfStudy, 'ND1');
  assert.equal(sanitized.lecturerStatus, 'pending');
  assert.equal(sanitized.lecturerApplicationDate, '2026-01-01T00:00:00.000Z');
  assert.equal(sanitized.lecturerRejectionReason, 'Needs approval');
  assert.equal(sanitized.lecturerProfile, null);

  assert.equal(sanitized.password, undefined);
  assert.equal(sanitized.paystackPayment, undefined);
  assert.equal(sanitized.refreshTokens, undefined);
  assert.equal(sanitized.googleId, undefined);
});

test('getAdminLecturerList filters pending lecturers and returns only safe fields', async () => {
  const originalFind = User.find;
  User.find = () => ({
    populate: () => ({
      sort: () => ({
        select: () => ({
          lean: async () => [
            {
              _id: '68b1a0a5f3f3ff0001abc111',
              name: 'Pending One',
              email: 'one@example.com',
              department: 'department-1',
              yearOfStudy: 'HND2',
              lecturerStatus: 'pending',
              lecturerApplication: { submittedAt: '2026-01-02T00:00:00.000Z', rejectionReason: '' },
              password: 'secret',
              paystackPayment: { secretKey: 'sk_test_999' }
            },
            {
              _id: '68b1a0a5f3f3ff0001abc222',
              name: 'Approved One',
              email: 'two@example.com',
              department: 'department-1',
              yearOfStudy: 'HND1',
              lecturerStatus: 'approved',
              lecturerApplication: { submittedAt: '2026-01-03T00:00:00.000Z', rejectionReason: '' },
              password: 'secret',
              paystackPayment: { secretKey: 'sk_test_888' }
            }
          ]
        })
      })
    })
  });

  try {
    const result = await getAdminLecturerList({ status: 'pending' });

    assert.equal(result.count, 1);
    assert.equal(result.lecturers.length, 1);
    assert.equal(result.lecturers[0].name, 'Pending One');
    assert.equal(result.lecturers[0].lecturerStatus, 'pending');
    assert.equal(result.lecturers[0].password, undefined);
    assert.equal(result.lecturers[0].paystackPayment, undefined);
  } finally {
    User.find = originalFind;
  }
});
