const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'priority-1-7-ai-test-secret';
const { generateAccessToken } = require('../utils/token');
const aiRouter = require('../routes/ai');
const AIConversation = require('../models/AIConversation');
const StudentNote = require('../models/StudentNote');
const Course = require('../models/course');
const StudentPerformance = require('../models/StudentPerformance');
const File = require('../models/File');
const PastQuestionPaper = require('../models/PastQuestionPaper');
const geminiService = require('../utils/gemini');

const USER_A = '507f1f77bcf86cd799439011';

const buildAiApp = (userOverrides = {}) => {
  const app = express();
  const user = { id: USER_A, role: 'student', ...userOverrides };
  const token = generateAccessToken(user.id, user);
  app.use(express.json());
  app.use((req, res, next) => {
    req.headers.authorization = `Bearer ${token}`;
    next();
  });
  app.use('/api/ai', aiRouter);
  return app;
};

test('unauthenticated users cannot access protected AI routes', async () => {
  const app = express();
  app.use('/api/ai', aiRouter);

  const res = await request(app).get('/api/ai/chat/507f1f77bcf86cd799439011');
  assert.equal(res.status, 401);
  assert.match(String(res.body.message || ''), /Not authorized|Not authenticated|valid token|token/i);
});

test('student cannot retrieve another student conversation', async () => {
  const app = buildAiApp();
  const original = AIConversation.findOne;
  AIConversation.findOne = async (query) => {
    assert.equal(query.user, USER_A);
    return null;
  };

  try {
    const res = await request(app).get('/api/ai/chat/conversation/507f1f77bcf86cd799439011');
    assert.equal(res.status, 404);
    assert.match(String(res.body.message || ''), /Conversation not found/i);
  } finally {
    AIConversation.findOne = original;
  }
});

test('student cannot delete another student conversation', async () => {
  const app = buildAiApp();
  const original = AIConversation.findOneAndDelete;
  AIConversation.findOneAndDelete = async (query) => {
    assert.equal(query.user, USER_A);
    return null;
  };

  try {
    const res = await request(app).delete('/api/ai/chat/507f1f77bcf86cd799439011');
    assert.equal(res.status, 404);
    assert.match(String(res.body.message || ''), /Conversation not found/i);
  } finally {
    AIConversation.findOneAndDelete = original;
  }
});

test('student cannot retrieve another student note', async () => {
  const app = buildAiApp();
  const original = StudentNote.findOne;
  StudentNote.findOne = async (query) => {
    assert.equal(query.user, USER_A);
    return null;
  };

  try {
    const res = await request(app).get('/api/ai/notes/detail/507f1f77bcf86cd799439011');
    assert.equal(res.status, 404);
    assert.match(String(res.body.message || ''), /Note not found/i);
  } finally {
    StudentNote.findOne = original;
  }
});

test('student cannot delete another student note', async () => {
  const app = buildAiApp();
  const original = StudentNote.findOneAndDelete;
  StudentNote.findOneAndDelete = async (query) => {
    assert.equal(query.user, USER_A);
    return null;
  };

  try {
    const res = await request(app).delete('/api/ai/notes/507f1f77bcf86cd799439011');
    assert.equal(res.status, 404);
    assert.match(String(res.body.message || ''), /Note not found/i);
  } finally {
    StudentNote.findOneAndDelete = original;
  }
});

test('authenticated users can access their own authorized AI records', async () => {
  const app = buildAiApp();
  const original = StudentNote.findOne;
  StudentNote.findOne = async (query) => {
    assert.equal(query.user, USER_A);
    return {
      _id: '507f1f77bcf86cd799439011',
      user: USER_A,
      course: { title: 'Algorithms' },
      lastReviewedAt: new Date(),
      reviewCount: 1,
      save: async function save() { return this; }
    };
  };

  try {
    const res = await request(app).get('/api/ai/notes/detail/507f1f77bcf86cd799439011');
    assert.equal(res.status, 200);
    assert.equal(res.body.note.user, USER_A);
  } finally {
    StudentNote.findOne = original;
  }
});

test('client-supplied user IDs cannot override authenticated identity in chat requests', async () => {
  const app = buildAiApp();
  const courseDoc = {
    _id: '507f1f77bcf86cd799439012',
    title: 'Programming 101',
    code: 'CSC101',
    department: { _id: '507f1f77bcf86cd799439013', name: 'Computer Science' }
  };

  const courseOrig = Course.findById;
  const perfOrig = StudentPerformance.findOne;
  const fileOrig = File.find;
  const paperOrig = PastQuestionPaper.find;
  const geminiOrig = geminiService.chatWithStudent;
  const convOrig = AIConversation.findById;

  Course.findById = async () => courseDoc;
  StudentPerformance.findOne = async () => null;
  File.find = async () => [];
  PastQuestionPaper.find = async () => [];
  geminiService.chatWithStudent = async (messages, context, userId) => {
    assert.equal(userId, USER_A);
    return { message: 'Powered by Gemini', tokens: { total: 1 }, cost: 0 };
  };
  AIConversation.findById = async () => ({
    user: USER_A,
    messages: [],
    save: async function save() { return this; }
  });

  try {
    const res = await request(app)
      .post('/api/ai/chat')
      .send({
        courseId: '507f1f77bcf86cd799439012',
        message: 'Explain variables',
        conversationId: '507f1f77bcf86cd799439014',
        userId: 'user-2'
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.message, 'Powered by Gemini');
  } finally {
    Course.findById = courseOrig;
    StudentPerformance.findOne = perfOrig;
    File.find = fileOrig;
    PastQuestionPaper.find = paperOrig;
    geminiService.chatWithStudent = geminiOrig;
    AIConversation.findById = convOrig;
  }
});
