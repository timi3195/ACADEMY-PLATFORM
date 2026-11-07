const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');
const axios = require('axios');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'priority-1-7-payment-test-secret';
process.env.PAYSTACK_SECRET_KEY = 'priority-1-7-paystack-test-secret';
process.env.PAYSTACK_CURRENCY = 'NGN';

const { generateAccessToken } = require('../utils/token');
const paymentsRouter = require('../routes/payments');
const Transaction = require('../models/Transaction');
const User = require('../models/User');

const USER_A = '507f1f77bcf86cd799439011';
const USER_B = '507f1f77bcf86cd799439012';
const REFERENCE = 'academy_test_reference';
const PROCESSING_LEASE_MS = 2 * 60 * 1000;

const buildApp = (userId = USER_A) => {
  const app = express();
  app.use(express.json({
    verify: (req, res, buffer) => {
      if (req.originalUrl.split('?')[0] === '/api/payments/webhook') {
        req.rawBody = Buffer.from(buffer);
      }
    }
  }));
  const token = generateAccessToken(userId, { email: 'student@example.test', role: 'student' });
  app.use((req, res, next) => {
    req.headers.authorization = `Bearer ${token}`;
    next();
  });
  app.use('/api/payments', paymentsRouter);
  return app;
};

const createPendingTransaction = (overrides = {}) => ({
  _id: 'transaction-1',
  user: USER_A,
  email: 'student@example.test',
  amount: 15000,
  currency: 'NGN',
  reference: REFERENCE,
  status: 'pending',
  createdAt: new Date(),
  plan: 'premium',
  paymentType: 'semester',
  semester: '2026-1',
  ...overrides
});

const successfulPayment = (overrides = {}) => ({
  status: 'success',
  reference: REFERENCE,
  amount: 1500000,
  currency: 'NGN',
  customer: { email: 'student@example.test' },
  id: 98765,
  metadata: { expectedAmount: 0.01, plan: 'basic', userId: USER_B },
  ...overrides
});

const withPaymentMocks = async (run, { transaction, userId = USER_A } = {}) => {
  const original = {
    create: Transaction.create,
    findOne: Transaction.findOne,
    findOneAndUpdate: Transaction.findOneAndUpdate,
    findById: User.findById,
    axiosGet: axios.get,
    axiosPost: axios.post
  };
  const state = {
    transactions: transaction ? [transaction] : [],
    user: {
      _id: userId,
      email: 'student@example.test',
      saveCount: 0,
      async save() {
        this.saveCount += 1;
        if (state.failSaveCount > 0) {
          state.failSaveCount -= 1;
          Object.assign(this, persistedSubscription);
          throw new Error('Temporary user database failure');
        }
        Object.assign(persistedSubscription, {
          plan: this.plan,
          subscriptionType: this.subscriptionType,
          subscriptionSemester: this.subscriptionSemester,
          subscriptionExpiresAt: this.subscriptionExpiresAt
        });
        return this;
      }
    },
    getCount: 0,
    getStarted: null,
    signalGetStarted: null,
    postCount: 0,
    postFailure: null,
    failCompletion: false,
    failSaveCount: 0,
    getFailureCount: 0,
    initializePayload: null,
    paystackData: successfulPayment(),
    getDelay: 0
  };
  state.getStarted = new Promise((resolve) => {
    state.signalGetStarted = resolve;
  });
  const persistedSubscription = {
    plan: 'free',
    subscriptionType: 'free',
    subscriptionSemester: null,
    subscriptionExpiresAt: null
  };
  Object.assign(state.user, persistedSubscription);

  Transaction.create = async (data) => {
    const created = { _id: `transaction-${state.transactions.length + 1}`, ...data };
    state.transactions.push(created);
    return created;
  };
  Transaction.findOne = async ({ reference }) =>
    state.transactions.find((item) => item.reference === reference) || null;
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
    if (state.failCompletion && update.$set?.status === 'success') {
      state.failCompletion = false;
      return null;
    }
    const found = state.transactions.find((item) =>
      matchesFilter(item, filter)
    );
    if (!found) return null;
    Object.assign(found, update.$set || {});
    return found;
  };
  User.findById = async (id) => String(id) === String(state.user._id) ? state.user : null;
  axios.get = async () => {
    state.getCount += 1;
    state.signalGetStarted();
    if (state.getDelay) await new Promise((resolve) => setTimeout(resolve, state.getDelay));
    if (state.getFailureCount > 0) {
      state.getFailureCount -= 1;
      throw new Error('Temporary Paystack network failure');
    }
    return { data: { status: true, data: state.paystackData } };
  };
  axios.post = async (url, payload) => {
    state.postCount += 1;
    state.initializePayload = payload;
    if (state.postFailure) throw state.postFailure;
    return {
      data: {
        status: true,
        data: {
          authorization_url: 'https://paystack.test/authorize',
          reference: payload.reference
        }
      }
    };
  };

  try {
    await run(state);
  } finally {
    Transaction.create = original.create;
    Transaction.findOne = original.findOne;
    Transaction.findOneAndUpdate = original.findOneAndUpdate;
    User.findById = original.findById;
    axios.get = original.axiosGet;
    axios.post = original.axiosPost;
  }
};

const postWebhook = (app, data) => {
  const rawBody = JSON.stringify({ event: 'charge.success', data });
  const signature = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(Buffer.from(rawBody))
    .digest('hex');
  return request(app)
    .post('/api/payments/webhook')
    .set('Content-Type', 'application/json')
    .set('x-paystack-signature', signature)
    .send(rawBody);
};

test('initialization ignores a client-controlled amount and stores server plan price', async () => {
  await withPaymentMocks(async (state) => {
    const response = await request(buildApp())
      .post('/api/payments/initialize')
      .send({
        amount: 0.01,
        plan: 'premium',
        semester: '2026-1',
        currency: 'NGN',
        userId: USER_B,
        email: 'attacker@example.test'
      });

    assert.equal(response.status, 200);
    assert.equal(state.transactions[0].amount, 15000);
    assert.equal(state.transactions[0].user, USER_A);
    assert.equal(state.transactions[0].email, 'student@example.test');
    assert.equal(state.transactions[0].status, 'pending');
    assert.equal(state.initializePayload.amount, 1500000);
    assert.equal(state.initializePayload.currency, 'NGN');
  });
});

test('initialization rejects a client-controlled currency mismatch', async () => {
  await withPaymentMocks(async (state) => {
    const response = await request(buildApp())
      .post('/api/payments/initialize')
      .send({ amount: 15000, plan: 'premium', semester: '2026-1', currency: 'USD' });

    assert.equal(response.status, 400);
    assert.equal(state.postCount, 0);
    assert.equal(state.transactions.length, 0);
  });
});

test('failed Paystack initialization leaves no successful transaction', async () => {
  await withPaymentMocks(async (state) => {
    state.postFailure = new Error('Paystack unavailable');
    const response = await request(buildApp())
      .post('/api/payments/initialize')
      .send({ amount: 15000, plan: 'premium', semester: '2026-1' });

    assert.equal(response.status, 500);
    assert.equal(state.transactions.length, 1);
    assert.equal(state.transactions[0].status, 'failed');
  });
});

test('verification rejects a missing pending transaction', async () => {
  await withPaymentMocks(async (state) => {
    const response = await request(buildApp()).get(`/api/payments/verify/${REFERENCE}`);
    assert.equal(response.status, 404);
    assert.equal(state.getCount, 0);
    assert.equal(state.user.saveCount, 0);
  });
});

test('verification rejects another user transaction reference', async () => {
  await withPaymentMocks(async (state) => {
    const response = await request(buildApp(USER_B)).get(`/api/payments/verify/${REFERENCE}`);
    assert.equal(response.status, 403);
    assert.equal(state.getCount, 0);
    assert.equal(state.user.saveCount, 0);
  }, { transaction: createPendingTransaction() });
});

for (const [label, override] of [
  ['lower amount', { amount: 1499999 }],
  ['higher amount', { amount: 1500001 }],
  ['incorrect currency', { currency: 'USD' }],
  ['different transaction reference', { reference: 'some_other_reference' }],
  ['failed Paystack transaction', { status: 'failed' }]
]) {
  test(`verification rejects a Paystack response with ${label}`, async () => {
    await withPaymentMocks(async (state) => {
      state.paystackData = successfulPayment(override);
      const response = await request(buildApp()).get(`/api/payments/verify/${REFERENCE}`);
      assert.equal(response.status, 400);
      assert.equal(state.transactions[0].status, 'failed');
      assert.equal(state.user.saveCount, 0);
    }, { transaction: createPendingTransaction() });
  });
}

test('duplicate verification grants subscription access exactly once', async () => {
  await withPaymentMocks(async (state) => {
    const app = buildApp();
    const first = await request(app).get(`/api/payments/verify/${REFERENCE}`);
    const second = await request(app).get(`/api/payments/verify/${REFERENCE}`);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(state.user.saveCount, 1);
    assert.equal(state.getCount, 1);
    assert.equal(state.transactions[0].status, 'success');
  }, { transaction: createPendingTransaction() });
});

test('verification does not grant subscription access when transaction completion fails', async () => {
  await withPaymentMocks(async (state) => {
    state.failCompletion = true;
    const response = await request(buildApp()).get(`/api/payments/verify/${REFERENCE}`);
    assert.equal(response.status, 409);
    assert.equal(state.user.saveCount, 0);
    assert.notEqual(state.transactions[0].status, 'success');
  }, { transaction: createPendingTransaction() });
});

test('a stale processing transaction is reclaimed and verified after interruption', async () => {
  await withPaymentMocks(async (state) => {
    const app = buildApp();
    const response = await request(app).get(`/api/payments/verify/${REFERENCE}`);
    assert.equal(response.status, 200);
    assert.equal(state.getCount, 1);
    assert.equal(state.user.saveCount, 1);
    assert.equal(state.transactions[0].status, 'success');
  }, {
    transaction: createPendingTransaction({
      status: 'processing',
      processingStartedAt: new Date(Date.now() - PROCESSING_LEASE_MS - 1000),
      processingToken: 'abandoned-attempt',
      createdAt: new Date(Date.now() - PROCESSING_LEASE_MS - 1000)
    })
  });
});

test('a transient Paystack failure releases the claim for safe retry', async () => {
  await withPaymentMocks(async (state) => {
    state.getFailureCount = 1;
    const app = buildApp();
    const first = await request(app).get(`/api/payments/verify/${REFERENCE}`);
    assert.equal(first.status, 500);
    assert.equal(state.transactions[0].status, 'pending');
    assert.equal(state.user.saveCount, 0);

    const retry = await request(app).get(`/api/payments/verify/${REFERENCE}`);
    assert.equal(retry.status, 200);
    assert.equal(state.transactions[0].status, 'success');
    assert.equal(state.user.saveCount, 1);
    assert.equal(state.getCount, 2);
  }, { transaction: createPendingTransaction() });
});

test('a recorded successful payment retries access activation after a server interruption', async () => {
  await withPaymentMocks(async (state) => {
    state.failSaveCount = 1;
    const app = buildApp();
    const first = await request(app).get(`/api/payments/verify/${REFERENCE}`);
    assert.equal(first.status, 500);
    assert.equal(state.transactions[0].status, 'success');
    assert.equal(state.user.saveCount, 1);

    const retry = await request(app).get(`/api/payments/verify/${REFERENCE}`);
    assert.equal(retry.status, 200);
    assert.equal(state.user.saveCount, 2);
    assert.equal(state.getCount, 1);
  }, { transaction: createPendingTransaction() });
});

test('concurrent verification cannot claim one pending transaction twice', async () => {
  await withPaymentMocks(async (state) => {
    state.getDelay = 100;
    const app = buildApp();
    const firstPromise = request(app).get(`/api/payments/verify/${REFERENCE}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const secondPromise = request(app).get(`/api/payments/verify/${REFERENCE}`);
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    assert.equal(second.status, 409);
    assert.equal(first.status, 200);
    assert.equal(state.getCount, 1);
    assert.equal(state.user.saveCount, 1);
  }, { transaction: createPendingTransaction() });
});

test('simultaneous verification and webhook cannot claim the same payment twice', async () => {
  await withPaymentMocks(async (state) => {
    state.getDelay = 300;
    const app = buildApp();
    const verificationPromise = request(app).get(`/api/payments/verify/${REFERENCE}`).then((response) => response);
    await state.getStarted;
    const webhookResponse = await postWebhook(app, successfulPayment());
    const verificationResponse = await verificationPromise;

    assert.equal(webhookResponse.status, 409);
    assert.equal(verificationResponse.status, 200);
    assert.equal(state.getCount, 1);
    assert.equal(state.user.saveCount, 1);
    assert.equal(state.transactions[0].status, 'success');
  }, { transaction: createPendingTransaction() });
});

test('duplicate webhook delivery grants subscription access exactly once', async () => {
  await withPaymentMocks(async (state) => {
    const app = buildApp();
    const data = successfulPayment();
    const first = await postWebhook(app, data);
    const second = await postWebhook(app, data);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(state.user.saveCount, 1);
    assert.equal(state.transactions[0].status, 'success');
  }, { transaction: createPendingTransaction() });
});

test('a duplicate webhook can recover subscription access after a server interruption', async () => {
  await withPaymentMocks(async (state) => {
    state.failSaveCount = 1;
    const app = buildApp();
    const first = await postWebhook(app, successfulPayment());
    assert.equal(first.status, 500);
    assert.equal(state.transactions[0].status, 'success');
    assert.equal(state.user.saveCount, 1);

    const retry = await postWebhook(app, successfulPayment());
    assert.equal(retry.status, 200);
    assert.equal(state.user.saveCount, 2);
    assert.equal(state.transactions[0].status, 'success');
  }, { transaction: createPendingTransaction() });
});

test('webhook can retry after payment verification but before success is recorded', async () => {
  await withPaymentMocks(async (state) => {
    state.failCompletion = true;
    const app = buildApp();
    const first = await postWebhook(app, successfulPayment());
    assert.equal(first.status, 409);
    assert.equal(state.transactions[0].status, 'pending');
    assert.equal(state.user.saveCount, 0);

    const retry = await postWebhook(app, successfulPayment());
    assert.equal(retry.status, 200);
    assert.equal(state.transactions[0].status, 'success');
    assert.equal(state.user.saveCount, 1);
  }, { transaction: createPendingTransaction() });
});

test('webhook rejects an invalid raw-body signature before transaction processing', async () => {
  await withPaymentMocks(async (state) => {
    const rawBody = JSON.stringify({ event: 'charge.success', data: successfulPayment() });
    const response = await request(buildApp())
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', '0'.repeat(128))
      .send(rawBody);

    assert.equal(response.status, 401);
    assert.equal(state.user.saveCount, 0);
    assert.equal(state.transactions[0].status, 'pending');
  }, { transaction: createPendingTransaction() });
});

test('webhook rejects an amount mismatch without granting access', async () => {
  await withPaymentMocks(async (state) => {
    const response = await postWebhook(buildApp(), successfulPayment({ amount: 1499999 }));
    assert.equal(response.status, 400);
    assert.equal(state.user.saveCount, 0);
    assert.equal(state.transactions[0].status, 'failed');
  }, { transaction: createPendingTransaction() });
});

test('webhook rejects a currency mismatch without granting access', async () => {
  await withPaymentMocks(async (state) => {
    const response = await postWebhook(buildApp(), successfulPayment({ currency: 'USD' }));
    assert.equal(response.status, 400);
    assert.equal(state.user.saveCount, 0);
    assert.equal(state.transactions[0].status, 'failed');
  }, { transaction: createPendingTransaction() });
});
