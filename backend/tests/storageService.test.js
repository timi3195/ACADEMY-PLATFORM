const test = require('node:test');
const assert = require('node:assert/strict');
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
