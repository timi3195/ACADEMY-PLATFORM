const test = require('node:test');
const assert = require('node:assert/strict');

const { getMaterialById } = require('../services/marketplaceService');

test('getMaterialById returns access and download flags for purchased user', async () => {
  const materialId = '64d47d7862e63c1a7f3d2c12';
  const userId = '64d47d7862e63c1a7f3d2c11';

  const fakeMaterial = {
    _id: materialId,
    title: 'Intro to Programming',
    fileUrl: `/api/files/view/${materialId}`,
    downloadUrl: `/api/files/download/${materialId}`,
    previewPages: 4,
    pageCount: 26,
    isPaid: true,
    productStatus: 'published',
    visibility: 'public',
    hidden: false,
    lecturer: { _id: 'lect1' }
  };

  const File = require('../models/File');
  const Transaction = require('../models/Transaction');

  const originalFindById = File.findById;
  const originalTxnFind = Transaction.findOne;

  File.findById = () => ({
    populate: () => ({
      select: () => ({
        lean: async () => fakeMaterial
      })
    })
  });

  Transaction.findOne = async () => ({ _id: 'tx1', status: 'success' });

  try {
    const result = await getMaterialById(materialId, { id: userId });
    assert.ok(result, 'material should be returned');
    assert.equal(result.canDownload, true);
    assert.equal(result.allowDownload, true);
    assert.ok(result.access && result.access.hasAccess === true, 'access.hasAccess should be true');
    assert.ok(result.access.isPurchased === true || result.access.canDownload === true, 'isPurchased or canDownload should be true');
  } finally {
    File.findById = originalFindById;
    Transaction.findOne = originalTxnFind;
  }
});


test('getMaterialById does not grant download for unpurchased user', async () => {
  const materialId = '64d47d7862e63c1a7f3d2c22';
  const userId = '64d47d7862e63c1a7f3d2c21';

  const fakeMaterial = {
    _id: materialId,
    title: 'Intro to Programming',
    fileUrl: `/api/files/view/${materialId}`,
    downloadUrl: `/api/files/download/${materialId}`,
    previewPages: 4,
    pageCount: 26,
    isPaid: true,
    productStatus: 'published',
    visibility: 'public',
    hidden: false,
    lecturer: { _id: 'lect1' }
  };

  const File = require('../models/File');
  const Transaction = require('../models/Transaction');

  const originalFindById = File.findById;
  const originalTxnFind = Transaction.findOne;

  File.findById = () => ({
    populate: () => ({
      select: () => ({
        lean: async () => fakeMaterial
      })
    })
  });

  // No matching successful transaction
  Transaction.findOne = async () => null;

  try {
    const result = await getMaterialById(materialId, { id: userId });
    assert.ok(result, 'material should be returned');
    assert.equal(result.canDownload, false);
    assert.equal(result.allowDownload, false);
    assert.ok(result.access && result.access.hasAccess === false, 'access.hasAccess should be false');
  } finally {
    File.findById = originalFindById;
    Transaction.findOne = originalTxnFind;
  }
});
