const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeMaterialFileUrl, getLibrary } = require('../services/marketplaceService');

test('normalizeMaterialFileUrl converts relative paths to absolute backend URLs', () => {
  const material = {
    _id: '64d47d7862e63c1a7f3d2c10',
    fileUrl: '/api/files/view/64d47d7862e63c1a7f3d2c10',
    downloadUrl: '/api/files/download/64d47d7862e63c1a7f3d2c10',
    coverImageUrl: '/uploads/test.png'
  };

  const result = normalizeMaterialFileUrl(material, { protocol: 'https', get: (header) => {
    if (header === 'host') return 'academy-platform-z3bw.onrender.com';
    return undefined;
  } });

  assert.equal(result.fileUrl, 'https://academy-platform-z3bw.onrender.com/api/files/view/64d47d7862e63c1a7f3d2c10');
  assert.equal(result.downloadUrl, 'https://academy-platform-z3bw.onrender.com/api/files/download/64d47d7862e63c1a7f3d2c10');
  assert.equal(result.coverImageUrl, 'https://academy-platform-z3bw.onrender.com/uploads/test.png');
});

test('library entries for successful material purchases keep download access enabled', async () => {
  const userId = '64d47d7862e63c1a7f3d2c11';
  const materialId = '64d47d7862e63c1a7f3d2c12';

  const fakeTransaction = {
    _id: '64d47d7862e63c1a7f3d2c13',
    reference: 'REF123',
    status: 'success',
    paidAt: new Date('2026-08-01T00:00:00Z'),
    amount: 2500,
    discount: 0,
    material: {
      _id: materialId,
      fileUrl: '/api/files/view/' + materialId,
      downloadUrl: '/api/files/download/' + materialId,
      coverImageUrl: '/uploads/cover.png',
      title: 'Intro to Programming'
    }
  };

  const Transaction = require('../models/Transaction');
  const originalFind = Transaction.find;
  Transaction.find = () => ({
    populate: () => ({
      lean: async () => [fakeTransaction]
    })
  });

  try {
    const result = await getLibrary(userId, {}, { protocol: 'https', get: (header) => header === 'host' ? 'academy-platform-z3bw.onrender.com' : undefined });
    assert.equal(result[0].material.allowDownload, true);
    assert.equal(result[0].material.canDownload, true);
    assert.equal(result[0].material.fileUrl, 'https://academy-platform-z3bw.onrender.com/api/files/view/' + materialId);
  } finally {
    Transaction.find = originalFind;
  }
});
