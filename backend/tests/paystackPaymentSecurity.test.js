const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");
const request = require("supertest");

process.env.JWT_SECRET = process.env.JWT_SECRET || "deferred-paystack-test-secret";
process.env.PAYSTACK_SECRET_KEY = "deferred-paystack-webhook-test-secret";

const { generateAccessToken } = require("../utils/token");
const paymentsRouter = require("../routes/payments");
const Transaction = require("../models/Transaction");
const User = require("../models/User");

const USER_ID = "507f1f77bcf86cd799439011";

const buildApp = () => {
  const app = express();
  app.use(express.json({
    verify: (req, res, buffer) => {
      if (req.originalUrl === "/api/payments/webhook") {
        req.rawBody = Buffer.from(buffer);
      }
    }
  }));
  const token = generateAccessToken(USER_ID, {
    email: "student@example.test",
    role: "student"
  });
  app.use((req, res, next) => {
    req.headers.authorization = `Bearer ${token}`;
    next();
  });
  app.use("/api/payments", paymentsRouter);
  return app;
};

test("subscription initialization and verification are unavailable", async () => {
  const app = buildApp();
  const initialize = await request(app)
    .post("/api/payments/initialize")
    .send({ plan: "premium", semester: "2026-1" });
  const verify = await request(app).get("/api/payments/verify/payment-reference");

  for (const response of [initialize, verify]) {
    assert.equal(response.status, 410);
    assert.equal(response.body.code, "COMMERCE_UNAVAILABLE");
    assert.equal(response.body.message, "Payments and marketplace commerce are unavailable in this release.");
  }
});

test("valid signed payment webhooks are acknowledged without processing transactions", async () => {
  const original = {
    create: Transaction.create,
    findOne: Transaction.findOne,
    findOneAndUpdate: Transaction.findOneAndUpdate,
    findById: User.findById
  };
  let databaseCalls = 0;
  for (const method of ["create", "findOne", "findOneAndUpdate"]) {
    Transaction[method] = async () => {
      databaseCalls += 1;
      throw new Error("Disabled commerce must not write transactions");
    };
  }
  User.findById = async () => {
    databaseCalls += 1;
    throw new Error("Disabled commerce must not change subscription access");
  };

  try {
    const app = buildApp();
    const payload = JSON.stringify({
      event: "charge.success",
      data: { status: "success", reference: "deferred-test-reference" }
    });
    const signature = crypto
      .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
      .update(payload)
      .digest("hex");

    const response = await request(app)
      .post("/api/payments/webhook")
      .set("Content-Type", "application/json")
      .set("x-paystack-signature", signature)
      .send(payload);

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.ignored, true);
    assert.equal(response.body.commerceDisabled, true);
    assert.equal(databaseCalls, 0);
  } finally {
    Transaction.create = original.create;
    Transaction.findOne = original.findOne;
    Transaction.findOneAndUpdate = original.findOneAndUpdate;
    User.findById = original.findById;
  }
});

test("invalid or missing webhook signatures remain rejected", async (t) => {
  for (const signature of [undefined, "invalid"]) {
    await t.test(signature ? "invalid signature" : "missing signature", async () => {
      const builder = request(buildApp())
        .post("/api/payments/webhook")
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ event: "charge.success" }));
      if (signature) builder.set("x-paystack-signature", signature);

      const response = await builder;
      assert.equal(response.status, 401);
      assert.equal(response.body.message, "Invalid Paystack webhook signature");
    });
  }
});
