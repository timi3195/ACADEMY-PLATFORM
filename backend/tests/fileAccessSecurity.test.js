const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { Readable } = require('stream');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'priority-1-7-file-test-secret';
const { generateAccessToken } = require('../utils/token');
const fileRouter = require('../routes/file');
const File = require('../models/File');
const User = require('../models/User');
const materialAccessService = require('../services/materialAccessService');
const storageService = require('../services/storageService');

const USER_A = '507f1f77bcf86cd799439011';

const buildFileApp = (user = { id: USER_A, role: 'student' }) => {
  const app = express();
  const token = generateAccessToken(user.id, user);
  app.use((req, res, next) => {
    req.headers.authorization = `Bearer ${token}`;
    next();
  });
  app.use('/api/files', fileRouter);
  return app;
};

test('unauthenticated users cannot access protected file downloads', async () => {
  const app = express();
  app.use('/api/files', fileRouter);

  const res = await request(app).get('/api/files/download/507f1f77bcf86cd799439011');
  assert.equal(res.status, 401);
});

test('unauthorized students cannot access restricted materials', async () => {
  const app = buildFileApp();
  const originalFileFind = File.findById;
  const originalUserFind = User.findById;
  const originalAccess = materialAccessService.canDownloadMaterial;

  User.findById = async () => ({ _id: USER_A, id: USER_A, role: 'student' });
  File.findById = async () => ({
    _id: '507f1f77bcf86cd799439011',
    isDeleted: false,
    hidden: false,
    visibility: 'public',
    title: 'Private note',
    originalName: 'private.pdf',
    storageFilename: 'private.pdf',
    fileUrl: '/api/files/download/507f1f77bcf86cd799439011',
    course: 'course-1',
    save: async function save() { return this; }
  });
  materialAccessService.canDownloadMaterial = async () => ({ allowed: false, reason: 'purchase_required' });

  try {
    const res = await request(app).get('/api/files/download/507f1f77bcf86cd799439011');
    assert.equal(res.status, 403);
    assert.match(String(res.body.message || ''), /purchase_required|access/i);
  } finally {
    File.findById = originalFileFind;
    User.findById = originalUserFind;
    materialAccessService.canDownloadMaterial = originalAccess;
  }
});

test('students cannot upload using administrative privileges', async () => {
  const app = buildFileApp({ id: USER_A, role: 'student' });
  const res = await request(app)
    .post('/api/files/upload')
    .attach('file', Buffer.from('hello'), { filename: 'notes.txt', contentType: 'text/plain' });

  assert.equal(res.status, 403);
  assert.match(String(res.body.message || ''), /Admin access only|permission/i);
});

test('invalid file types are rejected by the upload route', async () => {
  const app = buildFileApp({ id: '507f1f77bcf86cd799439012', role: 'admin' });
  const res = await request(app)
    .post('/api/files/upload')
    .attach('file', Buffer.from('bad'), { filename: 'malware.exe', contentType: 'application/x-msdownload' });

  assert.ok(res.status >= 400);
  assert.match(String(res.body.message || ''), /Unsupported file type|Invalid file type|file type/i);
});

test('oversized uploads are rejected before processing', async () => {
  const app = buildFileApp({ id: '507f1f77bcf86cd799439012', role: 'admin' });
  const big = Buffer.alloc(26 * 1024 * 1024, 'x');
  const res = await request(app)
    .post('/api/files/upload')
    .attach('file', big, { filename: 'big.pdf', contentType: 'application/pdf' });

  assert.ok(res.status === 413 || res.status >= 400);
});

test('path traversal attempts are rejected at the storage layer', () => {
  assert.equal(storageService.resolveStoragePath('../secrets.txt'), null);
  assert.equal(storageService.resolveStoragePath('..\\..\\secrets.txt'), null);
  assert.equal(storageService.resolveStoragePath('/etc/passwd'), null);
});

test('authorized users can still access materials they are entitled to use', async () => {
  const app = buildFileApp();
  const originalFileFind = File.findById;
  const originalUserFind = User.findById;
  const originalAccess = materialAccessService.canDownloadMaterial;
  const originalRecord = materialAccessService.recordDownload;
  const originalStream = storageService.getObjectReadStream;

  User.findById = async () => ({ _id: USER_A, id: USER_A, role: 'student' });
  File.findById = async () => ({
    _id: '507f1f77bcf86cd799439012',
    isDeleted: false,
    hidden: false,
    visibility: 'public',
    title: 'Study guide',
    originalName: 'guide.txt',
    storageFilename: 'guide.txt',
    mimeType: 'text/plain',
    fileUrl: '/api/files/download/507f1f77bcf86cd799439012',
    course: 'course-1',
    save: async function save() { return this; }
  });
  materialAccessService.canDownloadMaterial = async () => ({ allowed: true, reason: 'purchased' });
  materialAccessService.recordDownload = async () => ({ success: true });
  storageService.getObjectReadStream = async () => Readable.from(['ok']);

  try {
    const res = await request(app).get('/api/files/download/507f1f77bcf86cd799439012');
    assert.equal(res.status, 200);
    assert.equal(res.text, 'ok');
  } finally {
    File.findById = originalFileFind;
    User.findById = originalUserFind;
    materialAccessService.canDownloadMaterial = originalAccess;
    materialAccessService.recordDownload = originalRecord;
    storageService.getObjectReadStream = originalStream;
  }
});
