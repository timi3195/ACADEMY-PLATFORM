const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const storage = require('../services/storageService');

test('object keys are material-scoped and reject traversal from the filename', () => {
  const key = storage.generateStorageKey({ materialId: 'abc123', originalFilename: '../../lecture notes.pdf' });
  assert.match(key, /^materials\/abc123\/[0-9a-f-]+-lecture-notes\.pdf$/);
  assert.equal(key.includes('..'), false);
});

test('local storage path resolver rejects traversal and absolute paths', () => {
  assert.equal(storage.resolveStoragePath('../secrets.txt'), null);
  assert.equal(storage.resolveStoragePath('C:\\Windows\\system.ini'), null);
});

test('local storage path resolver supports confined private subdirectories', () => {
  const resolved = storage.resolveStoragePath('question-extractions\\507f1f77bcf86cd799439011\\image.png');
  assert.ok(resolved);
  assert.match(resolved, /question-extractions/);
});

test('private curriculum storage is import-scoped and streams only validated references', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'curriculum-storage-test-'));
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'curriculum-source-test-'));
  const previousProvider = process.env.STORAGE_PROVIDER;
  const previousStorageDir = process.env.FILE_STORAGE_DIR;
  process.env.STORAGE_PROVIDER = 'local-disk';
  process.env.FILE_STORAGE_DIR = root;
  t.after(async () => {
    if (previousProvider === undefined) delete process.env.STORAGE_PROVIDER;
    else process.env.STORAGE_PROVIDER = previousProvider;
    if (previousStorageDir === undefined) delete process.env.FILE_STORAGE_DIR;
    else process.env.FILE_STORAGE_DIR = previousStorageDir;
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const importId = '507f1f77bcf86cd799439011';
  const sourcePath = path.join(tempDir, 'source.upload');
  const content = Buffer.from('%PDF-1.7 private curriculum');
  await fs.writeFile(sourcePath, content);
  const document = await storage.storePrivateCurriculumDocument({
    file: { path: sourcePath },
    importId,
    originalFilename: 'curriculum.pdf',
    mimeType: 'application/pdf',
    size: content.length,
    contentHash: 'a'.repeat(64)
  });

  assert.equal(document.provider, 'local-disk');
  assert.match(document.storageFilename, new RegExp(`^curriculum-imports/${importId}/`));
  assert.equal(document.storageKey, '');
  const stream = await storage.getPrivateCurriculumDocumentStream({ document, importId });
  let streamed = '';
  for await (const chunk of stream) streamed += chunk.toString();
  assert.equal(streamed, content.toString());

  await assert.rejects(storage.getPrivateCurriculumDocumentStream({
    document: { ...document, storageFilename: '../outside.pdf' },
    importId
  }), { statusCode: 404 });
  await storage.deletePrivateCurriculumDocument({ document, importId });
});

test('private curriculum storage rejects references owned by another import', () => {
  assert.equal(storage.isSafeCurriculumStorageReference({
    importId: '507f1f77bcf86cd799439011',
    provider: 'local-disk',
    storageFilename: 'curriculum-imports/507f1f77bcf86cd799439012/source.pdf',
    mimeType: 'application/pdf'
  }), false);
});
