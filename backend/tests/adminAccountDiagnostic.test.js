const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const mongoose = require("mongoose");

const User = require("../models/User");
const adminRouter = require("../routes/admin");

const DIAGNOSTIC_SECRET = "0123456789abcdef0123456789abcdef";
const app = express();
const observedClientIps = [];
app.set("trust proxy", true);
app.use(express.json());
app.use((req, res, next) => {
  observedClientIps.push(req.ip);
  next();
});
app.use("/api/admin", adminRouter);

const withDiagnosticSecret = async (secret, run) => {
  const previous = process.env.ACCOUNT_DIAGNOSTIC_SECRET;
  if (secret === undefined) delete process.env.ACCOUNT_DIAGNOSTIC_SECRET;
  else process.env.ACCOUNT_DIAGNOSTIC_SECRET = secret;

  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.ACCOUNT_DIAGNOSTIC_SECRET;
    else process.env.ACCOUNT_DIAGNOSTIC_SECRET = previous;
  }
};

const diagnosticRequest = () => request(app).post("/api/admin/account-diagnostic");

test("invalid diagnostics do not consume the five valid-request quota", async () => {
  const originalCountDocuments = User.countDocuments;
  const originalFind = User.find;
  const originalDatabaseName = mongoose.connection.name;
  const registeredAt = new Date("2025-01-02T03:04:05.000Z");
  let selectedFields;
  let countCalls = 0;
  let findCalls = 0;

  mongoose.connection.name = "academy_test";
  User.countDocuments = async (filter) => {
    countCalls += 1;
    assert.deepEqual(filter, {});
    return 2;
  };
  User.find = (filter) => {
    findCalls += 1;
    assert.deepEqual(filter, {});
    return {
      select(fields) {
        selectedFields = fields;
        return this;
      },
      sort(fields) {
        assert.deepEqual(fields, { createdAt: 1 });
        return this;
      },
      lean: async () => [
        {
          email: "timilehin@example.com",
          role: "admin",
          createdAt: registeredAt,
          emailVerified: true,
          password: "must-not-be-returned",
          resetPasswordToken: "must-not-be-returned"
        },
        {
          email: "student@example.test",
          role: "student",
          createdAt: null,
          emailVerified: false,
          password: "must-not-be-returned",
          resetPasswordToken: "must-not-be-returned"
        }
      ]
    };
  };

  try {
    await withDiagnosticSecret(DIAGNOSTIC_SECRET, async () => {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const missing = await diagnosticRequest().send({});
        assert.equal(missing.status, 404);
        assert.deepEqual(missing.body, { success: false, message: "Not found." });
      }

      const shortConfiguredSecret = await withDiagnosticSecret("short-secret", () =>
        diagnosticRequest().send({ secret: "short-secret" })
      );
      assert.equal(shortConfiguredSecret.status, 404);
      assert.deepEqual(shortConfiguredSecret.body, { success: false, message: "Not found." });

      const emptyConfiguredSecret = await withDiagnosticSecret("", () =>
        diagnosticRequest().send({ secret: "" })
      );
      assert.equal(emptyConfiguredSecret.status, 404);
      assert.deepEqual(emptyConfiguredSecret.body, { success: false, message: "Not found." });

      const incorrect = await diagnosticRequest()
        .set("X-Forwarded-For", "198.51.100.10")
        .send({ secret: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" });
      assert.equal(incorrect.status, 404);
      assert.deepEqual(incorrect.body, { success: false, message: "Not found." });

      const unequalLength = await diagnosticRequest()
        .set("X-Forwarded-For", "203.0.113.200")
        .send({ secret: `${DIAGNOSTIC_SECRET}x` });
      assert.equal(unequalLength.status, 404);
      assert.deepEqual(unequalLength.body, { success: false, message: "Not found." });
    });

    await withDiagnosticSecret(undefined, async () => {
      const disabled = await diagnosticRequest()
        .set("X-Forwarded-For", "192.0.2.220")
        .send({ secret: DIAGNOSTIC_SECRET });
      assert.equal(disabled.status, 404);
      assert.deepEqual(disabled.body, { success: false, message: "Not found." });
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const success = await withDiagnosticSecret(DIAGNOSTIC_SECRET, () =>
        diagnosticRequest()
          .set("X-Forwarded-For", `192.0.2.${attempt + 1}`)
          .send({ secret: DIAGNOSTIC_SECRET })
      );
      assert.equal(success.status, 200);
      assert.deepEqual(selectedFields, "email role createdAt emailVerified -_id");
      assert.equal(success.body.success, true);
      assert.equal(success.body.database, "academy_test");
      assert.equal(success.body.totalUsers, 2);
      assert.deepEqual(success.body.users, [
        {
          email: "ti*****@example.com",
          role: "admin",
          registeredAt: registeredAt.toISOString(),
          emailVerified: true
        },
        {
          email: "st*****@example.test",
          role: "student",
          registeredAt: null,
          emailVerified: false
        }
      ]);

      const serializedResponse = JSON.stringify(success.body);
      assert.ok(!serializedResponse.includes("timilehin@example.com"));
      assert.ok(!serializedResponse.includes("student@example.test"));
      assert.ok(!serializedResponse.includes("must-not-be-returned"));
      assert.ok(!serializedResponse.includes(DIAGNOSTIC_SECRET));
      assert.ok(!Object.hasOwn(success.body, "connectionString"));
    }

    const sixthValid = await withDiagnosticSecret(DIAGNOSTIC_SECRET, () =>
      diagnosticRequest()
        .set("X-Forwarded-For", "192.0.2.250")
        .send({ secret: DIAGNOSTIC_SECRET })
    );
    assert.equal(sixthValid.status, 429);

    assert.ok(new Set(observedClientIps).size >= 3);
    assert.equal(countCalls, 5);
    assert.equal(findCalls, 5);
  } finally {
    User.countDocuments = originalCountDocuments;
    User.find = originalFind;
    if (originalDatabaseName === undefined) delete mongoose.connection.name;
    else mongoose.connection.name = originalDatabaseName;
  }
});
