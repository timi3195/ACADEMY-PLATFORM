const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { Readable } = require('node:stream');

const USER_A = '507f1f77bcf86cd799439011';
const USER_B = '507f1f77bcf86cd799439012';
const previousFileStorageDir = process.env.FILE_STORAGE_DIR;
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-upload-access-'));
process.env.FILE_STORAGE_DIR = uploadDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'priority-1-8-upload-test-secret';

const { generateAccessToken } = require('../utils/token');
const fileRoutes = require('../routes/file');
const File = require('../models/File');
const PastQuestionPaper = require('../models/PastQuestionPaper');
const StudentNote = require('../models/StudentNote');
const User = require('../models/User');
const materialAccessService = require('../services/materialAccessService');
const storageService = require('../services/storageService');

const coverFilename = 'public-cover-test.jpg';
const noteFilename = 'private-note-test.txt';
const fsPrivateFilename = 'restricted-lecturer-file-test.pdf';
const legacyMaterialFilename = 'legacy-material-test.pdf';
fs.writeFileSync(path.join(uploadDir, coverFilename), Buffer.from('public-cover-image'));
fs.writeFileSync(path.join(uploadDir, noteFilename), Buffer.from('student-a-private-note'));
fs.writeFileSync(path.join(uploadDir, fsPrivateFilename), Buffer.from('restricted-material'));
fs.writeFileSync(path.join(uploadDir, legacyMaterialFilename), Buffer.from('legacy-protected-material'));

const buildApp = (userId = USER_A, role = 'student', authenticated = true) => {
  const app = express();
  if (authenticated) {
    const token = generateAccessToken(userId, { role });
    app.use((req, res, next) => {
      req.headers.authorization = `Bearer ${token}`;
      next();
    });
  }
  app.use('/uploads', fileRoutes.legacyUploadsRouter);
  app.use('/api/files', fileRoutes.router);
  return app;
};

const publicCover = {
  coverImageFilename: coverFilename,
  visibility: 'public',
  productStatus: 'published',
  status: 'published',
  approved: true,
  hidden: false,
  isDeleted: false
};

const withMocks = async (run, options = {}) => {
  const originals = {
    fileExists: File.exists,
    fileFindOne: File.findOne,
    fileFindById: File.findById,
    paperExists: PastQuestionPaper.exists,
    paperFindById: PastQuestionPaper.findById,
    noteExists: StudentNote.exists,
    noteFindOne: StudentNote.findOne,
    userFindById: User.findById,
    canViewMaterial: materialAccessService.canViewMaterial,
    canDownloadMaterial: materialAccessService.canDownloadMaterial,
    recordView: materialAccessService.recordView,
    recordDownload: materialAccessService.recordDownload,
    getObjectReadStream: storageService.getObjectReadStream
  };

  const state = {
    userId: options.userId || USER_A,
    userRole: options.userRole || 'student',
    file: options.file || null,
    cover: options.cover || null,
    noteOwner: options.noteOwner || null,
    accessAllowed: options.accessAllowed ?? true,
    viewCalls: 0,
    downloadCalls: 0
  };

  File.exists = async (query) => {
    const isReferenced = state.file && (
      (query.storageFilename && state.file.storageFilename === query.storageFilename) ||
      (query.fileUrl && state.file.fileUrl === query.fileUrl)
    );
    return isReferenced ? { _id: state.file._id } : null;
  };
  File.findOne = async (query) => {
    if (query.coverImageFilename) {
      const isPublishedPublicCover = query.visibility === 'public' &&
        query.productStatus === 'published' &&
        query.status === 'published' &&
        query.approved === true &&
        query.hidden?.$ne === true &&
        query.isDeleted?.$ne === true &&
        state.cover?.visibility === 'public' &&
        state.cover?.productStatus === 'published' &&
        state.cover?.status === 'published' &&
        state.cover?.approved === true &&
        state.cover?.hidden !== true &&
        state.cover?.isDeleted !== true;
      return isPublishedPublicCover && state.cover?.coverImageFilename === query.coverImageFilename
        ? state.cover
        : null;
    }
    return null;
  };
  File.findById = async (id) => state.file && String(state.file._id) === String(id) ? state.file : null;
  PastQuestionPaper.exists = async () => null;
  PastQuestionPaper.findById = async (id) =>
    options.paper && String(options.paper._id) === String(id) ? options.paper : null;
  StudentNote.exists = async ({ fileName }) =>
    fileName === noteFilename && options.noteExists ? { _id: 'note-1' } : null;
  StudentNote.findOne = async ({ fileName, user }) =>
    fileName === noteFilename && String(user) === String(state.noteOwner) && state.noteOwner
      ? { fileName, user: state.noteOwner }
      : null;
  User.findById = async (id) => String(id) === String(state.userId)
    ? {
        _id: state.userId,
        id: state.userId,
        role: state.userRole,
        department: 'department-a',
        yearOfStudy: 'ND1',
        semester: 'First Semester'
      }
    : null;
  materialAccessService.canViewMaterial = async () => ({
    allowed: state.accessAllowed,
    reason: state.accessAllowed ? 'entitled' : 'purchase_required'
  });
  materialAccessService.canDownloadMaterial = async () => ({
    allowed: state.accessAllowed,
    reason: state.accessAllowed ? 'entitled' : 'purchase_required'
  });
  materialAccessService.recordView = async () => { state.viewCalls += 1; };
  materialAccessService.recordDownload = async () => { state.downloadCalls += 1; };
  storageService.getObjectReadStream = options.streamLocal
    ? originals.getObjectReadStream
    : async () => Readable.from(['authorized-material']);

  try {
    await run(state);
  } finally {
    File.exists = originals.fileExists;
    File.findOne = originals.fileFindOne;
    File.findById = originals.fileFindById;
    PastQuestionPaper.exists = originals.paperExists;
    PastQuestionPaper.findById = originals.paperFindById;
    StudentNote.exists = originals.noteExists;
    StudentNote.findOne = originals.noteFindOne;
    User.findById = originals.userFindById;
    materialAccessService.canViewMaterial = originals.canViewMaterial;
    materialAccessService.canDownloadMaterial = originals.canDownloadMaterial;
    materialAccessService.recordView = originals.recordView;
    materialAccessService.recordDownload = originals.recordDownload;
    storageService.getObjectReadStream = originals.getObjectReadStream;
  }
};

test('unauthenticated users cannot access private uploaded files', async () => {
  await withMocks(async () => {
    const response = await request(buildApp(USER_A, 'student', false)).get(`/uploads/${noteFilename}`);
    assert.equal(response.status, 401);
  }, { noteExists: true });
});

test('student A cannot access student B private uploads', async () => {
  await withMocks(async () => {
    const response = await request(buildApp(USER_A)).get(`/uploads/${noteFilename}`);
    assert.equal(response.status, 404);
    assert.doesNotMatch(response.text, /academy-upload-access|private-note/i);
  }, { noteExists: true, noteOwner: USER_B });
});

test('students cannot access lecturer or administrator material through legacy upload paths', async () => {
  await withMocks(async () => {
    const response = await request(buildApp(USER_A)).get(`/uploads/${fsPrivateFilename}`);
    assert.equal(response.status, 404);
    assert.doesNotMatch(response.text, /restricted-material|academy-upload-access/i);
  }, {
    file: {
      _id: 'file-1',
      storageFilename: fsPrivateFilename
    }
  });
});

test('students cannot access paid materials without purchase entitlement', async () => {
  await withMocks(async () => {
    const response = await request(buildApp()).get('/api/files/view/507f1f77bcf86cd799439013');
    assert.equal(response.status, 403);
    assert.match(response.body.message, /purchase_required/);
  }, {
    accessAllowed: false,
    file: {
      _id: '507f1f77bcf86cd799439013',
      isDeleted: false,
      hidden: false,
      visibility: 'public',
      title: 'Paid material',
      originalName: 'paid.pdf',
      storageFilename: 'paid-material.pdf',
      fileUrl: '/api/files/view/507f1f77bcf86cd799439013',
      course: 'course-a'
    }
  });
});

test('authorized students can access their own permitted uploaded notes', async () => {
  await withMocks(async () => {
    const response = await request(buildApp(USER_A)).get(`/uploads/${noteFilename}`);
    assert.equal(response.status, 200);
    assert.equal(response.text, 'student-a-private-note');
    assert.equal(response.headers['cache-control'], 'private, no-store');
  }, { noteExists: true, noteOwner: USER_A });
});

test('intentionally public published cover images remain accessible', async () => {
  await withMocks(async () => {
    const response = await request(buildApp(USER_A, 'student', false)).get(`/uploads/${coverFilename}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.toString(), 'public-cover-image');
    assert.equal(response.headers['content-type'], 'image/jpeg');
    assert.equal(response.headers['cache-control'], 'public, max-age=3600');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
  }, { cover: publicCover });
});

test('unpublished cover images are not exposed as public assets', async () => {
  await withMocks(async () => {
    const response = await request(buildApp(USER_A, 'student', false)).get(`/uploads/${coverFilename}`);
    assert.equal(response.status, 401);
  }, {
    cover: { ...publicCover, productStatus: 'draft' }
  });
});

test('public cover metadata cannot expose a file also referenced as legacy material', async () => {
  await withMocks(async () => {
    const response = await request(buildApp(USER_A, 'student', false)).get(`/uploads/${coverFilename}`);
    assert.equal(response.status, 401);
  }, {
    cover: publicCover,
    file: { _id: 'legacy-file', fileUrl: `/uploads/${coverFilename}` }
  });
});

test('encoded traversal and alternate upload paths are rejected', async () => {
  await withMocks(async () => {
    const app = buildApp(USER_A);
    const attemptedPaths = [
      '/uploads/%2e%2e%2fprivate.pdf',
      '/uploads/%252e%252e%252fprivate.pdf',
      '/uploads/..%2fprivate.pdf',
      '/uploads/nested/private.pdf',
      '/uploads-private/restricted-lecturer-file-test.pdf'
    ];

    for (const attemptedPath of attemptedPaths) {
      const response = await request(app).get(attemptedPath);
      assert.notEqual(response.status, 200, attemptedPath);
      assert.doesNotMatch(response.text || '', /academy-upload-access|restricted-material/i);
    }
  });
});

test('protected view and download routes still serve entitled files without shared caching', async () => {
  await withMocks(async (state) => {
    const app = buildApp();
    const view = await request(app).get('/api/files/view/507f1f77bcf86cd799439013');
    const download = await request(app).get('/api/files/download/507f1f77bcf86cd799439013');

    assert.equal(view.status, 200);
    assert.equal(download.status, 200);
    assert.equal(view.body.toString(), 'authorized-material');
    assert.equal(download.body.toString(), 'authorized-material');
    assert.equal(view.headers['cache-control'], 'private, no-store');
    assert.equal(download.headers['cache-control'], 'private, no-store');
    assert.equal(state.viewCalls, 1);
    assert.equal(state.downloadCalls, 1);
  }, {
    file: {
      _id: '507f1f77bcf86cd799439013',
      isDeleted: false,
      hidden: false,
      visibility: 'public',
      title: 'Entitled material',
      originalName: 'entitled.pdf',
      storageFilename: 'entitled.pdf',
      mimeType: 'application/pdf',
      fileUrl: '/api/files/view/507f1f77bcf86cd799439013',
      course: 'course-a'
    }
  });
});

test('legacy material URLs remain available through the protected file endpoint', async () => {
  await withMocks(async () => {
    const response = await request(buildApp()).get('/api/files/view/507f1f77bcf86cd799439014');
    assert.equal(response.status, 200);
    assert.equal(response.body.toString(), 'legacy-protected-material');
    assert.equal(response.headers['cache-control'], 'private, no-store');
  }, {
    streamLocal: true,
    file: {
      _id: '507f1f77bcf86cd799439014',
      isDeleted: false,
      hidden: false,
      visibility: 'public',
      title: 'Legacy material',
      originalName: legacyMaterialFilename,
      fileUrl: `/uploads/${legacyMaterialFilename}`,
      course: 'course-a'
    }
  });
});

test('past-question file route rejects students outside the paper course profile', async () => {
  await withMocks(async () => {
    const response = await request(buildApp()).get('/api/files/past-questions/paper-1');
    assert.equal(response.status, 403);
  }, {
    paper: {
      _id: 'paper-1',
      department: 'department-b',
      level: 'ND1',
      semester: 'First',
      mimeType: 'application/pdf'
    }
  });
});

test.after(() => {
  fs.rmSync(uploadDir, { recursive: true, force: true });
  if (previousFileStorageDir === undefined) delete process.env.FILE_STORAGE_DIR;
  else process.env.FILE_STORAGE_DIR = previousFileStorageDir;
});
