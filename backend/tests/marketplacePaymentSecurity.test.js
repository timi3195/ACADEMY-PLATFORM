const test = require('node:test');
const assert = require('node:assert/strict');

process.env.PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'priority-1-7-material-test-secret';
process.env.PAYSTACK_CURRENCY = 'NGN';

const marketplaceService = require('../services/marketplaceService');
const File = require('../models/File');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const paystackService = require('../services/paystackService');

const USER_ID = '507f1f77bcf86cd799439011';
const MATERIAL_ID = '507f1f77bcf86cd799439012';
const REFERENCE = 'academy_material_test_reference';

const createPendingTransaction = (overrides = {}) => ({
  _id: 'material-transaction-1',
  user: USER_ID,
  email: 'student@example.test',
  amount: 4000,
  currency: 'NGN',
  reference: REFERENCE,
  status: 'pending',
  plan: 'material',
  paymentType: 'material',
  material: MATERIAL_ID,
  materialPrice: 4000,
  discount: 0,
  lecturer: '507f1f77bcf86cd799439013',
  platformFee: 400,
  lecturerAmount: 3600,
  ...overrides
});

const withMaterialMocks = async (run, { transaction } = {}) => {
  const original = {
    fileFindById: File.findById,
    fileFindByIdAndUpdate: File.findByIdAndUpdate,
    userFindById: User.findById,
    transactionCreate: Transaction.create,
    transactionFindOne: Transaction.findOne,
    transactionFindOneAndUpdate: Transaction.findOneAndUpdate,
    transactionCountDocuments: Transaction.countDocuments,
    canPurchase: require('../services/materialAccessService').canPurchaseMaterial,
    initialize: paystackService.initializePayment,
    verify: paystackService.verifyPayment
  };
  const state = {
    transactions: transaction ? [transaction] : [],
    initialization: null,
    verification: {
      status: 'success',
      reference: REFERENCE,
      amount: 400000,
      currency: 'NGN',
      customer: { email: 'student@example.test' },
      id: 12345,
      metadata: { amount: 0.01, materialId: 'different-material' }
    },
    verifyCount: 0,
    verifyFailureCount: 0,
    purchaseCount: 0,
    material: {
      _id: MATERIAL_ID,
      price: 4000,
      premiumDiscount: 0,
      isFree: false,
      isPaid: true,
      lecturer: {
        _id: '507f1f77bcf86cd799439013',
        paystackPayment: { verified: true, subaccountCode: 'ACT_test' }
      },
      purchases: 0,
      sales: 0,
      async save() { return this; }
    },
    user: {
      _id: USER_ID,
      id: USER_ID,
      email: 'student@example.test',
      name: 'Student',
      role: 'student',
      plan: 'basic',
      matricNumber: 'STU-001',
      yearOfStudy: 'ND1',
      department: '507f1f77bcf86cd799439014'
    }
  };

  File.findById = () => ({
    populate: async () => state.material,
    then: (resolve, reject) => Promise.resolve(state.material).then(resolve, reject)
  });
  File.findByIdAndUpdate = async (id, update) => {
    if (update.$inc) {
      state.purchaseCount += update.$inc.purchases || 0;
      state.material.purchases += update.$inc.purchases || 0;
      state.material.sales += update.$inc.sales || 0;
    }
    if (update.$set) {
      state.material.purchases = update.$set.purchases;
      state.material.sales = update.$set.sales;
      state.purchaseCount = update.$set.purchases;
    }
    return state.material;
  };
  User.findById = () => ({ lean: async () => state.user });
  Transaction.create = async (data) => {
    const created = { _id: `transaction-${state.transactions.length + 1}`, ...data };
    state.transactions.push(created);
    return created;
  };
  Transaction.findOne = async ({ reference }) =>
    state.transactions.find((item) => item.reference === reference) || null;
  Transaction.countDocuments = async (filter) => state.transactions.filter((item) =>
    Object.entries(filter).every(([key, value]) => String(item[key]) === String(value))
  ).length;
  const matchesFilter = (item, filter) => Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some((condition) => matchesFilter(item, condition));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('$lte' in value) return new Date(item[key]).getTime() <= new Date(value.$lte).getTime();
      if ('$exists' in value) return value.$exists ? item[key] !== undefined : item[key] === undefined;
      return String(item[key]) === String(value);
    }
    return String(item[key]) === String(value);
  });
  Transaction.findOneAndUpdate = async (filter, update) => {
    const found = state.transactions.find((item) => matchesFilter(item, filter));
    if (!found) return null;
    Object.assign(found, update.$set || {});
    return found;
  };
  require('../services/materialAccessService').canPurchaseMaterial = async () => ({ allowed: true });
  paystackService.initializePayment = async (payload) => {
    state.initialization = payload;
    return { authorization_url: 'https://paystack.test/material', reference: payload.reference };
  };
  paystackService.verifyPayment = async () => {
    state.verifyCount += 1;
    if (state.verifyFailureCount > 0) {
      state.verifyFailureCount -= 1;
      throw new Error('Temporary Paystack network failure');
    }
    return state.verification;
  };

  try {
    await run(state);
  } finally {
    File.findById = original.fileFindById;
    File.findByIdAndUpdate = original.fileFindByIdAndUpdate;
    User.findById = original.userFindById;
    Transaction.create = original.transactionCreate;
    Transaction.findOne = original.transactionFindOne;
    Transaction.findOneAndUpdate = original.transactionFindOneAndUpdate;
    Transaction.countDocuments = original.transactionCountDocuments;
    require('../services/materialAccessService').canPurchaseMaterial = original.canPurchase;
    paystackService.initializePayment = original.initialize;
    paystackService.verifyPayment = original.verify;
  }
};

test('material initialization stores the database price and server-owned pending transaction', async () => {
  await withMaterialMocks(async (state) => {
    const result = await marketplaceService.initializePurchase(MATERIAL_ID, { id: USER_ID });

    assert.equal(result.amount, 4000);
    assert.equal(result.currency, 'NGN');
    assert.equal(state.transactions[0].amount, 4000);
    assert.equal(state.transactions[0].user, USER_ID);
    assert.equal(state.transactions[0].material, MATERIAL_ID);
    assert.equal(state.transactions[0].paymentType, 'material');
    assert.equal(state.transactions[0].status, 'pending');
    assert.equal(state.initialization.amount, 4000);
    assert.equal(state.initialization.reference, state.transactions[0].reference);
  });
});

test('material verification ignores metadata, validates the pending amount and grants purchase once', async () => {
  await withMaterialMocks(async (state) => {
    const pending = createPendingTransaction();
    state.transactions.push(pending);
    const first = await marketplaceService.verifyPurchase(MATERIAL_ID, REFERENCE, { id: USER_ID });
    const second = await marketplaceService.verifyPurchase(MATERIAL_ID, REFERENCE, { id: USER_ID });

    assert.equal(first.status, 'success');
    assert.equal(second.status, 'success');
    assert.equal(state.verifyCount, 1);
    assert.equal(state.purchaseCount, 1);
    assert.equal(state.transactions[0].status, 'success');
  });
});

test('material verification rejects another user transaction reference', async () => {
  await withMaterialMocks(async (state) => {
    state.transactions.push(createPendingTransaction());
    await assert.rejects(
      marketplaceService.verifyPurchase(MATERIAL_ID, REFERENCE, { id: '507f1f77bcf86cd799439099' }),
      /does not belong to this user/i
    );
    assert.equal(state.verifyCount, 0);
    assert.equal(state.purchaseCount, 0);
  });
});

test('material verification rejects Paystack amount and currency mismatches', async () => {
  for (const mismatch of [
    { amount: 399999, currency: 'NGN' },
    { amount: 400001, currency: 'NGN' },
    { amount: 400000, currency: 'USD' }
  ]) {
    await withMaterialMocks(async (state) => {
      state.transactions.push(createPendingTransaction());
      state.verification = {
        status: 'success',
        reference: REFERENCE,
        amount: mismatch.amount,
        currency: mismatch.currency,
        customer: { email: 'student@example.test' }
      };

      await assert.rejects(
        marketplaceService.verifyPurchase(MATERIAL_ID, REFERENCE, { id: USER_ID }),
        /amount does not match|currency does not match/i
      );
      assert.equal(state.purchaseCount, 0);
      assert.equal(state.transactions[0].status, 'failed');
    });
  }
});

test('material verification retries after a transient Paystack failure', async () => {
  await withMaterialMocks(async (state) => {
    state.transactions.push(createPendingTransaction());
    state.verifyFailureCount = 1;

    await assert.rejects(
      marketplaceService.verifyPurchase(MATERIAL_ID, REFERENCE, { id: USER_ID }),
      /Temporary Paystack network failure/
    );
    assert.equal(state.transactions[0].status, 'pending');
    assert.equal(state.purchaseCount, 0);

    const completed = await marketplaceService.verifyPurchase(MATERIAL_ID, REFERENCE, { id: USER_ID });
    assert.equal(completed.status, 'success');
    assert.equal(state.transactions[0].status, 'success');
    assert.equal(state.purchaseCount, 1);
    assert.equal(state.material.purchases, 1);
    assert.equal(state.material.sales, 1);
    assert.equal(state.verifyCount, 2);
  });
});

test('successful material payment retries metric reconciliation without duplicate increments', async () => {
  await withMaterialMocks(async (state) => {
    state.transactions.push(createPendingTransaction());
    await marketplaceService.verifyPurchase(MATERIAL_ID, REFERENCE, { id: USER_ID });
    const retry = await marketplaceService.verifyPurchase(MATERIAL_ID, REFERENCE, { id: USER_ID });

    assert.equal(retry.status, 'success');
    assert.equal(state.verifyCount, 1);
    assert.equal(state.purchaseCount, 1);
    assert.equal(state.material.purchases, 1);
    assert.equal(state.material.sales, 1);
  });
});
