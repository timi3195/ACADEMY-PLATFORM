const test = require('node:test');
const assert = require('node:assert/strict');

const { getMaterialById } = require('../services/marketplaceService');
const marketplaceService = require('../services/marketplaceService');
const materialAccessService = require('../services/materialAccessService');

const publishedMaterial = (overrides = {}) => ({
  _id: '64d47d7862e63c1a7f3d2c12',
  title: 'Published material',
  fileUrl: '/api/files/view/64d47d7862e63c1a7f3d2c12',
  productStatus: 'published',
  status: 'published',
  approved: true,
  visibility: 'public',
  hidden: false,
  isDeleted: false,
  deletedAt: null,
  lecturer: { _id: 'lecturer-id' },
  ...overrides
});

const stubMaterialLookup = (File, material) => {
  File.findById = () => ({
    populate: () => ({
      select: () => ({
        lean: async () => material
      })
    })
  });
};

test('getMaterialById returns access independent of purchase history', async () => {
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
    status: 'published',
    approved: true,
    visibility: 'public',
    hidden: false,
    isDeleted: false,
    deletedAt: null,
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
    assert.equal(result.access.isPurchased, false);
  } finally {
    File.findById = originalFindById;
    Transaction.findOne = originalTxnFind;
  }
});


test('getMaterialById grants access without a purchase record', async () => {
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
    status: 'published',
    approved: true,
    visibility: 'public',
    hidden: false,
    isDeleted: false,
    deletedAt: null,
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

  Transaction.findOne = async () => {
    throw new Error('Free marketplace access must not query purchases');
  };

  try {
    const result = await getMaterialById(materialId, { id: userId });
    assert.ok(result, 'material should be returned');
    assert.equal(result.canDownload, true);
    assert.equal(result.allowDownload, true);
    assert.ok(result.access && result.access.hasAccess === true, 'access.hasAccess should be true');
    assert.equal(result.access.isPurchased, false);
  } finally {
    File.findById = originalFindById;
    Transaction.findOne = originalTxnFind;
  }
});

test('course-associated marketplace access metadata respects course membership', async (t) => {
  const File = require('../models/File');
  const User = require('../models/User');
  const Course = require('../models/course');
  const materialId = '64d47d7862e63c1a7f3d2c32';
  const departmentId = '507f1f77bcf86cd799439041';
  const course = {
    _id: '507f1f77bcf86cd799439031',
    title: 'Applied Mathematics',
    code: 'MATH101',
    department: departmentId,
    level: 'ND1',
    semester: 'First'
  };
  const material = publishedMaterial({
    _id: materialId,
    course: course.title,
    courseCode: course.code,
    department: departmentId,
    level: course.level,
    semester: course.semester,
    category: 'Lecture Notes',
    materialType: 'Lecture Note'
  });
  const originals = {
    findById: File.findById,
    userFindById: User.findById,
    courseFind: Course.find
  };

  File.findById = () => ({
    populate() { return this; },
    select() { return this; },
    lean: async () => material,
    then: (resolve, reject) => Promise.resolve(material).then(resolve, reject)
  });
  User.findById = (userId) => ({
    lean: async () => ({
      _id: userId,
      id: userId,
      role: 'student',
      department: departmentId,
      yearOfStudy: 'ND1',
      semester: 'First',
      coursesEnrolled: [course._id]
    })
  });
  Course.find = async (query) => query.code === course.code ? [course] : [];

  try {
    for (const [label, user, expectedAccess] of [
      ['same-department student without enrollment', {
        id: '507f1f77bcf86cd799439051',
        coursesEnrolled: []
      }, true],
      [
        'cross-department student remains denied despite enrollment',
        {
          id: '507f1f77bcf86cd799439052',
          department: '507f1f77bcf86cd799439099',
          coursesEnrolled: [course._id]
        },
        false
      ],
      [
        'same-department access ignores academic profile fields',
        {
          id: '507f1f77bcf86cd799439053',
          yearOfStudy: 'HND2',
          coursesEnrolled: [course._id]
        },
        true
      ]
    ]) {
      await t.test(label, async () => {
        const baseStudent = {
          role: 'student',
          department: departmentId,
          yearOfStudy: 'ND1',
          semester: 'First',
          ...user,
          coursesEnrolled: user.coursesEnrolled || []
        };
        User.findById = (userId) => ({
          lean: async () => ({ ...baseStudent, _id: userId, id: userId })
        });

        const detail = await getMaterialById(materialId, baseStudent);
        const access = await marketplaceService.getMaterialAccess(baseStudent.id, materialId);

        assert.equal(detail.access.hasAccess, expectedAccess);
        assert.equal(detail.canDownload, expectedAccess);
        assert.equal(access.access, expectedAccess);
        if (!expectedAccess) {
          assert.equal(detail.access.reason, "course_membership_required");
          assert.equal(access.reason, detail.access.reason);
        } else {
          assert.equal(detail.access.reason, 'available_without_purchase');
          assert.equal(access.reason, 'available_without_purchase');
        }
      });
    }
  } finally {
    File.findById = originals.findById;
    User.findById = originals.userFindById;
    Course.find = originals.courseFind;
  }
});

test('marketplace listings apply shared publication rules and remain public-only', async () => {
  const File = require('../models/File');
  const Course = require('../models/course');
  const Department = require('../models/Department');
  const originals = {
    find: File.find,
    countDocuments: File.countDocuments,
    courseFindById: Course.findById,
    departmentFindById: Department.findById
  };
  const publicItem = publishedMaterial();
  const unlistedItem = publishedMaterial({ visibility: 'unlisted' });
  const invalidItems = [
    publishedMaterial({ productStatus: 'draft' }),
    publishedMaterial({ status: 'draft' }),
    publishedMaterial({ approved: false }),
    publishedMaterial({ status: 'pending', approved: false }),
    publishedMaterial({ status: 'rejected', approved: false }),
    publishedMaterial({ hidden: true }),
    publishedMaterial({ isDeleted: true }),
    publishedMaterial({ deletedAt: new Date() })
  ];
  const filters = [];
  const rows = [publicItem, unlistedItem, ...invalidItems];

  File.countDocuments = async (filter) => {
    filters.push(filter);
    return 1;
  };
  File.find = (filter) => {
    filters.push(filter);
    return {
      populate() { return this; },
      sort() { return this; },
      skip() { return this; },
      limit() { return this; },
      lean: async () => rows.filter((item) =>
        materialAccessService.isMarketplaceMaterial(item) && item.visibility === 'public'
      )
    };
  };
  Course.findById = () => ({ select: () => ({ lean: async () => null }) });
  Department.findById = () => ({ select: () => ({ lean: async () => null }) });

  try {
    const result = await marketplaceService.listMaterials({});
    assert.equal(result.materials.length, 1);
    assert.equal(result.materials[0]._id, publicItem._id);

    for (const filter of filters) {
      assert.equal(filter.productStatus, 'published');
      assert.equal(filter.approved, true);
      assert.deepEqual(filter.status, { $in: ['published', 'approved'] });
      assert.equal(filter.visibility, 'public');
      assert.equal(filter.hidden, false);
      assert.equal(filter.isDeleted, false);
      assert.equal(filter.deletedAt, null);
    }
  } finally {
    File.find = originals.find;
    File.countDocuments = originals.countDocuments;
    Course.findById = originals.courseFindById;
    Department.findById = originals.departmentFindById;
  }
});

test('material detail requires publication eligibility and allows public or unlisted access', async (t) => {
  const File = require('../models/File');
  const originalFindById = File.findById;
  const cases = [
    ['public', publishedMaterial(), true],
    ['unlisted', publishedMaterial({ visibility: 'unlisted' }), true],
    ['draft', publishedMaterial({ productStatus: 'draft' }), false],
    ['archived', publishedMaterial({ productStatus: 'archived' }), false],
    ['hidden status', publishedMaterial({ status: 'hidden' }), false],
    ['pending', publishedMaterial({ status: 'pending', approved: false }), false],
    ['rejected', publishedMaterial({ status: 'rejected', approved: false }), false],
    ['unapproved', publishedMaterial({ approved: false }), false],
    ['hidden', publishedMaterial({ hidden: true }), false],
    ['deleted', publishedMaterial({ isDeleted: true }), false],
    ['soft-deleted', publishedMaterial({ deletedAt: new Date() }), false]
  ];

  try {
    for (const [label, material, expected] of cases) {
      await t.test(label, async () => {
        stubMaterialLookup(File, material);
        assert.equal(Boolean(await getMaterialById(material._id)), expected);
      });
    }
  } finally {
    File.findById = originalFindById;
  }
});
