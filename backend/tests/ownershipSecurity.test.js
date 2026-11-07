const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'priority-1-7-ownership-test-secret';
const { generateAccessToken } = require('../utils/token');
const User = require('../models/User');
const QuizSession = require('../models/QuizSession');
const userRouter = require('../routes/users');
const analyticsRouter = require('../routes/analytics');
const quizRouter = require('../routes/quizSession');

const USER_A = '507f1f77bcf86cd799439011';
const USER_B = '507f1f77bcf86cd799439012';

const buildApp = (basePath, router, userId = USER_A, role = 'student') => {
  const app = express();
  app.use(express.json());
  const token = generateAccessToken(userId, { role });
  app.use((req, res, next) => {
    req.headers.authorization = `Bearer ${token}`;
    next();
  });
  app.use(basePath, router);
  return app;
};

test('student cannot read another user profile', async () => {
  const originalFindById = User.findById;
  User.findById = () => {
    throw new Error('profile lookup must not run for unauthorized requests');
  };
  try {
    const response = await request(buildApp('/api/users', userRouter))
      .get(`/api/users/${USER_B}`);
    assert.equal(response.status, 403);
  } finally {
    User.findById = originalFindById;
  }
});

test('student cannot elevate role or plan through a profile update', async () => {
  const originalFindById = User.findById;
  const user = {
    _id: USER_A,
    id: USER_A,
    name: 'Student',
    role: 'student',
    plan: 'basic',
    async save() { return this; }
  };
  User.findById = async () => user;
  try {
    const response = await request(buildApp('/api/users', userRouter))
      .put(`/api/users/${USER_A}`)
      .send({
        name: 'Updated Student',
        role: 'admin',
        plan: 'premium',
        subscriptionType: 'premium',
        userId: USER_B
      });

    assert.equal(response.status, 200);
    assert.equal(user.name, 'Updated Student');
    assert.equal(user.role, 'student');
    assert.equal(user.plan, 'basic');
  } finally {
    User.findById = originalFindById;
  }
});

test('student cannot read another user analytics dashboard', async () => {
  const originalFindById = User.findById;
  User.findById = () => {
    throw new Error('dashboard lookup must not run for unauthorized requests');
  };
  try {
    const response = await request(buildApp('/api/analytics', analyticsRouter))
      .get(`/api/analytics/dashboard/${USER_B}`);
    assert.equal(response.status, 403);
  } finally {
    User.findById = originalFindById;
  }
});

test('student cannot read another user quiz history', async () => {
  const originalFind = QuizSession.find;
  QuizSession.find = () => {
    throw new Error('quiz lookup must not run for unauthorized requests');
  };
  try {
    const response = await request(buildApp('/api/quiz', quizRouter))
      .get(`/api/quiz/results/${USER_B}`);
    assert.equal(response.status, 403);
  } finally {
    QuizSession.find = originalFind;
  }
});

test('student can read their own quiz history', async () => {
  const originalFind = QuizSession.find;
  let query;
  let projection;
  QuizSession.find = (criteria) => {
    query = criteria;
    const chain = {
      select(fields) {
        projection = fields;
        return chain;
      },
      populate() {
        return chain;
      },
      sort: async () => []
    };
    return chain;
  };
  try {
    const response = await request(buildApp('/api/quiz', quizRouter))
      .get(`/api/quiz/results/${USER_A}`);
    assert.equal(response.status, 200);
    assert.deepEqual(query, { user: USER_A });
    assert.equal(projection, '-questions.correctOptionId -questions.correctAnswer -questions.isCorrect');
    assert.deepEqual(response.body.results, []);
  } finally {
    QuizSession.find = originalFind;
  }
});
