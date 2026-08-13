const test = require('node:test');
const assert = require('node:assert/strict');

const marketplaceController = require('../controllers/marketplaceController');
const marketplaceService = require('../services/marketplaceService');
const fileRoutes = require('../routes/file');

test('controller passes req.user into getMaterialById', async () => {
  const called = { args: null };
  const original = marketplaceService.getMaterialById;
  marketplaceService.getMaterialById = async (id, user) => {
    called.args = { id, user };
    return { _id: id, title: 'fake' };
  };

  const req = { params: { id: 'abc123' }, user: { id: 'user-1' } };
  const sent = {};
  const res = {
    json: (payload) => { sent.payload = payload; }
  };

  try {
    await marketplaceController.getMaterial(req, res);
    assert.ok(called.args, 'service should be called');
    assert.equal(called.args.user.id, 'user-1');
    assert.equal(sent.payload.success, true);
  } finally {
    marketplaceService.getMaterialById = original;
  }
});

test('getMaterialById returns preview for unauthenticated user (no access object)', async () => {
  const { getMaterialById } = require('../services/marketplaceService');

  const fakeMaterial = {
    _id: '64d47d7862e63c1a7f3d2c12',
    title: 'Preview Only',
    fileUrl: `/api/files/view/64d47d7862e63c1a7f3d2c12`,
    downloadUrl: `/api/files/download/64d47d7862e63c1a7f3d2c12`,
    previewPages: 2,
    pageCount: 10,
    isPaid: true,
    productStatus: 'published',
    visibility: 'public',
    hidden: false,
    lecturer: { _id: 'lect1' }
  };

  const File = require('../models/File');
  const originalFindById = File.findById;
  File.findById = () => ({
    populate: () => ({
      select: () => ({
        lean: async () => fakeMaterial
      })
    })
  });

  try {
    const result = await getMaterialById('64d47d7862e63c1a7f3d2c12', null);
    assert.ok(result, 'material should be returned for public preview');
    assert.ok(!result.access, 'unauthenticated requests should not receive access object');
  } finally {
    File.findById = originalFindById;
  }
});

test('file routes have protect middleware for view and download', () => {
  const routes = fileRoutes.router.stack.filter(Boolean).map(layer => layer.route).filter(Boolean);
  const viewRoute = routes.find(r => r.path === '/view/:id');
  const downloadRoute = routes.find(r => r.path === '/download/:id');
  assert.ok(viewRoute, 'view route must exist');
  assert.ok(downloadRoute, 'download route must exist');

  const viewHandlers = viewRoute.stack.map(s => s.name);
  const downloadHandlers = downloadRoute.stack.map(s => s.name);
  assert.ok(viewHandlers.includes('protect'), 'view route must include protect middleware');
  assert.ok(downloadHandlers.includes('protect'), 'download route must include protect middleware');
});
